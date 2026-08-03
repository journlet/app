// @vitest-environment jsdom
//
// Removing a device (spec/device-identity-design.md, steps 4 and 5).
//
// The assertion that justifies the whole of steps 4 and 5 is the last one here:
// after removal, the removed device cannot read what is written next. Everything
// before it is bookkeeping. A version of this feature that revoked without
// rotating was built and deleted in July precisely because it passed every
// obvious test and did not have that property.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  decryptUpdate,
  encryptUpdate,
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
  wrapDataKeyForDevice,
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
/** The realtime handler for journal_updates, so a test can deliver a row. */
let rowHandler: ((m: { new: Row }) => void) | null = null;
/** Set to boot as a device that was linked by approval rather than as the Mac. */
let phoneRing: { dataKeys: Map<number, CryptoKey>; epoch: number } | null = null;

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
        on: (
          _e: string,
          cfg: { table?: string },
          handler: (m: { new: Row }) => void
        ) => {
          if (cfg?.table === "journal_updates") rowHandler = handler;
          return ch;
        },
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
    // phoneRing stands in for a device linked by approval: it holds a data key
    // and no keeper key, so it can read but cannot rotate or recover.
    ...(phoneRing
      ? { dataKeys: phoneRing.dataKeys, epoch: phoneRing.epoch }
      : {
          keeperKey,
          dataKeys: storedRing?.dataKeys ?? new Map([[0, dataKey]]),
          epoch: storedRing?.epoch ?? 0,
          wrapped: accountWrapped,
        }),
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

/**
 * The engine booted by the current test, so it can be stopped afterwards.
 *
 * Without this, a device left waiting for approval keeps its poll running against
 * the shared fixtures after its test ends, and the next test measures a connect
 * driven by the previous one. The same isolation problem bit connectRetry.test.ts.
 */
let current: typeof import("../src/store/sync") | null = null;

const start = async () => {
  vi.resetModules();
  const sync = await import("../src/store/sync");
  current = sync;
  sync.startSync();
  authCallback?.("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  return sync;
};

const boot = async () => {
  const sync = await start();
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
  return sync;
};

afterEach(async () => {
  await current?.signOutAndWipe().catch(() => undefined);
  current = null;
});

beforeEach(async () => {
  tables = {};
  doc = new Y.Doc();
  storedRing = null;
  phoneRing = null;
  rowHandler = null;
  authCallback = null;
  localStorage.clear();
  localStorage.setItem("journlet-device-id", DEVICE_ID);
  myPair = await generateDeviceKeyPair();
  const pair = await generateDeviceKeyPair();
  phone = { pair, publicKey: await exportDevicePublicKey(pair.publicKey) };
  await phoneIsOnTheAccount();
});

describe("the removed device's own view", () => {
  /**
   * Boot as the phone: no keeper key, its epoch 0 key held locally, a journal
   * already on disk, and nothing wrapped to it on the server any more. Exactly
   * where a device lands the moment it is removed.
   */
  const bootAsRemovedPhone = async () => {
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_wrapped_keys = [];
    tables.device_keys = [
      { user_id: USER_ID, device_id: DEVICE_ID, public_key: "mac" },
    ];
    tables.journal_keys = [
      {
        user_id: USER_ID,
        epoch: 1,
        wrapped_key: { v: 1, iv: "", blob: "" },
      },
    ];
    doc.getArray("entries").push(["written before it was removed"]);
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    return start();
  };

  test("knows it was removed rather than merely behind", async () => {
    // The two are identical from the epoch alone, and telling the wrong story is
    // what made removal read as a fault: the phone was told to open another
    // device so it could catch up, which it never could.
    const sync = await bootAsRemovedPhone();

    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
  });

  test("stays signed in, and waits to be asked rather than asking", async () => {
    // Gary's expectation, 3 August: removing a device should leave it signed in
    // and needing approval again, not stranded with a stale journal.
    //
    // But it must not ask on its own. Asking automatically put an approval prompt
    // for this device on the device that had just removed it, seconds later, with
    // no answer that made sense — "codes are different" is untrue, "not now"
    // invites it back. A vicious cycle, in Gary's words.
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));

    expect(sync.getSyncStatus()).toBe("needs-key");
    expect(sync.getSessionEmail()).toBe("g@example.com");
    expect(tables.device_link_requests ?? []).toEqual([]);
    expect(sync.getLinkCode()).toBeNull();
  });

  test("asks only when someone on that device chooses to", async () => {
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));

    await sync.askToBeAddedBack();

    expect(tables.device_link_requests?.[0]?.device_id).toBe("phone");
    expect(sync.getLinkCode()).not.toBeNull();
  });

  test("does not tell it to wait for a key it will never be given", async () => {
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));

    expect(sync.getSyncError()).toBeNull();
  });

  test("a device that is merely behind is told to wait, not that it was removed", async () => {
    // The same epoch gap, but its key is still on the server. It will catch up as
    // soon as an up-to-date device is open alongside it.
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_keys = [
      { user_id: USER_ID, device_id: "phone", public_key: phone.publicKey },
    ];
    // A real blob, wrapped to this device. A placeholder would be deleted as
    // unopenable and the device would then look removed rather than behind —
    // which is correct behaviour, and not what this test is about.
    tables.device_wrapped_keys = [
      {
        user_id: USER_ID,
        device_id: "phone",
        epoch: 0,
        wrapped: await wrapDataKeyForDevice(dataKey, phone.publicKey, {
          userId: USER_ID,
          deviceId: "phone",
        }),
      },
    ];
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();

    await vi.waitFor(() =>
      expect(sync.getSyncError()).toMatch(/does not have the newest key/)
    );
    expect(sync.wasRemoved()).toBe(false);
  });

  test("clears the wait-for-a-key message once it turns out to be removal", async () => {
    // The sequence that makes clearError load-bearing rather than defensive: a
    // device that was legitimately behind has already been told to wait, and is
    // then removed. Without clearing, the re-approval screen carries a message
    // telling you to go and open another device so this one can catch up.
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_keys = [
      { user_id: USER_ID, device_id: "phone", public_key: phone.publicKey },
    ];
    tables.device_wrapped_keys = [
      {
        user_id: USER_ID,
        device_id: "phone",
        epoch: 0,
        wrapped: await wrapDataKeyForDevice(dataKey, phone.publicKey, {
          userId: USER_ID,
          deviceId: "phone",
        }),
      },
    ];
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();
    await vi.waitFor(() =>
      expect(sync.getSyncError()).toMatch(/does not have the newest key/)
    );

    // Now removed, and it looks again.
    tables.device_wrapped_keys = [];
    await sync.retryConnect();

    expect(sync.wasRemoved()).toBe(true);
    expect(sync.getSyncError()).toBeNull();
  });

  test("notices removal from a row it cannot read, while sitting open", async () => {
    // The path Gary actually hit: the phone was open when the Mac removed it, so
    // the first thing it learned was a realtime row under an epoch it has no key
    // for. Reached without any reconnect, and it must not report that as a device
    // that is merely behind.
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_keys = [
      { user_id: USER_ID, device_id: "phone", public_key: phone.publicKey },
    ];
    tables.device_wrapped_keys = [
      {
        user_id: USER_ID,
        device_id: "phone",
        epoch: 0,
        wrapped: await wrapDataKeyForDevice(dataKey, phone.publicKey, {
          userId: USER_ID,
          deviceId: "phone",
        }),
      },
    ];
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
    await vi.waitFor(() => expect(rowHandler).not.toBeNull());

    const rotated = await generateDataKey();
    const state = new Y.Doc();
    state.getArray("entries").push(["written after the removal"]);
    const rowUnderEpoch1 = async (id: number) => ({
      new: {
        id,
        volume: "v1",
        payload: b64encode(
          await encryptUpdate(
            rotated,
            Y.encodeStateAsUpdate(state),
            { userId: USER_ID, volume: "v1" },
            1
          )
        ),
      },
    });

    // First, still entitled: a rotation it simply has not caught up with, so it
    // is told to wait. This is the state the message is written for.
    rowHandler?.(await rowUnderEpoch1(98));
    await vi.waitFor(() =>
      expect(sync.getSyncError()).toMatch(/does not have the newest key/)
    );

    // Then removed, and another row arrives.
    tables.device_wrapped_keys = [];
    rowHandler?.(await rowUnderEpoch1(99));

    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
    // And the earlier message is gone. Left showing, it would tell someone to go
    // and open another device so this one can catch up, on a screen explaining
    // that it was removed.
    expect(sync.getSyncError()).toBeNull();
  });

  test("does not erase the journal it holds", async () => {
    // Hidden rather than wiped (Gary's decision): nothing written here can be
    // lost, and re-approval brings it back including anything unsynced.
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));

    expect(doc.getArray("entries").toArray()).toContain(
      "written before it was removed"
    );
  });
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
