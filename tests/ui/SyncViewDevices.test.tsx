// @vitest-environment jsdom
//
// The Sync screen: the device register, and getting a signed-out device back.
//
// These pin the wording, not the styling, because the wording is the fix. The
// register in particular must not imply a power it does not have: it cannot
// sign anything out, so it says "a record, not a lock".

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const EMAIL = "gary@example.com";

let status = "synced";
let signedIn = true;
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
  client: string;
  renamed: boolean;
  firstSeen: number;
  lastSeen: number;
  isThisDevice: boolean;
}

// Rebuilt per test rather than mutated in place, so a case that empties the
// list cannot decide what a later case sees.
const twoDevices = (): Row[] => [
  {
    id: "a",
    label: "Chrome (macOS)",
    client: "Chrome (macOS)",
    renamed: false,
    firstSeen: Date.now() - 86_400_000,
    lastSeen: Date.now() - 60_000,
    isThisDevice: true,
  },
  {
    id: "b",
    label: "work phone",
    client: "Installed app (iOS)",
    renamed: true,
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

describe("the device register", () => {
  test("lists the devices and marks which one you are on", () => {
    render(<SyncView />);

    expect(screen.getByText("Chrome (macOS)")).toBeTruthy();
    expect(screen.getByText("work phone")).toBeTruthy();
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
    expect(screen.getByLabelText(/Name for Chrome \(macOS\)/i)).toBeTruthy();
  });

  test("saving the new name commits it", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);

    fireEvent.change(screen.getByLabelText(/Name for Chrome \(macOS\)/i), {
      target: { value: "work laptop" },
    });
    fireEvent.click(screen.getByText(/save name/i));

    expect(renameDevice).toHaveBeenCalledWith("a", "work laptop");
  });

  test("Enter saves, so it behaves like the rest of the app's inputs", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);
    const input = screen.getByLabelText(/Name for Chrome \(macOS\)/i);

    fireEvent.change(input, { target: { value: "desk Mac" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(renameDevice).toHaveBeenCalledWith("a", "desk Mac");
  });

  test("cancelling leaves the name alone", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);
    fireEvent.change(screen.getByLabelText(/Name for Chrome \(macOS\)/i), {
      target: { value: "discarded" },
    });

    fireEvent.click(screen.getByText(/^cancel$/i));

    expect(renameDevice).not.toHaveBeenCalled();
    expect(screen.getByText("Chrome (macOS)")).toBeTruthy();
  });

  test("a blank name is refused rather than saved", () => {
    // Saving empty would leave a row with no label at all, which is worse than
    // a wrong one: an unrecognised device is the thing you are looking for.
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);
    fireEvent.change(screen.getByLabelText(/Name for Chrome \(macOS\)/i), {
      target: { value: "   " },
    });

    fireEvent.keyDown(screen.getByLabelText(/Name for Chrome \(macOS\)/i), {
      key: "Enter",
    });

    expect(renameDevice).not.toHaveBeenCalled();
  });

  test("only the row being renamed turns into an input", () => {
    render(<SyncView />);
    fireEvent.click(screen.getAllByText(/^rename$/i)[0]);

    expect(screen.getByText("work phone")).toBeTruthy();
    expect(screen.queryByLabelText(/Name for work phone/i)).toBeNull();
  });

  test("names a row by its client, so two installs on one machine differ", () => {
    // The installed app and a browser tab on the same Mac have separate
    // storage, so they are separate rows. "Mac" twice would be unreadable.
    render(<SyncView />);

    expect(screen.getByText("Chrome (macOS)")).toBeTruthy();
  });

  test("keeps showing the client once a row has been renamed", () => {
    // Renaming should not hide what the row actually is, or an unfamiliar
    // device could be disguised by a friendly name.
    render(<SyncView />);

    expect(screen.getByText(/Installed app \(iOS\)/)).toBeTruthy();
  });

  test("does not repeat the client when it is also the name", () => {
    render(<SyncView />);

    // Once as the row's name, and not again in the metadata line beneath it.
    expect(screen.getAllByText(/Chrome \(macOS\)/)).toHaveLength(1);
  });

  test("an empty register says so rather than rendering nothing", () => {
    deviceRows = [];
    render(<SyncView />);

    expect(screen.getByText(/No devices recorded yet/i)).toBeTruthy();
  });
});
