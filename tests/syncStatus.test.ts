// The sync store's observable value.
//
// The contract these pin is narrow and was the whole of Finding 2: a change the
// UI needs to see has to change the snapshot's identity, because that is the
// only thing useSyncExternalStore can react to. Recording the value and
// notifying with something the consumer already holds is what hid an
// undecryptable-updates tally, and the second of two consecutive connect
// failures, from the screen entirely.

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearError,
  getSyncError,
  getSyncSnapshot,
  getSyncStatus,
  resetLinkState,
  resetSyncStatus,
  setError,
  setRemoved,
  setStatus,
  subscribeSync,
  wasRemoved,
} from "../src/store/syncStatus";
import type { SyncSnapshot } from "../src/store/syncStatus";

beforeEach(() => {
  resetSyncStatus();
});

describe("the snapshot as useSyncExternalStore needs it", () => {
  test("is the same object when nothing has changed", () => {
    // Returning a fresh object per call is the documented way to make React
    // loop forever, so this is the load-bearing property, not a nicety.
    expect(getSyncSnapshot()).toBe(getSyncSnapshot());
  });

  test("is a different object once something has changed", () => {
    const before = getSyncSnapshot();
    setStatus("connecting");
    expect(getSyncSnapshot()).not.toBe(before);
  });

  test("does not mutate a snapshot a consumer is already holding", () => {
    const held = getSyncSnapshot();
    setStatus("connecting");
    setError("something went wrong");
    expect(held.status).toBe("signed-out");
    expect(held.error).toBeNull();
  });
});

describe("an error with no status change", () => {
  // Finding 2 itself. reportTally sets the most serious diagnostic the app has
  // and never touches the status, on a path where the status is already
  // "synced". The old listener payload was the status, so nothing re-rendered.
  test("notifies subscribers", () => {
    setStatus("synced");
    const seen = vi.fn();
    subscribeSync(seen);

    setError("3 synced updates could not be decrypted");

    expect(seen).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().error).toMatch(/could not be decrypted/);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  test("replaces the previous error rather than leaving the first on screen", () => {
    // The second failure path: both set "pending", so the status was unchanged
    // and CannotLoadView kept rendering the first message.
    setStatus("pending");
    const seen = vi.fn();
    subscribeSync(seen);

    setError("first failure");
    setStatus("pending");
    setError("second failure");

    expect(getSyncError()).toBe("second failure");
    expect(seen).toHaveBeenCalledTimes(2);
  });

  test("accepts a thrown non-Error without stringifying it into nonsense", () => {
    setError(new Error("from an Error"));
    expect(getSyncError()).toBe("from an Error");
    setError("from a string");
    expect(getSyncError()).toBe("from a string");
  });
});

describe("what deliberately does not notify", () => {
  // Because App re-renders on every notification and its journal walks are not
  // memoised, and setStatus("synced") runs on every reconcile.
  test("setting the status it already has", () => {
    setStatus("synced");
    const seen = vi.fn();
    subscribeSync(seen);

    setStatus("synced");

    expect(seen).not.toHaveBeenCalled();
    expect(getSyncSnapshot()).toBe(getSyncSnapshot());
  });

  test("setting the error it already has", () => {
    setError("same");
    const seen = vi.fn();
    subscribeSync(seen);
    setError("same");
    expect(seen).not.toHaveBeenCalled();
  });

  test("clearing an error that is already clear", () => {
    const seen = vi.fn();
    subscribeSync(seen);
    clearError();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("what the snapshot still carries beyond status and error", () => {
  // Most of this file's link-state tests went with §12.1 phase 7 on 14 August 2026:
  // the code a device displayed while waiting, the stage it had reached, and the
  // requests it could approve were all approval's, and approval is gone. Removal
  // stayed, and it is now the only other field, so the comparison test below matters
  // more than it did: with three fields there is nowhere for a stale one to hide.
  beforeEach(() => {
    resetLinkState();
    setStatus("connecting");
    clearError();
  });

  test("removal is part of the snapshot, not a separate read", () => {
    // It decides which screen a device sees, so a consumer must learn about it in the
    // same publish as everything else rather than by polling a getter.
    const seen: boolean[] = [];
    const off = subscribeSync(() => seen.push(getSyncSnapshot().removed));

    setRemoved(true);
    setRemoved(true);
    setRemoved(false);

    expect(seen).toEqual([true, false]);
    // And the getter agrees with the snapshot, since store/sync.ts reads it that way.
    expect(wasRemoved()).toBe(false);
    off();
  });

  test("resetLinkState clears it in one publish", () => {
    setRemoved(true);
    let publishes = 0;
    const off = subscribeSync(() => publishes++);

    resetLinkState();

    expect(publishes).toBe(1);
    expect(getSyncSnapshot().removed).toBe(false);
    off();
  });

  test("every field of the snapshot is compared before publishing", () => {
    // The guard against a field being added and forgotten by the equality check, which
    // is how a screen stops updating for one particular change. Written as a walk over
    // the keys rather than a list, so a new field fails this until it is compared.
    const keys = Object.keys(getSyncSnapshot()) as (keyof SyncSnapshot)[];
    expect(keys.sort()).toEqual(["error", "removed", "status"]);
  });
});

describe("subscriptions", () => {
  test("unsubscribing stops the notifications", () => {
    const seen = vi.fn();
    const off = subscribeSync(seen);
    setStatus("connecting");
    off();
    setStatus("synced");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test("does not call back on subscribe, unlike onSyncStatus", () => {
    // Consumers read the current snapshot themselves, which is what
    // useSyncExternalStore does. A call on subscribe would be a second render
    // on mount for no new information.
    const seen = vi.fn();
    subscribeSync(seen);
    expect(seen).not.toHaveBeenCalled();
  });

  test("getSyncStatus and getSyncError read through to the snapshot", () => {
    setStatus("offline");
    setError("nope");
    expect(getSyncStatus()).toBe(getSyncSnapshot().status);
    expect(getSyncError()).toBe(getSyncSnapshot().error);
  });
});
