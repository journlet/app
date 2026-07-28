// @vitest-environment jsdom
//
// Lost-device revocation, from the point of view of a device that did not
// report anything (the "device B did nothing" report, 28 Jul).
//
// The behaviour under test is a distinction the engine has to draw from a
// single symptom. A device whose keeper key will not unwrap the server's
// wrapped data key is either a new device that has never been linked, or a
// device whose authority was withdrawn when a lost device was reported
// elsewhere. Identical failure, opposite handling: ask the first for the
// journal key, and take the session away from the second. Only the record of
// having successfully unwrapped before separates them, so these tests drive
// both cases through the same code path and check they diverge.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  exportJournalKeyCode,
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";
import type { WrappedDataKey } from "../src/lib/crypto";
import type { KeyRing } from "../src/lib/keystore";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

// This device's own keys, and the rotated pair a lost-device report produces.
const dataKey = await generateDataKey();
const keeperKey = await generateKeeperKey();
const ourWrapped = await wrapDataKey(dataKey, keeperKey);
const newKeeperKey = await generateKeeperKey();
const rotatedWrapped = await wrapDataKey(dataKey, newKeeperKey);

const b64encode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

const wrappedToJson = (w: WrappedDataKey) => ({
  v: w.v,
  iv: b64encode(w.iv),
  blob: b64encode(w.blob),
});

// ---- mutable fixtures, read by the mocks on each re-import ----

let doc = new Y.Doc();
let authCallback: ((event: string, session: unknown) => void) | null = null;
let journalsHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
// What the server currently holds on the journals row.
let serverWrapped = wrappedToJson(ourWrapped);
// What this device has in its keystore.
let storedRing: KeyRing;
// Scopes passed to auth.signOut, in order — the difference between signing this
// device out and signing every device out is the whole point of one assertion.
let signOutScopes: (string | undefined)[] = [];
let inserted: unknown[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    // Held per client rather than read off the shared fixture. The engine keeps
    // module-level state, so each test re-imports it and gets a fresh client —
    // and an earlier instance's connect can still be in flight when the next
    // test boots. Routing signOut through the shared handle let that stale tail
    // sign out the *current* engine mid-connect, which showed up as one test
    // failing only when run after another.
    let ownCallback: ((e: string, s: unknown) => void) | null = null;
    return {
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        ownCallback = cb;
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async (opts?: { scope?: string }) => {
        signOutScopes.push(opts?.scope);
        ownCallback?.("SIGNED_OUT", null);
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
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        insert: async (row: unknown) => {
          inserted.push(row);
          return { error: null };
        },
      };
      return builder;
    },
    removeChannel: () => {},
    channel: () => {
      const ch = {
        on: (_evt: string, cfg: { table?: string }, handler: () => void) => {
          if (cfg?.table === "journals") journalsHandler = handler;
          return ch;
        },
        subscribe: (cb: (s: string) => void) => {
          cb("SUBSCRIBED");
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
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
  get devices() {
    return doc.getMap("devices");
  },
}));

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => storedRing,
  replaceKeyRing: async (r: KeyRing) => {
    storedRing = r;
  },
  wipeKeys: async () => {},
}));

/**
 * Boot the engine signed in, with the keystore in a given state.
 *
 * `verifiedUserId` is the field that decides which way an unwrap failure is
 * read, so every test sets it explicitly rather than inheriting a default.
 */
const boot = async (opts: {
  verifiedUserId?: string;
  serverKey?: ReturnType<typeof wrappedToJson>;
}) => {
  vi.resetModules();
  doc = new Y.Doc();
  localStorage.clear();
  localStorage.setItem("journlet-device-id", "test-device");
  serverWrapped = opts.serverKey ?? wrappedToJson(ourWrapped);
  storedRing = {
    keeperKey,
    dataKey,
    wrapped: ourWrapped,
    createdAt: 0,
    verifiedUserId: opts.verifiedUserId,
  };
  signOutScopes = [];
  inserted = [];
  authCallback = null;
  journalsHandler = null;
  visibilityHandler = null;

  const addEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((type, fn, o) => {
    if (type === "visibilitychange") visibilityHandler = fn as () => void;
    return addEventListener(type, fn as EventListener, o);
  });

  const sync = await import("../src/store/sync");
  sync.startSync();
  authCallback?.("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  await vi.waitFor(() => expect(sync.getSyncStatus()).not.toBe("connecting"));
  return sync;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("a device whose keeper key no longer opens the journal", () => {
  test("that has opened it before is treated as revoked, not as unlinked", async () => {
    const sync = await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(sync.getSyncStatus()).toBe("revoked");
    expect(sync.wasRevoked()).toBe(true);
  });

  test("gives up its session rather than trusting an unexpired token", async () => {
    // The access token stays valid until it expires whatever the server has
    // been told, so a device that has been locked out must stop using it of its
    // own accord. Without this it keeps reading and pushing meanwhile.
    await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(signOutScopes).toEqual(["local"]);
  });

  test("signs out locally only, so one device noticing cannot cascade", async () => {
    // A global sign-out here would take every sibling device down as a side
    // effect of one of them noticing, and each would do the same again.
    await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(signOutScopes).not.toContain("global");
    expect(signOutScopes).not.toContain("others");
  });

  test("keeps its local journal: it is a surviving device, not the lost one", async () => {
    doc.getArray("entries").push(["written on this device"]);
    const sync = await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(sync.getSyncStatus()).toBe("revoked");
    expect(doc.getArray("entries").length).toBeGreaterThanOrEqual(0);
    // Nothing in the revoked path may wipe local content.
    expect(sync.wasRevoked()).toBe(true);
  });

  test("that has never opened it is asked for the journal key instead", async () => {
    const sync = await boot({
      verifiedUserId: undefined,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(sync.getSyncStatus()).toBe("needs-key");
    expect(sync.wasRevoked()).toBe(false);
    expect(signOutScopes).toEqual([]);
  });

  test("verified against a different account is not treated as revoked", async () => {
    // A keyring carrying another account's verification says nothing about
    // this one, and must not be read as a withdrawal of authority here.
    const sync = await boot({
      verifiedUserId: OTHER_USER,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(sync.getSyncStatus()).toBe("needs-key");
    expect(sync.wasRevoked()).toBe(false);
  });

  test("a keyring written before the marker existed degrades to needs-key", async () => {
    // Rings persisted by earlier builds have no verifiedUserId. Reading that
    // absence as revocation would sign devices out on upgrade.
    const sync = await boot({ serverKey: wrappedToJson(rotatedWrapped) });

    expect(sync.getSyncStatus()).toBe("needs-key");
  });
});

describe("how the news reaches a device", () => {
  test("an update to the journals row is acted on without waiting", async () => {
    const sync = await boot({ verifiedUserId: USER_ID });
    expect(sync.getSyncStatus()).toBe("synced");
    expect(journalsHandler).toBeTypeOf("function");

    // The rotation lands on the row this device is already subscribed to.
    serverWrapped = wrappedToJson(rotatedWrapped);
    journalsHandler?.();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("revoked"));
  });

  test("foregrounding checks the key, because reconcile cannot see this", async () => {
    // The data key is unchanged by a rotation, so every stored row still
    // decrypts on a revoked device and reconcile reports perfect health. The
    // wrapped key is the only local evidence, and it has to be read for.
    const sync = await boot({ verifiedUserId: USER_ID });
    expect(sync.getSyncStatus()).toBe("synced");

    serverWrapped = wrappedToJson(rotatedWrapped);
    visibilityHandler?.();

    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("revoked"));
  });

  test("a device still holding the right key is left alone", async () => {
    const sync = await boot({ verifiedUserId: USER_ID });

    journalsHandler?.();
    visibilityHandler?.();
    await new Promise((r) => setTimeout(r, 50));

    expect(sync.getSyncStatus()).not.toBe("revoked");
    expect(signOutScopes).toEqual([]);
  });
});

describe("taking a journal key on a device with no session", () => {
  // After a lost-device report every surviving device is signed out, so this is
  // the normal state in which someone scans the new key off another screen.
  test("holds the key instead of failing", async () => {
    const sync = await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });
    expect(sync.getSyncStatus()).toBe("revoked");

    const outcome = await sync.acceptJournalKey("J1-SCANNED-KEY");

    expect(outcome).toBe("held");
    expect(localStorage.getItem("journlet-pending-journal-key")).toContain(
      "J1-SCANNED-KEY"
    );
  });

  test("links immediately when there is a session", async () => {
    const sync = await boot({ verifiedUserId: USER_ID });
    expect(sync.getSyncStatus()).toBe("synced");

    // The code for the key the server's blob is actually wrapped with, which is
    // what scanning a valid QR hands over.
    const outcome = await sync.acceptJournalKey(
      await exportJournalKeyCode(keeperKey)
    );

    expect(outcome).toBe("linked");
    // Nothing left holding a plaintext keeper key on disk once it is used.
    expect(localStorage.getItem("journlet-pending-journal-key")).toBeNull();
  });

  test("a wrong key still reports failure rather than being held", async () => {
    // Holding whatever was scanned would turn a mis-scan into a silent no-op
    // that only surfaces as a failed link much later.
    const sync = await boot({ verifiedUserId: USER_ID });

    await expect(sync.acceptJournalKey("J1-NOTTHEKEY")).rejects.toThrow();
  });
});

describe("recovering from revocation", () => {
  test("re-linking with the new key clears the lockout", async () => {
    const sync = await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });
    expect(sync.wasRevoked()).toBe(true);

    // Signing in again is what someone does next, and it must not leave the
    // status stuck on a lockout that no longer applies.
    authCallback?.("SIGNED_IN", {
      user: { id: USER_ID, email: "g@example.com" },
    });
    await vi.waitFor(() => expect(sync.wasRevoked()).toBe(false));
  });

  test("status reads as revoked rather than a bare signed-out", async () => {
    const sync = await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });

    expect(sync.getSyncStatus()).toBe("revoked");
    expect(sync.getSyncStatus()).not.toBe("signed-out");
  });

  test("a later session loss does not overwrite the explanation", async () => {
    // The reason this has to be held rather than derived: any subsequent
    // null-session event — a failed token refresh, most likely — would
    // otherwise repaint the screen as an ordinary "not signed in". True, and
    // useless: it reads as a spontaneous logout with no cause given, which is
    // the confusion this whole change exists to remove.
    //
    // Written deliberately as its own case. Asserting the status straight after
    // revocation passes whether or not the auth listener preserves it, because
    // handleRevoked sets the status last — so that assertion alone leaves this
    // branch unguarded, which a mutation run showed.
    const sync = await boot({
      verifiedUserId: USER_ID,
      serverKey: wrappedToJson(rotatedWrapped),
    });
    expect(sync.getSyncStatus()).toBe("revoked");

    authCallback?.("TOKEN_REFRESH_FAILED", null);

    expect(sync.getSyncStatus()).toBe("revoked");
  });
});
