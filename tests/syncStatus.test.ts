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
  notifyLinkChanged,
  resetSyncStatus,
  setError,
  setStatus,
  subscribeSync,
} from "../src/store/syncStatus";

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

describe("notifyLinkChanged", () => {
  // Link state still lives in store/sync.ts and still reaches the UI by being
  // re-read on any notification. It used to ride on setStatus notifying
  // unconditionally; now that setStatus does not, this is the explicit channel.
  test("notifies even though nothing in the snapshot changed", () => {
    const seen = vi.fn();
    subscribeSync(seen);

    notifyLinkChanged();

    expect(seen).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe("signed-out");
    expect(getSyncSnapshot().error).toBeNull();
  });

  test("still changes the snapshot's identity, or React would not look again", () => {
    const before = getSyncSnapshot();
    notifyLinkChanged();
    expect(getSyncSnapshot()).not.toBe(before);
    expect(getSyncSnapshot().revision).toBe(before.revision + 1);
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
