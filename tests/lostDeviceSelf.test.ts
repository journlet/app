// @vitest-environment jsdom
//
// The device that REPORTS a lost device must not sign itself out.
//
// It did. Pressing the button logged out both devices, and the cause was the
// interaction between two things that were each individually correct.
// lostDevice() persists the rotated keyring locally *before* publishing it, so
// that a failed publish leaves the old key working everywhere — deliberate, and
// documented at the call site. But for as long as that publish takes, the local
// keeper key cannot open the blob the server still holds, and that mismatch is
// precisely the signature of having been locked out. Any key check landing in
// the window therefore concluded this device had been revoked and signed it out.
//
// Both of the checks that can land there were added by the same piece of work as
// the revocation detection itself: the realtime echo of the journals row, and
// the check on foreground. So these tests drive a check at each point in the
// rotation, including inside the window, which is the case that regressed.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";
import type { KeyRing } from "../src/lib/keystore";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const dataKey = await generateDataKey();
const keeperKey = await generateKeeperKey();
const wrapped = await wrapDataKey(dataKey, keeperKey);

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const toJson = (w: { v: number; iv: Uint8Array; blob: Uint8Array }) => ({
  v: w.v,
  iv: b64encode(w.iv),
  blob: b64encode(w.blob),
});

// Captured once: re-binding an already-spied addEventListener each boot stacks
// the spies and blows the stack.
const REAL_ADD_EL = document.addEventListener.bind(document);

let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;
let journalsHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let storedRing: KeyRing;
let serverWrapped = toJson(wrapped);
let signOutScopes: (string | undefined)[] = [];
/** Fires at the start of the journals UPDATE: the ring is already rotated and
 *  the server row is not. This is the window that regressed. */
let duringPublish: (() => void) | null = null;
/** Fires once the row has changed, as the realtime echo of our own write. */
let afterPublish: (() => void) | null = null;

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
        signOut: async (opts?: { scope?: string }) => {
          signOutScopes.push(opts?.scope);
          // Matches the real client, verified in GoTrueClient._signOut: scope
          // 'others' leaves the local session alone, anything else clears it.
          if (opts?.scope !== "others") ownCallback?.("SIGNED_OUT", null);
          return { error: null };
        },
      },
      from: (table: string) => {
        if (table === "journals") {
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: { wrapped_key: serverWrapped },
                error: null,
              }),
            }),
            insert: async () => ({ error: null }),
            update: (patch: { wrapped_key: unknown }) => ({
              eq: async () => {
                duringPublish?.();
                // A tick, so anything the hook started can actually run before
                // the row changes — without it the window is not modelled.
                await Promise.resolve();
                serverWrapped = patch.wrapped_key as typeof serverWrapped;
                afterPublish?.();
                return { error: null };
              },
            }),
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
          on: (_e: string, cfg: { table?: string }, h: () => void) => {
            if (cfg?.table === "journals") journalsHandler = h;
            return ch;
          },
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
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

/** The reporting device: signed in, synced, holding the current journal key. */
const boot = async () => {
  vi.resetModules();
  doc = new Y.Doc();
  localStorage.clear();
  localStorage.setItem("journlet-device-id", "mac-id");
  serverWrapped = toJson(wrapped);
  signOutScopes = [];
  duringPublish = null;
  afterPublish = null;
  storedRing = {
    keeperKey,
    dataKey,
    wrapped,
    createdAt: 0,
    verifiedUserId: USER_ID,
  };
  vi.spyOn(document, "addEventListener").mockImplementation((t, f, o) => {
    if (t === "visibilitychange") visibilityHandler = f as () => void;
    return REAL_ADD_EL(t, f as EventListener, o);
  });
  const sync = await import("../src/store/sync");
  sync.startSync();
  authCallback?.("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
  return sync;
};

const settle = () => new Promise((r) => setTimeout(r, 60));

describe("reporting a lost device", () => {
  test("leaves this device signed in", async () => {
    const sync = await boot();

    await sync.lostDevice();
    await settle();

    expect(sync.getSyncStatus()).not.toBe("revoked");
    expect(sync.wasRevoked()).toBe(false);
  });

  test("signs out others without signing out this device", async () => {
    const sync = await boot();

    await sync.lostDevice();
    await settle();

    // The whole bug in one assertion: a trailing 'local' here is this device
    // revoking itself on the way through.
    expect(signOutScopes).toEqual(["others"]);
  });

  test("survives the realtime echo of its own rotation", async () => {
    const sync = await boot();
    afterPublish = () => journalsHandler?.();

    await sync.lostDevice();
    await settle();

    expect(sync.getSyncStatus()).not.toBe("revoked");
  });

  test("survives a realtime check inside the publish window", async () => {
    // The regression. Between persisting the rotated ring and the row changing,
    // the server holds a blob the new keeper key cannot open.
    const sync = await boot();
    duringPublish = () => journalsHandler?.();

    await sync.lostDevice();
    await settle();

    expect(sync.getSyncStatus()).not.toBe("revoked");
    expect(signOutScopes).toEqual(["others"]);
  });

  test("survives a foreground check inside the publish window", async () => {
    // Pressing the button and then glancing at another device is the obvious
    // way to arrive here, and it is what happened.
    const sync = await boot();
    duringPublish = () => visibilityHandler?.();

    await sync.lostDevice();
    await settle();

    expect(sync.getSyncStatus()).not.toBe("revoked");
    expect(signOutScopes).toEqual(["others"]);
  });

  test("still returns a working new journal key", async () => {
    // The serialisation must not swallow the point of the operation.
    const sync = await boot();
    duringPublish = () => visibilityHandler?.();

    const code = await sync.lostDevice();

    expect(code).toMatch(/^J1-/);
    expect(await sync.getJournalKeyCode()).toBe(code);
  });

  test("a check after the rotation completes is unaffected", async () => {
    // Sanity in the other direction: serialising must not stop this device
    // noticing a *genuine* later rotation made somewhere else.
    const sync = await boot();
    await sync.lostDevice();
    await settle();

    journalsHandler?.();
    visibilityHandler?.();
    await settle();

    expect(sync.getSyncStatus()).not.toBe("revoked");
  });
});
