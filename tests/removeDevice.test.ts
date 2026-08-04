// @vitest-environment jsdom
//
// Removing a device (spec/device-identity-design.md, steps 4 and 5), and the
// approving device's view of the link requests it is asked to judge.
//
// The assertion that justifies the whole of steps 4 and 5 is the last one in
// the "removing a device" block: after removal, the removed device cannot read
// what is written next. Everything before it is bookkeeping. A version of this
// feature that revoked without rotating was built and deleted in July precisely
// because it passed every obvious test and did not have that property.
//
// The link-request block at the foot is here rather than in its own file because
// it needs this same harness: an engine that is connected, holds the keeper key,
// and is therefore allowed to be shown a request at all.

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
  signGrant,
  unwrapDataKeyForDevice,
  verificationCode,
  wrapAndGrant,
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
              ...(journalsDelayMs
                ? await new Promise((r) => setTimeout(r, journalsDelayMs)).then(
                    () => ({})
                  )
                : {}),
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

/**
 * A row that proves its device belongs here: a grant at `epoch` under that
 * epoch's key. A fixture that writes a row without one is describing the
 * forged-row attack, not a device, which is what the block at the foot uses.
 */
const grantedRow = async (id: string, epoch: number, key: CryptoKey) => ({
  user_id: USER_ID,
  device_id: id,
  epoch,
  wrapped: {
    v: 1,
    epk: "",
    salt: "",
    iv: "",
    blob: "",
    grant: await signGrant(key, { userId: USER_ID, deviceId: id }, epoch),
  },
});

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
  tables.device_wrapped_keys = [await grantedRow("phone", 0, dataKey)];
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
/** Holds the journals read open, so a test can interleave with a live connect. */
let journalsDelayMs = 0;

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
  journalsDelayMs = 0;
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
        wrapped: await wrapAndGrant(
          dataKey,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          0
        ),
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
        wrapped: await wrapAndGrant(
          dataKey,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          0
        ),
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
        wrapped: await wrapAndGrant(
          dataKey,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          0
        ),
      },
    ];
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
    await vi.waitFor(() => expect(rowHandler).not.toBeNull());

    // The account has rotated. Stated on the server as well as in the rows, since
    // a reconnect reads the epoch from journal_keys and would otherwise conclude
    // there was nothing wrong.
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
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

  /** The phone as it actually is before removal: synced, entitled to epoch 0. */
  const bootPhoneSynced = async () => {
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
        wrapped: await wrapAndGrant(
          dataKey,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          0
        ),
      },
    ];
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
    return sync;
  };

  test("opens the journal on being approved, without a restart", async () => {
    // Reported by Gary, 3 August: after approving, the phone sat on "Approved.
    // Opening your journal…" until the app was restarted. doConnect early-outs on
    // `connectedUserId && channel`, and a device that had synced before removal
    // still had both, so every later connect() did nothing at all. Restarting
    // worked because it cleared this module's state.
    // Synced first, which is the whole point: a device that has connected holds a
    // channel and a connectedUserId, and those are what doConnect early-outs on. A
    // fixture that starts already removed never sets them, so it cannot catch this
    // — my first version of this test passed with the fix removed.
    const sync = await bootPhoneSynced();
    await vi.waitFor(() => expect(rowHandler).not.toBeNull());

    // Removed, and it finds out the way it really does: a realtime row under an
    // epoch it has no key for. That path never runs ensureJournalKeys, which is
    // why dropping the connection had to happen where the state is entered.
    tables.device_wrapped_keys = [];
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    const rotated = await generateDataKey();
    const state = new Y.Doc();
    state.getArray("entries").push(["written after the removal"]);
    rowHandler?.({
      new: {
        id: 99,
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
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
    await sync.askToBeAddedBack();

    // Approved: the current epoch's key, wrapped to this device.
    tables.device_wrapped_keys = [
      {
        user_id: USER_ID,
        device_id: "phone",
        epoch: 1,
        wrapped: await wrapAndGrant(
          rotated,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          1
        ),
      },
    ];

    await sync.retryConnect();

    expect(sync.getSyncStatus()).toBe("synced");
    expect(sync.wasRemoved()).toBe(false);
    // And it is not left mid-flight on the opening message.
    expect(sync.getLinkStage()).toBeNull();
    expect(sync.getLinkCode()).toBeNull();
  });

  test("a device that is only behind recovers without a restart too", async () => {
    // Same shape of bug as the removed case: rows stop decrypting, the status
    // still reads synced, and nothing re-runs the key check. It now drops the
    // connection and goes back round the retry loop, so the key arriving is
    // enough.
    const sync = await bootPhoneSynced();
    await vi.waitFor(() => expect(rowHandler).not.toBeNull());

    // Rotated, and this device is still entitled but has not been given epoch 1.
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    const rotated = await generateDataKey();
    const state = new Y.Doc();
    state.getArray("entries").push(["written under the new key"]);
    const payload = b64encode(
      await encryptUpdate(
        rotated,
        Y.encodeStateAsUpdate(state),
        { userId: USER_ID, volume: "v1" },
        1
      )
    );
    // On the server as well as delivered live, because recovery happens through a
    // reconnect and a reconcile, which fetch rather than replay.
    tables.journal_updates = [{ id: 99, volume: "v1", payload }];
    rowHandler?.({ new: { id: 99, volume: "v1", payload } });
    await vi.waitFor(() =>
      expect(sync.getSyncError()).toMatch(/does not have the newest key/)
    );
    expect(sync.wasRemoved()).toBe(false);

    // Another device hands the key over.
    tables.device_wrapped_keys?.push({
      user_id: USER_ID,
      device_id: "phone",
      epoch: 1,
      wrapped: await wrapAndGrant(
        rotated,
        phone.publicKey,
        { userId: USER_ID, deviceId: "phone" },
        1
      ),
    });
    await sync.retryConnect();

    expect(sync.getSyncStatus()).toBe("synced");
    expect(doc.getArray("entries").toArray()).toContain(
      "written under the new key"
    );
  });

  test("says so when its request is refused, rather than waiting it out", async () => {
    // Gary, 3 August: a declined device carried on saying "waiting to be added
    // back" until the thirty minutes lapsed, because it watched for a key rather
    // than for its own request. Refusal and expiry are not distinguished: both
    // mean not added, and ask again if you want in.
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
    await sync.askToBeAddedBack();
    expect(sync.getLinkStage()).toBe("waiting");

    // Refused on the other device: the request row goes, no key appears.
    tables.device_link_requests = [];
    await sync.retryConnect();

    await vi.waitFor(() => expect(sync.getLinkStage()).toBe("declined"));
    // And the code goes with it. There is nothing left to compare.
    expect(sync.getLinkCode()).toBeNull();
  });

  test("reconnecting while it waits does not cancel its own request", async () => {
    // Found by the test above rather than by reading the code. The withdraw ran
    // before the key check, so any reconnect — a foreground, a retry — retracted
    // the request: the card disappeared from the approving device while this one
    // went on waiting for an answer to a question it had taken back.
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
    await sync.askToBeAddedBack();
    const code = sync.getLinkCode();

    await sync.retryConnect();

    expect(tables.device_link_requests?.[0]?.device_id).toBe("phone");
    expect(sync.getLinkCode()).toBe(code);
    expect(sync.getLinkStage()).not.toBe("declined");
  });

  test("an approval is never mistaken for a refusal", async () => {
    // Approving deletes the request too, so the order of the two checks is the
    // whole safety property: the wrapped key is published first, so a grant is
    // always visible by the time the request disappears. Checking the request
    // first would report a successful approval as a refusal.
    const sync = await bootAsRemovedPhone();
    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
    await sync.askToBeAddedBack();

    const rotated = await generateDataKey();
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    tables.device_wrapped_keys = [
      {
        user_id: USER_ID,
        device_id: "phone",
        epoch: 1,
        wrapped: await wrapAndGrant(
          rotated,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          1
        ),
      },
    ];
    // Approval removes the request as its last step.
    tables.device_link_requests = [];

    await sync.retryConnect();

    expect(sync.getLinkStage()).not.toBe("declined");
    expect(sync.getSyncStatus()).toBe("synced");
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
    tables.device_wrapped_keys?.push(
      await grantedRow("laptop", 0, dataKey)
    );
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

describe("what the approving device is shown", () => {
  /**
   * Foreground the app, which is one of the three things that refreshes the
   * list in production. Driven this way rather than by exporting
   * refreshLinkRequests, so the test exercises a path that actually runs.
   */
  const foreground = async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  };

  /**
   * A request from a device that is not on the account yet.
   *
   * agoMs rather than a fixed timestamp: listLinkRequests drops anything older
   * than the thirty minute TTL, so a hard-coded date makes the test pass today
   * and silently stop testing anything later.
   */
  const asks = (deviceId: string, publicKey: string, agoMs = 0) => {
    tables.device_link_requests = [
      {
        user_id: USER_ID,
        device_id: deviceId,
        public_key: publicKey,
        client: "Safari on iOS",
        requested_at: new Date(Date.now() - agoMs).toISOString(),
      },
    ];
  };

  test("shows the code for the key that arrived, not the one that used to", async () => {
    // The regression. publishLinkRequest upserts on (user_id, device_id) and
    // rewrites public_key in place, so a device that signs out, wipes its
    // keypair, signs back in and asks again keeps its device id and arrives with
    // a new key and therefore a new code. refreshLinkRequests compared device
    // ids only, found the list unchanged, and returned early holding the old
    // row — so this screen showed a code the asking device was no longer
    // displaying, and the only correct response to two different codes is to
    // refuse a device that should have been let in.
    const first = await generateDeviceKeyPair();
    const second = await generateDeviceKeyPair();
    const firstKey = await exportDevicePublicKey(first.publicKey);
    const secondKey = await exportDevicePublicKey(second.publicKey);
    expect(firstKey).not.toBe(secondKey);

    asks("laptop", firstKey, 10 * 60 * 1000);
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getLinkRequests()).toHaveLength(1));
    const before = sync.getLinkRequests()[0].code;

    asks("laptop", secondKey, 10 * 60 * 1000);
    await foreground();

    await vi.waitFor(() =>
      expect(sync.getLinkRequests()[0].code).not.toBe(before)
    );
    // And it is the code for the key actually on the table, not merely a change.
    expect(sync.getLinkRequests()[0].code).toBe(
      await verificationCode(secondKey)
    );
  });

  test("a renewed request stops counting down from the old timestamp", async () => {
    // requested_at resets on every ask, and the countdown reads the cached copy,
    // so a device that re-asked was told it had no time left.
    const pair = await generateDeviceKeyPair();
    const key = await exportDevicePublicKey(pair.publicKey);

    asks("laptop", key, 10 * 60 * 1000);
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getLinkRequests()).toHaveLength(1));
    const before = sync.getLinkRequests()[0].requestedAt;

    asks("laptop", key, 0);
    await foreground();

    await vi.waitFor(() =>
      expect(sync.getLinkRequests()[0].requestedAt).toBeGreaterThan(before)
    );
  });

  test("still returns early when nothing about the request changed", async () => {
    // The early-out is worth keeping. Widening the comparison must not turn
    // every poll into a re-render.
    const pair = await generateDeviceKeyPair();
    const key = await exportDevicePublicKey(pair.publicKey);

    asks("laptop", key, 10 * 60 * 1000);
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getLinkRequests()).toHaveLength(1));

    const held = sync.getLinkRequests();
    await foreground();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    // Same array identity: nothing was reassigned, so no listener was notified.
    expect(sync.getLinkRequests()).toBe(held);
  });
});

describe("who the data key is handed to", () => {
  /**
   * Someone who has the mailbox and nothing else. They can sign in, so RLS lets
   * them write both per-device tables: a public key they hold the private half
   * of, and a wrapped row at an epoch nobody is using, with junk in it. Then they
   * wait for a real device to connect.
   */
  const forgedRowsFor = async (id: string) => {
    const pair = await generateDeviceKeyPair();
    tables.device_keys?.push({
      user_id: USER_ID,
      device_id: id,
      public_key: await exportDevicePublicKey(pair.publicKey),
    });
    tables.device_wrapped_keys?.push({
      user_id: USER_ID,
      device_id: id,
      epoch: 9,
      wrapped: { v: 1, note: "granted earlier" },
    });
    return pair;
  };

  test("not to a device whose row proves nothing", async () => {
    // End to end through a connect, which is how this fires in practice: nothing
    // is asked of the person, because this path deliberately compares no
    // verification code, and nothing appears in the register, because it never
    // writes there. So there was no prompt to refuse and no trace afterwards.
    await forgedRowsFor("intruder");

    await boot();

    expect(
      tables.device_wrapped_keys?.filter(
        (r) => r.device_id === "intruder" && r.epoch === 0
      ) ?? []
    ).toEqual([]);
  });

  test("not even after a rotation, which is when new rows are written anyway", async () => {
    const intruder = await forgedRowsFor("intruder");
    const sync = await boot();

    await sync.removeDevice("phone");

    expect(
      tables.device_wrapped_keys?.find(
        (r) => r.device_id === "intruder" && r.epoch === 1
      )
    ).toBeUndefined();
    // Explicit about what is absent: a row this keypair could have opened.
    expect(intruder.privateKey).toBeTruthy();
  });

  test("not on the strength of a grant lifted off another device", async () => {
    // The version available to anyone who can read the table, which is anyone on
    // the account. A grant names its device, so moving it proves nothing.
    await forgedRowsFor("intruder");
    const real = tables.device_wrapped_keys?.find(
      (r) => r.device_id === "phone"
    );
    tables.device_wrapped_keys?.push({
      user_id: USER_ID,
      device_id: "intruder",
      epoch: 0,
      wrapped: (real as { wrapped: unknown }).wrapped,
    });

    const sync = await boot();
    await sync.removeDevice("phone");

    expect(
      tables.device_wrapped_keys?.find(
        (r) => r.device_id === "intruder" && r.epoch === 1
      )
    ).toBeUndefined();
  });

  test("and a device linked before grants existed needs approving again", async () => {
    // The migration, stated as behaviour rather than left to be discovered. An
    // older row carries no grant, so the device stops being topped up. It keeps
    // every epoch it already holds, so nothing it could read becomes unreadable.
    tables.device_wrapped_keys = [
      { user_id: USER_ID, device_id: "phone", epoch: 0, wrapped: { v: 1 } },
    ];
    const laptopPair = await generateDeviceKeyPair();
    tables.device_keys?.push({
      user_id: USER_ID,
      device_id: "laptop",
      public_key: await exportDevicePublicKey(laptopPair.publicKey),
    });
    tables.device_wrapped_keys.push({
      user_id: USER_ID,
      device_id: "laptop",
      epoch: 0,
      wrapped: { v: 1 },
    });

    const sync = await boot();
    await sync.removeDevice("phone");

    expect(
      tables.device_wrapped_keys?.find(
        (r) => r.device_id === "laptop" && r.epoch === 1
      )
    ).toBeUndefined();
    // And the old row is still there, so it reads what it always could.
    expect(
      tables.device_wrapped_keys?.some(
        (r) => r.device_id === "laptop" && r.epoch === 0
      )
    ).toBe(true);
  });

  // The positive case is "a device that stays gets the new key" above, whose
  // fixture grants the laptop properly as a real one would. That test and these
  // are the same fixture with and without a valid grant, which is the whole of
  // what this rule changes.
});

describe("telling apart behind, unproven and removed", () => {
  /**
   * The phone as it stands after the grant change and before it is approved
   * again: a real blob it can open, at an epoch it holds, with no grant on it.
   * That is every device linked before grants existed.
   */
  const bootAsUnprovenPhone = async () => {
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_keys = [
      { user_id: USER_ID, device_id: "phone", public_key: phone.publicKey },
      { user_id: USER_ID, device_id: DEVICE_ID, public_key: "mac" },
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
    // Rotated away from the epoch it holds, so it cannot read the newest rows.
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    doc.getArray("entries").push(["written before the rotation"]);
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    return start();
  };

  test("an unproven device asks to be approved rather than told to wait", async () => {
    // The whole point. Before this it was told "open another device and it will
    // catch up", which cannot work: no other device will top up a row that proves
    // nothing. Telling someone to wait for something that cannot arrive is what
    // got the lost-device feature deleted twice in July, and the natural response
    // to it is to sign out and back in, which wipes unsynced writes.
    const sync = await bootAsUnprovenPhone();

    await vi.waitFor(() => expect(sync.getLinkStage()).toBe("waiting"));
    expect(sync.getSyncError()).toMatch(/needs approving again/i);
    expect(sync.getSyncError()).not.toMatch(/it will catch up/i);
  });

  test("and it publishes a code, so there is something to compare", async () => {
    // A device with entries never reaches the unlock screen, so without this the
    // person is asked to compare two codes and shown one.
    const sync = await bootAsUnprovenPhone();

    await vi.waitFor(() => expect(sync.getLinkCode()).toBeTruthy());
    expect(tables.device_link_requests?.[0]?.device_id).toBe("phone");
  });

  test("and it is not reported as removed", async () => {
    const sync = await bootAsUnprovenPhone();

    await vi.waitFor(() => expect(sync.getLinkStage()).toBe("waiting"));
    expect(sync.wasRemoved()).toBe(false);
  });

  test("and it keeps the journal it already had", async () => {
    // Nothing it could read becomes unreadable. Hiding the journal here would be
    // indistinguishable from losing it.
    await bootAsUnprovenPhone();

    expect(doc.getArray("entries").length).toBe(1);
  });

  test("a device with a proven row is still told it is merely behind", async () => {
    // The regression guard: the new arm must not swallow the old one.
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_keys = [
      { user_id: USER_ID, device_id: "phone", public_key: phone.publicKey },
    ];
    // Openable as well as granted. grantedRow leaves the blob empty, and an
    // unopenable row is deleted as useless, which would make this look removed.
    tables.device_wrapped_keys = [
      {
        user_id: USER_ID,
        device_id: "phone",
        epoch: 0,
        wrapped: await wrapAndGrant(
          dataKey,
          phone.publicKey,
          { userId: USER_ID, deviceId: "phone" },
          0
        ),
      },
    ];
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    doc.getArray("entries").push(["something"]);
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();

    await vi.waitFor(() =>
      expect(sync.getSyncError()).toMatch(/it will catch up/i)
    );
    expect(sync.getLinkStage()).toBeNull();
  });

  test("and no rows at all still means removed", async () => {
    // The third arm, unchanged.
    localStorage.setItem("journlet-device-id", "phone");
    myPair = phone.pair;
    tables.device_wrapped_keys = [];
    tables.device_keys = [
      { user_id: USER_ID, device_id: DEVICE_ID, public_key: "mac" },
    ];
    tables.journal_keys = [
      { user_id: USER_ID, epoch: 1, wrapped_key: { v: 1, iv: "", blob: "" } },
    ];
    doc.getArray("entries").push(["written before it was removed"]);
    phoneRing = { dataKeys: new Map([[0, dataKey]]), epoch: 0 };
    const sync = await start();

    await vi.waitFor(() => expect(sync.wasRemoved()).toBe(true));
  });
});

describe("a connect that outlives its keyring", () => {
  test("abandons quietly instead of throwing", async () => {
    // The bug that broke the build on 4 August. ensureJournalKeys guards `ring`
    // once at the top, and TypeScript keeps that narrowing across all dozen of its
    // awaits, so every read below compiled. wipeThisDevice() sets ring to null, so
    // a sign-out or an account deletion lands in the middle of one of those awaits
    // and the next read throws TypeError: Cannot read properties of null.
    //
    // It surfaced as a flaky test rather than as a bug report, because the only
    // thing that reliably opens the window is a device still polling after its
    // test ended. It is a real path in the app all the same: signing out while the
    // app is connecting does exactly this.
    journalsDelayMs = 30;
    const sync = await start();

    // Inside the journals read by now, with the keyring about to go.
    await sync.signOutAndWipe();
    await new Promise((r) => setTimeout(r, 80));

    // The real assertion is that nothing threw: an unhandled rejection fails the
    // run on its own, which is what this test is here to trip. Alongside it, the
    // abandoned connect must not have reported success. Not asserted as
    // "signed-out" because this harness's signOut mock does not fire the auth
    // state change that would set it; real Supabase does.
    expect(sync.getSyncStatus()).not.toBe("synced");
  });

  test("and does not write a keyring back for the account just left", async () => {
    // The other half. Abandoning has to mean not publishing: a connect that
    // finished after the wipe would restore a keyring for an account the person
    // has signed out of, and the next launch would open their journal.
    journalsDelayMs = 30;
    const sync = await start();

    await sync.signOutAndWipe();
    await new Promise((r) => setTimeout(r, 80));

    expect(storedRing).toBeNull();
  });
});
