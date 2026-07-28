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
    channel: () => ({
      on: (_evt: string, _cfg: unknown, handler: (msg: { new: Row }) => void) => {
        realtimeHandler = handler;
        return {
          subscribe: (cb: (s: string) => void) => {
            subscribeCallback = cb;
            cb("SUBSCRIBED");
          },
        };
      },
    }),
  }),
}));

vi.mock("../src/store/journal", () => ({
  get doc() {
    return doc;
  },
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
}));

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => ({ keeperKey, dataKey, wrapped, createdAt: 0 }),
  replaceKeyRing: async () => {},
  wipeKeys: async () => {},
}));

/** A stored row in the retired format: same layout, version byte 1, no AAD. */
const legacyRow = async (id: number, text: string): Promise<Row> => {
  const scratch = new Y.Doc();
  scratch.getArray("entries").push([text]);
  const update = Y.encodeStateAsUpdate(scratch);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, update)
  );
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(ct, 13);
  return { id, payload: b64encode(out), volume: "v1" };
};

/** Fresh engine, fresh local journal, given server rows, signed in. */
const boot = async (opts: { local: string[]; server: Row[] }) => {
  vi.resetModules();
  doc = new Y.Doc();
  doc.getArray("entries").push(opts.local);
  rows = opts.server;
  inserted = [];
  authCallback = null;
  realtimeHandler = null;
  subscribeCallback = null;
  insertDelayMs = 0;

  const sync = await import("../src/store/sync");
  sync.startSync();
  if (!authCallback) throw new Error("startSync registered no listener");
  authCallback("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
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
