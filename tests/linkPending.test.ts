// @vitest-environment jsdom
//
// Linking a device from a *stashed* journal key — the QR path.
//
// This route is applied from inside doConnect, which makes it structurally
// different from typing the key in, and it was broken in a way that inspection
// had missed twice: provideJournalKey ends by calling connect(), connect() is
// single-flight, so calling it from within doConnect returned the promise
// doConnect was still executing and awaiting it deadlocked. The device then sat
// in needs-key permanently — no reconcile, no device registration, and every
// later foreground handed back the same dead promise. The symptom reported was
// a phone that synced entries fine but never appeared in the device register,
// which is two steps removed from the cause.
//
// So these tests drive the pending-key path end to end and assert the things
// that only happen *after* the point where it used to stop.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  exportJournalKeyCode,
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";
import type { KeyRing } from "../src/lib/keystore";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PENDING_STORAGE_KEY = "journlet-pending-journal-key";

const dataKey = await generateDataKey();
// The key the server's blob is wrapped with: the journal key someone scans.
const realKeeper = await generateKeeperKey();
const realWrapped = await wrapDataKey(dataKey, realKeeper);
// A device that has just been erased: a fresh ring that cannot open the journal.
const freshKeeper = await generateKeeperKey();

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
let storedRing: KeyRing;
let inserted: unknown[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    let ownCallback: ((e: string, s: unknown) => void) | null = null;
    return {
      auth: {
        onAuthStateChange: (fn: (e: string, s: unknown) => void) => {
          ownCallback = fn;
          authCallback = fn;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: async () => {
          ownCallback?.("SIGNED_OUT", null);
          return { error: null };
        },
      },
      from: (table: string) => {
        if (table === "journals") {
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: {
                  wrapped_key: {
                    v: realWrapped.v,
                    iv: b64encode(realWrapped.iv),
                    blob: b64encode(realWrapped.blob),
                  },
                },
                error: null,
              }),
            }),
            insert: async () => ({ error: null }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        const b = {
          select: () => b,
          eq: () => b,
          gt: () => b,
          order: () => b,
          limit: async () => ({ data: [], error: null }),
          insert: async (row: unknown) => {
            inserted.push(row);
            return { error: null };
          },
        };
        return b;
      },
      removeChannel: () => {},
      channel: () => {
        const ch = {
          on: () => ch,
          subscribe: (fn: (s: string) => void) => {
            fn("SUBSCRIBED");
            return ch;
          },
        };
        return ch;
      },
    };
  },
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
  ensureKeys: async () => storedRing,
  replaceKeyRing: async (r: KeyRing) => {
    storedRing = r;
  },
  wipeKeys: async () => {},
  // Every connect publishes this device's key now, so the mock has to offer
  // one. A stub keypair is enough: the wrapping itself is tested against real
  // keys in deviceKeys.test.ts.
  ensureDeviceKeyPair: async () =>
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]),
}));

const stash = async (code?: string): Promise<void> => {
  localStorage.setItem(
    PENDING_STORAGE_KEY,
    JSON.stringify({
      k: code ?? (await exportJournalKeyCode(realKeeper)),
      t: Date.now(),
    })
  );
};

/** Boot a just-erased device, signed in, with whatever key is stashed. */
const boot = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  inserted = [];
  authCallback = null;
  localStorage.setItem("journlet-device-id", "phone-id");
  storedRing = {
    keeperKey: freshKeeper,
    dataKeys: new Map([[0, await generateDataKey()]]),
    epoch: 0,
    wrapped: await wrapDataKey(await generateDataKey(), freshKeeper),
    createdAt: 0,
  };
  const sync = await import("../src/store/sync");
  sync.startSync();
  signIn();
  return sync;
};

beforeEach(() => {
  localStorage.clear();
});

describe("a device linking from a scanned key", () => {
  test("reaches synced rather than sitting in needs-key", async () => {
    await stash();
    const sync = await boot();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
  });

  test("registers itself in the device register", async () => {
    // The reported symptom. It is downstream of the deadlock: registration
    // happens after the point where the connect used to stop.
    await stash();
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    expect(Object.keys(doc.getMap("devices").toJSON())).toContain("phone-id");
  });

  test("reconciles, so the journal actually syncs", async () => {
    await stash();
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    // An empty local journal against an empty server still pushes the register
    // row, which is proof reconcile ran at all.
    expect(inserted.length).toBeGreaterThan(0);
  });

  test("does not leave the plaintext keeper key on disk", async () => {
    // It is the credential that opens the whole journal, so it is applied at
    // most once and cleared either way.
    await stash();
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    expect(localStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  test("and can show the journal key code, having proved the key it adopted", async () => {
    // The one thing on this path that nothing downstream would repair. A device
    // linked from a scan reaches reconcile without ensureJournalKeys ever running
    // again, so if the adoption does not record that the key opened the journal,
    // this device syncs perfectly and then refuses to display the code it was
    // linked with — and a code that cannot be shown from a device that holds it is
    // how an account ends up with one copy of it (spec §6.1e).
    await stash();
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    await expect(sync.getJournalKeyCode()).resolves.toBe(
      await exportJournalKeyCode(realKeeper)
    );
  });

  test("a later foreground still works, rather than reusing a dead connect", async () => {
    // The deadlock poisoned `connecting` permanently, so every subsequent
    // trigger awaited the same promise that could never settle.
    await stash();
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 50));

    expect(sync.getSyncStatus()).toBe("synced");
  });
});

describe("a stashed key that does not fit", () => {
  test("leaves needs-key showing for manual entry", async () => {
    await stash(await exportJournalKeyCode(await generateKeeperKey()));
    const sync = await boot();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));
  });

  test("typed in rather than scanned, it is refused in the words of what was typed", async () => {
    // The shared adoption path cannot say "journal key", because a passkey wrap
    // reaches it too and that person has typed nothing (spec §6.1e). So this path
    // translates, and the translation is worth pinning: the message goes straight to
    // the box someone has just typed sixteen characters into.
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    await expect(
      sync.provideJournalKey(await exportJournalKeyCode(await generateKeeperKey()))
    ).rejects.toThrow(/journal key/);
  });

  test("is still cleared from disk, not left to be retried forever", async () => {
    await stash(await exportJournalKeyCode(await generateKeeperKey()));
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    expect(localStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  test("does not register the device, since it never linked", async () => {
    await stash(await exportJournalKeyCode(await generateKeeperKey()));
    const sync = await boot();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));

    expect(doc.getMap("devices").toJSON()).toEqual({});
  });
});
