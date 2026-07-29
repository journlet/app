// When the app insists on sign-in before showing a journal (decision 3, spec
// device-identity-design.md).
//
// The rule is four conditions, and three of them exist to stop it firing when
// it must not. The one that matters most is hasLocalContent: hiding an existing
// journal behind a sign-in screen would look exactly like losing it.

import { describe, expect, test } from "vitest";
import { needsOnboarding } from "../src/lib/onboarding";
import type { OnboardingInput } from "../src/lib/onboarding";

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
