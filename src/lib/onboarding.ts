// Whether the app should insist on sign-in before showing a journal at all
// (decision 3, spec device-identity-design.md, 29 July 2026).
//
// Sign-in became part of onboarding to remove a real ambiguity rather than to
// add a gate for its own sake. A device used to generate its own keys and an
// empty journal on first launch and only later discover whether it should have
// adopted an existing one, which produced two paths through the key check and
// an untested behaviour nobody chose: write locally, sign into an account that
// already has a journal, and the local entries merge into it.

import type { SyncStatus } from "../store/syncStatus";

export interface OnboardingInput {
  /** Does this build have Supabase configured at all? */
  configured: boolean;
  status: SyncStatus;
  /** Has the local journal finished loading? Before that, nothing is known. */
  loaded: boolean;
  /** Does this device already hold entries, collections or habits? */
  hasLocalContent: boolean;
  /**
   * Has this device been removed from the account by another device? Only the
   * unlock gate reads it, and only to override hasLocalContent.
   */
  removed?: boolean;
}

/**
 * True only for a genuinely fresh install: configured for sync, signed out,
 * loaded, and holding nothing.
 *
 * The `hasLocalContent` condition is the load-bearing one. A signed-out device
 * that already holds a journal is a different case and gets a different screen:
 * it is offered sign-in or erasure by `needsSignInChoice`, and is never sent back
 * to "start your journal", which would describe the wrong thing to somebody who
 * has one.
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
 * The same state with a journal already on the device: signed out, configured,
 * loaded, holding content. Sign in, or erase this copy.
 *
 * The exact complement of `needsOnboarding` within the signed-out state, added 13
 * August 2026, and the one gate here that took something away rather than adding
 * a screen. A browser whose session had lapsed was reading its own journal
 * indefinitely behind one yellow line, which is what decision 3 exists to
 * prevent — "no use without an account" — while §6.1b's allowance for a
 * signed-out device to keep capturing is what let it happen.
 *
 * Those two are reconciled by separating states §6.1b had run together. An
 * offline device still has a session and still captures, so the flight §6.1b was
 * written for is untouched: nothing about an aeroplane signs anybody out. A
 * device with no session is the different case, and it now shows the screen
 * instead of the journal. The cost, which is real, is that a session lapsing with
 * no network cannot be signed back in until there is one; nothing is erased by
 * waiting, and everything comes back on sign-in, including entries that never
 * reached the server.
 *
 * `hasLocalContent` divides the two screens rather than suppressing either, so
 * exactly one of this and `needsOnboarding` is true whenever a configured,
 * loaded device is signed out. The test pins that, because a state with no
 * screen renders an empty journal and a state with two renders both.
 *
 * What made this the most costly gate to get wrong is that "signed out" was, for
 * the first moments of every launch, a guess. The status was seeded "signed-out"
 * before Supabase had been asked, so this screen — the one offering to erase the
 * journal — was what a device with a valid session showed while the check ran,
 * for up to thirty seconds on a bad connection (reported 19 August 2026, with a
 * screen recording). The status now starts as "starting" and only becomes this
 * when Supabase says so, which is what makes the condition mean what it reads as.
 */
export const needsSignInChoice = (i: OnboardingInput): boolean =>
  i.configured && i.loaded && i.status === "signed-out" && i.hasLocalContent;

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
 *
 * `removed` is the one case that overrides that gate, and it is not a weakening
 * of it. Everywhere else, hiding a journal that exists would be indistinguishable
 * from losing it. A device removed from the account is the exception because the
 * hiding is the *point*: access has been taken away deliberately, by the account
 * holder, on another device. The copy is not erased — it comes back if the device
 * is approved again — but it must not be readable in the meantime, or removal
 * means nothing on the device it was aimed at (Gary, 3 August).
 */
export const needsJournalKey = (i: OnboardingInput): boolean =>
  i.configured &&
  i.loaded &&
  i.status === "needs-key" &&
  (!i.hasLocalContent || i.removed === true);

/**
 * Nothing is known yet: the journal is still coming out of IndexedDB, or Supabase
 * has not said who is signed in (19 August 2026).
 *
 * The screens below all answer a question. This one is the absence of an answer,
 * and it has to be a gate of its own because every other gate here reads false
 * while it holds — so without it the journal renders, which is the failure this
 * module keeps finding in new forms. The old shape of it was an empty spread for
 * a second; the new one was worse, because seeding the status as "signed-out"
 * made the *sign-in-or-erase* screen the thing that flashed, offering to delete a
 * journal whose session was fine.
 *
 * `loaded` belongs here rather than beside it in App for the same reason: two
 * conditions that both mean "not yet" reading as one screen is what stops a
 * launch flickering through three states on the way to the journal.
 *
 * An unconfigured build has no account to check, so only the journal load counts
 * — the development mode must not sit behind a question nobody will answer.
 */
export const isStarting = (i: {
  configured: boolean;
  status: SyncStatus;
  loaded: boolean;
}): boolean => !i.loaded || (i.configured && i.status === "starting");

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

/**
 * A device that holds nothing, has never synced, and is still finding out which
 * of the other screens applies. Show that it is working, not an empty journal.
 *
 * This is the same failure as `cannotLoadYet`, one moment earlier. Connecting was
 * excluded from that gate to avoid flashing an alarming screen on every launch,
 * and the consequence was flashing an empty journal instead: reported 29 July as
 * "an empty journal for about a second before the needs-key window appeared".
 *
 * Between them the two gates make the rule total: a device with nothing local and
 * no successful sync never renders a journal. It is signing in, unlocking,
 * failing to load, or still working it out. Only a device that has actually
 * synced is allowed to show an empty journal, because then it really is empty.
 */
export const isSettling = (i: LoadGateInput): boolean =>
  i.configured &&
  i.loaded &&
  !i.hasLocalContent &&
  !i.syncedOnce &&
  i.status === "connecting";

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
