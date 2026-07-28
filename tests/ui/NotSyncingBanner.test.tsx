// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NotSyncingBanner, { isNotSyncing } from "../../src/ui/NotSyncingBanner";

afterEach(cleanup);

describe("which states warn that writing reaches nothing", () => {
  test("a signed-out device warns", () => {
    // Including one signed out because another device pressed "lost a device":
    // entries keep saving locally and reaching nothing, which is exactly the
    // silent state this banner exists to break.
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
