// @vitest-environment jsdom
//
// Being added by another device, end to end through the sync engine
// (spec/device-identity-design.md, step 3).
//
// The unit tests in deviceLink.test.ts cover the tables. What they cannot cover
// is the sequence: a device that cannot open the journal has to ask rather than
// only asking for a key, has to notice when it is granted, and above all must
// not present the keeper key it generated on first launch as this account's
// recovery code. That last one is the reason this file exists — it is silent,
// plausible, and would be written down and relied on.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  encryptUpdate,
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";
import {
  exportDevicePublicKey,
  generateDeviceKeyPair,
  wrapDataKeyForDevice,
} from "../src/lib/deviceKeys";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "this-device";

// The account's real data key, and a keeper key this device does not have. That
// combination is exactly a new device linking to an existing journal.
const dataKey = await generateDataKey();
const absentKeeper = await generateKeeperKey();
const accountWrapped = await wrapDataKey(dataKey, absentKeeper);

// What ensureKeys() hands back here: a freshly generated keeper key, as every
// install has, which cannot open this account's journal.
const ownKeeper = await generateKeeperKey();
const ownWrapped = await wrapDataKey(await generateDataKey(), ownKeeper);

let myPair: CryptoKeyPair;

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;

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
        const api = {
          eq(c: string, v: unknown) {
            filters.push([c, v]);
            return api;
          },
          gt: () => api,
          order: () => api,
          limit: async () => ({ data: matching(), error: null }),
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
          const at = rows().findIndex((r) => r.device_id === row.device_id);
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
        subscribe: (cb: (s: string) => void) => {
          cb("SUBSCRIBED");
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
    keeperKey: ownKeeper,
    dataKey: adoptedRing?.dataKey ?? (await generateDataKey()),
    wrapped: ownWrapped,
    createdAt: 0,
  }),
  // Records what the engine decided to store, which is how the test sees that
  // the useless keeper key was dropped rather than kept.
  replaceKeyRing: async (ring: unknown) => {
    adoptedRing = ring as { keeperKey?: CryptoKey; dataKey: CryptoKey };
  },
  wipeKeys: async () => {},
  ensureDeviceKeyPair: async () => myPair,
}));

let adoptedRing: { keeperKey?: CryptoKey; dataKey: CryptoKey } | null = null;

/** Put the account's journal on the server, so a granted device has something to pull. */
const serverHoldsAJournal = async () => {
  const state = new Y.Doc();
  state.getArray("entries").push(["written before this device existed"]);
  const payload = await encryptUpdate(dataKey, Y.encodeStateAsUpdate(state), {
    userId: USER_ID,
    volume: "v1",
  });
  tables.journal_updates = [{ id: 1, payload: b64encode(payload), volume: "v1" }];
};

/** Another device approves: the data key, wrapped to this device alone. */
const somebodyApproves = async () => {
  tables.device_wrapped_keys = [
    {
      user_id: USER_ID,
      device_id: DEVICE_ID,
      wrapped: await wrapDataKeyForDevice(
        dataKey,
        await exportDevicePublicKey(myPair.publicKey),
        { userId: USER_ID, deviceId: DEVICE_ID }
      ),
    },
  ];
};

const boot = async () => {
  vi.resetModules();
  const sync = await import("../src/store/sync");
  sync.startSync();
  authCallback?.("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  return sync;
};

beforeEach(async () => {
  tables = {};
  doc = new Y.Doc();
  adoptedRing = null;
  authCallback = null;
  localStorage.clear();
  localStorage.setItem("journlet-device-id", DEVICE_ID);
  myPair = await generateDeviceKeyPair();
  await serverHoldsAJournal();
});

describe("a device that cannot open the journal", () => {
  test("asks to be added, rather than only asking for a key", async () => {
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    await vi.waitFor(() =>
      expect(tables.device_link_requests?.[0]?.device_id).toBe(DEVICE_ID)
    );
    expect(tables.device_link_requests?.[0]?.public_key).toBe(
      await exportDevicePublicKey(myPair.publicKey)
    );
  });

  test("shows a code to compare", async () => {
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getLinkCode()).not.toBeNull());

    // Sixteen Crockford characters in four groups. The screen it appears on is
    // useless without this shape being right.
    expect(sync.getLinkCode()).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}( [0-9A-HJKMNP-TV-Z]{4}){3}$/
    );
  });

  test("does not offer a recovery code it cannot honour", async () => {
    // The dangerous case. Every install generates a keeper key, and on a device
    // linking to an existing journal that key opens nothing. Rendering it would
    // produce something indistinguishable from the real recovery code.
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    expect(await sync.getJournalKeyCode()).toBeNull();
  });
});

describe("once another device approves", () => {
  test("it takes the key and opens the journal", async () => {
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    await somebodyApproves();
    await sync.retryConnect();

    expect(sync.getSyncStatus()).toBe("synced");
    expect(doc.getArray("entries").toArray()).toContain(
      "written before this device existed"
    );
  });

  test("it withdraws its request", async () => {
    const sync = await boot();
    await vi.waitFor(() =>
      expect(tables.device_link_requests).toHaveLength(1)
    );

    await somebodyApproves();
    await sync.retryConnect();

    expect(tables.device_link_requests).toEqual([]);
    expect(sync.getLinkCode()).toBeNull();
  });

  test("signing out gives up its place on the account", async () => {
    // The gap Gary found on 31 July. Sign-out marked the register and left both
    // server rows in place, so the device stayed listed as one of the account's
    // devices and per-device keys were doing nothing for the one case they were
    // built for. Asserted here rather than in the unit tests because the unit
    // test for surrenderDeviceKeys passed while nothing called it.
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));
    await somebodyApproves();
    await sync.retryConnect();
    await vi.waitFor(() =>
      expect(tables.device_keys?.some((r) => r.device_id === DEVICE_ID)).toBe(true)
    );

    await sync.signOutAndWipe();

    expect(tables.device_keys ?? []).toEqual([]);
    expect(tables.device_wrapped_keys ?? []).toEqual([]);
  });

  test("it does not keep the keeper key it arrived with", async () => {
    // Keeping it would leave something that looks like a recovery code on a
    // device that has no business showing one, and would mean a device removed
    // later could still unwrap the account's journal row.
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    await somebodyApproves();
    await sync.retryConnect();

    expect(adoptedRing?.keeperKey).toBeUndefined();
    expect(await sync.getJournalKeyCode()).toBeNull();
  });
});
