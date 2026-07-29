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
