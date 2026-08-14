// @vitest-environment jsdom
//
// Which device gets marked as owing the user a look at the recovery code
// (decision 4). Only the one that brings a journal into existence.
//
// This is the half of the feature the UI cannot check for itself: the flag is
// written deep inside the sync engine's key check, on exactly one of its two
// paths, and marking the wrong one would either nag a device that already has
// the code or leave a new journal whose code nobody has seen.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PENDING_KEY = "journlet-recovery-pending";

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
/** null means the account has no journal yet, so this device creates one. */
let journalRow: { wrapped_key: unknown } | null = null;

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
            maybeSingle: async () => ({ data: journalRow, error: null }),
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

const boot = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  authCallback = null;
  const sync = await import("../src/store/sync");
  sync.startSync();
  signIn();
  await vi.waitFor(() => expect(sync.getSyncStatus()).not.toBe("connecting"));
  return sync;
};

beforeEach(() => {
  localStorage.clear();
});

describe("a device that creates the journal", () => {
  test("is marked as owing the code", async () => {
    journalRow = null; // no journal on the account yet
    await boot();

    expect(localStorage.getItem(PENDING_KEY)).toBe("1");
  });
});

describe("a device that finds a journal already there", () => {
  test("is not marked, because it was handed the code to get in", async () => {
    journalRow = {
      wrapped_key: {
        v: wrapped.v,
        iv: b64encode(wrapped.iv),
        blob: b64encode(wrapped.blob),
      },
    };
    await boot();

    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  test("is not marked even when its key does not fit", async () => {
    // A device asking for the journal key has not created anything, so it owes
    // nobody a code. Marking here would prompt for a code it cannot yet read.
    const stranger = await generateKeeperKey();
    const strangerWrapped = await wrapDataKey(dataKey, stranger);
    journalRow = {
      wrapped_key: {
        v: strangerWrapped.v,
        iv: b64encode(strangerWrapped.iv),
        blob: b64encode(strangerWrapped.blob),
      },
    };
    const sync = await boot();

    expect(sync.getSyncStatus()).toBe("needs-key");
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
});
