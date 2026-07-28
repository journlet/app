// @vitest-environment jsdom
//
// The two screens added on 28 July: what a device says after it has been
// locked out by a lost-device report elsewhere, and the device register.
//
// These pin the wording, not the styling, because the wording is the fix. The
// original complaint was a device that appeared to do nothing; a device that
// silently drops its session is no better, and a device that claims a lost
// phone can no longer reach the server is worse — it is untrue for as long as
// its token lives. So: say what happened, say what was not done.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const EMAIL = "gary@example.com";

let status = "synced";
let signedIn = true;
const lostDevice = vi.fn(async () => "J1-NEWKEY");
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
  lostDevice: (...a: unknown[]) => lostDevice(...(a as [])),
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

describe("a device that has been locked out", () => {
  beforeEach(() => {
    status = "revoked";
    signedIn = false; // the session is gone by the time this renders
  });

  test("says why it signed out instead of just showing signed-out", () => {
    render(<SyncView />);

    expect(screen.getByText(/This device was signed out/i)).toBeTruthy();
    // Twice over deliberately: the status line beside the heading and the
    // explanation below it. Someone glancing at the badge should get the
    // reason without having to read on.
    expect(screen.getAllByText(/lost device was reported/i).length).toBe(2);
  });

  test("says plainly that nothing local was deleted", () => {
    // Someone reading this screen has just lost their sign-in without asking
    // to. The first question is whether their writing survived.
    render(<SyncView />);

    expect(screen.getByText(/Nothing has been deleted/i)).toBeTruthy();
  });

  test("tells you how to get back: sign in, then the new key", () => {
    render(<SyncView />);

    expect(
      screen.getByText(/enter the new journal key\s+when asked/i)
    ).toBeTruthy();
    expect(screen.getByLabelText(/Email address/i)).toBeTruthy();
  });

  test("offers the camera, not just typing the key in", () => {
    // The key is on another device's screen, and on an installed iOS app the
    // QR is the only linking path that does not involve retyping 40 characters.
    render(<SyncView />);

    expect(
      screen.getByText(/Scan the new journal key with the camera/i)
    ).toBeTruthy();
  });

  test("offers erasing this device, but does not push you towards it", () => {
    // Keeping the device costs nothing: entries still save locally and merge on
    // re-link. Erasing is the exception, so it sits behind its own step.
    render(<SyncView />);

    expect(screen.getByText(/erase this device and start over/i)).toBeTruthy();
    expect(screen.queryByText(/^Erase this device and start over$/)).toBeNull();
  });

  test("erasing warns that unsynced writing goes with it, and gates on that", () => {
    // "A re-link would bring it back" is only true of what reached the server.
    // Anything this device wrote offline and never pushed is here alone.
    render(<SyncView />);
    fireEvent.click(screen.getByText(/erase this device and start over/i));

    // The warning wraps "not" in <em>, so match around it.
    expect(screen.getByText(/cannot be recovered/i)).toBeTruthy();
    expect(screen.getByText(/not yet synced from this device/i)).toBeTruthy();
    const confirm = screen.getByText(/^Erase this device and start over$/);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("getting back in on a device that was signed out", () => {
  // Reporting a lost device drops every surviving device into the sign-in
  // flow at once, so this step stops being a rare once-per-device event and
  // becomes the recovery path for the whole account. It cannot be a dead end.
  beforeEach(() => {
    status = "revoked";
    signedIn = false;
  });

  const requestCode = () => {
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "gary@example.com" },
    });
    fireEvent.click(screen.getByText(/Send sign-in link/i));
  };

  test("says which address the code went to", async () => {
    // Otherwise a typo is invisible: you wait for an email that was sent
    // somewhere else, with nothing on screen to tell you so.
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

  test("still explains that the device cannot be erased remotely", () => {
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));

    expect(screen.getByText(/nothing can reach out and erase a device/i)).toBeTruthy();
  });

  test("afterwards, tells you to change your email password too", async () => {
    render(<SyncView />);
    fireEvent.click(screen.getByText(/lost a device\? sign it out/i));
    fireEvent.click(
      screen.getByText(/Sign out other devices and issue a new journal key/i)
    );

    expect(
      await screen.findByText(/change your email password/i)
    ).toBeTruthy();
    expect(lostDevice).toHaveBeenCalled();
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
