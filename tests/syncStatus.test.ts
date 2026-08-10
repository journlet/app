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
  getLinkCode,
  getLinkRequests,
  getLinkStage,
  getSyncStatus,
  resetLinkState,
  resetSyncStatus,
  setError,
  setLinkRequests,
  setLinkState,
  setRemoved,
  setStatus,
  subscribeSync,
  wasRemoved,
} from "../src/store/syncStatus";
import type { SyncSnapshot } from "../src/store/syncStatus";
import type { LinkRequest } from "../src/store/deviceLink";

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

describe("the link state, which used to live in store/sync.ts", () => {
  // It reached the screen by being re-read whenever this snapshot changed, and
  // needed notifyLinkChanged() to force a publish that carried none of it. Both
  // that function and the `revision` counter it bumped are gone: these fields
  // are in the snapshot, so identity changes when they do.

  const request = (over: Partial<LinkRequest> = {}): LinkRequest =>
    ({
      deviceId: "dev-1",
      publicKey: "pk",
      code: "AAAA-BBBB-CCCC-DDDD",
      label: "Phone",
      requestedAt: 1,
      ...over,
    }) as LinkRequest;

  test("a new code changes the snapshot's identity", () => {
    const before = getSyncSnapshot();
    const seen = vi.fn();
    subscribeSync(seen);

    setLinkState({ linkCode: "4T9K-2WQ7-BX30-M1PZ", linkStage: "waiting" });

    expect(getSyncSnapshot()).not.toBe(before);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getLinkCode()).toBe("4T9K-2WQ7-BX30-M1PZ");
    expect(getLinkStage()).toBe("waiting");
  });

  test("setting one half leaves the other alone, in one publish", () => {
    // "opening" keeps the code it was granted against. Two setters would put a
    // render between them, showing a device with no code and a stale stage.
    setLinkState({ linkCode: "4T9K-2WQ7-BX30-M1PZ", linkStage: "waiting" });
    const seen = vi.fn();
    subscribeSync(seen);

    setLinkState({ linkStage: "opening" });

    expect(seen).toHaveBeenCalledTimes(1);
    expect(getLinkCode()).toBe("4T9K-2WQ7-BX30-M1PZ");
    expect(getLinkStage()).toBe("opening");
  });

  test("re-setting the same values publishes nothing", () => {
    setLinkState({ linkCode: "X", linkStage: "waiting" });
    const before = getSyncSnapshot();
    const seen = vi.fn();
    subscribeSync(seen);

    setLinkState({ linkCode: "X", linkStage: "waiting" });

    expect(seen).not.toHaveBeenCalled();
    expect(getSyncSnapshot()).toBe(before);
  });

  test("an unchanged request list keeps its identity", () => {
    // LinkPrompts counts down to expiry from this array. A fresh array of equal
    // requests restarted that countdown, which is why store/sync.ts compares
    // field by field before handing one over.
    const list = [request()];
    setLinkRequests(list);
    const held = getLinkRequests();

    setLinkRequests(list);

    expect(getLinkRequests()).toBe(held);
  });

  test("an empty list is the same empty list every time", () => {
    setLinkRequests([request()]);
    setLinkRequests([]);
    const empty = getLinkRequests();
    setLinkRequests([]);
    expect(getLinkRequests()).toBe(empty);
    expect(empty).toHaveLength(0);
  });

  test("removal is part of the snapshot, not a separate read", () => {
    const seen = vi.fn();
    subscribeSync(seen);

    setRemoved(true);

    expect(wasRemoved()).toBe(true);
    expect(getSyncSnapshot().removed).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);

    setRemoved(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test("resetLinkState clears all of it in one publish", () => {
    setLinkState({ linkCode: "X", linkStage: "waiting" });
    setLinkRequests([request()]);
    setRemoved(true);
    setError("kept");
    const seen = vi.fn();
    subscribeSync(seen);

    resetLinkState();

    expect(seen).toHaveBeenCalledTimes(1);
    expect(getLinkCode()).toBeNull();
    expect(getLinkStage()).toBeNull();
    expect(getLinkRequests()).toHaveLength(0);
    expect(wasRemoved()).toBe(false);
    // Not link state, and a sign-out is exactly when the last error matters.
    expect(getSyncError()).toBe("kept");
  });

  test("every field of the snapshot is compared before publishing", () => {
    // The no-op check is written out field by field rather than looped, because
    // a loop would have to index the snapshot by string. That means adding a
    // field to the interface without adding it to the comparison compiles
    // cleanly and silently stops publishing on that field. This is the guard
    // against that: it fails when a field is added and left uncompared.
    const keys: (keyof SyncSnapshot)[] = [
      "status",
      "error",
      "linkCode",
      "linkStage",
      "requests",
      "removed",
    ];
    expect(Object.keys(getSyncSnapshot()).sort()).toEqual([...keys].sort());
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
