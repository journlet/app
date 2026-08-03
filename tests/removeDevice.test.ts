// @vitest-environment jsdom
//
// Removing a device (spec/device-identity-design.md, steps 4 and 5).
//
// The assertion that justifies the whole of steps 4 and 5 is the last one here:
// after removal, the removed device cannot read what is written next. Everything
// before it is bookkeeping. A version of this feature that revoked without
// rotating was built and deleted in July precisely because it passed every
// obvious test and did not have that property.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  decryptUpdate,
  generateDataKey,
  generateKeeperKey,
  readPayloadEpoch,
  unwrapDataKey,
  wrapDataKey,
} from "../src/lib/crypto";
import {
  exportDevicePublicKey,
  generateDeviceKeyPair,
  unwrapDataKeyForDevice,
} from "../src/lib/deviceKeys";
import type { DeviceWrappedKeyJson } from "../src/lib/deviceKeys";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "this-mac";

const keeperKey = await generateKeeperKey();
const dataKey = await generateDataKey();
const accountWrapped = await wrapDataKey(dataKey, keeperKey);

let myPair: CryptoKeyPair;
/** The device being removed, so the test can try to read as it would. */
let phone: { pair: CryptoKeyPair; publicKey: string };

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const b64decode = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;
let storedRing: { dataKeys: Map<number, CryptoKey>; epoch: number } | null = null;

/* oxlint-disable unicorn/no-thenable */
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      if (table === "journals") {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: {
                wrapped_key: {
                  v: accountWrapped.v,
                  iv: b64encode(accountWrapped.iv),
                  blob: b64encode(accountWrapped.blob),
                },
              },
              error: null,
            }),
          }),
          insert: async () => ({ error: null }),
        };
      }
      const query = () => {
        const filters: [string, unknown][] = [];
        const matching = () =>
          rows().filter((r) => filters.every(([c, v]) => r[c] === v));
        let desc = false;
        const api = {
          eq(c: string, v: unknown) {
            filters.push([c, v]);
            return api;
          },
          gt: () => api,
          order: (_c: string, o?: { ascending?: boolean }) => {
            desc = o?.ascending === false;
            return api;
          },
          limit: async (n: number) => {
            const out = [...matching()].sort((a, b) =>
              desc
                ? Number(b.epoch ?? 0) - Number(a.epoch ?? 0)
                : Number(a.id ?? 0) - Number(b.id ?? 0)
            );
            return { data: out.slice(0, n), error: null };
          },
          maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
          then<T>(res: (v: { data: Row[]; error: null }) => T) {
            return Promise.resolve({ data: matching(), error: null }).then(res);
          },
        };
        return api;
      };
      return {
        select: () => query(),
        async insert(row: Row) {
          rows().push(row);
          return { error: null };
        },
        async upsert(row: Row) {
          const at = rows().findIndex(
            (r) =>
              r.device_id === row.device_id && (r.epoch ?? 0) === (row.epoch ?? 0)
          );
          if (at >= 0) rows()[at] = row;
          else rows().push(row);
          return { error: null };
        },
        delete() {
          const filters: [string, unknown][] = [];
          const api = {
            eq(c: string, v: unknown) {
              filters.push([c, v]);
              return api;
            },
            then<T>(res: (v: { error: null }) => T) {
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
    removeChannel: () => {},
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: (cb?: (s: string) => void) => {
          cb?.("SUBSCRIBED");
          return ch;
        },
      };
      return ch;
    },
  }),
}));

vi.mock("../src/store/journal", () => ({
  get doc() {
    return doc;
  },
  get devices() {
    return doc.getMap("devices");
  },
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
}));

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => ({
    keeperKey,
    dataKeys: storedRing?.dataKeys ?? new Map([[0, dataKey]]),
    epoch: storedRing?.epoch ?? 0,
    wrapped: accountWrapped,
    createdAt: 0,
  }),
  replaceKeyRing: async (r: unknown) => {
    storedRing = r as { dataKeys: Map<number, CryptoKey>; epoch: number };
  },
  wipeKeys: async () => {},
  ensureDeviceKeyPair: async () => myPair,
}));

/** The phone: on the account, entitled to epoch 0, and about to be removed. */
const phoneIsOnTheAccount = async () => {
  tables.device_keys = [
    { user_id: USER_ID, device_id: "phone", public_key: phone.publicKey },
    {
      user_id: USER_ID,
      device_id: DEVICE_ID,
      public_key: await exportDevicePublicKey(myPair.publicKey),
    },
  ];
  tables.device_wrapped_keys = [
    { user_id: USER_ID, device_id: "phone", epoch: 0, wrapped: { v: 1 } },
  ];
  doc.getMap<Y.Map<unknown>>("devices").set("phone", new Y.Map());
  (doc.getMap<Y.Map<unknown>>("devices").get("phone") as Y.Map<unknown>).set(
    "id",
    "phone"
  );
};

const boot = async () => {
  vi.resetModules();
  const sync = await import("../src/store/sync");
  sync.startSync();
  authCallback?.("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
  return sync;
};

beforeEach(async () => {
  tables = {};
  doc = new Y.Doc();
  storedRing = null;
  authCallback = null;
  localStorage.clear();
  localStorage.setItem("journlet-device-id", DEVICE_ID);
  myPair = await generateDeviceKeyPair();
  const pair = await generateDeviceKeyPair();
  phone = { pair, publicKey: await exportDevicePublicKey(pair.publicKey) };
  await phoneIsOnTheAccount();
});

describe("removing a device", () => {
  test("takes away both of its rows", async () => {
    const sync = await boot();

    await sync.removeDevice("phone");

    expect(
      tables.device_wrapped_keys?.filter((r) => r.device_id === "phone")
    ).toEqual([]);
    expect(tables.device_keys?.map((r) => r.device_id)).toEqual([DEVICE_ID]);
  });

  test("rotates, and publishes the new key under the recovery key first", async () => {
    // Before any device is given it, so the recovery code covers the new epoch
    // from the moment it exists. Otherwise there would be a window of content the
    // recovery code cannot reach, permanent if the writing device were then lost.
    const sync = await boot();

    await sync.removeDevice("phone");

    const row = tables.journal_keys?.[0];
    expect(row?.epoch).toBe(1);
    const wrappedKey = row?.wrapped_key as {
      v: number;
      iv: string;
      blob: string;
    };
    await expect(
      unwrapDataKey(
        {
          v: wrappedKey.v,
          iv: b64decode(wrappedKey.iv),
          blob: b64decode(wrappedKey.blob),
        },
        keeperKey
      )
    ).resolves.toBeTruthy();
  });

  test("writes under the new epoch afterwards", async () => {
    const sync = await boot();

    await sync.removeDevice("phone");
    // Counted first: connecting itself pushes the device register, so "a row
    // exists" was already true and the assertion was reading that row instead.
    const before = tables.journal_updates?.length ?? 0;
    doc.getArray("entries").push(["written after the phone was removed"]);

    await vi.waitFor(() =>
      expect(tables.journal_updates?.length ?? 0).toBeGreaterThan(before)
    );
    const payloads = (tables.journal_updates ?? []).map((r) =>
      readPayloadEpoch(b64decode(r.payload as string))
    );
    expect(payloads.at(-1)).toBe(1);
  });

  test("the removed device cannot read what is written next", async () => {
    // The whole point. Its key opens history and nothing after the rotation.
    const sync = await boot();
    await sync.removeDevice("phone");
    const before = tables.journal_updates?.length ?? 0;
    doc.getArray("entries").push(["written after the phone was removed"]);
    await vi.waitFor(() =>
      expect(tables.journal_updates?.length ?? 0).toBeGreaterThan(before)
    );

    // The phone holds epoch 0's key and was given nothing since.
    expect(
      tables.device_wrapped_keys?.some((r) => r.device_id === "phone")
    ).toBe(false);
    const newest = b64decode(
      tables.journal_updates?.at(-1)?.payload as string
    );
    await expect(
      decryptUpdate(dataKey, newest, { userId: USER_ID, volume: "v1" })
    ).rejects.toThrow();
  });

  test("a device that stays gets the new key", async () => {
    // Removal must not disturb the rest, which is the failure of the July
    // version: rotating a shared keeper key locked out everything at once.
    const laptopPair = await generateDeviceKeyPair();
    tables.device_keys?.push({
      user_id: USER_ID,
      device_id: "laptop",
      public_key: await exportDevicePublicKey(laptopPair.publicKey),
    });
    tables.device_wrapped_keys?.push({
      user_id: USER_ID,
      device_id: "laptop",
      epoch: 0,
      wrapped: { v: 1 },
    });
    const sync = await boot();

    await sync.removeDevice("phone");

    const granted = tables.device_wrapped_keys?.find(
      (r) => r.device_id === "laptop" && r.epoch === 1
    );
    await expect(
      unwrapDataKeyForDevice(
        granted?.wrapped as DeviceWrappedKeyJson,
        laptopPair.privateKey,
        { userId: USER_ID, deviceId: "laptop" }
      )
    ).resolves.toBeTruthy();
  });

  test("marks the device in the register, since it will never say so itself", async () => {
    const sync = await boot();

    await sync.removeDevice("phone");

    const rec = doc.getMap<Y.Map<unknown>>("devices").get("phone");
    expect(rec?.get("removedAt")).toBeGreaterThan(0);
  });

  test("refuses to remove this device", async () => {
    // Sign out is the operation for that, and it wipes locally too. Rotating the
    // key and then leaving would strand the journal here.
    const sync = await boot();

    await expect(sync.removeDevice(DEVICE_ID)).rejects.toThrow(/sign out/i);
  });

  test("keeps history readable on the device that did the removing", async () => {
    const sync = await boot();
    await sync.removeDevice("phone");

    expect([...(storedRing?.dataKeys.keys() ?? [])]).toEqual([0, 1]);
    expect(storedRing?.epoch).toBe(1);
  });
});
