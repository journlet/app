// When the app insists on sign-in before showing a journal (decision 3, spec
// device-identity-design.md).
//
// The rule is four conditions, and three of them exist to stop it firing when
// it must not. The one that matters most is hasLocalContent: hiding an existing
// journal behind a sign-in screen would look exactly like losing it.

import { describe, expect, test } from "vitest";
import { needsOnboarding, needsRecoveryCode } from "../src/lib/onboarding";
import type {
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
    // would reasonably conclude it was gone. That device keeps working and is
    // warned by NotSyncingBanner instead (§6.1b).
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
