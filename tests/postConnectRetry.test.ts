// @vitest-environment jsdom
//
// Retrying a sync that breaks *after* this device has connected.
//
// connectRetry.test.ts covers the other half: a connect that never succeeds.
// That was the only half the retry ever covered, because its single caller was
// connect()'s continuation and it armed the timer only while connectedUserId
// was unset. So everything that can go wrong once a device is up — a refused
// push, a reconcile that throws, a realtime channel that errors — set "pending"
// and scheduled nothing at all.
//
// The two escape routes left were the `online` and `visibilitychange`
// listeners, which is why the fault looked like two different faults. A phone
// is backgrounded every few minutes, fires visibilitychange, reconciles and
// appears to heal itself "after a while". A desktop tab that stays visible and
// stays online fires neither and sits under a "Not syncing" banner until it is
// reloaded. Reported 17 Aug 2026 with a screenshot of exactly that.
//
// These tests deliberately never touch visibility or the network, for the same
// reason connectRetry's do not: the property under test is that the app mends
// itself with no prod at all.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const dataKey = await generateDataKey();
const keeperKey = await generateKeeperKey();
const wrapped = await wrapDataKey(dataKey, keeperKey);

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;

const signIn = (): void => {
  if (!authCallback)
    throw new Error("startSync installed no auth listener, so nothing signed in");
  authCallback("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
};

/** How many rows this device has tried to write. */
let insertAttempts = 0;
/** Refuse the write, as a storage quota or an RLS rule would. */
let failInsert = false;
/** The last subscribe callback, so a test can drop the channel under the app. */
let channelCallback: ((s: string) => void) | null = null;

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
        insert: async () => {
          insertAttempts += 1;
          return failInsert
            ? { error: { message: "storage quota exceeded" } }
            : { error: null };
        },
      };
      return b;
    },
    removeChannel: () => {},
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: (cb?: (s: string) => void) => {
          channelCallback = cb ?? null;
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
  ensureDeviceKeyPair: async () =>
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]),
}));

let current: typeof import("../src/store/sync") | null = null;

/** Boot, sign in, and wait until this device is actually up. */
const bootConnected = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  insertAttempts = 0;
  authCallback = null;
  channelCallback = null;
  localStorage.clear();
  const sync = await import("../src/store/sync");
  sync.startSync();
  signIn();
  current = sync;
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"), {
    timeout: 8000,
  });
  return sync;
};

/** A local edit, which is what a user typing an entry produces. */
const write = (text: string): void => {
  doc.getArray("entries").push([text]);
};

beforeEach(() => {
  failInsert = false;
});

afterEach(async () => {
  await current?.signOutAndWipe().catch(() => undefined);
  current = null;
});

describe("a push the server refuses, after this device connected", () => {
  test("lands in pending with the server's reason", async () => {
    const sync = await bootConnected();
    failInsert = true;

    write("buy milk");

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));
    expect(sync.getSyncError()).toMatch(/storage quota exceeded/);
  });

  test("tries again on its own, with no foreground and no network event", async () => {
    // The regression this file exists for. Before the fix insertAttempts stayed
    // at exactly one forever: nothing armed a retry once connectedUserId was
    // set, and this test's device is never backgrounded and never goes offline.
    const sync = await bootConnected();
    failInsert = true;

    write("buy milk");
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));
    const afterFirst = insertAttempts;

    await vi.waitFor(() => expect(insertAttempts).toBeGreaterThan(afterFirst), {
      timeout: 8000,
    });
  }, 15_000);

  test("recovers by itself once the server is willing again", async () => {
    const sync = await bootConnected();
    failInsert = true;

    write("buy milk");
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));

    failInsert = false;

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"), {
      timeout: 10_000,
    });
  }, 20_000);

  test("backs off rather than hammering", async () => {
    const sync = await bootConnected();
    failInsert = true;

    write("buy milk");
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("pending"));
    const afterFirst = insertAttempts;

    await new Promise((r) => setTimeout(r, 7000));

    // 2-4-8 gives two attempts in a seven second window; a fixed two second
    // interval would give three. See the same reasoning in connectRetry.test.ts.
    expect(insertAttempts - afterFirst).toBeLessThanOrEqual(2);
    expect(insertAttempts).toBeGreaterThan(afterFirst);
  }, 15_000);
});

describe("a realtime channel that drops", () => {
  test("does not leave the device behind with nothing scheduled", async () => {
    // Realtime has no replay, so a channel that errors and stays down means
    // missed rows. The status went to "pending" and that was the whole response.
    const sync = await bootConnected();
    expect(channelCallback).not.toBeNull();

    channelCallback?.("CHANNEL_ERROR");
    expect(sync.getSyncStatus()).toBe("pending");

    // The retry reconciles rather than reconnecting, so it mends itself.
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"), {
      timeout: 8000,
    });
  }, 15_000);
});
