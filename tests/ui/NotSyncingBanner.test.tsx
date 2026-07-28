// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NotSyncingBanner, { isNotSyncing } from "../../src/ui/NotSyncingBanner";

afterEach(cleanup);

describe("which states warn that writing reaches nothing", () => {
  test("a device locked out by a lost-device report warns", () => {
    // Regression: this was a bare === "signed-out", so a revoked device kept
    // saving locally and said so nowhere on the journal itself. Keeping capture
    // working is deliberate, which is exactly why the warning has to appear.
    expect(isNotSyncing("revoked")).toBe(true);
  });

  test("an ordinary signed-out device warns", () => {
    expect(isNotSyncing("signed-out")).toBe(true);
  });

  test("working states stay quiet", () => {
    expect(isNotSyncing("synced")).toBe(false);
    expect(isNotSyncing("connecting")).toBe(false);
    expect(isNotSyncing("pending")).toBe(false);
  });

  test("states that explain themselves elsewhere stay quiet", () => {
    // offline is temporary and expected; needs-key and disabled each have their
    // own account on the Sync screen, and disabled would nag on every launch.
    expect(isNotSyncing("offline")).toBe(false);
    expect(isNotSyncing("needs-key")).toBe(false);
    expect(isNotSyncing("disabled")).toBe(false);
  });
});

test("warns that entries are device-only and offers a sign-in route", () => {
  const onSignIn = vi.fn();
  render(<NotSyncingBanner onSignIn={onSignIn} />);
  expect(screen.getByText("Not syncing.")).toBeTruthy();
  expect(
    screen.getByText(/saved on this device only/i),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});
