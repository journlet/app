// @vitest-environment jsdom
//
// Signing out has to announce itself before it tears sync down.
//
// The register lives inside the journal, so a departing device is the only one
// that can report leaving, and only while it still has a connection. Get the
// ordering wrong and the mark is written into a doc that is about to be erased,
// which fails silently: everything still works, the row simply lies for weeks.

import { beforeEach, describe, expect, test, vi } from "vitest";
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
/** Every payload the engine pushed, decrypted later to see what it said. */
let inserted: string[] = [];
let wiped = false;
/** Rows the server already holds, for a device re-linking to a live journal. */
let serverRows: { id: number; payload: string }[] = [];

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
        limit: async () => ({ data: serverRows, error: null }),
        insert: async (row: { payload: string }) => {
          inserted.push(row.payload);
          return { error: null };
        },
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
  wipeLocalJournal: async () => {
    wiped = true;
  },
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
  inserted = [];
  wiped = false;
  localStorage.clear();
  localStorage.setItem("journlet-device-id", "phone");
  const sync = await import("../src/store/sync");
  sync.startSync();
  authCallback?.("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));
  return sync;
};

/** Boot a wiped device against a server that already holds `state`. */
const bootWith = async (state: Y.Doc) => {
  const { encryptUpdate } = await import("../src/lib/crypto");
  const payload = await encryptUpdate(dataKey, Y.encodeStateAsUpdate(state), {
    userId: USER_ID,
    volume: "v1",
  });
  serverRows = [{ id: 1, payload: b64encode(payload) }];
  return boot();
};

/** Rebuild what the server would hold from everything that was pushed. */
const asServerSees = async (): Promise<Y.Doc> => {
  const { decryptUpdate } = await import("../src/lib/crypto");
  const rebuilt = new Y.Doc();
  for (const payload of inserted) {
    const update = await decryptUpdate(
      dataKey,
      Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
      { userId: USER_ID, volume: "v1" }
    );
    Y.applyUpdate(rebuilt, update);
  }
  return rebuilt;
};

beforeEach(() => {
  localStorage.clear();
  serverRows = [];
});

describe("coming back after signing out", () => {
  test("clears the mark, so the other devices stop showing it as gone", async () => {
    // The reported bug. touchThisDevice used to run before the reconcile, so on
    // a device that had been wiped the local doc was empty and it created a
    // fresh row rather than finding its own. The server's row, carrying the
    // mark, then merged in on top, and the phone showed as signed out on the
    // Mac while it was sitting there syncing.
    const sync = await boot();
    // The account's journal as it is after this device signed out: its row is
    // present and marked.
    const server = new Y.Doc();
    const rec = new Y.Map<unknown>();
    server.getMap<Y.Map<unknown>>("devices").set("phone", rec);
    rec.set("id", "phone");
    rec.set("platform", "iOS");
    rec.set("firstSeen", 1000);
    rec.set("signedOutAt", Date.now() - 60_000);
    server.getArray("entries").push(["written before signing out"]);
    await sync.signOutAndWipe();

    // Re-linking: a wiped device, and the server holding that state.
    const relinked = await bootWith(server);
    await vi.waitFor(() => expect(relinked.getSyncStatus()).toBe("synced"));

    const row = doc.getMap<Y.Map<unknown>>("devices").get("phone");
    expect(row?.get("signedOutAt")).toBeUndefined();
  });

  test("keeps the row's original added date rather than resetting it", async () => {
    // The same conflict churned firstSeen, so a device that had been on the
    // account for months looked as though it had just appeared.
    const server = new Y.Doc();
    const rec = new Y.Map<unknown>();
    server.getMap<Y.Map<unknown>>("devices").set("phone", rec);
    rec.set("id", "phone");
    rec.set("platform", "iOS");
    rec.set("firstSeen", 1000);
    rec.set("signedOutAt", Date.now() - 60_000);

    const sync = await bootWith(server);
    await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("synced"));

    const row = doc.getMap<Y.Map<unknown>>("devices").get("phone");
    expect(row?.get("firstSeen")).toBe(1000);
  });
});

describe("signing out", () => {
  test("pushes the sign-out mark before wiping", async () => {
    // The assertion that matters. If the mark is written after teardown it goes
    // into a doc nobody will ever read, and the other devices keep showing this
    // one as holding a journal it has erased.
    const sync = await boot();
    doc.getArray("entries").push(["something to sync"]);
    await vi.waitFor(() => expect(inserted.length).toBeGreaterThan(0));

    await sync.signOutAndWipe();

    const server = await asServerSees();
    const row = server.getMap<Y.Map<unknown>>("devices").get("phone");
    expect(row?.get("signedOutAt")).toBeGreaterThan(0);
  });

  test("still wipes the device", async () => {
    // Announcing must never become a precondition for leaving.
    const sync = await boot();

    await sync.signOutAndWipe();

    expect(wiped).toBe(true);
  });

  test("wipes even when the mark cannot be pushed", async () => {
    // Offline: nothing can be recorded, the row goes stale as it did before,
    // and sign-out proceeds regardless. A device that could not be signed out
    // because it was offline would be a far worse failure than a stale row.
    const sync = await boot();
    const { supabase } = await import("../src/store/sync");
    vi.spyOn(supabase!, "from").mockImplementation(() => {
      throw new Error("offline");
    });

    await sync.signOutAndWipe();

    expect(wiped).toBe(true);
  });
});
