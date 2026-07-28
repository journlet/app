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
/** How the publish behaves: succeeds, errors, or silently matches no rows. */
let publishResult: "ok" | "error" | "no-rows" = "ok";

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
            // Shaped like the real client: update().eq() returns a builder, and
            // .select() is what makes the affected rows come back. The mock has
            // to model that, or a matched-nothing update cannot be told from a
            // successful one here either.
            update: (patch: { wrapped_key: unknown }) => ({
              eq: () => ({
                select: async () => {
                  duringPublish?.();
                  // A tick, so anything the hook started can actually run
                  // before the row changes — without it the window in which the
                  // ring and the server disagree is not modelled at all.
                  await Promise.resolve();
                  if (publishResult === "error")
                    return { data: null, error: { message: "boom" } };
                  if (publishResult === "no-rows")
                    return { data: [], error: null };
                  serverWrapped = patch.wrapped_key as typeof serverWrapped;
                  afterPublish?.();
                  return { data: [{ user_id: USER_ID }], error: null };
                },
              }),
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
  publishResult = "ok";
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

  test("carries the superseded key while the publish is in flight", async () => {
    // The whole recovery from an interrupted rotation depends on this being
    // persisted *before* the publish, not after. Asserting it only at the end
    // cannot tell that apart from never setting it, so look inside the window.
    const sync = await boot();
    let inFlight: CryptoKey | undefined;
    duringPublish = () => {
      inFlight = storedRing.supersededKeeperKey;
    };

    await sync.lostDevice();

    expect(inFlight).toBe(keeperKey);
  });

  test("drops the superseded key once the rotation is confirmed", async () => {
    // It is a live credential for this journal, so it is held only for as long
    // as it is needed to recover from a half-finished rotation.
    const sync = await boot();

    await sync.lostDevice();
    await settle();

    expect(storedRing.supersededKeeperKey).toBeUndefined();
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

describe("when the rotation does not reach the server", () => {
  test("an update that matches no rows is treated as a failure", async () => {
    // No error is returned for a matched-nothing update, so without asking for
    // the affected rows this looked like success: the user would be handed a new
    // journal key that opens nothing while the server kept the old blob. A
    // missing journals row or an RLS policy that excludes it does this.
    const sync = await boot();
    publishResult = "no-rows";

    await expect(sync.lostDevice()).rejects.toThrow(
      /journal key could not be changed/i
    );
  });

  test("says the other devices were signed out anyway", async () => {
    // That half already happened and cannot be undone. Reporting it as "nothing
    // happened" would leave someone wondering why their devices dropped out.
    const sync = await boot();
    publishResult = "error";

    await expect(sync.lostDevice()).rejects.toThrow(
      /other devices have been signed out/i
    );
  });

  test("leaves the old journal key working rather than a key nothing accepts", async () => {
    const sync = await boot();
    const before = await sync.getJournalKeyCode();
    publishResult = "error";

    await sync.lostDevice().catch(() => {});

    expect(await sync.getJournalKeyCode()).toBe(before);
  });

  test("and this device stays signed in", async () => {
    const sync = await boot();
    publishResult = "error";

    await sync.lostDevice().catch(() => {});
    await settle();

    expect(sync.getSyncStatus()).not.toBe("revoked");
    expect(signOutScopes).toEqual(["others"]);
  });
});

describe("when the app dies mid-rotation", () => {
  // The persisted ring holds the new key, the server still holds the old blob,
  // and nothing ran the restore. Without the superseded key this device reads
  // its own half-finished write as a lockout and signs itself out of a journal
  // it is the rightful holder of, with a new code that opens nothing.
  const bootInterrupted = async () => {
    vi.resetModules();
    doc = new Y.Doc();
    localStorage.clear();
    serverWrapped = toJson(wrapped); // server never moved
    signOutScopes = [];
    publishResult = "ok";
    duringPublish = null;
    afterPublish = null;
    const orphanKeeper = await generateKeeperKey();
    storedRing = {
      keeperKey: orphanKeeper, // never reached the server
      dataKey,
      wrapped: await wrapDataKey(dataKey, orphanKeeper),
      createdAt: Date.now(),
      verifiedUserId: USER_ID,
      supersededKeeperKey: keeperKey, // the key the server still has
    };
    vi.spyOn(document, "addEventListener").mockImplementation((t, f, o) => {
      if (t === "visibilitychange") visibilityHandler = f as () => void;
      return REAL_ADD_EL(t, f as EventListener, o);
    });
    const sync = await import("../src/store/sync");
    sync.startSync();
    authCallback?.("SIGNED_IN", {
      user: { id: USER_ID, email: "g@example.com" },
    });
    return sync;
  };

  test("recovers instead of locking the device out", async () => {
    const sync = await bootInterrupted();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
    expect(sync.wasRevoked()).toBe(false);
  });

  test("reverts to the key the server actually holds", async () => {
    const sync = await bootInterrupted();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    expect(storedRing.keeperKey).toBe(keeperKey);
    expect(storedRing.supersededKeeperKey).toBeUndefined();
  });

  test("says plainly that the key was not changed", async () => {
    const sync = await bootInterrupted();
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    expect(sync.getSyncError()).toMatch(/previous journal key is still/i);
  });

  test("a confirmed rotation clears the superseded key on the next check", async () => {
    // The other interruption point: the publish landed but the confirming write
    // did not. The key check is then the thing that has to retire the old key,
    // and it must, because that key is a live credential for this journal and
    // anything holding it can still open everything.
    vi.resetModules();
    doc = new Y.Doc();
    localStorage.clear();
    signOutScopes = [];
    const landedKeeper = await generateKeeperKey();
    const landedWrapped = await wrapDataKey(dataKey, landedKeeper);
    serverWrapped = toJson(landedWrapped); // the rotation did reach the server
    storedRing = {
      keeperKey: landedKeeper,
      dataKey,
      wrapped: landedWrapped,
      createdAt: Date.now(),
      verifiedUserId: USER_ID,
      supersededKeeperKey: keeperKey, // stale, never retired
    };
    vi.spyOn(document, "addEventListener").mockImplementation((t, f, o) => {
      if (t === "visibilitychange") visibilityHandler = f as () => void;
      return REAL_ADD_EL(t, f as EventListener, o);
    });
    const sync = await import("../src/store/sync");
    sync.startSync();
    authCallback?.("SIGNED_IN", {
      user: { id: USER_ID, email: "g@example.com" },
    });
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    expect(storedRing.supersededKeeperKey).toBeUndefined();
  });

  test("a genuine lockout is still a lockout, not a revert", async () => {
    // The fallback must not become a way to ignore revocation: if neither the
    // current key nor the superseded one opens the blob, this device really has
    // been locked out by a report made somewhere else.
    vi.resetModules();
    doc = new Y.Doc();
    localStorage.clear();
    signOutScopes = [];
    const strangerKeeper = await generateKeeperKey();
    const strangerWrapped = await wrapDataKey(dataKey, strangerKeeper);
    serverWrapped = toJson(strangerWrapped); // rotated by another device
    const orphanKeeper = await generateKeeperKey();
    storedRing = {
      keeperKey: orphanKeeper,
      dataKey,
      wrapped: await wrapDataKey(dataKey, orphanKeeper),
      createdAt: Date.now(),
      verifiedUserId: USER_ID,
      supersededKeeperKey: keeperKey,
    };
    vi.spyOn(document, "addEventListener").mockImplementation((t, f, o) => {
      if (t === "visibilitychange") visibilityHandler = f as () => void;
      return REAL_ADD_EL(t, f as EventListener, o);
    });
    const sync = await import("../src/store/sync");
    sync.startSync();
    authCallback?.("SIGNED_IN", {
      user: { id: USER_ID, email: "g@example.com" },
    });

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("revoked"));
  });
});
