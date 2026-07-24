// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NotSyncingBanner from "../../src/ui/NotSyncingBanner";

afterEach(cleanup);

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
