// @vitest-environment jsdom
//
// The unlock screen after §12.1 phase 7, which cut it roughly in half.
//
// Eleven of this file's tests described approval: the code to compare, the waiting
// card, the refusal, asking again, and the order the three routes came in. All of it
// went with the feature on 14 August 2026, and what is left is the part that was
// always load-bearing — this screen must not read as "my journal is gone", and it must
// hand over the two routes rather than describing them.
//
// The removed case keeps its own tests, and gained one: the wording now has to say what
// removal actually is, since nothing enforces it any more.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UnlockView from "../../src/ui/UnlockView";

const show = (props: Partial<React.ComponentProps<typeof UnlockView>> = {}) => {
  const onSignOut = props.onSignOut ?? vi.fn();
  render(
    <UnlockView removed={props.removed ?? false} onSignOut={onSignOut}>
      <div>the ways in</div>
    </UnlockView>
  );
  return { onSignOut };
};

afterEach(cleanup);

describe("what it says", () => {
  test("says the journal is still there, first", () => {
    // An empty screen at this point reads as loss. The truthful reassurance is that
    // the journal is on the server, intact, and merely unopened.
    show();

    expect(screen.getByText(/your journal is on the server where it was/i))
      .toBeTruthy();
  });

  test("explains why this device cannot read it", () => {
    show();

    expect(screen.getByText(/the key never leaves your devices/i)).toBeTruthy();
  });

  test("says where to find the key, including that it can be scanned", () => {
    // The QR is how the key travels between devices, settled 14 August 2026, so the
    // screen that needs the key says the key can be scanned rather than only typed.
    show();

    expect(screen.getByText(/Sync → show journal key/i)).toBeTruthy();
    expect(screen.getByText(/scanned as a QR code/i)).toBeTruthy();
  });

  test("is headed as unlocking rather than as an error", () => {
    show();

    expect(screen.getByRole("heading", { name: /Unlock your journal/i }))
      .toBeTruthy();
  });
});

describe("what it renders", () => {
  test("the routes it is given, rather than its own", () => {
    // The passkey button and the journal key entry are SyncView's. Two copies of
    // either would drift, and this screen has no business owning them.
    show();

    expect(screen.getByText("the ways in")).toBeTruthy();
  });

  test("and no way to ask another device, which no longer exists", () => {
    // §12.1 phase 7. Kept as an assertion rather than a deletion, because the button
    // coming back would mean the tables came back with it.
    show();

    for (const label of [/ask a device/i, /ask again/i, /ask to be added/i])
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(screen.queryByText(/code to compare/i)).toBeNull();
  });

  test("offers signing out, which is the other thing this screen can do", () => {
    const { onSignOut } = show();

    fireEvent.click(
      screen.getByRole("button", { name: /sign out and erase this journal/i })
    );

    expect(onSignOut).toHaveBeenCalled();
  });
});

describe("a device that was removed", () => {
  test("says so, and does not pretend it is waiting on a key it is owed", () => {
    show({ removed: true });

    expect(screen.getByRole("heading", { name: /This device was removed/i }))
      .toBeTruthy();
    expect(screen.queryByText(/your journal is on the server where it was/i))
      .toBeNull();
  });

  test("says nothing here has been erased", () => {
    show({ removed: true });

    expect(screen.getByText(/nothing here has been erased/i)).toBeTruthy();
  });

  test("and describes removal as a request rather than a lock", () => {
    // The change phase 7 forced. Removal used to rotate the data key and revoke that
    // device's grant, which genuinely denied it future content. Every device now holds
    // the keeper key, so the mark is honoured rather than enforced, and this screen is
    // one of the two places that must not imply otherwise.
    show({ removed: true });

    expect(screen.getByText(/asks this device to hide the journal/i)).toBeTruthy();
    expect(screen.getByText(/which nothing can/i)).toBeTruthy();
  });

  test("and still offers the way back in", () => {
    // Being marked removed is not being locked out: the routes are the same two, and
    // using one brings the journal back.
    show({ removed: true });

    expect(screen.getByText("the ways in")).toBeTruthy();
    expect(screen.getByText(/Unlocking below brings\s+it back/i)).toBeTruthy();
  });
});
