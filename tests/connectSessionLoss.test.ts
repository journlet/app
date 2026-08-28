// @vitest-environment jsdom
//
// A session that goes away while a connect is in flight.
//
// doConnect guards on `session` at the top and then awaits four things, the last
// of them a network round trip. The auth listener assigns to that same module
// state, so a token refresh that fails, an expiry, or a sign-out in another tab
// nulls it part-way through. TypeScript carried the narrowing from the guard
// across every await, so the final `session.user.id` compiled and would then
// throw a TypeError. It is the fault already recorded against `ring` in
// wipeThisDevice, found again against `session` on 28 August 2026 by asking which
// other module state is read after an await without being held.
//
// A throw there is worse than the throw. connect()'s continuation is a `.then`,
// so an exception skipped the branch that arms the retry: no cancelRetry, no
// scheduleRetry, and an unhandled rejection.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const dataKey = await generateDataKey();
const keeperKey = await generateKeeperKey();
const wrapped = await wrapDataKey(dataKey, keeperKey);

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;
/**
 * A one-shot gate the test closes over the reconcile's read, so it can take the
 * session away at exactly the point the old code carried on regardless. Once
 * opened it stays open, or the retry that follows would block on it too, which is
 * what the first version of this harness did.
 */
let gate: { promise: Promise<void>; open: () => void } | null = null;
let readReached: (() => void) | null = null;
/** How many times the reconcile's paged read has run. */
let reconciles = 0;

const closeGate = (): void => {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  gate = { promise, open };
};

const openGate = (): void => {
  const g = gate;
  gate = null;
  g?.open();
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
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
        // The reconcile's paged read. Held open so the test can take the session
        // away at exactly the point the old code would have carried on regardless.
        limit: async () => {
          reconciles += 1;
          readReached?.();
          await gate?.promise;
          return { data: [], error: null };
        },
        insert: async () => ({ error: null }),
      };
      return b;
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
const errors: unknown[] = [];

/**
 * On the process, not on window.
 *
 * The first version of this listened for the `unhandledrejection` DOM event and
 * asserted on an empty list, which passed against the unfixed engine while vitest
 * itself was printing the TypeError two lines further up the same output. The
 * rejection escapes through node rather than through jsdom, so window heard
 * nothing. Worth recording, because a test that cannot see the fault it is named
 * after is worse than no test: it reports the bug fixed.
 */
const onRejection = (reason: unknown) => errors.push(reason);

beforeEach(() => {
  errors.length = 0;
  process.on("unhandledRejection", onRejection);
});

afterEach(async () => {
  process.off("unhandledRejection", onRejection);
  openGate();
  readReached = null;
  await current?.signOutAndWipe().catch(() => undefined);
  current = null;
});

/**
 * Let a rejection surface before asserting there was none.
 *
 * An unhandled rejection is reported a turn or two after the promise settles, so
 * asserting immediately passes whether or not one is coming. Two of the tests
 * below did exactly that, and passed against the unfixed engine while vitest
 * printed the TypeError in the same output.
 */
const settle = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 60));

/**
 * Fire an auth event, insisting the engine actually registered a listener.
 *
 * A function rather than `authCallback?.(...)` for the reason tests/connectRetry
 * uses one: the optional call swallows a boot that never subscribed, so the test
 * would go on to assert about an engine that had heard nothing. It also keeps
 * TypeScript honest, which narrows `authCallback` to null from the assignment in
 * bootHeld and cannot see the mock reassign it.
 */
const authEvent = (event: string, session: unknown): void => {
  if (!authCallback)
    throw new Error("the engine registered no auth listener: boot failed");
  authCallback(event, session);
};

/** Boot with the reconcile's read held open, and wait until it is reached. */
const bootHeld = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  authCallback = null;
  reconciles = 0;
  localStorage.clear();
  localStorage.setItem("journlet-device-id", "phone");

  const reached = new Promise<void>((r) => (readReached = r));
  closeGate();

  const sync = await import("../src/store/sync");
  current = sync;
  sync.startSync();
  authEvent("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  await reached;
  return sync;
};

describe("the session going away mid-connect", () => {
  test("does not throw, and claims nothing about being connected", async () => {
    const sync = await bootHeld();

    // The expiry: Supabase reports no session, which the listener assigns
    // straight into the module state doConnect is part-way through using.
    authEvent("SIGNED_OUT", null);
    openGate();
    await vi.waitFor(() => expect(sync.getSyncStatus()).not.toBe("connecting"));
    await settle();

    expect(errors).toEqual([]);
    expect(sync.getSyncStatus()).not.toBe("synced");
  });

  test("admits it is not connected before it claims to be, when replaced", async () => {
    // Worse than a null, and the reason the check is an identity comparison
    // rather than a null test: sign out and back in as somebody else inside one
    // connect, and the unfixed engine wrote the new user's id against the
    // reconcile and channel of the session before it, then set "synced". A device
    // reporting itself in step with an account it had never pulled.
    //
    // Asserted on the sequence of statuses rather than the destination, because
    // both versions end at "synced" and both reconcile twice: the unfixed one
    // because subscribing rejoins the channel, the fixed one because the retry
    // connects properly. What separates them is that the fixed engine goes
    // through a state that says it is not there yet. Counting reconciles was
    // tried first and could not tell them apart.
    const sync = await bootHeld();
    const seen: string[] = [];
    const stop = sync.subscribeSync(() => seen.push(sync.getSyncStatus()));

    authEvent("SIGNED_IN", {
      user: { id: OTHER_ID, email: "someone@example.com" },
    });
    openGate();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"), {
      timeout: 10000,
    });
    stop();

    expect(errors).toEqual([]);
    expect(seen).toContain("pending");
    expect(seen.indexOf("pending")).toBeLessThan(seen.lastIndexOf("synced"));
  }, 15000);

  test("leaves the retry armed rather than nothing at all", async () => {
    // connect()'s `.then` was the only thing that armed a retry, so an exception
    // in doConnect meant a device with no route back but a foreground or a
    // network event. Asserted through the status the retry path sets.
    const sync = await bootHeld();

    authEvent("SIGNED_OUT", null);
    openGate();

    await vi.waitFor(() =>
      expect(["pending", "offline", "signed-out"]).toContain(
        sync.getSyncStatus()
      )
    );
    await settle();

    expect(errors).toEqual([]);
  });
});
