// @vitest-environment jsdom
//
// The Sync screen: the device register, and getting a signed-out device back.
//
// These pin the wording, not the styling, because the wording is the fix. The
// register in particular must not imply a power it does not have: it cannot
// remove a device's access for real since steps 4 and 5, so the old "a record,
// not a lock" wording has gone.

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
  canRemoveDevices: () => canRemove,
  removeDevice: vi.fn(),
  signIn: (...a: unknown[]) => signIn(...(a as [])),
  verifyEmailCode: vi.fn(),
}));

/**
 * Whether this device holds the recovery key, which is what allows it to remove
 * another. Only such a device can rotate, and removal without rotation does not
 * remove anything (spec/device-identity-design.md, steps 4 and 5).
 */
let canRemove = false;

interface Row {
  id: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  signedOutAt?: number;
  removedAt?: number;
  isThisDevice: boolean;
}

// Rebuilt per test rather than mutated in place, so a case that empties the
// list cannot decide what a later case sees.
const twoDevices = (): Row[] => [
  {
    id: "a",
    name: "Installed app and Chrome (macOS)",
    firstSeen: Date.now() - 86_400_000,
    lastSeen: Date.now() - 60_000,
    isThisDevice: true,
  },
  {
    id: "b",
    name: "Installed app (iOS)",
    firstSeen: Date.now() - 172_800_000,
    lastSeen: Date.now() - 7_200_000,
    isThisDevice: false,
  },
];

let deviceRows: Row[] = twoDevices();

vi.mock("../../src/store/devices", () => ({
  listDevices: () => deviceRows,
  onDevicesChange: () => () => {},
  thisDeviceId: () => "a",
  touchThisDevice: vi.fn(),
}));

import SyncView from "../../src/SyncView";

beforeEach(() => {
  vi.clearAllMocks();
  status = "synced";
  signedIn = true;
  canRemove = false;
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

describe("signing out of this device", () => {
  const openSignOut = () => {
    render(<SyncView />);
    fireEvent.click(screen.getByText(/sign out of this device/i));
  };

  test("when synced, says nothing is lost and does not gate", () => {
    // The gate exists for unrecoverable loss. When the server already has
    // everything, asking someone to tick a box teaches them to tick boxes.
    status = "synced";
    openSignOut();

    expect(screen.getByText(/signing out loses\s+nothing/i)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const go = screen.getByText(
      /Sign out and remove journal from this device/i
    ) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
  });

  test("when not synced, warns and refuses until acknowledged", () => {
    // The case that matters: signing out on a device that has been offline.
    // Those entries exist nowhere else and nothing can bring them back.
    status = "offline";
    openSignOut();

    expect(screen.getByText(/has not finished syncing/i)).toBeTruthy();
    const go = screen.getByText(
      /Sign out and remove journal from this device/i
    ) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(go.disabled).toBe(false);
  });

  test("suggests waiting rather than only warning", () => {
    status = "pending";
    openSignOut();

    expect(screen.getByText(/wait until this says synced/i)).toBeTruthy();
  });

  test("treats every unsettled state as risky, not just pending", () => {
    for (const s of ["pending", "offline", "connecting"] as const) {
      cleanup();
      status = s;
      openSignOut();
      expect(screen.getByRole("checkbox")).toBeTruthy();
    }
  });

  test("says the journal key is readable from another device", () => {
    // The old wording said the key "cannot be recovered afterwards", which is
    // true on a lone device and misleading on an account with others.
    status = "synced";
    openSignOut();

    expect(screen.getByText(/read from another device/i)).toBeTruthy();
    expect(screen.getByText(/only device, save it first/i)).toBeTruthy();
  });

  test("does not gate on the journal key, since another device has it", () => {
    status = "synced";
    openSignOut();

    expect(screen.queryByText(/I have saved my journal key/i)).toBeNull();
  });
});

describe("the device register", () => {
  test("lists the devices and marks which one you are on", () => {
    render(<SyncView />);

    expect(screen.getByText("Installed app and Chrome (macOS)")).toBeTruthy();
    expect(screen.getByText("Installed app (iOS)")).toBeTruthy();
    // "this device" also appears in the surrounding prose, so match the badge
    // by its exact text rather than a substring.
    expect(screen.getByText(/^\s*this device\s*$/i)).toBeTruthy();
  });

  test("says the list never leaves the journal encrypted", () => {
    render(<SyncView />);

    expect(screen.getByText(/server never sees it/i)).toBeTruthy();
  });

  test("says what the list is for, including removal", () => {
    // It used to say "a record, not a lock, and nothing here signs a device out",
    // which was true and load-bearing while per-device keys did not exist. Steps 4
    // and 5 made it false: the list now removes a device's access for real, so the
    // sentence had to go rather than be softened.
    render(<SyncView />);

    expect(screen.getByText(/spot a device you do not recognise/i)).toBeTruthy();
    expect(screen.queryByText(/nothing here signs a device out/i)).toBeNull();
  });

  test("never offers renaming", () => {
    // Withdrawn 28 Jul (Gary) and not coming back: a name you chose is exactly
    // what would disguise a device you did not recognise, which is the one thing
    // this list exists to show you.
    render(<SyncView />);

    expect(screen.queryByText(/rename/i)).toBeNull();
  });

  test("offers no removal on a device that cannot carry it out", () => {
    // A device linked by approval holds no recovery key, so it cannot publish the
    // new epoch and therefore cannot rotate. Offering the action and failing
    // would be worse than not offering it.
    canRemove = false;
    render(<SyncView />);

    expect(screen.queryByText(/remove this device/i)).toBeNull();
  });

  test("offers removal on the device holding the recovery key", () => {
    canRemove = true;
    render(<SyncView />);

    expect(screen.getAllByText(/remove this device/i).length).toBeGreaterThan(0);
  });

  test("never offers to remove the device you are using", () => {
    // Sign out is that operation, and it wipes locally too. Rotating the key and
    // then walking away would strand the journal on this device.
    canRemove = true;
    render(<SyncView />);

    // Two devices in the fixture, one of them this one.
    expect(screen.getAllByText(/remove this device/i)).toHaveLength(1);
  });

  test("spells out what removal does and does not do before doing it", () => {
    // The wording is the feature. Tier one without rotation was deleted in July
    // for claiming more than it did; this claims exactly what it does.
    canRemove = true;
    render(<SyncView />);

    fireEvent.click(screen.getAllByText(/remove this device/i)[0]);

    expect(
      screen.getByText(/not be able to read anything written from now on/i)
    ).toBeTruthy();
    expect(screen.getByText(/already synced stays on that device/i)).toBeTruthy();
  });

  test("shows every client a device has been opened with", () => {
    // One machine can reach the journal as an installed app and as a browser
    // tab, sharing the same storage, so one row names both.
    render(<SyncView />);

    expect(screen.getByText(/Installed app and Chrome/)).toBeTruthy();
  });

  test("says this device is syncing now rather than quoting a stale time", () => {
    // last-seen is recorded at most hourly, so a figure in minutes claims a
    // precision that does not exist. It read as plainly wrong on a device that
    // was syncing at that moment, which is how the problem was spotted.
    render(<SyncView />);

    expect(screen.getByText(/syncing now/)).toBeTruthy();
    expect(screen.queryByText(/last synced .*minutes ago/)).toBeNull();
  });

  test("describes other devices only as coarsely as it knows", () => {
    deviceRows = [
      {
        id: "b",
        name: "Installed app (iOS)",
        firstSeen: Date.now() - 172_800_000,
        lastSeen: Date.now() - 3 * 86_400_000,
        isThisDevice: false,
      },
    ];
    render(<SyncView />);

    expect(screen.getByText(/last synced 3 days ago/)).toBeTruthy();
  });

  test("a device seen in the last hour says so without pretending to minutes", () => {
    deviceRows = [
      {
        id: "b",
        name: "Installed app (iOS)",
        firstSeen: Date.now() - 172_800_000,
        lastSeen: Date.now() - 10 * 60_000,
        isThisDevice: false,
      },
    ];
    render(<SyncView />);

    expect(screen.getByText(/within the last hour/)).toBeTruthy();
  });

  test("this device falls back to a time when it is not syncing", () => {
    // Offline or waiting to sync: "syncing now" would be a lie, so it reverts
    // to what was recorded.
    status = "offline";
    deviceRows = [
      {
        id: "a",
        name: "Installed app and Chrome (macOS)",
        firstSeen: Date.now() - 86_400_000,
        lastSeen: Date.now() - 2 * 86_400_000,
        isThisDevice: true,
      },
    ];
    render(<SyncView />);

    expect(screen.queryByText(/syncing now/)).toBeNull();
    expect(screen.getByText(/last synced 2 days ago/)).toBeTruthy();
  });

  test("a device that signed out is reported as such, not as last synced", () => {
    // "last synced within the last hour" would be technically true and quite
    // wrong: that device has erased its copy, so saying when it last synced
    // implies it still holds one.
    deviceRows = [
      {
        id: "b",
        name: "Installed app (iOS)",
        firstSeen: Date.now() - 172_800_000,
        lastSeen: Date.now() - 10 * 60_000,
        signedOutAt: Date.now() - 10 * 60_000,
        isThisDevice: false,
      },
    ];
    render(<SyncView />);

    expect(screen.getByText(/signed out within the last hour/i)).toBeTruthy();
    expect(screen.queryByText(/last synced/i)).toBeNull();
  });

  test("an empty register says so rather than rendering nothing", () => {
    deviceRows = [];
    render(<SyncView />);

    expect(screen.getByText(/No devices recorded yet/i)).toBeTruthy();
  });
});
