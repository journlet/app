// Whether the app should insist on sign-in before showing a journal at all
// (decision 3, spec device-identity-design.md, 29 July 2026).
//
// Sign-in became part of onboarding to remove a real ambiguity rather than to
// add a gate for its own sake. A device used to generate its own keys and an
// empty journal on first launch and only later discover whether it should have
// adopted an existing one, which produced two paths through the key check and
// an untested behaviour nobody chose: write locally, sign into an account that
// already has a journal, and the local entries merge into it.

import type { SyncStatus } from "../store/sync";

export interface OnboardingInput {
  /** Does this build have Supabase configured at all? */
  configured: boolean;
  status: SyncStatus;
  /** Has the local journal finished loading? Before that, nothing is known. */
  loaded: boolean;
  /** Does this device already hold entries, collections or habits? */
  hasLocalContent: boolean;
}

/**
 * True only for a genuinely fresh install: configured for sync, signed out,
 * loaded, and holding nothing.
 *
 * The `hasLocalContent` condition is the load-bearing one. A signed-out device
 * that already holds a journal must never have it hidden behind a sign-in
 * screen: sessions expire, and someone whose journal vanished behind a login
 * would reasonably conclude they had lost it. That device keeps working and is
 * warned by NotSyncingBanner instead, which is the §6.1b decision to let
 * capture continue and make the state impossible to miss.
 *
 * `loaded` matters for the same reason. IndexedDB resolves asynchronously, so
 * for the first moments of every launch a device with years of journal in it
 * looks identical to a new one.
 *
 * A build with no Supabase configuration is never gated. That is the
 * development mode, and there would be nothing to sign in to.
 */
export const needsOnboarding = (i: OnboardingInput): boolean =>
  i.configured && i.loaded && i.status === "signed-out" && !i.hasLocalContent;

/**
 * A device that is signed in, holds nothing, and cannot open the account's
 * journal: it needs the journal key before it has anything to show.
 *
 * Without this it rendered an empty spread with a small "key needed" badge in
 * the header and no prompt at all, which looks exactly like a journal that has
 * lost its contents. That is the same failure this module is careful to avoid
 * for signed-out devices, and it was walked into for locked ones: the reasoning
 * that a device part-way through linking must not be thrown back to the email
 * step is right, but it does not follow that it should be shown a blank journal.
 *
 * Gated on hasLocalContent for the same reason as needsOnboarding. A device that
 * holds entries and has *become* unlockable — an account whose key was changed
 * elsewhere, say — keeps showing them rather than hiding them behind a form.
 */
export const needsJournalKey = (i: OnboardingInput): boolean =>
  i.configured && i.loaded && i.status === "needs-key" && !i.hasLocalContent;

export interface LoadGateInput {
  configured: boolean;
  status: SyncStatus;
  loaded: boolean;
  hasLocalContent: boolean;
  /** Has this device ever pulled the account's journal successfully? */
  syncedOnce: boolean;
}

/**
 * A signed-in device that holds nothing and has never managed to fetch the
 * journal. Say so, rather than rendering an empty one.
 *
 * Reported 29 July: a transient "JWT issued at future" clock error stopped the
 * first reconcile, and the app showed four empty sections with a small "waiting"
 * badge. Nothing was lost and nothing was wrong with the journal, but there is
 * no way to tell that apart from having lost everything by looking, which is the
 * worst thing this app can imply.
 *
 * `syncedOnce` is what separates this from a genuinely empty new journal: a first
 * device that has just created one has no content either, and it has reconciled.
 *
 * Only for states a fetch has actually been attempted and not reached: "pending"
 * and "offline". Not "connecting", which is normal and brief and would flash this
 * screen on every launch; not "needs-key", which has its own screen; not
 * "synced", where an empty journal really is empty.
 */
export const cannotLoadYet = (i: LoadGateInput): boolean =>
  i.configured &&
  i.loaded &&
  !i.hasLocalContent &&
  !i.syncedOnce &&
  (i.status === "pending" || i.status === "offline");

export interface RecoveryGateInput {
  configured: boolean;
  status: SyncStatus;
  loaded: boolean;
  /** Has this device created a journal whose code nobody has seen? */
  pending: boolean;
}

/**
 * Second stage of first run: show the recovery code once, before the journal
 * (decision 4).
 *
 * Only ever true on a device that created the journal, so it can never hide
 * content: at that moment there is none. It is deliberately a gate rather than
 * a dismissible notice, because it is the only route back from losing every
 * device and there is no better moment to interrupt someone later.
 *
 * Not shown while signed out, because the code is unreadable then: the keyring
 * is there but the journal it belongs to has not been confirmed, and a code
 * shown before the account exists could be the wrong one. In practice a device
 * only becomes pending after a successful connect anyway.
 */
export const needsRecoveryCode = (i: RecoveryGateInput): boolean =>
  i.configured &&
  i.loaded &&
  i.pending &&
  i.status !== "signed-out" &&
  i.status !== "disabled";
