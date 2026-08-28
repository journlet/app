// @vitest-environment jsdom
//
// A realtime row that decrypts and then will not apply.
//
// Two routes carry the same data into the journal: the paged read in reconcile,
// and the realtime handler. reconcile wraps its pair of Y.applyUpdate calls in a
// try that reports the failure, sets a retriable status and arms the retry. The
// realtime path had no try at all, so the identical failure was reported on one
// route and swallowed on the other: Yjs throws on a malformed update, the throw
// left an async function nobody awaits, and so the row was lost, nothing was
// said, and reportTally never ran either.
//
// Narrow, because the row has to survive AES-GCM authentication first, which
// means it was written by a device holding the key. A Yjs version skew or a
// truncated update is enough. The failure mode is what makes it worth a test:
// silent loss while the badge reads "synced", which is the one thing
// store/sync.ts says is worse than admitting a problem.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  encryptUpdate,
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const dataKey = await generateDataKey();
const keeperKey = await generateKeeperKey();
const wrapped = await wrapDataKey(dataKey, keeperKey);

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;
/** The realtime handler the engine registers, so a test can deliver a row. */
let realtime: ((msg: { new: unknown }) => void) | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => {
      if (table === "journals") {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: {
                wrapped_key: {
                  v: wrapped.v,
                  iv: b64encode(wrapped.iv),
                  blob: b64encode(wrapped.blob),
                },
              },
              error: null,
            }),
          }),
          insert: async () => ({ error: null }),
        };
      }
      const b = {
        select: () => b,
        eq: () => b,
        gt: () => b,
        order: () => b,
        limit: async () => ({ data: [], error: null }),
        insert: async () => ({ error: null }),
      };
      return b;
    },
    removeChannel: async () => {},
    channel: () => {
      const ch = {
        on: (_e: string, _f: unknown, handler: (m: { new: unknown }) => void) => {
          realtime = handler;
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
  get credentials() {
    return doc.getMap("credentials");
  },
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
}));

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => ({
    keeperKey,
    dataKeys: new Map([[0, dataKey]]),
    epoch: 0,
    wrapped,
    createdAt: 0,
  }),
  replaceKeyRing: async () => {},
  wipeKeys: async () => {},
}));

let current: typeof import("../src/store/sync") | null = null;
const rejections: unknown[] = [];
const onRejection = (reason: unknown) => rejections.push(reason);

/**
 * Fire an auth event from outside boot().
 *
 * A separate function, as tests/connectRetry does it: boot() assigns
 * `authCallback = null`, which narrows it for the rest of that function, so even a
 * guard leaves TypeScript calling a `never`. It reassigns from inside the mock,
 * which TypeScript cannot see.
 */
const authEvent = (event: string, session: unknown): void => {
  if (!authCallback)
    throw new Error("the engine registered no auth listener: boot failed");
  authCallback(event, session);
};

/** Rejections surface a turn or two late, so give them room before asserting. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeEach(() => {
  rejections.length = 0;
  process.on("unhandledRejection", onRejection);
});

afterEach(async () => {
  process.off("unhandledRejection", onRejection);
  realtime = null;
  await current?.signOutAndWipe().catch(() => undefined);
  current = null;
});

const boot = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  authCallback = null;
  localStorage.clear();
  localStorage.setItem("journlet-device-id", "phone");
  const sync = await import("../src/store/sync");
  current = sync;
  sync.startSync();
  authEvent("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
  return sync;
};

/** A payload that authenticates against the account's key and is not a Yjs update. */
const unapplyablePayload = async (): Promise<string> => {
  const nonsense = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
  const payload = await encryptUpdate(dataKey, nonsense, {
    userId: USER_ID,
    volume: "v1",
  });
  return b64encode(payload);
};

const deliver = (payload: string): void => {
  if (!realtime) throw new Error("the engine registered no realtime handler");
  realtime({ new: { payload, volume: "v1" } });
};

describe("a row that decrypts but cannot be applied", () => {
  test("says so, rather than dropping it while reporting synced", async () => {
    const sync = await boot();
    expect(sync.getSyncStatus()).toBe("synced");

    deliver(await unapplyablePayload());
    await settle();

    expect(sync.getSyncError()).toBeTruthy();
    expect(sync.getSyncStatus()).not.toBe("synced");
  });

  test("does not escape as an unhandled rejection", async () => {
    // The throw left an async function nobody awaits. Under vitest that is an
    // "Errors 1" and an exit code of 1 with every test passing, which is how a
    // CI failure presented on 27 August from a different cause.
    await boot();

    deliver(await unapplyablePayload());
    await settle();

    expect(rejections).toEqual([]);
  });

  test("arms the retry, because the device is now behind that row", async () => {
    // Realtime has no replay, so a row this device could not apply is only
    // recovered by a reconcile, and the retry is what runs one.
    const sync = await boot();

    deliver(await unapplyablePayload());
    await settle();

    expect(["pending", "offline"]).toContain(sync.getSyncStatus());
  });

  test("leaves a good row applying normally afterwards", async () => {
    // The wrap must not have made the handler brittle: a valid row after a bad
    // one still lands.
    const sync = await boot();
    deliver(await unapplyablePayload());
    await settle();

    const other = new Y.Doc();
    other.getArray("entries").push(["written elsewhere"]);
    const good = await encryptUpdate(
      dataKey,
      Y.encodeStateAsUpdate(other),
      { userId: USER_ID, volume: "v1" }
    );
    deliver(b64encode(good));
    await settle();

    expect(doc.getArray("entries").toArray()).toContain("written elsewhere");
    expect(rejections).toEqual([]);
    expect(sync).toBeTruthy();
  });
});
