// @vitest-environment jsdom
//
// Signed in, but this device cannot read the journal yet.
//
// Someone arriving here has just signed in and been shown no journal. The whole
// job of the wording is to say that nothing is lost before it says what to do,
// because the honest reassurance is available: the journal is on the server,
// intact, and merely unopened.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UnlockView from "../../src/ui/UnlockView";
import type { LinkStage } from "../../src/store/sync";

afterEach(cleanup);

interface Options {
  linkCode?: string | null;
  linkStage?: LinkStage | null;
  removed?: boolean;
}

const renderView = (o: Options = {}) => {
  const onAskAgain = vi.fn();
  const onSignOut = vi.fn();
  render(
    <UnlockView
      linkCode={o.linkCode ?? null}
      linkStage={o.linkStage ?? null}
      removed={o.removed ?? false}
      asking={false}
      onAskAgain={onAskAgain}
      onSignOut={onSignOut}
    >
      <div>key entry</div>
    </UnlockView>
  );
  return { onAskAgain, onSignOut };
};

describe("what it says", () => {
  test("says the journal is still there, first", () => {
    renderView();

    expect(screen.getByText(/your journal is on the server where it was/i))
      .toBeTruthy();
  });

  test("explains why this device cannot read it", () => {
    // Not a fault and not a loss: the content is encrypted and the key never
    // leaves the user's devices, which is the design working as intended.
    renderView();

    expect(screen.getByText(/the content is encrypted/i)).toBeTruthy();
    expect(screen.getByText(/never leaves your devices/i)).toBeTruthy();
  });

  test("says where to find the key", () => {
    renderView();

    expect(screen.getByText(/show journal key/i)).toBeTruthy();
    expect(screen.getByText(/wherever you saved it/i)).toBeTruthy();
  });

  test("is headed as unlocking rather than as an error", () => {
    renderView();

    expect(screen.getByText(/Unlock your journal/i)).toBeTruthy();
  });
});

describe("what it renders", () => {
  test("the key entry it is given, rather than its own", () => {
    // Typing the key, scanning it and the error wording all live in SyncView.
    renderView();

    expect(screen.getByText("key entry")).toBeTruthy();
  });
});

describe("a device that was removed", () => {
  test("says so, and does not pretend it is waiting on a key it is owed", () => {
    renderView({ removed: true });

    expect(screen.getByText(/This device was removed/i)).toBeTruthy();
    expect(
      screen.queryByText(/your journal is on the server where it was/i)
    ).toBeNull();
  });

  test("says nothing here has been erased", () => {
    // True, and the reason removal hides the journal rather than wiping it.
    renderView({ removed: true });

    expect(screen.getByText(/nothing here has been erased/i)).toBeTruthy();
  });

  test("offers to ask again rather than asking on its own", () => {
    const { onAskAgain } = renderView({ removed: true });

    fireEvent.click(screen.getByText(/ask to be added again/i));

    expect(onAskAgain).toHaveBeenCalled();
  });
});

describe("a device whose request was refused", () => {
  test("says it was not added, instead of still saying waiting", () => {
    // It used to go on saying "waiting to be added back" for the full half hour
    // after the answer had been given (Gary, 3 August).
    renderView({ removed: true, linkStage: "declined" });

    expect(screen.getByText(/was not added/i)).toBeTruthy();
    expect(screen.queryByText(/waiting to be added/i)).toBeNull();
  });

  test("offers both ways out: ask again, or sign out", () => {
    // Gary asked for exactly these two. Signing out is the only thing that erases
    // the copy held here, so it says so.
    const { onAskAgain, onSignOut } = renderView({
      removed: true,
      linkStage: "declined",
    });

    fireEvent.click(screen.getByText(/^ask again$/i));
    expect(onAskAgain).toHaveBeenCalled();

    fireEvent.click(screen.getByText(/sign out and erase this journal/i));
    expect(onSignOut).toHaveBeenCalled();
  });

  test("shows no code to compare, since there is nothing pending", () => {
    renderView({ removed: true, linkStage: "declined", linkCode: "AAAA BBBB" });

    expect(screen.queryByText("AAAA BBBB")).toBeNull();
  });
});
