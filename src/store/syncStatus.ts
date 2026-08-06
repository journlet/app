// What the sync engine is doing, and what went wrong, as one observable value.
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
// Deliberately not published on a no-op. setStatus("synced") when the status is
// already "synced" runs on every reconcile, and re-rendering App on each one is
// not free while its journal walks are unmemoised. Link state, which currently
// rides on those notifications, has notifyLinkChanged() instead: explicit, and
// the next thing to move in here.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";

export type SyncStatus =
  | "disabled" // no Supabase config in the build
  | "signed-out"
  | "connecting"
  | "needs-key" // remote journal uses a different journal key
  | "synced"
  | "pending" // local changes not yet on the server
  | "offline";

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
   * Bumped by every publish, including notifyLinkChanged(), which changes
   * nothing else in here. It exists because link state is still owned by
   * store/sync.ts and still reaches the UI by being re-read whenever this
   * snapshot changes. When that state moves in here, this field goes.
   */
  readonly revision: number;
}

let snapshot: SyncSnapshot = {
  status: isConfigured() ? "signed-out" : "disabled",
  error: null,
  revision: 0,
};

const listeners = new Set<() => void>();

const publish = (next: Omit<SyncSnapshot, "revision">): void => {
  snapshot = { ...next, revision: snapshot.revision + 1 };
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

export const setStatus = (status: SyncStatus): void => {
  if (status === snapshot.status) return;
  publish({ status, error: snapshot.error });
};

export const setError = (e: unknown): void => {
  const error =
    e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  if (error === snapshot.error) return;
  publish({ status: snapshot.status, error });
};

export const clearError = (): void => {
  if (snapshot.error === null) return;
  publish({ status: snapshot.status, error: null });
};

/**
 * Republish without changing status or error.
 *
 * The device-linking code owns `linkCode`, `linkStage` and `pendingRequests`
 * and has always pushed them to the UI by triggering a status notification.
 * That worked by accident, because setStatus notified unconditionally. It now
 * does not, so the linking code says what it means.
 */
export const notifyLinkChanged = (): void => {
  publish({ status: snapshot.status, error: snapshot.error });
};

/** Test seam: reset to a freshly loaded module's state. */
export const resetSyncStatus = (): void => {
  snapshot = {
    status: isConfigured() ? "signed-out" : "disabled",
    error: null,
    revision: 0,
  };
  listeners.clear();
};
