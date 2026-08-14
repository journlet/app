// @vitest-environment jsdom
//
// Retrying a failed connect.
//
// A transient server error used to leave the app in "pending" until something
// incidental happened: a foreground, or the network dropping and returning.
// Reported 29 July as an empty journal after a "JWT issued at future" clock
// error, resolved by restarting the app — which is to say the fix worked and was
// simply never attempted on its own.
//
// The risk in the other direction is a retry loop hammering a server that is
// having a bad minute, so the backoff matters as much as the retry.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
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
/** How many times the journals row has been read. */
let journalReads = 0;
/** Fail the journals read, as the clock error did. */
let failJournalRead = true;

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
            maybeSingle: async () => {
              journalReads += 1;
              if (failJournalRead) {
                return { data: null, error: { message: "JWT issued at future" } };
              }
              return {
                data: {
                  wrapped_key: {
                    v: wrapped.v,
                    iv: b64encode(wrapped.iv),
                    blob: b64encode(wrapped.blob),
                  },
                },
                error: null,
              };
            },
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
    removeChannel: () => {},
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: (cb?: (s: string) => void) => {
          // Optional: watchForGrant subscribes with no callback, which is legal and
          // made this mock throw.
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

/**
 * The engine booted by the current test, so it can be stopped afterwards.
 *
 * Without this, a retry chain armed by one test keeps firing against the shared
 * mock after that test ends, inflating the read count in the next one. That is
 * a test-isolation problem rather than a product one, but it made the backoff
 * assertion measure leftovers from earlier tests instead of the backoff.
 */
let current: typeof import("../src/store/sync") | null = null;

const boot = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  journalReads = 0;
  authCallback = null;
  localStorage.clear();
  const sync = await import("../src/store/sync");
  sync.startSync();
  signIn();
  current = sync;
  return sync;
};

beforeEach(() => {
  failJournalRead = true;
});

afterEach(async () => {
  // Stops the retry chain and drops the session, so nothing re-arms.
  await current?.signOutAndWipe().catch(() => undefined);
  current = null;
});

describe("a connect that fails", () => {
  test("leaves the status where a load-failure screen can see it", async () => {
    const sync = await boot();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));
    expect(sync.hasSyncedOnce()).toBe(false);
    expect(sync.getSyncError()).toMatch(/JWT issued at future/);
  });

  test("retries on its own without being prodded", async () => {
    // The whole point: no foreground, no network event, no restart.
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));
    const first = journalReads;

    await vi.waitFor(() => expect(journalReads).toBeGreaterThan(first), {
      timeout: 6000,
    });
  });

  test("recovers by itself once the server is willing", async () => {
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));

    failJournalRead = false;

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"), {
      timeout: 8000,
    });
    expect(sync.hasSyncedOnce()).toBe(true);
  });

  test("backs off rather than hammering", async () => {
    // A server having a bad minute should not be retried in a tight loop by
    // every device at once.
    //
    // Deliberately a seven second window rather than three. Three could not
    // distinguish a doubling delay from a fixed two second one: both retry once
    // in that time, so removing the doubling passed the test. Over seven
    // seconds, 2-4-8 gives two retries and a fixed 2s gives three, which is the
    // difference the assertion needs to see. Worth the wall-clock cost, since
    // the property being protected is not hammering someone else's server.
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));

    const afterFirstFailure = journalReads;
    await new Promise((r) => setTimeout(r, 7000));

    expect(journalReads - afterFirstFailure).toBeLessThanOrEqual(2);
    expect(journalReads).toBeGreaterThan(afterFirstFailure);
    // Raised from the 5s default: the window itself is 7s.
  }, 15_000);
});

describe("asking again by hand", () => {
  test("retryConnect tries immediately", async () => {
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));
    const before = journalReads;

    failJournalRead = false;
    await sync.retryConnect();

    expect(journalReads).toBeGreaterThan(before);
    expect(sync.getSyncStatus()).toBe("synced");
  });
});
