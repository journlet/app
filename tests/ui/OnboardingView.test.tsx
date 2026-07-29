// @vitest-environment jsdom
//
// First run. What it says matters more than how it looks: someone here has
// installed an app and been asked for an email address before seeing anything,
// so it has to earn that in two or three lines.

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import OnboardingView from "../../src/ui/OnboardingView";

afterEach(cleanup);

describe("the first-run screen", () => {
  test("says why an account is needed at all", () => {
    render(
      <OnboardingView>
        <div>sign-in form</div>
      </OnboardingView>
    );

    expect(screen.getByText(/every device you use/i)).toBeTruthy();
    expect(screen.getByText(/needs an account/i)).toBeTruthy();
  });

  test("says there is no password to invent", () => {
    // The most common reason to abandon a sign-up screen is being asked to
    // choose and remember a password. This one never does.
    render(
      <OnboardingView>
        <div>sign-in form</div>
      </OnboardingView>
    );

    expect(screen.getByText(/no password/i)).toBeTruthy();
  });

  test("promises the encryption plainly, including from the operator", () => {
    render(
      <OnboardingView>
        <div>sign-in form</div>
      </OnboardingView>
    );

    expect(screen.getByText(/nobody else can read it/i)).toBeTruthy();
    expect(screen.getByText(/runs the service/i)).toBeTruthy();
  });

  test("warns before the email field that a second device needs the first", () => {
    // Said early on purpose: someone setting up a new phone needs to know their
    // laptop has a part to play while they can still go and fetch it, not after
    // they have signed in and hit a wall asking for a journal key.
    render(
      <OnboardingView>
        <div>sign-in form</div>
      </OnboardingView>
    );

    expect(screen.getByText(/Already journalling on another device/i))
      .toBeTruthy();
    expect(screen.getByText(/ask for your journal key/i)).toBeTruthy();
  });

  test("renders the sign-in form it is given rather than its own", () => {
    // The email and code flow, the resend and change-address escapes and the
    // pending-key handling all live in SyncView. None of it should exist twice.
    render(
      <OnboardingView>
        <div>sign-in form</div>
      </OnboardingView>
    );

    expect(screen.getByText("sign-in form")).toBeTruthy();
  });
});
