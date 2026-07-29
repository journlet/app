// @vitest-environment jsdom
//
// What a device says when it cannot fetch the journal.
//
// This screen exists because its absence read as data loss: a transient clock
// error on the server stopped the first reconcile and the app rendered four
// empty sections. So the reassurance has to come first and be unhedged, and the
// error has to be visible rather than filed at the bottom of a settings screen.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CannotLoadView from "../../src/ui/CannotLoadView";

afterEach(cleanup);

const renderView = (over: Partial<Parameters<typeof CannotLoadView>[0]> = {}) => {
  const onRetry = vi.fn();
  render(
    <CannotLoadView
      error="JWT issued at future"
      offline={false}
      busy={false}
      onRetry={onRetry}
      {...over}
    />
  );
  return onRetry;
};

describe("what it says", () => {
  test("says the journal is safe, first", () => {
    renderView();

    expect(screen.getByText(/Your journal is safe/i)).toBeTruthy();
    expect(screen.getByText(/on the server and on your other devices/i))
      .toBeTruthy();
  });

  test("does not call itself an empty journal", () => {
    renderView();

    expect(screen.getByText(/Cannot load your journal yet/i)).toBeTruthy();
  });

  test("shows what the server actually said", () => {
    // The error was previously at the very bottom of the Sync screen, below
    // Delete account, so the one useful fact was the hardest to find.
    renderView();

    expect(screen.getByText(/JWT issued at future/)).toBeTruthy();
  });

  test("says it keeps trying, when there is a network", () => {
    renderView();

    expect(screen.getByText(/keeps trying on its own/i)).toBeTruthy();
  });

  test("says something different when offline", () => {
    // "It keeps trying" is not true with no network, and a wrong reassurance is
    // worse than none.
    renderView({ offline: true });

    expect(screen.getByText(/This device is offline/i)).toBeTruthy();
    expect(screen.queryByText(/keeps trying on its own/i)).toBeNull();
  });

  test("explains why writing here would be a bad idea for now", () => {
    // Capture is hidden on this screen, so it owes an explanation: this device
    // has no copy of the journal for an entry to join.
    renderView();

    expect(screen.getByText(/no copy of the journal to add to yet/i))
      .toBeTruthy();
  });

  test("copes with no error text", () => {
    renderView({ error: null });

    expect(screen.getByText(/Your journal is safe/i)).toBeTruthy();
    expect(screen.queryByText(/What the server said/i)).toBeNull();
  });
});

describe("trying again", () => {
  test("offers a retry rather than requiring a restart", () => {
    // Restarting the app was the only way out of this state, and it worked,
    // which means the fix was reachable but not offered.
    const onRetry = renderView();

    fireEvent.click(screen.getByText(/Try again now/i));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("shows it is working and cannot be double-fired", () => {
    const onRetry = renderView({ busy: true });

    const btn = screen.getByText(/Trying…/) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
