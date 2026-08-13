// When the app insists on sign-in before showing a journal (decision 3, spec
// device-identity-design.md).
//
// The rule is four conditions, and three of them exist to stop it firing when
// it must not. The one that matters most is hasLocalContent: hiding an existing
// journal behind a sign-in screen would look exactly like losing it.

import { describe, expect, test } from "vitest";
import {
  cannotLoadYet,
  isSettling,
  needsJournalKey,
  needsOnboarding,
  needsRecoveryCode,
  needsSignInChoice,
} from "../src/lib/onboarding";
import type {
  LoadGateInput,
  OnboardingInput,
  RecoveryGateInput,
} from "../src/lib/onboarding";

/** A genuinely fresh install with sync configured. */
const fresh: OnboardingInput = {
  configured: true,
  status: "signed-out",
  loaded: true,
  hasLocalContent: false,
};

describe("a fresh install", () => {
  test("is asked to sign in before it has a journal", () => {
    expect(needsOnboarding(fresh)).toBe(true);
  });
});

describe("what must never be gated", () => {
  test("a signed-out device that already holds a journal", () => {
    // Sessions expire. Someone whose journal disappeared behind a login screen
    // would reasonably conclude it was gone. That device is offered the choices
    // instead of being asked to start over (§6.1b, 13 August).
    expect(needsOnboarding({ ...fresh, hasLocalContent: true })).toBe(false);
  });

  test("a device whose journal has not finished loading", () => {
    // IndexedDB resolves asynchronously, so for the first moments of every
    // launch a device with years of journal in it looks identical to a new one.
    // Without this the gate would flash up on every cold start.
    expect(needsOnboarding({ ...fresh, loaded: false })).toBe(false);
    expect(
      needsOnboarding({ ...fresh, loaded: false, hasLocalContent: true })
    ).toBe(false);
  });

  test("a build with no Supabase configuration", () => {
    // The development mode: there is nothing to sign in to, so gating would
    // make the app unusable rather than safer.
    expect(needsOnboarding({ ...fresh, configured: false })).toBe(false);
    expect(needsOnboarding({ ...fresh, configured: false, status: "disabled" }))
      .toBe(false);
  });

  test("any state other than signed out", () => {
    // Including needs-key, which is a device part-way through linking: it has
    // a session and is being asked for the journal key, and starting it over
    // at the email step would strand it.
    for (const status of [
      "connecting",
      "needs-key",
      "synced",
      "pending",
      "offline",
      "disabled",
    ] as const) {
      expect(needsOnboarding({ ...fresh, status })).toBe(false);
    }
  });
});

describe("a signed-in device that cannot open the journal", () => {
  /** Wiped and signed back in, or a new device linking to an existing journal. */
  const locked: OnboardingInput = { ...fresh, status: "needs-key" };

  test("is asked for the journal key", () => {
    // Without this it rendered an empty spread with only a small "key needed"
    // badge in the header, which looks exactly like a journal that has lost its
    // contents — the failure this module avoids for signed-out devices and had
    // walked into for locked ones.
    expect(needsJournalKey(locked)).toBe(true);
  });

  test("is asked anyway when this device was removed from the account", () => {
    // The one case allowed to hide a journal that exists. Everywhere else that
    // would be indistinguishable from losing it; here the hiding is the point,
    // because access was taken away deliberately from another device. The copy is
    // not erased and comes back on re-approval (Gary, 3 Aug).
    expect(needsJournalKey({ ...locked, hasLocalContent: true, removed: true })).toBe(
      true
    );
  });

  test("removal does not force the screen in any other state", () => {
    // The flag is not a licence to hide the journal generally: it only overrides
    // hasLocalContent once the engine has already reached needs-key.
    for (const status of ["synced", "pending", "offline", "connecting"] as const) {
      expect(
        needsJournalKey({ ...locked, status, hasLocalContent: true, removed: true })
      ).toBe(false);
    }
  });

  test("is not asked while it still holds content", () => {
    // A device with entries that has somehow become unlockable keeps showing
    // them rather than hiding them behind a form.
    expect(needsJournalKey({ ...locked, hasLocalContent: true })).toBe(false);
  });

  test("is not asked before the journal has loaded", () => {
    expect(needsJournalKey({ ...locked, loaded: false })).toBe(false);
  });

  test("no other state asks for a key", () => {
    for (const status of [
      "signed-out",
      "connecting",
      "synced",
      "pending",
      "offline",
      "disabled",
    ] as const) {
      expect(needsJournalKey({ ...locked, status })).toBe(false);
    }
  });

  test("the sign-in gate and the unlock gate are never both true", () => {
    // They render different screens in the same place, so overlapping would be
    // a bug whichever won.
    for (const status of [
      "signed-out",
      "needs-key",
      "connecting",
      "synced",
      "pending",
      "offline",
      "disabled",
    ] as const) {
      const i = { ...fresh, status };
      expect(needsOnboarding(i) && needsJournalKey(i)).toBe(false);
    }
  });
});

describe("signed out with a journal already on the device", () => {
  /** The lapsed session: content here, nothing reaching the server. */
  const lapsed: OnboardingInput = { ...fresh, hasLocalContent: true };

  test("is offered the three choices", () => {
    // Added 13 August 2026. The yellow banner was the whole answer before, and it
    // only ever offered one thing to do — sign in — while two other reasonable
    // answers, carrying on unsynced and erasing this copy, were unreachable.
    expect(needsSignInChoice(lapsed)).toBe(true);
  });

  test("a fresh install is not, because it has nothing to choose about", () => {
    // It goes to onboarding: there is no journal to keep and none to erase.
    expect(needsSignInChoice(fresh)).toBe(false);
  });

  test("not before the journal has loaded", () => {
    // Same reason as every other gate here: for the first moments of a launch a
    // device with years of journal in it is indistinguishable from a new one, and
    // this screen offers to erase things.
    expect(needsSignInChoice({ ...lapsed, loaded: false })).toBe(false);
  });

  test("not in a build without sync, where there is nothing to sign into", () => {
    expect(needsSignInChoice({ ...lapsed, configured: false })).toBe(false);
    expect(
      needsSignInChoice({ ...lapsed, configured: false, status: "disabled" })
    ).toBe(false);
  });

  test("and never while there is a session", () => {
    // Including needs-key, which has its own screen and its own three routes. A
    // device part-way through unlocking must not be offered "sign in" as though
    // it were signed out.
    for (const status of [
      "connecting",
      "needs-key",
      "synced",
      "pending",
      "offline",
      "disabled",
    ] as const) {
      expect(needsSignInChoice({ ...lapsed, status })).toBe(false);
    }
  });

  test("exactly one screen answers a signed-out device", () => {
    // The pair divides the signed-out state rather than each testing for it: with
    // no screen the device renders an empty journal, and with two it renders both
    // in the same place. Checked in both directions, since one predicate drifting
    // to `>= 0` content or the other losing its negation both show up here.
    for (const hasLocalContent of [true, false]) {
      const i = { ...fresh, hasLocalContent };
      expect([needsOnboarding(i), needsSignInChoice(i)].filter(Boolean)).toHaveLength(
        1
      );
    }
  });

  test("and it never collides with the other four screens", () => {
    // The other four all require a session, so this is a property of the states
    // rather than of the order they are checked in App. Worth pinning anyway:
    // App renders them as six independent conditions, so an overlap would render
    // two screens rather than choose between them.
    const i: OnboardingInput = lapsed;
    const gate: LoadGateInput = { ...lapsed, syncedOnce: false };
    expect(needsSignInChoice(i) && needsJournalKey(i)).toBe(false);
    expect(needsSignInChoice(i) && isSettling(gate)).toBe(false);
    expect(needsSignInChoice(i) && cannotLoadYet(gate)).toBe(false);
    expect(
      needsSignInChoice(i) &&
        needsRecoveryCode({ ...lapsed, pending: true })
    ).toBe(false);
  });
});

/** A device that has just created a journal, signed in and loaded. */
const justCreated: RecoveryGateInput = {
  configured: true,
  status: "synced",
  loaded: true,
  pending: true,
};

describe("the recovery code gate", () => {
  test("stops a device that has created a journal nobody has a code for", () => {
    expect(needsRecoveryCode(justCreated)).toBe(true);
  });

  test("does not fire on a device that linked to an existing journal", () => {
    // It was handed the code to get in, so it has one. Only the device that
    // brings a journal into existence is marked.
    expect(needsRecoveryCode({ ...justCreated, pending: false })).toBe(false);
  });

  test("does not fire while signed out", () => {
    // The code cannot be trusted then: the keyring exists but the journal it
    // belongs to has not been confirmed, so a code shown here could be for a
    // journal the account does not have.
    expect(needsRecoveryCode({ ...justCreated, status: "signed-out" })).toBe(
      false
    );
  });

  test("does not fire before the journal has loaded", () => {
    expect(needsRecoveryCode({ ...justCreated, loaded: false })).toBe(false);
  });

  test("does not fire in a build without sync", () => {
    expect(needsRecoveryCode({ ...justCreated, configured: false })).toBe(false);
    expect(needsRecoveryCode({ ...justCreated, status: "disabled" })).toBe(
      false
    );
  });

  test("still fires while sync is unsettled, since the journal exists either way", () => {
    // Created and then went offline, or is still catching up. The code is real
    // and unseen in all of these, and waiting for "synced" could mean never
    // showing it.
    for (const status of ["connecting", "pending", "offline", "needs-key"] as const) {
      expect(needsRecoveryCode({ ...justCreated, status })).toBe(true);
    }
  });
});

/** Signed in, nothing local, and the first fetch never landed. */
const stuck: LoadGateInput = {
  configured: true,
  status: "pending",
  loaded: true,
  hasLocalContent: false,
  syncedOnce: false,
};

describe("a device that cannot load the journal", () => {
  test("says so rather than rendering an empty journal", () => {
    // Reported 29 July: a transient "JWT issued at future" clock error stopped
    // the first reconcile, and the app showed four empty sections with a small
    // "waiting" badge. Indistinguishable from having lost everything.
    expect(cannotLoadYet(stuck)).toBe(true);
  });

  test("covers offline as well as a failed fetch", () => {
    expect(cannotLoadYet({ ...stuck, status: "offline" })).toBe(true);
  });

  test("does not fire once a fetch has ever succeeded", () => {
    // This is what separates it from a genuinely empty new journal: a first
    // device that has just created one holds nothing either.
    expect(cannotLoadYet({ ...stuck, syncedOnce: true })).toBe(false);
  });

  test("does not fire on a device that holds a journal", () => {
    // Sync trouble on a device with entries is the banner's job, not a takeover
    // of the whole screen.
    expect(cannotLoadYet({ ...stuck, hasLocalContent: true })).toBe(false);
  });

  test("does not fire while merely connecting", () => {
    // Normal and brief on every launch. Showing this screen there would flash a
    // scare at someone whose journal is about to appear.
    expect(cannotLoadYet({ ...stuck, status: "connecting" })).toBe(false);
  });

  test("leaves needs-key and signed-out to their own screens", () => {
    expect(cannotLoadYet({ ...stuck, status: "needs-key" })).toBe(false);
    expect(cannotLoadYet({ ...stuck, status: "signed-out" })).toBe(false);
  });

  test("does not fire before the journal has loaded, or without sync", () => {
    expect(cannotLoadYet({ ...stuck, loaded: false })).toBe(false);
    expect(cannotLoadYet({ ...stuck, configured: false })).toBe(false);
  });

  test("the connecting moment shows working, not an empty journal", () => {
    // Reported as "an empty journal for about a second before the needs-key
    // window appeared". Connecting was excluded from cannotLoadYet to avoid
    // flashing an alarming screen, which left the empty journal flashing
    // instead — worse, since it is the one thing that reads as data loss.
    expect(isSettling({ ...stuck, status: "connecting" })).toBe(true);
    expect(cannotLoadYet({ ...stuck, status: "connecting" })).toBe(false);
  });

  test("settling gives way to the other screens once they apply", () => {
    for (const status of [
      "signed-out",
      "needs-key",
      "synced",
      "pending",
      "offline",
      "disabled",
    ] as const) {
      expect(isSettling({ ...stuck, status })).toBe(false);
    }
  });

  test("an established device is never held at a settling screen", () => {
    // It has a journal to show, so it shows it while sync catches up.
    expect(isSettling({ ...stuck, status: "connecting", hasLocalContent: true }))
      .toBe(false);
    expect(isSettling({ ...stuck, status: "connecting", syncedOnce: true }))
      .toBe(false);
  });

  test("no state lets a never-synced empty device render a journal", () => {
    // The property the four gates exist to guarantee, asserted directly rather
    // than inferred from each of them. Every status is claimed by exactly one
    // screen, except "synced", where an empty journal really is empty, and
    // "disabled", which is the development build.
    for (const status of [
      "signed-out",
      "needs-key",
      "connecting",
      "pending",
      "offline",
    ] as const) {
      const base = { configured: true, loaded: true, hasLocalContent: false };
      const claimed =
        needsOnboarding({ ...base, status }) ||
        needsJournalKey({ ...base, status }) ||
        cannotLoadYet({ ...base, status, syncedOnce: false }) ||
        isSettling({ ...base, status, syncedOnce: false });
      expect(claimed).toBe(true);
    }
  });

  test("never overlaps the other gates", () => {
    // Four screens compete for one slot, so any overlap is a bug whichever wins.
    for (const status of [
      "signed-out",
      "needs-key",
      "connecting",
      "synced",
      "pending",
      "offline",
      "disabled",
    ] as const) {
      const base = { configured: true, loaded: true, hasLocalContent: false };
      const load = cannotLoadYet({ ...base, status, syncedOnce: false });
      const onboard = needsOnboarding({ ...base, status });
      const key = needsJournalKey({ ...base, status });
      const settle = isSettling({ ...base, status, syncedOnce: false });
      expect([load, onboard, key, settle].filter(Boolean).length).toBeLessThan(2);
    }
  });
});
