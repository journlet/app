// Publishing this device's key, and sharing the data key with the others
// (spec/device-identity-design.md, step 2).
//
// Step 2 is invisible when it works, which is exactly the kind of change that
// can be broken for weeks without anyone noticing. So the assertions are about
// what reaches the server and what does not: an extra write every launch, or a
// stale row left behind, would both look like success from the outside.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { generateDataKey } from "../src/lib/crypto";
import {
  exportDevicePublicKey,
  generateDeviceKeyPair,
  unwrapDataKeyForDevice,
} from "../src/lib/deviceKeys";
import type { DeviceWrappedKeyJson } from "../src/lib/deviceKeys";

const USER = "11111111-1111-4111-8111-111111111111";

/** This device's keypair, swapped between tests to stand in for a wipe. */
let myPair: CryptoKeyPair;

vi.mock("../src/lib/keystore", () => ({
  ensureDeviceKeyPair: async () => myPair,
}));

// The fake below deliberately puts `then` on its query builders, because that is
// how postgrest-js works: a builder is awaited directly with no terminal call, so
// a stub that does not do the same cannot stand in for it.
/* oxlint-disable unicorn/no-thenable */

type Row = Record<string, unknown>;

/** Every write the fake server received, in order, for asserting on silence. */
let writes: { table: string; op: string; row?: Row; filters?: [string, unknown][] }[] = [];
let tables: Record<string, Row[]> = {};
/** `table:op` pairs that should fail, for the error paths. */
let failing = new Set<string>();

const fail = (key: string) => ({
  data: null,
  error: { message: `${key} refused` },
});

const client = {
  from(table: string) {
    const rows = () => (tables[table] ??= []);
    const query = () => {
      const filters: [string, unknown][] = [];
      const matching = () =>
        rows().filter((r) => filters.every(([c, v]) => r[c] === v));
      const result = () =>
        failing.has(`${table}:select`)
          ? fail(`${table}:select`)
          : { data: matching(), error: null };
      const api = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return api;
        },
        async maybeSingle() {
          if (failing.has(`${table}:select`)) return fail(`${table}:select`);
          return { data: matching()[0] ?? null, error: null };
        },
        then<T>(res: (v: { data: Row[] | null; error: unknown }) => T) {
          return Promise.resolve(result()).then(res);
        },
      };
      return api;
    };
    return {
      select: () => query(),
      async upsert(row: Row) {
        if (failing.has(`${table}:upsert`)) return fail(`${table}:upsert`);
        writes.push({ table, op: "upsert", row });
        const existing = rows().findIndex(
          (r) => r.device_id === row.device_id && r.user_id === row.user_id
        );
        if (existing >= 0) rows()[existing] = row;
        else rows().push(row);
        return { error: null };
      },
      delete() {
        const filters: [string, unknown][] = [];
        const api = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return api;
          },
          then<T>(res: (v: { error: unknown }) => T) {
            if (failing.has(`${table}:delete`))
              return Promise.resolve(fail(`${table}:delete`)).then(res);
            writes.push({ table, op: "delete", filters });
            tables[table] = rows().filter(
              (r) => !filters.every(([c, v]) => r[c] === v)
            );
            return Promise.resolve({ error: null }).then(res);
          },
        };
        return api;
      },
    };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const { publishDeviceKey, shareDataKeyWithDevices } = await import(
  "../src/store/deviceLink"
);

const binding = { userId: USER, deviceId: "this-device" };

/** A device that is not this one, already on the account. */
const otherDevice = async (id: string) => {
  const pair = await generateDeviceKeyPair();
  const publicKey = await exportDevicePublicKey(pair.publicKey);
  (tables.device_keys ??= []).push({
    user_id: USER,
    device_id: id,
    public_key: publicKey,
  });
  return { id, pair, publicKey };
};

beforeEach(async () => {
  writes = [];
  tables = {};
  failing = new Set();
  myPair = await generateDeviceKeyPair();
});

describe("publishing this device's key", () => {
  test("writes it on the first launch", async () => {
    const published = await publishDeviceKey(client, binding);

    expect(published).toBe(await exportDevicePublicKey(myPair.publicKey));
    expect(tables.device_keys).toEqual([
      { user_id: USER, device_id: "this-device", public_key: published },
    ]);
  });

  test("writes nothing on the second launch", async () => {
    // Every launch calls this. A blind upsert would work and would also mean a
    // pointless round trip on every single start, forever.
    await publishDeviceKey(client, binding);
    writes = [];

    await publishDeviceKey(client, binding);

    expect(writes).toEqual([]);
  });

  test("does not delete a wrapped row on a first publish", async () => {
    // A device being approved right now may have just been given its wrapped
    // row by another device. Clearing it unconditionally would race that and
    // strand the approval.
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "this-device",
      wrapped: { v: 1 },
    });

    await publishDeviceKey(client, binding);

    expect(writes.some((w) => w.op === "delete")).toBe(false);
    expect(tables.device_wrapped_keys).toHaveLength(1);
  });
});

describe("a device coming back after signing out", () => {
  test("republishes, and clears the row sealed to its old key", async () => {
    // The keystore is wiped on sign-out, so the keypair is new. The old wrapped
    // row can never be opened again, and leaving it would be worse than
    // useless: step 3 treats a wrapped row appearing as proof of approval, so a
    // stale one fires that signal and then fails to unwrap.
    await publishDeviceKey(client, binding);
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "this-device",
      wrapped: { v: 1, note: "sealed to the old key" },
    });
    writes = [];

    myPair = await generateDeviceKeyPair();
    const republished = await publishDeviceKey(client, binding);

    expect(tables.device_keys?.[0].public_key).toBe(republished);
    expect(tables.device_wrapped_keys).toEqual([]);
    expect(writes.map((w) => w.op)).toEqual(["upsert", "delete"]);
  });

  test("only its own wrapped row is cleared", async () => {
    const laptop = await otherDevice("laptop");
    (tables.device_wrapped_keys ??= []).push(
      { user_id: USER, device_id: "this-device", wrapped: { v: 1 } },
      { user_id: USER, device_id: laptop.id, wrapped: { v: 1 } }
    );
    await publishDeviceKey(client, binding);

    myPair = await generateDeviceKeyPair();
    await publishDeviceKey(client, binding);

    expect(tables.device_wrapped_keys?.map((r) => r.device_id)).toEqual([
      "laptop",
    ]);
  });
});

describe("sharing the data key", () => {
  test("the other device can open what it is given", async () => {
    // The end-to-end assertion for the migration: not that a row appeared, but
    // that the device it names can actually read the journal with it.
    const dataKey = await generateDataKey();
    const laptop = await otherDevice("laptop");

    const written = await shareDataKeyWithDevices(client, dataKey, binding);

    expect(written).toBe(1);
    const row = tables.device_wrapped_keys?.[0];
    const opened = await unwrapDataKeyForDevice(
      row?.wrapped as DeviceWrappedKeyJson,
      laptop.pair.privateKey,
      { userId: USER, deviceId: laptop.id }
    );
    const raw = await crypto.subtle.exportKey("raw", opened);
    const expected = await crypto.subtle.exportKey("raw", dataKey);
    expect(new Uint8Array(raw)).toEqual(new Uint8Array(expected));
  });

  test("skips this device", async () => {
    // This device already has the data key, and after a sign-out its keypair is
    // gone, so a row wrapped to itself could never be opened by anything.
    const dataKey = await generateDataKey();
    await publishDeviceKey(client, binding);

    expect(await shareDataKeyWithDevices(client, dataKey, binding)).toBe(0);
    expect(tables.device_wrapped_keys ?? []).toEqual([]);
  });

  test("skips a device that already holds one", async () => {
    const dataKey = await generateDataKey();
    const laptop = await otherDevice("laptop");
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: laptop.id,
      wrapped: { v: 1, note: "given earlier" },
    });

    expect(await shareDataKeyWithDevices(client, dataKey, binding)).toBe(0);
    expect(tables.device_wrapped_keys?.[0].wrapped).toEqual({
      v: 1,
      note: "given earlier",
    });
  });

  test("reaches every device that is missing one", async () => {
    const dataKey = await generateDataKey();
    await otherDevice("laptop");
    await otherDevice("tablet");
    await otherDevice("desktop");
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "tablet",
      wrapped: { v: 1 },
    });

    expect(await shareDataKeyWithDevices(client, dataKey, binding)).toBe(2);
    expect(tables.device_wrapped_keys?.map((r) => r.device_id).sort()).toEqual([
      "desktop",
      "laptop",
      "tablet",
    ]);
  });

  test("each device gets a blob only it can open", async () => {
    const dataKey = await generateDataKey();
    const laptop = await otherDevice("laptop");
    await otherDevice("tablet");
    await shareDataKeyWithDevices(client, dataKey, binding);

    const tabletRow = tables.device_wrapped_keys?.find(
      (r) => r.device_id === "tablet"
    );
    await expect(
      unwrapDataKeyForDevice(
        tabletRow?.wrapped as DeviceWrappedKeyJson,
        laptop.pair.privateKey,
        { userId: USER, deviceId: laptop.id }
      )
    ).rejects.toThrow();
  });

  test("does nothing on an account with no other devices", async () => {
    expect(
      await shareDataKeyWithDevices(client, await generateDataKey(), binding)
    ).toBe(0);
  });
});

describe("when the server refuses", () => {
  test("a failed read is reported, not read as an empty account", async () => {
    // The bug pattern from 28 July: an error that looks like "nothing there"
    // leads to writing over what is there.
    failing.add("device_keys:select");
    await expect(publishDeviceKey(client, binding)).rejects.toThrow(
      /Could not read device keys/
    );
    expect(writes).toEqual([]);
  });

  test("a failed publish is reported rather than assumed", async () => {
    failing.add("device_keys:upsert");
    await expect(publishDeviceKey(client, binding)).rejects.toThrow(
      /Could not publish/
    );
  });

  test("a failed share names the device it could not reach", async () => {
    await otherDevice("laptop");
    failing.add("device_wrapped_keys:upsert");
    await expect(
      shareDataKeyWithDevices(client, await generateDataKey(), binding)
    ).rejects.toThrow(/laptop/);
  });

  test("a failed clear does not report success", async () => {
    // If this were swallowed the device would have published a new key while a
    // row sealed to the old one stayed behind — the exact state step 3
    // misreads as approval.
    await publishDeviceKey(client, binding);
    myPair = await generateDeviceKeyPair();
    failing.add("device_wrapped_keys:delete");

    await expect(publishDeviceKey(client, binding)).rejects.toThrow(
      /Could not clear/
    );
  });
});
