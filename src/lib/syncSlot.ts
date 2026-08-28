// What the header's left slot says about sync, and the whole of it (spec §4.5,
// §11 Q20; added 27 August 2026).
//
// Three tiers replaced the pill that used to sit in the header's right corner:
// nothing at all while sync is working, one word here for what is true but has
// nothing to be done about it, and ui/NotSyncingBanner on the journal itself
// for what needs an action. This file is the middle tier and nothing else.
//
// A Record rather than a list of the states that speak, for the reason
// NotSyncingBanner gives about its own table: adding a SyncStatus should fail
// the build until somebody decides which tier it belongs to, because the
// failure mode of getting it wrong is a device that has stopped reaching the
// server and says so nowhere.

import type { SyncStatus } from "../store/syncStatus";

const SLOT: Record<SyncStatus, string> = {
  // Working, so nothing to say. A slot that says something every time you look
  // at it is one you stop reading, which is §4.5's own reason for giving up the
  // standing word "synced" a day before this replaced the badge entirely.
  synced: "",

  // Behind, and normally for a second. A word here would appear and vanish on
  // every capture, which is the flicker this tier exists to avoid. It does fit
  // — 14.3px spare at 375px beside the longest badge — so this is a choice
  // rather than a measurement. A refusal that will not clear is a different
  // thing and gets the banner, via notSyncingReason().
  pending: "",

  // Left out deliberately, and not because it would not fit. `syncLabel()`
  // returned the bare noun for this state, so "sync · connecting…" only ever
  // reached the accessible name and has never been visible in the app. Showing
  // it here would therefore be new information rather than information this
  // change took away, and it would appear on every cold launch. If it is ever
  // wanted it needs a delay of a second or two first (§11 Q20).
  connecting: "",

  // Behind the boot splash, where the question this would answer is already
  // being answered.
  starting: "",

  // True, expected, and nothing to do about it. This is the one state this
  // tier exists for.
  offline: "offline",

  // Somewhere better to be. Signed out gets NotSyncingBanner, which offers the
  // way back in; a signed-out device holding writing does not even reach the
  // journal, since App gives it ui/SignedOutView.
  "signed-out": "",

  // Never shares a screen with the journal at all: needsJournalKey() has
  // already given this device ui/UnlockView, so there is no page for a word to
  // sit on.
  "needs-key": "",

  // A build with no Supabase configuration. A standing word would be noise on
  // every launch forever, and the Sync screen explains it.
  disabled: "",
};

/** The word for this status, or "" where this tier has nothing to say. */
export const syncSlotWord = (s: SyncStatus): string => SLOT[s];
