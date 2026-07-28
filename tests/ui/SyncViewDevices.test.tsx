// @vitest-environment jsdom
//
// The Sync screen: reporting a lost device, getting a signed-out device back,
// and the device register.
//
// These pin the wording, not the styling, because the wording is the fix. A
// screen that claims a lost phone can no longer reach the server is worse than
// one that says nothing: it is untrue for as long as that device's sign-in
// lives. So: say what the action does, and say what it does not do.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const EMAIL = "gary@example.com";

let status = "synced";
let signedIn = true;
const signOutOtherDevices = vi.fn(async () => {});
const signIn = vi.fn(async () => {});

vi.mock("../../src/store/sync", () => ({
  DeviceNotClearedError: class extends Error {},
  deleteAccount: vi.fn(),
  signOutAndWipe: vi.fn(),
  getJournalKeyCode: vi.fn(async () => "J1-TESTKEY"),
  getSessionEmail: () => (signedIn ? EMAIL : null),
  getSyncError: () => null,
  getSyncStatus: () => status,
  isConfigured: () => true,
  signOutOtherDevices: (...a: unknown[]) => signOutOtherDevices(...(a as [])),
  onSyncStatus: (fn: (s: string) => void) => {
    fn(status);
    return () => {};
  },
  provideJournalKey: vi.fn(),
  signIn: (...a: unknown[]) => signIn(...(a as [])),
  verifyEmailCode: vi.fn(),
}));

interface Row {
  id: string;
  label: string;
  firstSeen: number;
  lastSeen: number;
  isThisDevice: boolean;
}

// Rebuilt per test rather than mutated in place, so a case that empties the
// list cannot decide what a later case sees.
const twoDevices = (): Row[] => [
  {
    id: "a",
    label: "Mac",
    firstSeen: Date.now() - 86_400_000,
    lastSeen: Date.now() - 60_000,
    isThisDevice: true,
  },
  {
    id: "b",
    label: "iPhone",
    firstSeen: Date.now() - 172_800_000,
    lastSeen: Date.now() - 7_200_000,
    isThisDevice: false,
  },
];

let deviceRows: Row[] = twoDevices();
const forgetDevice = vi.fn();
const renameDevice = vi.fn();

vi.mock("../../src/store/devices", () => ({
  listDevices: () => deviceRows,
  onDevicesChange: () => () => {},
  forgetDevice: (...a: unknown[]) => forgetDevice(...(a as [])),
  renameDevice: (...a: unknown[]) => renameDevice(...(a as [])),
  thisDeviceId: () => "a",
  touchThisDevice: vi.fn(),
}));

import SyncView from "../../src/SyncView";

beforeEach(() => {
  vi.clearAllMocks();
  status = "synced";
  signedIn = true;
  deviceRows = twoDevices();
});

afterEach(cleanup);

describe("getting back in after the other devices were signed out", () => {
  // Signing out other devices drops each of them into this flow at once, so it
  // stops being a rare per-device event and becomes the recovery path for the
  // account. It cannot be a dead end.
  beforeEach(() => {
    status = "signed-out";
    signedIn = false;
  });

  const requestCode = () => {
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "gary@example.com" },
    });
    fireEvent.click(screen.getByText(/Send sign-in link/i));
  };

  test("says which address the code went to", async () => {
    // Otherwise a typo is invisible: you wait for an email that went somewhere
    // else, with nothing on screen to tell you so.
    render(<SyncView />);
    requestCode();

    expect(await screen.findByText("gary@example.com")).toBeTruthy();
  });

  test("offers a way back to the address field", async () => {
    render(<SyncView />);
    requestCode();
    expect(await screen.findByLabelText(/Sign-in code/i)).toBeTruthy();

    fireEvent.click(screen.getByText(/use a different email address/i));

    expect(screen.getByLabelText(/Email address/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Sign-in code/i)).toBeNull();
  });

  test("offers a new code without leaving the step", async () => {
    render(<SyncView />);
    requestCode();
    await screen.findByLabelText(/Sign-in code/i);
    expect(signIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(/send a new code/i));

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(/Sign-in code/i)).toBeTruthy();
  });
});

describe("reporting a lost device", () => {
  test("does not claim the lost device is cut off immediately", () => {
    // The old copy said it "can never download anything new", which was untrue
    // for as long as its access token remained valid. Overstating this is worse
    // than understating it: someone might skip changing their email password.
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));

    expect(screen.getByText(/few minutes/i)).toBeTruthy();
    expect(screen.getByText(/keeps the copy it/i)).toBeTruthy();
  });

  test("says the other devices keep their journal key", () => {
    // The whole point of the simplification: nothing to re-enter, so getting a
    // device back is an ordinary sign-in.
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));

    expect(screen.getByText(/nothing to re-enter/i)).toBeTruthy();
  });

  test("still explains that the device cannot be erased remotely", () => {
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));

    expect(screen.getByText(/nothing can reach out and erase a device/i)).toBeTruthy();
  });

  test("afterwards, tells you to change your email password too", async () => {
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));
    fireEvent.click(screen.getByText(/^Sign out all other devices$/));

    expect(await screen.findByText(/change your email password/i)).toBeTruthy();
    expect(signOutOtherDevices).toHaveBeenCalled();
  });

  test("and says there is nothing to re-enter afterwards", async () => {
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));
    fireEvent.click(screen.getByText(/^Sign out all other devices$/));

    expect(await screen.findByText(/journal key is unchanged/i)).toBeTruthy();
  });
});

describe("the device register", () => {
  test("lists the devices and marks which one you are on", () => {
    render(<SyncView />);

    expect(screen.getByText("Mac")).toBeTruthy();
    expect(screen.getByText("iPhone")).toBeTruthy();
    // "this device" also appears in the surrounding prose, so match the badge
    // by its exact text rather than a substring.
    expect(screen.getByText(/^\s*this device\s*$/i)).toBeTruthy();
  });

  test("says the list never leaves the journal encrypted", () => {
    render(<SyncView />);

    expect(screen.getByText(/server never sees it/i)).toBeTruthy();
  });

  test("says it is a record, not a lock", () => {
    // The register cannot revoke anything: per-device revocation is not
    // available without server-side code, so a UI that implied otherwise would
    // be promising a protection that does not exist.
    render(<SyncView />);

    expect(screen.getByText(/record, not a lock/i)).toBeTruthy();
    expect(screen.getByText(/only tidies the list/i)).toBeTruthy();
  });

  test("removing a row is offered for other devices, not your own", () => {
    render(<SyncView />);

    const remove = screen.getAllByText(/remove from list/i);
    expect(remove).toHaveLength(1); // the iPhone, not this Mac
    fireEvent.click(remove[0]);
    expect(forgetDevice).toHaveBeenCalledWith("b");
  });

  test("renaming happens in the row, with no native dialog", () => {
    // The app has no window.prompt/confirm/alert anywhere else, and a native
    // prompt looks foreign in an installed home-screen app — where it can also
    // be suppressed, leaving a button that silently does nothing.
    const prompt = vi.spyOn(window, "prompt");
    render(<SyncView />);

    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);

    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Name for Mac/i)).toBeTruthy();
  });

  test("saving the new name commits it", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);

    fireEvent.change(screen.getByLabelText(/Name for Mac/i), {
      target: { value: "work laptop" },
    });
    fireEvent.click(screen.getByText(/save name/i));

    expect(renameDevice).toHaveBeenCalledWith("a", "work laptop");
  });

  test("Enter saves, so it behaves like the rest of the app's inputs", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);
    const input = screen.getByLabelText(/Name for Mac/i);

    fireEvent.change(input, { target: { value: "desk Mac" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(renameDevice).toHaveBeenCalledWith("a", "desk Mac");
  });

  test("cancelling leaves the name alone", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);
    fireEvent.change(screen.getByLabelText(/Name for Mac/i), {
      target: { value: "discarded" },
    });

    fireEvent.click(screen.getByText(/^cancel$/i));

    expect(renameDevice).not.toHaveBeenCalled();
    expect(screen.getByText("Mac")).toBeTruthy();
  });

  test("a blank name is refused rather than saved", () => {
    // Saving empty would leave a row with no label at all, which is worse than
    // a wrong one: an unrecognised device is the thing you are looking for.
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);
    fireEvent.change(screen.getByLabelText(/Name for Mac/i), {
      target: { value: "   " },
    });

    fireEvent.keyDown(screen.getByLabelText(/Name for Mac/i), {
      key: "Enter",
    });

    expect(renameDevice).not.toHaveBeenCalled();
  });

  test("only the row being renamed turns into an input", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);

    expect(screen.getByText("iPhone")).toBeTruthy();
    expect(screen.queryByLabelText(/Name for iPhone/i)).toBeNull();
  });

  test("an empty register says so rather than rendering nothing", () => {
    deviceRows = [];
    render(<SyncView />);

    expect(screen.getByText(/No devices recorded yet/i)).toBeTruthy();
  });
});
