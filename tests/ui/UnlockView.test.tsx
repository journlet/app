// @vitest-environment jsdom
//
// Signed in, but this device cannot read the journal yet.
//
// Someone arriving here has just signed in and been shown no journal. The whole
// job of the wording is to say that nothing is lost before it says what to do,
// because the honest reassurance is available: the journal is on the server,
// intact, and merely unopened.

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import UnlockView from "../../src/ui/UnlockView";

afterEach(cleanup);

const renderView = () =>
  render(
    <UnlockView>
      <div>key entry</div>
    </UnlockView>
  );

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
