// @vitest-environment jsdom
//
// Integration tests for the sync engine, driven against a fake table.
//
// Two things here are worth testing at this level rather than in units. The
// migration off the retired payload format has no dedicated code — it falls out
// of reconcile, because the shadow doc only learns about rows that actually
// decrypted — and the shadow's bookkeeping is exactly the kind of thing that
// goes wrong silently, as the duplicate-push bug below did.
//
// The engine holds module-level state (the connected user, the shadow doc, the
// high-water mark), so each case resets the module registry and re-imports
// rather than trying to unwind it.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  decryptUpdate,
  encryptUpdate,
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";

// Real keys, held by the test so it can read what the engine writes.
const keeperKey = await generateKeeperKey();
const dataKey = await generateDataKey();
const wrapped = await wrapDataKey(dataKey, keeperKey);

interface Row {
  id: number;
  payload: string;
  volume: string;
}

// Mutable fixtures, read by the mock factories on each re-import.
let doc = new Y.Doc();
let rows: Row[] = [];
let inserted: { payload: string; volume: string }[] = [];
let authCallback: ((event: string, session: unknown) => void) | null = null;

/**
 * Sign in through the listener the Supabase mock installed.
 *
 * A function rather than an inline `authCallback?.(...)` for two reasons. The
 * optional call silently does nothing when the listener was never installed, so
 * a test would boot signed out and look identical to one that signed in and
 * found nothing to do. And reading a module-level `let` inside the same
 * function that assigned it `null` leaves TypeScript narrowing it to `null`
 * across the `await import(...)`, which is the narrowing trap Finding 28 came
 * from: here it made the call unreachable as far as the compiler could tell.
 */
const signIn = (): void => {
  if (!authCallback)
    throw new Error("startSync installed no auth listener, so nothing signed in");
  authCallback("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
};
// The realtime INSERT handler, captured so a test can deliver a row the way
// another device's edit would arrive.
let realtimeHandler: ((msg: { new: Row }) => void) | null = null;
let subscribeCallback: ((state: string) => void) | null = null;
// Inserts resolve instantly by default. Slowing them opens the window in which
// a live push is in flight, which is what the duplicate-push race needs.
let insertDelayMs = 0;

const b64encode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));
const b64decode = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const updatesTable = () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    order: () => builder,
    limit: async () => ({ data: rows, error: null }),
    insert: async (row: { payload: string; volume: string }) => {
      if (insertDelayMs > 0)
        await new Promise((r) => setTimeout(r, insertDelayMs));
      inserted.push(row);
      return { error: null };
    },
  };
  return builder;
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ error: null }),
    from: (table: string) => {
      if (table === "journals") {
        // No journal row yet, so ensureJournalKeys takes the first-device path,
        // publishes our wrapped key and reports success.
        return {
          select: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          insert: async () => ({ error: null }),
        };
      }
      return updatesTable();
    },
    removeChannel: () => {},
    // Chainable, because the channel now carries two subscriptions: inserts to
    // journal_updates and updates to journals (the lost-device signal). A mock
    // whose .on() returned a different shape than the real client's would have
    // let a broken chain pass here and fail only in the browser.
    channel: () => {
      const ch = {
        on: (
          _evt: string,
          cfg: { table?: string },
          handler: (msg: { new: Row }) => void
        ) => {
          // Named positively. This was `!== "journals"`, and when a third
          // subscription was added (device_link_requests) it silently captured
          // that one instead, so every remote-edit test in this file started
          // asserting against a handler that does nothing with journal rows.
          // Match the table you mean.
          if (cfg?.table === "journal_updates") realtimeHandler = handler;
          return ch;
        },
        subscribe: (cb?: (s: string) => void) => {
          // Optional: watchForGrant subscribes with no callback, which is legal
          // and made this mock throw.
          if (cb) subscribeCallback = cb;
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
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
  // The device register lives in the doc, so it follows the doc fixture and is
  // recreated with it between tests rather than leaking rows across them.
  get devices() {
    return doc.getMap("devices");
  },
}));

vi.mock("../src/lib/keystore", () => ({
  // The ring holds a key per epoch since 3 August. Epoch 0 is every account
  // that has never rotated, which is what these tests exercise.
  ensureKeys: async () => ({
    keeperKey,
    dataKeys: new Map([[0, dataKey]]),
    epoch: 0,
    wrapped,
    createdAt: 0,
  }),
  replaceKeyRing: async () => {},
  wipeKeys: async () => {},
  // Every connect publishes this device's key now, so the mock has to offer
  // one. A stub keypair is enough: the wrapping itself is tested against real
  // keys in deviceKeys.test.ts.
  ensureDeviceKeyPair: async () =>
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]),
}));

/** A stored row in the retired format: same layout, version byte 1, no AAD. */
const legacyRow = async (id: number, text: string): Promise<Row> => {
  const scratch = new Y.Doc();
  scratch.getArray("entries").push([text]);
  const update = Y.encodeStateAsUpdate(scratch);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    // `as BufferSource` for the same reason crypto.ts does it at the real call
    // site: since the typed arrays became generic in their buffer, a plain
    // Uint8Array is not assignable to the DOM lib's ArrayBufferView<ArrayBuffer>.
    // Nothing about the bytes changes.
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      dataKey,
      update as BufferSource
    )
  );
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(ct, 13);
  return { id, payload: b64encode(out), volume: "v1" };
};

/** A v2 row holding a doc's complete state, as the server would store it. */
const snapshotRow = async (id: number, from: Y.Doc): Promise<Row> => {
  const payload = await encryptUpdate(dataKey, Y.encodeStateAsUpdate(from), {
    userId: USER_ID,
    volume: "v1",
  });
  return { id, payload: b64encode(payload), volume: "v1" };
};

// The device register writes into the same doc, so it is part of what these
// tests see. Pinning the id makes that deterministic across module resets.
const DEVICE_ID = "test-device";

/**
 * Pre-register this device with a recent last-seen, so touchThisDevice() on
 * connect is a no-op. Needed wherever a test asserts the engine stays
 * completely quiet: registering is a genuine local change and pushing it is
 * correct, so without this the "no rows at all" assertions would be measuring
 * the register rather than the delete-set behaviour they exist to protect.
 */
const withDeviceRegistered = (d: Y.Doc): void => {
  // Idempotent: boot() registers by default, and some fixtures also put the row
  // into the server snapshot. Setting the key twice would be a local change the
  // server lacks, which is a push, which is exactly what the quiet tests are
  // measuring.
  if (d.getMap("devices").has(DEVICE_ID)) return;
  const rec = new Y.Map<unknown>();
  d.getMap<Y.Map<unknown>>("devices").set(DEVICE_ID, rec);
  rec.set("id", DEVICE_ID);
  // What clientName()/platformName() detect under jsdom, whose user agent
  // matches no browser or platform. If this drifts, touchThisDevice records the
  // newly detected client and these "stays quiet" assertions will catch it.
  rec.set("platform", "unknown platform");
  const clients = new Y.Map<unknown>();
  rec.set("clients", clients);
  clients.set("Browser", Date.now());
  rec.set("firstSeen", Date.now());
  rec.set("lastSeen", Date.now());
};

/** Fresh engine, fresh local journal, given server rows, signed in. */
const boot = async (opts: {
  local?: string[];
  /** Runs against the fresh local doc — use for deletions and other edits. */
  prepare?: (d: Y.Doc) => void;
  server: Row[];
}) => {
  vi.resetModules();
  localStorage.setItem("journlet-device-id", DEVICE_ID);
  doc = new Y.Doc();
  if (opts.local) doc.getArray("entries").push(opts.local);
  opts.prepare?.(doc);
  // Registered by default. touchThisDevice runs after the reconcile now (see
  // doConnect), so an unregistered device writes its row as a separate live
  // push, which would show up in every assertion about how many rows a journal
  // change produced. Tests about the register itself live in devices.test.ts.
  withDeviceRegistered(doc);
  rows = opts.server;
  inserted = [];
  authCallback = null;
  realtimeHandler = null;
  subscribeCallback = null;
  insertDelayMs = 0;

  const sync = await import("../src/store/sync");
  sync.startSync();
  signIn();
  return sync;
};

beforeEach(() => {
  localStorage.clear();
});

describe("first sync after the payload format changed", () => {
  test("writes the whole local journal back as one v2 payload", async () => {
    await boot({
      local: ["written before the upgrade"],
      server: [await legacyRow(1, "the same content, stored the old way")],
    });
    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));

    expect(inserted).toHaveLength(1);
    expect(b64decode(inserted[0].payload)[0]).toBe(2);
    expect(inserted[0].volume).toBe("v1");
  });

  test("the payload it wrote carries the local content and is readable", async () => {
    await boot({ local: ["survives the migration"], server: [] });
    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));

    const update = await decryptUpdate(
      dataKey,
      b64decode(inserted[0].payload),
      { userId: USER_ID, volume: "v1" }
    );
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, update);
    expect(rebuilt.getArray("entries").toArray()).toContain(
      "survives the migration"
    );
  });

  // Legacy rows are expected, not a fault. Reporting them as decryption
  // failures would tell every existing user their journal was damaged.
  test("legacy rows do not raise a sync error", async () => {
    const sync = await boot({
      local: ["anything"],
      server: [await legacyRow(1, "old"), await legacyRow(2, "older")],
    });
    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));
    expect(sync.getSyncError()).toBeNull();
  });

  test("a legacy row's content is not silently resurrected", async () => {
    // The old row is never decrypted, so what it held cannot reach the doc.
    // The local copy is the source of truth for the migration, by design.
    await boot({
      local: ["local copy"],
      server: [await legacyRow(1, "only ever stored remotely")],
    });
    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));

    expect(doc.getArray("entries").toArray()).toEqual(["local copy"]);
  });
});

// Regression: the shadow doc tracks what the server holds, but realtime-
// delivered rows were applied to the live doc only. The next reconcile then saw
// another device's edit as a local diff and pushed it straight back, so every
// remote edit cost a duplicate row. Spotted in the wild as two 492-byte rows
// 119ms apart.
describe("another device's edit arriving over realtime", () => {
  const remoteEdit = async () => {
    const scratch = new Y.Doc();
    scratch.getArray("entries").push(["written on the other device"]);
    const payload = await encryptUpdate(
      dataKey,
      Y.encodeStateAsUpdate(scratch),
      { userId: USER_ID, volume: "v1" }
    );
    return { id: 2000, payload: b64encode(payload), volume: "v1" };
  };

  test("is applied to the local journal", async () => {
    await boot({ local: ["mine"], server: [] });
    await vi.waitFor(() => expect(realtimeHandler).toBeTruthy());

    realtimeHandler?.({ new: await remoteEdit() });
    await vi.waitFor(() =>
      expect(doc.getArray("entries").toArray()).toContain(
        "written on the other device"
      )
    );
  });

  test("is not pushed back to the server on the next reconcile", async () => {
    await boot({ local: ["mine"], server: [] });
    await vi.waitFor(() => expect(inserted.length).toBe(1)); // initial snapshot

    realtimeHandler?.({ new: await remoteEdit() });
    await vi.waitFor(() =>
      expect(doc.getArray("entries").toArray()).toContain(
        "written on the other device"
      )
    );

    // A dropped socket rejoining is one of several things that reconciles; any
    // of them would have re-pushed the remote edit.
    subscribeCallback?.("SUBSCRIBED");
    await new Promise((r) => setTimeout(r, 50));

    expect(inserted).toHaveLength(1);
  });

  test("a genuine local edit afterwards still pushes", async () => {
    await boot({ local: ["mine"], server: [] });
    await vi.waitFor(() => expect(inserted.length).toBe(1));

    realtimeHandler?.({ new: await remoteEdit() });
    await vi.waitFor(() =>
      expect(doc.getArray("entries").toArray()).toContain(
        "written on the other device"
      )
    );

    doc.getArray("entries").push(["and now mine again"]);
    await vi.waitFor(() => expect(inserted.length).toBe(2));
  });
});

// Regression: nothing coordinated a live push with a concurrent reconcile. The
// shadow doc is only updated once an insert *completes*, so a reconcile landing
// mid-flight computed the same update as a local diff and sent it a second time.
// Observed in the wild as pairs of identical-length rows 126ms and 342ms apart,
// on a single device with the other closed. Harmless — Yjs updates are
// idempotent — but it doubled the log.
describe("a reconcile landing while a push is in flight", () => {
  test("does not send the same update twice", async () => {
    await boot({ local: ["mine"], server: [] });
    await vi.waitFor(() => expect(inserted.length).toBe(1)); // initial snapshot

    // Make the insert slow, then edit and immediately reconcile — which is what
    // backgrounding and foregrounding the app does via visibilitychange.
    insertDelayMs = 40;
    doc.getArray("entries").push(["an edit mid-flight"]);
    subscribeCallback?.("SUBSCRIBED");

    await new Promise((r) => setTimeout(r, 250));
    expect(inserted).toHaveLength(2);
  });

  test("still sends it once when the reconcile is the only writer", async () => {
    await boot({ local: ["mine"], server: [] });
    await vi.waitFor(() => expect(inserted.length).toBe(1));

    // Same shape, but the push settles before the reconcile starts, which
    // always worked. Guards against fixing the race by dropping writes.
    insertDelayMs = 0;
    doc.getArray("entries").push(["an edit, then a pause"]);
    await vi.waitFor(() => expect(inserted.length).toBe(2));

    subscribeCallback?.("SUBSCRIBED");
    await new Promise((r) => setTimeout(r, 100));
    expect(inserted).toHaveLength(2);
  });

  test("two edits in quick succession both reach the server", async () => {
    await boot({ local: ["mine"], server: [] });
    await vi.waitFor(() => expect(inserted.length).toBe(1));

    insertDelayMs = 40;
    doc.getArray("entries").push(["first"]);
    doc.getArray("entries").push(["second"]);

    await vi.waitFor(() => expect(inserted.length).toBe(3));
    await new Promise((r) => setTimeout(r, 150));
    expect(inserted).toHaveLength(3);
  });
});

// Invariant: several auth events on launch must not each open with their own
// push. Worth pinning, but read the caveat — this passes with or without the
// single-flight guard on connect(), because reconcile's own `reconciling` flag
// already blocks the second one in this harness. It is therefore NOT a
// regression test for that guard, and it does not reproduce the two [connect]
// pushes with an identical hash 125ms apart seen on a real device on 28 July.
// That interleaving is still unexplained; see the note in sync.ts.
describe("several auth events on launch", () => {
  test("open with a single push, not one each", async () => {
    insertDelayMs = 40;
    await boot({ local: ["mine"], server: [] });
    authCallback?.("TOKEN_REFRESHED", {
      user: { id: USER_ID, email: "g@example.com" },
    });
    authCallback?.("SIGNED_IN", {
      user: { id: USER_ID, email: "g@example.com" },
    });

    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 250));
    expect(inserted).toHaveLength(1);
  });
});

// The bug that produced every duplicate row actually reported, and the reason
// none of the tests above caught any of it: this harness only ever *appended* to
// the doc. Yjs includes the whole delete set in a state-vector diff, so a
// journal with tombstones — completed, migrated or struck-through entries, which
// is every real journal — computes a non-empty diff on every reconcile even when
// the server already holds everything. Append-only docs never have a delete set,
// so the old `diff.length > 2` test looked correct here and was wrong in life.
describe("a journal that has had entries deleted", () => {
  // Content plus a tombstone, built up front so the same state can be put on
  // the server and in the local doc.
  const stagedWithDeletion = () => {
    const staged = new Y.Doc();
    const entries = staged.getArray("entries");
    entries.push(["kept", "struck", "also kept"]);
    entries.delete(1, 1);
    withDeviceRegistered(staged);
    return staged;
  };

  test("does not re-push the delete set when the server is already current", async () => {
    const staged = stagedWithDeletion();
    const state = Y.encodeStateAsUpdate(staged);

    await boot({
      prepare: (d) => Y.applyUpdate(d, state),
      server: [await snapshotRow(1, staged)],
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(inserted).toHaveLength(0);
  });

  test("stays quiet across repeated reconciles", async () => {
    const staged = stagedWithDeletion();
    const state = Y.encodeStateAsUpdate(staged);

    await boot({
      prepare: (d) => Y.applyUpdate(d, state),
      server: [await snapshotRow(1, staged)],
    });
    await new Promise((r) => setTimeout(r, 100));

    // Every foreground and socket rejoin used to cost a row.
    subscribeCallback?.("SUBSCRIBED");
    subscribeCallback?.("SUBSCRIBED");
    await new Promise((r) => setTimeout(r, 200));

    expect(inserted).toHaveLength(0);
  });

  test("still pushes a genuinely new deletion", async () => {
    const staged = stagedWithDeletion();
    const state = Y.encodeStateAsUpdate(staged);

    await boot({
      prepare: (d) => Y.applyUpdate(d, state),
      server: [await snapshotRow(1, staged)],
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(inserted).toHaveLength(0);

    // Deleting something the server has not seen deleted must still sync.
    doc.getArray("entries").delete(0, 1);
    await vi.waitFor(() => expect(inserted).toHaveLength(1));
  });

  test("still pushes offline edits found at startup", async () => {
    // The case the diff push exists for: local content the server lacks, on a
    // journal that also has tombstones. Must not be suppressed.
    const staged = stagedWithDeletion();
    const serverRow = await snapshotRow(1, staged);
    const state = Y.encodeStateAsUpdate(staged);

    await boot({
      prepare: (d) => {
        Y.applyUpdate(d, state);
        d.getArray("entries").push(["written while offline"]);
      },
      server: [serverRow],
    });

    await vi.waitFor(() => expect(inserted).toHaveLength(1));
  });
});

describe("rows that should worry us", () => {
  // A v2 row that will not decrypt is a real problem and must not be silent.
  test("a corrupt v2 row is surfaced to the user", async () => {
    const good = await encryptUpdate(
      dataKey,
      Y.encodeStateAsUpdate(new Y.Doc()),
      { userId: USER_ID, volume: "v1" }
    );
    good[30] ^= 0xff; // corrupt the ciphertext, version byte still reads 2
    const sync = await boot({
      local: ["anything"],
      server: [{ id: 1, payload: b64encode(good), volume: "v1" }],
    });

    await vi.waitFor(() => expect(sync.getSyncError()).toBeTruthy());
    expect(sync.getSyncError()).toMatch(/could not be decrypted/i);

    // Recorded is not surfaced, which was the whole of Finding 2. This path
    // never changes the status, so the old notification carried a value the UI
    // already held and React bailed out of re-rendering. What the UI reads now
    // is the snapshot, so the message has to be on it, and the status alongside
    // it has to be untouched. That the change also notifies is pinned in
    // tests/syncStatus.test.ts, where it can be asserted directly.
    expect(sync.getSyncSnapshot().error).toMatch(/could not be decrypted/i);
    expect(sync.getSyncSnapshot().status).toBe(sync.getSyncStatus());
  });

  // The binding doing its job: a blob written for another volume must not be
  // accepted just because the server hands it over under this one.
  test("a blob from another volume is surfaced, not applied", async () => {
    const foreign = await encryptUpdate(
      dataKey,
      Y.encodeStateAsUpdate(new Y.Doc()),
      { userId: USER_ID, volume: "v7" }
    );
    const sync = await boot({
      local: ["anything"],
      server: [{ id: 1, payload: b64encode(foreign), volume: "v1" }],
    });

    await vi.waitFor(() => expect(sync.getSyncError()).toBeTruthy());
    expect(sync.getSyncError()).toMatch(/could not be decrypted/i);
  });

  test("a blob from another account is surfaced, not applied", async () => {
    const foreign = await encryptUpdate(
      dataKey,
      Y.encodeStateAsUpdate(new Y.Doc()),
      { userId: "99999999-9999-4999-8999-999999999999", volume: "v1" }
    );
    const sync = await boot({
      local: ["anything"],
      server: [{ id: 1, payload: b64encode(foreign), volume: "v1" }],
    });

    await vi.waitFor(() => expect(sync.getSyncError()).toBeTruthy());
    expect(sync.getSyncError()).toMatch(/could not be decrypted/i);
  });
});
