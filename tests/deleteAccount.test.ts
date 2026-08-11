// @vitest-environment jsdom
//
// The safety property of account deletion lives in the store, not the UI: the
// server call must come first, and a failure on either side of it means
// something different. The SyncView tests mock this module out, so without
// these the ordering could be reversed and every other test would still pass.

/* oxlint-disable unicorn/no-thenable */
import { beforeEach, describe, expect, test, vi } from "vitest";

const rpc = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));
const wipeLocalJournal = vi.fn(async () => {});
const wipeKeys = vi.fn(async () => {});

// Order of effects, so "server before local" can be asserted directly rather
// than inferred from call counts.
const calls: string[] = [];

let authCallback: ((event: string, session: unknown) => void) | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: (...a: unknown[]) => {
        calls.push("signOut");
        return signOut(...(a as []));
      },
    },
    // The function name is recorded, not just "rpc". A connect now calls
    // set_delete_code as its self-backfill (assessment Finding 24), so a bare
    // "rpc" marker would make "the server first" true before deleteAccount had
    // done anything at all, and the ordering test would stop checking.
    rpc: (fn: string, ...a: unknown[]) => {
      calls.push(`rpc:${fn}`);
      return rpc(fn, ...(a as []));
    },
    // connect() has to get far enough to establish that this device's keeper key
    // opens this account's journal, because deleteAccount refuses otherwise and
    // for a good reason: every fresh install generates a keeper key, so holding
    // one proves nothing until it has opened the journal (assessment Finding 24,
    // and the same argument getJournalKeyCode makes). So this returns a real
    // wrapped data key rather than an inert failure.
    from: (table: string) => {
      const query = {
        eq: () => query,
        gt: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () =>
          table === "journals" && journalExists
            ? { data: { wrapped_key: journalsRow }, error: null }
            : { data: null, error: null },
        then<T>(res: (v: { data: unknown[]; error: null }) => T) {
          return Promise.resolve({ data: [], error: null }).then(res);
        },
      };
      return {
        select: () => query,
        insert: async () => {
          calls.push(`insert:${table}`);
          return { error: null };
        },
        upsert: async () => ({ error: null }),
        delete: () => ({ eq: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }) }),
      };
    },
    removeChannel: () => {},
    // Chainable: the channel registers more than one subscription now.
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
  }),
}));

vi.mock("../src/store/journal", async () => {
  const Y = await import("yjs");
  const doc = new Y.Doc();
  return {
    doc,
    devices: doc.getMap("devices"),
    REMOTE_ORIGIN: "remote",
    wipeLocalJournal: async () => {
      calls.push("wipeLocalJournal");
      return wipeLocalJournal();
    },
  };
});

// A real AES key, because deleteAccount derives the code the server compares
// from it (assessment Finding 24) and an empty object cannot be exported.
const { wrapDataKey } = await import("../src/lib/crypto");
const keeperKey = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["wrapKey", "unwrapKey"]
);
const dataKey = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);
const wrapped = await wrapDataKey(dataKey, keeperKey);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const journalsRow = { v: 1, iv: b64(wrapped.iv), blob: b64(wrapped.blob) };

let ringHasKeeper = true;
/**
 * Whether the account already has a journals row.
 *
 * False exercises the first-device branch of ensureJournalKeys, which creates the
 * row and returns early. That early return is why a brand-new account went
 * without a delete code until the next cold start: the harness only ever
 * described the other state, so one fixture covered one of two paths.
 */
let journalExists = true;

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => ({
    ...(ringHasKeeper ? { keeperKey } : {}),
    dataKeys: new Map([[0, dataKey]]),
    epoch: 0,
    wrapped,
    createdAt: 0,
  }),
  replaceKeyRing: async () => {},
  ensureDeviceKeyPair: async () =>
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]),
  wipeKeys: async () => {
    calls.push("wipeKeys");
    return wipeKeys();
  },
}));

const { deriveDeleteCode } = await import("../src/lib/crypto");

/**
 * The engine, re-imported per test.
 *
 * A single top-level import made this file order-dependent the moment
 * deleteAccount needed a connect behind it: a successful delete tears the module
 * down, and nothing brings a proved keeper key back, so every test after the
 * first would fail on the precondition rather than on its own subject. Same
 * isolation problem the comment in removeDevice.test.ts describes.
 */
let sync: typeof import("../src/store/sync");

const signIn = () => {
  sync.startSync();
  if (!authCallback) throw new Error("startSync did not register a listener");
  authCallback("SIGNED_IN", {
    user: { id: "user-1", email: "gary@example.com" },
  });
};

/** Signed in and connected far enough for the keeper key to have been proved. */
const signInAndConnect = async () => {
  signIn();
  await vi.waitFor(() => expect(sync.canDeleteAccount()).toBe(true));
};


/** What delete_account should answer with; set_delete_code always succeeds. */
let deleteResult: { error: { message: string } | null } = { error: null };

beforeEach(async () => {
  calls.length = 0;
  ringHasKeeper = true;
  journalExists = true;
  deleteResult = { error: null };
  vi.clearAllMocks();
  rpc.mockImplementation(async (fn: string) =>
    fn === "delete_account" ? deleteResult : { error: null }
  );
  authCallback = null;
  vi.resetModules();
  sync = await import("../src/store/sync");
});

describe("recording the delete code", () => {
  // The write half of Finding 24. Without this nothing is ever stored, the
  // stored code stays null, and delete_account() keeps allowing a delete on the
  // mailbox alone: the check would be in place and doing nothing.
  test("a connect records it, derived from the keeper key", async () => {
    await signInAndConnect();

    expect(rpc).toHaveBeenCalledWith("set_delete_code", {
      code: await deriveDeleteCode(keeperKey),
    });
  });

  test("a brand-new account gets one as its journal is created", async () => {
    // The branch that was missed. ensureJournalKeys returns early after creating
    // the journals row, so the call further down never ran, and a new account was
    // created unprotected and stayed that way until the app was next launched
    // from cold. doConnect early-outs while a connection is live, so nothing
    // shorter than a relaunch would have closed it.
    const expected = await deriveDeleteCode(keeperKey);
    journalExists = false;
    signIn();

    await vi.waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_delete_code", { code: expected })
    );
  });

  test("and it is recorded after the journal row exists, not before", async () => {
    // Order matters: set_delete_code updates journals, so a call that arrives
    // before the insert would match no row and silently do nothing, which is the
    // same failure wearing a different hat.
    journalExists = false;
    signIn();

    await vi.waitFor(() => expect(calls).toContain("rpc:set_delete_code"));
    expect(calls.indexOf("insert:journals")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("insert:journals")).toBeLessThan(
      calls.indexOf("rpc:set_delete_code")
    );
  });

  test("a device with no journal key code records nothing", async () => {
    // It cannot derive the code, and writing anything else would set a value the
    // account holder could never produce.
    ringHasKeeper = false;
    signIn();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(calls).not.toContain("rpc:set_delete_code");
  });

  test("a failure recording it does not stop the connect", async () => {
    // It is a backfill on a path that has to keep working offline and against an
    // older schema, where the function does not exist at all.
    rpc.mockImplementation(async (fn: string) =>
      fn === "set_delete_code"
        ? { error: { message: "function does not exist" } }
        : { error: null }
    );
    signIn();

    await vi.waitFor(() => expect(sync.canDeleteAccount()).toBe(true));
  });
});

describe("deleteAccount ordering", () => {
  test("refuses when there is no session", async () => {
    await expect(sync.deleteAccount()).rejects.toThrow(/not signed in/i);
    expect(calls).toEqual([]);
  });

  test("calls the server before touching anything local", async () => {
    await signInAndConnect();
    await sync.deleteAccount();
    expect(calls).toContain("rpc:delete_account");
    expect(calls).toContain("wipeLocalJournal");
    expect(calls).toContain("wipeKeys");
    expect(calls.indexOf("rpc:delete_account")).toBeLessThan(
      calls.indexOf("wipeLocalJournal")
    );
  });

  test("invokes the delete_account function specifically", async () => {
    await signInAndConnect();
    await sync.deleteAccount();
    expect(rpc).toHaveBeenCalledWith("delete_account", {
      code: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test("sends the code derived from the keeper key, not something else", async () => {
    // The server stores this value at journal creation and compares it here, so
    // if the two derivations ever disagree the account becomes undeletable.
    // Pinned against the same function the write path uses.
    await signInAndConnect();
    await sync.deleteAccount();
    expect(rpc).toHaveBeenCalledWith("delete_account", {
      code: await deriveDeleteCode(keeperKey),
    });
  });

  test("a device with no journal key code cannot delete, and says why", async () => {
    // The point of Finding 24: holding the mailbox is not enough. A device
    // linked by approval holds a data key and no keeper key, so it cannot derive
    // the code, and the message names the device that can rather than letting
    // the database refuse.
    ringHasKeeper = false;
    signIn();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sync.canDeleteAccount()).toBe(false);
    await expect(sync.deleteAccount()).rejects.toThrow(/journal key code/i);
    expect(calls).not.toContain("rpc:delete_account");
    expect(calls).not.toContain("wipeLocalJournal");
    expect(calls).not.toContain("wipeKeys");
  });

  // The whole point of server-first: a failed RPC must leave the journal on the
  // device, so the user can retry rather than losing both copies.
  test("wipes nothing when the server call fails", async () => {
    await signInAndConnect();
    deleteResult = { error: { message: "permission denied" } };
    await expect(sync.deleteAccount()).rejects.toThrow(/permission denied/);
    expect(calls).not.toContain("wipeLocalJournal");
    expect(calls).not.toContain("wipeKeys");
  });

  test("a server failure is not reported as a wipe failure", async () => {
    await signInAndConnect();
    deleteResult = { error: { message: "offline" } };
    await expect(sync.deleteAccount()).rejects.not.toBeInstanceOf(
      sync.DeviceNotClearedError
    );
  });

  // Past the RPC the account is gone, so a local failure is a different kind of
  // problem and has to be distinguishable by the caller.
  test("a wipe failure after deletion throws sync.DeviceNotClearedError", async () => {
    await signInAndConnect();
    wipeLocalJournal.mockRejectedValueOnce(new Error("QuotaExceededError"));
    await expect(sync.deleteAccount()).rejects.toBeInstanceOf(
      sync.DeviceNotClearedError
    );
  });

  test("that error carries the underlying reason", async () => {
    await signInAndConnect();
    wipeKeys.mockRejectedValueOnce(new Error("blocked by open connection"));
    await expect(sync.deleteAccount()).rejects.toThrow(
      /blocked by open connection/
    );
  });

  test("a failed sign-out does not stop the wipe", async () => {
    await signInAndConnect();
    signOut.mockRejectedValueOnce(new Error("network"));
    await sync.deleteAccount();
    expect(calls).toContain("wipeLocalJournal");
    expect(calls).toContain("wipeKeys");
  });
});
