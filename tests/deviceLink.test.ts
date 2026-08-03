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
  verificationCode,
  wrapDataKeyForDevice,
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
        // Keyed on the epoch too, as device_wrapped_keys now is. Without this a
        // second epoch would overwrite the first and the "holds every epoch"
        // assertions would pass while the device held one key.
        const existing = rows().findIndex(
          (r) =>
            r.device_id === row.device_id &&
            r.user_id === row.user_id &&
            (r.epoch ?? 0) === (row.epoch ?? 0)
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

const {
  LINK_REQUEST_TTL_MS,
  approveLinkRequest,
  claimWrappedDataKeys,
  listLinkRequests,
  publishDeviceKey,
  publishLinkRequest,
  rejectLinkRequest,
  shareDataKeyWithDevices,
  surrenderDeviceKeys,
} = await import("../src/store/deviceLink");

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

/** Give a device an entitlement: a wrapped key it already holds. */
const alreadyGranted = (id: string, epoch = 0) => {
  (tables.device_wrapped_keys ??= []).push({
    user_id: USER,
    device_id: id,
    epoch,
    wrapped: { v: 1, note: "granted earlier" },
  });
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
    // The end-to-end assertion: not that a row appeared, but that the device it
    // names can actually read the journal with it.
    const dataKey = await generateDataKey();
    const laptop = await otherDevice("laptop");
    alreadyGranted(laptop.id, 0);

    const written = await shareDataKeyWithDevices(client, dataKey, binding, 1);

    expect(written).toBe(1);
    const row = tables.device_wrapped_keys?.find((r) => r.epoch === 1);
    const opened = await unwrapDataKeyForDevice(
      row?.wrapped as DeviceWrappedKeyJson,
      laptop.pair.privateKey,
      { userId: USER, deviceId: laptop.id }
    );
    const raw = await crypto.subtle.exportKey("raw", opened);
    const expected = await crypto.subtle.exportKey("raw", dataKey);
    expect(new Uint8Array(raw)).toEqual(new Uint8Array(expected));
  });

  test("a device that has never been granted anything gets nothing", async () => {
    // The hole this rule closes, and the reason the rule changed on 3 August.
    // Until then a row in device_keys was treated as permission, and every device
    // republishes that row on each connect — so a removed device holding a
    // session would be re-granted the current key silently, with no approval and
    // nothing shown to anyone. Publishing a key is not being entitled to one.
    const stranger = await otherDevice("removed-phone");
    expect(stranger.id).toBe("removed-phone");

    expect(
      await shareDataKeyWithDevices(client, await generateDataKey(), binding, 1)
    ).toBe(0);
    expect(tables.device_wrapped_keys ?? []).toEqual([]);
  });

  test("skips this device", async () => {
    // This device already has the key, and after a sign-out its keypair is gone,
    // so a row wrapped to itself could never be opened by anything.
    const dataKey = await generateDataKey();
    await publishDeviceKey(client, binding);
    alreadyGranted(binding.deviceId, 0);
    writes = [];

    expect(await shareDataKeyWithDevices(client, dataKey, binding, 1)).toBe(0);
    expect(writes).toEqual([]);
  });

  test("skips an epoch the device already holds", async () => {
    const laptop = await otherDevice("laptop");
    alreadyGranted(laptop.id, 1);

    expect(
      await shareDataKeyWithDevices(client, await generateDataKey(), binding, 1)
    ).toBe(0);
  });

  test("reaches every entitled device that is missing the new epoch", async () => {
    await otherDevice("laptop");
    await otherDevice("tablet");
    await otherDevice("desktop");
    alreadyGranted("laptop", 0);
    alreadyGranted("tablet", 0);
    alreadyGranted("tablet", 1);
    alreadyGranted("desktop", 0);

    expect(
      await shareDataKeyWithDevices(client, await generateDataKey(), binding, 1)
    ).toBe(2);
    expect(
      tables.device_wrapped_keys
        ?.filter((r) => r.epoch === 1)
        .map((r) => r.device_id)
        .sort()
    ).toEqual(["desktop", "laptop", "tablet"]);
  });

  test("each device gets a blob only it can open", async () => {
    const dataKey = await generateDataKey();
    const laptop = await otherDevice("laptop");
    await otherDevice("tablet");
    alreadyGranted("laptop", 0);
    alreadyGranted("tablet", 0);
    await shareDataKeyWithDevices(client, dataKey, binding, 1);

    const tabletRow = tables.device_wrapped_keys?.find(
      (r) => r.device_id === "tablet" && r.epoch === 1
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
      await shareDataKeyWithDevices(client, await generateDataKey(), binding, 0)
    ).toBe(0);
  });
});

// ---------- step 3 ----------

/** A request row as a waiting device would have written it. */
const aRequest = async (
  id: string,
  opts: { client?: string | null; age?: number; requestedAt?: string } = {}
) => {
  const pair = await generateDeviceKeyPair();
  const publicKey = await exportDevicePublicKey(pair.publicKey);
  (tables.device_link_requests ??= []).push({
    user_id: USER,
    device_id: id,
    public_key: publicKey,
    // `in` rather than ??, so an explicit null is a device that declined to say
    // rather than one that was not asked.
    client: "client" in opts ? opts.client : "Safari (iOS)",
    requested_at:
      opts.requestedAt ??
      new Date(Date.now() - (opts.age ?? 60_000)).toISOString(),
  });
  return { id, pair, publicKey };
};

describe("asking to be added", () => {
  test("publishes the key and client, and returns the code to show", async () => {
    const code = await publishLinkRequest(client, binding, "Safari (iOS)");

    const row = tables.device_link_requests?.[0];
    expect(row?.device_id).toBe("this-device");
    expect(row?.client).toBe("Safari (iOS)");
    expect(row?.public_key).toBe(await exportDevicePublicKey(myPair.publicKey));
    // The code must be of the key that was actually sent, or comparing the two
    // screens compares nothing.
    expect(code).toBe(await verificationCode(row?.public_key as string));
  });

  test("asking again restarts the clock", async () => {
    // A device that has been sitting on a stale request should get a fresh half
    // hour rather than expiring in the middle of somebody approving it.
    await publishLinkRequest(client, binding, "Safari (iOS)");
    const first = tables.device_link_requests?.[0].requested_at as string;
    await new Promise((r) => setTimeout(r, 5));

    await publishLinkRequest(client, binding, "Safari (iOS)");

    expect(tables.device_link_requests).toHaveLength(1);
    expect(
      Date.parse(tables.device_link_requests?.[0].requested_at as string)
    ).toBeGreaterThanOrEqual(Date.parse(first));
  });
});

describe("seeing who is asking", () => {
  test("shows another device, with the code of the key that arrived", async () => {
    const phone = await aRequest("phone");

    const [request] = await listLinkRequests(client, binding);

    expect(request.deviceId).toBe("phone");
    expect(request.client).toBe("Safari (iOS)");
    expect(request.code).toBe(await verificationCode(phone.publicKey));
  });

  test("never shows this device its own request", async () => {
    // A device cannot vouch for itself, and showing it its own prompt would be
    // an invitation to approve it.
    await publishLinkRequest(client, binding, "Chrome (macOS)");

    expect(await listLinkRequests(client, binding)).toEqual([]);
  });

  test("newest first", async () => {
    await aRequest("older", { age: 20 * 60_000 });
    await aRequest("newer", { age: 60_000 });

    expect((await listLinkRequests(client, binding)).map((r) => r.deviceId)).toEqual(
      ["newer", "older"]
    );
  });

  test("an expired request is not shown, and is deleted", async () => {
    // Deleted rather than merely filtered: nothing here runs on a schedule, so
    // if the device that notices does not clear it, the plaintext client string
    // stays on the server indefinitely.
    await aRequest("stale", { age: LINK_REQUEST_TTL_MS + 60_000 });

    expect(await listLinkRequests(client, binding)).toEqual([]);
    expect(tables.device_link_requests).toEqual([]);
  });

  test("a request just inside the window is still shown", async () => {
    await aRequest("phone", { age: LINK_REQUEST_TTL_MS - 60_000 });

    expect(await listLinkRequests(client, binding)).toHaveLength(1);
    expect(tables.device_link_requests).toHaveLength(1);
  });

  test("an unreadable timestamp counts as expired", async () => {
    // Treating it as fresh would mean a malformed row offered for approval
    // forever.
    await aRequest("odd", { requestedAt: "not a date" });

    expect(await listLinkRequests(client, binding)).toEqual([]);
    expect(tables.device_link_requests).toEqual([]);
  });

  test("a device that will not say what it is still gets shown", async () => {
    // Better an approval prompt that admits it does not know than no prompt.
    await aRequest("quiet", { client: null });

    const [request] = await listLinkRequests(client, binding);
    expect(request.client).toBeNull();
  });
});

describe("approving", () => {
  test("the asking device can open what it is given", async () => {
    const dataKey = await generateDataKey();
    const phone = await aRequest("phone");
    const [request] = await listLinkRequests(client, binding);

    await approveLinkRequest(client, dataKey, request, binding, 0);

    const row = tables.device_wrapped_keys?.[0];
    const opened = await unwrapDataKeyForDevice(
      row?.wrapped as DeviceWrappedKeyJson,
      phone.pair.privateKey,
      { userId: USER, deviceId: "phone" }
    );
    expect(
      new Uint8Array(await crypto.subtle.exportKey("raw", opened))
    ).toEqual(new Uint8Array(await crypto.subtle.exportKey("raw", dataKey)));
  });

  test("the request is withdrawn afterwards", async () => {
    await aRequest("phone");
    const [request] = await listLinkRequests(client, binding);

    await approveLinkRequest(client, await generateDataKey(), request, binding, 0);

    expect(tables.device_link_requests).toEqual([]);
  });

  test("the key is published, so later changes reach the device", async () => {
    // Without this the newly added device would hold the data key but be absent
    // from device_keys, so nothing could ever wrap for it again.
    const phone = await aRequest("phone");
    const [request] = await listLinkRequests(client, binding);

    await approveLinkRequest(client, await generateDataKey(), request, binding, 0);

    expect(tables.device_keys).toEqual([
      { user_id: USER, device_id: "phone", public_key: phone.publicKey },
    ]);
  });

  test("grants to the key the code was computed from, not a later one", async () => {
    // The person approved a specific code. Re-reading the row at grant time
    // would open a window in which the key could be swapped between the
    // comparison and the grant, which is the whole attack the code exists to
    // stop.
    const dataKey = await generateDataKey();
    const phone = await aRequest("phone");
    const [request] = await listLinkRequests(client, binding);

    const impostor = await generateDeviceKeyPair();
    (tables.device_link_requests as Row[])[0].public_key =
      await exportDevicePublicKey(impostor.publicKey);

    await approveLinkRequest(client, dataKey, request, binding, 0);

    const row = tables.device_wrapped_keys?.[0];
    await expect(
      unwrapDataKeyForDevice(
        row?.wrapped as DeviceWrappedKeyJson,
        impostor.privateKey,
        { userId: USER, deviceId: "phone" }
      )
    ).rejects.toThrow();
    await expect(
      unwrapDataKeyForDevice(
        row?.wrapped as DeviceWrappedKeyJson,
        phone.pair.privateKey,
        { userId: USER, deviceId: "phone" }
      )
    ).resolves.toBeTruthy();
  });

  test("nothing is granted if the wrapped row cannot be written", async () => {
    await aRequest("phone");
    const [request] = await listLinkRequests(client, binding);
    failing.add("device_wrapped_keys:upsert");

    await expect(
      approveLinkRequest(client, await generateDataKey(), request, binding, 0)
    ).rejects.toThrow(/Could not add the device/);
    // The request survives, so the person can try again rather than being left
    // with a device that was told nothing.
    expect(tables.device_link_requests).toHaveLength(1);
  });
});

describe("refusing", () => {
  test("deletes the request and shares nothing", async () => {
    await aRequest("phone");

    await rejectLinkRequest(client, "phone");

    expect(tables.device_link_requests).toEqual([]);
    expect(tables.device_wrapped_keys ?? []).toEqual([]);
  });

  test("leaves other devices' requests alone", async () => {
    await aRequest("phone");
    await aRequest("tablet");

    await rejectLinkRequest(client, "phone");

    expect(tables.device_link_requests?.map((r) => r.device_id)).toEqual([
      "tablet",
    ]);
  });
});

describe("waiting for a key", () => {
  test("empty while nothing has been granted", async () => {
    // The ordinary state of a waiting device, and deliberately not an error.
    expect((await claimWrappedDataKeys(client, binding)).size).toBe(0);
  });

  test("the key once it has", async () => {
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKeyForDevice(
      dataKey,
      await exportDevicePublicKey(myPair.publicKey),
      binding
    );
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "this-device",
      epoch: 0,
      wrapped,
    });

    const claimed = await claimWrappedDataKeys(client, binding);

    expect([...claimed.keys()]).toEqual([0]);
    expect(
      new Uint8Array(
        await crypto.subtle.exportKey("raw", claimed.get(0) as CryptoKey)
      )
    ).toEqual(new Uint8Array(await crypto.subtle.exportKey("raw", dataKey)));
  });

  test("a row it cannot open is cleared rather than retried forever", async () => {
    // Only this device could ever open it, so a row that fails is unusable by
    // definition — realistically one sealed to a keypair lost in a wipe.
    const stranger = await generateDeviceKeyPair();
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "this-device",
      // The column is not null with a default of 0, so a real row always carries
      // an epoch even if it predates the column.
      epoch: 0,
      wrapped: await wrapDataKeyForDevice(
        await generateDataKey(),
        await exportDevicePublicKey(stranger.publicKey),
        binding
      ),
    });

    expect((await claimWrappedDataKeys(client, binding)).size).toBe(0);
    expect(tables.device_wrapped_keys).toEqual([]);
  });

  test("a failed read is reported, not read as 'not yet'", async () => {
    // Otherwise a server problem is indistinguishable from waiting, and the
    // device waits for something that will never come.
    failing.add("device_wrapped_keys:select");
    await expect(claimWrappedDataKeys(client, binding)).rejects.toThrow(
      /Could not check for a key/
    );
  });
});

describe("giving up a place on the account", () => {
  test("removes this device's key and the key wrapped to it", async () => {
    // The point of per-device keys. A sign-out that leaves these rows behind has
    // not removed the device from anything.
    await publishDeviceKey(client, binding);
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "this-device",
      wrapped: { v: 1 },
    });

    await surrenderDeviceKeys(client, binding);

    expect(tables.device_keys).toEqual([]);
    expect(tables.device_wrapped_keys).toEqual([]);
  });

  test("leaves the other devices alone", async () => {
    // A device signing out must not disturb the rest, which is the whole reason
    // the blanket keeper-key rotation was abandoned on 28 July.
    const laptop = await otherDevice("laptop");
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: laptop.id,
      wrapped: { v: 1 },
    });
    await publishDeviceKey(client, binding);

    await surrenderDeviceKeys(client, binding);

    expect(tables.device_keys?.map((r) => r.device_id)).toEqual(["laptop"]);
    expect(tables.device_wrapped_keys?.map((r) => r.device_id)).toEqual([
      "laptop",
    ]);
  });

  test("reports a failure rather than looking like success", async () => {
    // The caller signs out anyway, but it should be able to say so in the log.
    await publishDeviceKey(client, binding);
    failing.add("device_keys:delete");

    await expect(surrenderDeviceKeys(client, binding)).rejects.toThrow(
      /Could not remove this device's key/
    );
  });

  test("does not drop the public key while a usable blob remains", async () => {
    // Order matters when only one deletion lands. A public key with nothing
    // sealed to it is harmless; a wrapped blob with no record of whose it is
    // outlives the device it belonged to.
    await publishDeviceKey(client, binding);
    (tables.device_wrapped_keys ??= []).push({
      user_id: USER,
      device_id: "this-device",
      wrapped: { v: 1 },
    });
    failing.add("device_wrapped_keys:delete");

    await expect(surrenderDeviceKeys(client, binding)).rejects.toThrow(
      /Could not release the journal key/
    );
    expect(tables.device_keys).toHaveLength(1);
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
    // Entitled, or the share loop would correctly skip it and never fail.
    alreadyGranted("laptop", 0);
    failing.add("device_wrapped_keys:upsert");
    await expect(
      shareDataKeyWithDevices(client, await generateDataKey(), binding, 1)
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
