// @vitest-environment jsdom
//
// The safety property of account deletion lives in the store, not the UI: the
// server call must come first, and a failure on either side of it means
// something different. The SyncView tests mock this module out, so without
// these the ordering could be reversed and every other test would still pass.

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
    rpc: (...a: unknown[]) => {
      calls.push("rpc");
      return rpc(...(a as []));
    },
    // connect() runs in the background once a session appears; give it
    // something inert to fail against rather than letting it throw.
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: { message: "stub" } }),
      }),
    }),
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
  return {
    doc: new Y.Doc(),
    REMOTE_ORIGIN: "remote",
    wipeLocalJournal: async () => {
      calls.push("wipeLocalJournal");
      return wipeLocalJournal();
    },
  };
});

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => ({
    keeperKey: {},
    dataKey: {},
    wrapped: { v: 1, iv: new Uint8Array(), blob: new Uint8Array() },
    createdAt: 0,
  }),
  replaceKeyRing: async () => {},
  wipeKeys: async () => {
    calls.push("wipeKeys");
    return wipeKeys();
  },
}));

const { deleteAccount, startSync, DeviceNotClearedError } = await import(
  "../src/store/sync"
);

const signIn = () => {
  startSync();
  if (!authCallback) throw new Error("startSync did not register a listener");
  authCallback("SIGNED_IN", {
    user: { id: "user-1", email: "gary@example.com" },
  });
};

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
});

describe("deleteAccount ordering", () => {
  test("refuses when there is no session", async () => {
    await expect(deleteAccount()).rejects.toThrow(/not signed in/i);
    expect(calls).toEqual([]);
  });

  test("calls the server before touching anything local", async () => {
    signIn();
    await deleteAccount();
    expect(calls[0]).toBe("rpc");
    expect(calls).toContain("wipeLocalJournal");
    expect(calls).toContain("wipeKeys");
    expect(calls.indexOf("rpc")).toBeLessThan(
      calls.indexOf("wipeLocalJournal")
    );
  });

  test("invokes the delete_account function specifically", async () => {
    signIn();
    await deleteAccount();
    expect(rpc).toHaveBeenCalledWith("delete_account");
  });

  // The whole point of server-first: a failed RPC must leave the journal on the
  // device, so the user can retry rather than losing both copies.
  test("wipes nothing when the server call fails", async () => {
    signIn();
    rpc.mockResolvedValueOnce({ error: { message: "permission denied" } });
    await expect(deleteAccount()).rejects.toThrow(/permission denied/);
    expect(calls).not.toContain("wipeLocalJournal");
    expect(calls).not.toContain("wipeKeys");
  });

  test("a server failure is not reported as a wipe failure", async () => {
    signIn();
    rpc.mockResolvedValueOnce({ error: { message: "offline" } });
    await expect(deleteAccount()).rejects.not.toBeInstanceOf(
      DeviceNotClearedError
    );
  });

  // Past the RPC the account is gone, so a local failure is a different kind of
  // problem and has to be distinguishable by the caller.
  test("a wipe failure after deletion throws DeviceNotClearedError", async () => {
    signIn();
    wipeLocalJournal.mockRejectedValueOnce(new Error("QuotaExceededError"));
    await expect(deleteAccount()).rejects.toBeInstanceOf(
      DeviceNotClearedError
    );
  });

  test("that error carries the underlying reason", async () => {
    signIn();
    wipeKeys.mockRejectedValueOnce(new Error("blocked by open connection"));
    await expect(deleteAccount()).rejects.toThrow(
      /blocked by open connection/
    );
  });

  test("a failed sign-out does not stop the wipe", async () => {
    signIn();
    signOut.mockRejectedValueOnce(new Error("network"));
    await deleteAccount();
    expect(calls).toContain("wipeLocalJournal");
    expect(calls).toContain("wipeKeys");
  });
});
