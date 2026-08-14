// What the sync engine is doing, what went wrong, and where this device is in
// being added, as one observable value.
//
// This was three module-level variables in store/sync.ts pushed through one
// listener set, and the listener payload was the status alone. So an error with
// no status change published the value the consumers already held, React's
// same-value bail-out fired, and nothing re-rendered. Two things were invisible
// because of it: the undecryptable-updates tally, which is the most serious
// diagnostic the app has and never changes the status at all, and the second of
// two consecutive connect failures, which left the first error on screen.
//
// The fix is not another listener. It is publishing an immutable snapshot whose
// identity changes when anything in it changes, which is what
// useSyncExternalStore is built to consume: React re-renders on identity, so it
// cannot bail out on a change it cannot see.
//
// The link state moved in here second. It used to live in store/sync.ts and
// reach the screen by being re-read whenever this snapshot changed, which worked
// by accident while setStatus notified unconditionally and needed an explicit
// notifyLinkChanged() once it stopped. Both that function and the `revision`
// counter it existed to bump are gone: identity now changes exactly when a
// field does, so there is nothing left to bump.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";

export type SyncStatus =
  | "disabled" // no Supabase config in the build
  | "signed-out"
  | "connecting"
  | "needs-key" // remote journal uses a different journal key
  | "synced"
  | "pending" // local changes not yet on the server
  | "offline";

/** Whether this build has Supabase configured at all. */
export const isConfigured = (): boolean =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export interface SyncSnapshot {
  readonly status: SyncStatus;
  /**
   * Last server error, surfaced on the Sync screen so that a schema or RLS
   * problem does not masquerade as "offline".
   */
  readonly error: string | null;
  /**
   * Whether another device has marked this one removed in the register.
   *
   * A mark inside the encrypted journal since §12.1 phase 7 removed the grant tables,
   * so it arrives as ordinary content rather than as a fact the server could be asked
   * for. Kept apart from "cannot open the journal" because the two need opposite
   * screens: a device that is behind should wait, a removed one has to be told.
   */
  readonly removed: boolean;
}

const initial = (): SyncSnapshot => ({
  status: isConfigured() ? "signed-out" : "disabled",
  error: null,
  removed: false,
});

let snapshot: SyncSnapshot = initial();

const listeners = new Set<() => void>();

/**
 * Every field compared, so no setter needs a guard of its own and none can
 * publish a value the consumers already hold.
 *
 * Written out rather than looped for a reason: a loop over Object.keys has to
 * index the snapshot by a string, which is the index-signature hole Finding 15
 * closed elsewhere in this codebase. Adding a field to the interface without
 * adding it here would compile, so the test file asserts that every key of the
 * snapshot is read by this function.
 */
const same = (a: SyncSnapshot, b: SyncSnapshot): boolean =>
  a.status === b.status &&
  a.error === b.error &&
  a.removed === b.removed;

const publish = (next: SyncSnapshot): void => {
  // Not published on a no-op. setStatus("synced") when the status is already
  // "synced" runs on every reconcile, and re-rendering App on each one is not
  // free.
  if (same(snapshot, next)) return;
  snapshot = next;
  listeners.forEach((fn) => fn());
};

/** For useSyncExternalStore: stable between changes, new object on each one. */
export const getSyncSnapshot = (): SyncSnapshot => snapshot;

export const subscribeSync = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const getSyncStatus = (): SyncStatus => snapshot.status;
export const getSyncError = (): string | null => snapshot.error;
export const wasRemoved = (): boolean => snapshot.removed;

export const setStatus = (status: SyncStatus): void =>
  publish({ ...snapshot, status });

export const setError = (e: unknown): void =>
  publish({
    ...snapshot,
    error: e instanceof Error ? e.message : typeof e === "string" ? e : String(e),
  });

export const clearError = (): void => publish({ ...snapshot, error: null });

/**
 * Set either half of the link state, or both in one publish.
 *
 * Both, because they are one state rather than two: "opening" keeps the code it
 * was granted against, and a refusal clears the code and sets the stage in the
 * same breath. Two setters would put a render between those, showing a device
 * with no code and a stage that had not caught up.
 */
export const setLinkState = (next: {
}): void => publish({ ...snapshot, ...next });


export const setRemoved = (removed: boolean): void =>
  publish({ ...snapshot, removed });

/**
 * Clear everything about being added, in one publish.
 *
 * Called from teardown: link state belongs to a session and a keyring, both of
 * which are going. A pending-approval card left on screen after a sign-out
 * would offer to grant a device access with a data key this device no longer
 * holds.
 */
export const resetLinkState = (): void =>
  publish({
    ...snapshot,
    removed: false,
  });

/** Test seam: reset to a freshly loaded module's state. */
export const resetSyncStatus = (): void => {
  snapshot = initial();
  listeners.clear();
};
