// @vitest-environment jsdom
//
// The Sync screen: the device register, and getting a signed-out device back.
//
// These pin the wording, not the styling, because the wording is the fix. The
// register in particular must not imply a power it does not have: it cannot
// remove a device's access for real since steps 4 and 5, so the old "a record,
// not a lock" wording has gone.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const EMAIL = "gary@example.com";

let status = "synced";
let signedIn = true;
const signIn = vi.fn(async () => {});

// useSyncExternalStore compares snapshots by identity and warns about an
// infinite loop if getSnapshot returns a fresh object every call, so this
// caches like the real store does and only rebuilds when the status changes.
let snap = { status: "", error: null as string | null, revision: 0 };
const snapshot = () => {
  if (snap.status !== status) snap = { ...snap, status, revision: snap.revision + 1 };
  return snap;
};

vi.mock("../../src/store/sync", () => ({
  DeviceNotClearedError: class extends Error {},
  deleteAccount: vi.fn(),
  signOutAndWipe: vi.fn(),
  getJournalKeyCode: vi.fn(async () => "J1-TESTKEY"),
  getSessionEmail: () => (signedIn ? EMAIL : null),
  getSyncError: () => null,
  getSyncStatus: () => status,
  getSyncSnapshot: () => snapshot(),
  subscribeSync: () => () => {},
  isConfigured: () => true,
  onSyncStatus: (fn: (s: string) => void) => {
    fn(status);
    return () => {};
  },
  provideJournalKey: vi.fn(),
  canEnrolPasskey: () => canEnrol,
  takeJournalKey: (...a: unknown[]) => takeJournalKey(...(a as [string])),
  countPasskeyRoutes: async () => passkeyRoutes,
  enrolPasskey: vi.fn(),
  unlockWithPasskey: vi.fn(),
  NoPasskeyRouteError: class extends Error {},
  UnknownCredentialError: class extends Error {},
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

/**
 * Whether this device can add a passkey route, and how many the account has.
 *
 * Same condition as canRemove in the store and separate here for the same reason
 * it is separate there: one is about rotating and the other about wrapping.
 */
let canEnrol = false;
/** Handing this device the journal key it never had. */
const takeJournalKey = vi.fn(async (_code: string) => {});
let passkeyRoutes = 0;

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
  forgetDevice: (id: string) => {
    forgotten.push(id);
    deviceRows = deviceRows.filter((r) => r.id !== id);
    return true;
  },
  forgetGoneDevices: () => {
    const gone = deviceRows.filter((r) => !r.isThisDevice && (r.removedAt || r.signedOutAt));
    gone.forEach((r) => forgotten.push(r.id));
    deviceRows = deviceRows.filter((r) => !gone.includes(r));
    return gone.length;
  },
}));

/** Rows the screen asked the store to forget. */
let forgotten: string[] = [];

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
    fireEvent.click(screen.getByText(/Email me a sign-in code/i));
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

  // Reported by Gary: his wife tried to sign in with the journal key. The two
  // credentials arrive minutes apart and both go into a text box, and the
  // journal key is the one she had just been made to save, so it is the one in
  // her head. Naming was never the problem; saying nothing at the moment of the
  // mistake was.
  test("names the journal key when it is typed into the sign-in box", async () => {
    render(<SyncView />);
    requestCode();
    const box = await screen.findByLabelText(/Sign-in code/i);

    fireEvent.change(box, { target: { value: "J1-ABCD-EFGH-JKMN" } });

    expect(screen.getByText(/That is your journal key/i)).toBeTruthy();
    // Not sent. The server would answer "invalid", which names neither what was
    // typed nor where the right thing is.
    expect(
      (screen.getByText(/Sign in with code/i) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("says nothing while a real code is being typed", async () => {
    // The correction must not flash at everyone entering a code normally, so
    // this pins the quiet case as firmly as the loud one.
    render(<SyncView />);
    requestCode();
    const box = await screen.findByLabelText(/Sign-in code/i);

    fireEvent.change(box, { target: { value: "123456" } });

    expect(screen.queryByText(/That is your journal key/i)).toBeNull();
    expect(
      (screen.getByText(/Sign in with code/i) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});

describe("the same mix-up from the other side", () => {
  // A device that is signed in but cannot open the journal. Here the box wants
  // the journal key, and the thing most recently typed was the sign-in code.
  beforeEach(() => {
    status = "needs-key";
    signedIn = true;
  });

  test("names the sign-in code when it is typed into the journal key box", () => {
    render(<SyncView />);

    fireEvent.change(screen.getByLabelText(/Journal key/i), {
      target: { value: "123456" },
    });

    expect(screen.getByText(/That is the sign-in code/i)).toBeTruthy();
    // The length guard already refused this. What it did not do was say so,
    // which left the screen looking broken rather than particular.
    expect(
      (screen.getByText(/Unlock with this journal key/i) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  test("says nothing while a real journal key is being typed", () => {
    render(<SyncView />);

    fireEvent.change(screen.getByLabelText(/Journal key/i), {
      target: { value: "J1-ABCD-EFGH-JKMN" },
    });

    expect(screen.queryByText(/That is the sign-in code/i)).toBeNull();
    expect(
      (screen.getByText(/Unlock with this journal key/i) as HTMLButtonElement)
        .disabled
    ).toBe(false);
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
    // The wording is the feature, and §12.1 phase 7 changed what it may claim. Until
    // 14 August 2026 removal rotated the data key and revoked that device's grant, so
    // "cannot read anything written from now on" was true. Every device now holds the
    // keeper key and can read any epoch, so rotation would exclude nobody and none is
    // attempted: what is left is a mark the other device honours. Claiming more is
    // exactly why the July version of this feature was deleted.
    canRemove = true;
    render(<SyncView />);

    fireEvent.click(screen.getAllByText(/remove this device/i)[0]);

    expect(screen.getByText(/hide the journal on that device/i)).toBeTruthy();
    expect(screen.getByText(/a request that device\s+honours, not a lock/i)).toBeTruthy();
    expect(screen.getByText(/already synced stays on\s+it/i)).toBeTruthy();
    // And it must not go back to promising denial.
    expect(
      screen.queryByText(/not be able to read anything written from now on/i)
    ).toBeNull();
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

// A device linked by approval holds the data key and never held the journal key,
// so it cannot show the key, add a passkey, or remove another device. Until
// takeJournalKey there was nothing it could do about that: the key entry lives on
// the unlock screen, which a working device never sees, so the screen stated a
// permanent second class and called it an explanation. Reported from a phone in
// exactly that state, as "I don't understand how to resolve this".
describe("a device that does not hold the journal key", () => {
  beforeEach(() => {
    canEnrol = false;
  });

  test("says what it cannot do, before anything is pressed", () => {
    // Not behind "show journal key" any more. The condition is known at render, and
    // making somebody press a button to be told it does nothing is the no-guessing
    // rule broken twice over.
    render(<SyncView />);

    // Two boxes mention it, deliberately: the passkey box points down at the
    // remedy, and this one carries it.
    expect(
      screen.getByText(/before Journlet stopped adding devices that way/i)
    ).toBeTruthy();
    expect(screen.getByText(/cannot show the key, add a\s+passkey, or manage/i))
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: /show journal key/i })).toBeNull();
  });

  test("and offers the one thing that resolves it", () => {
    render(<SyncView />);

    expect(
      screen.getByRole("button", { name: /enter journal key/i })
    ).toBeTruthy();
  });

  test("saying where to find the key, and that nothing here is lost", () => {
    // The old wording named "the device that created the journal" as the only one
    // that could show it, which stopped being true with §6.1e: any device holding
    // the key can. And somebody about to type a key into a working device wants to
    // know it will not wipe what is on it.
    render(<SyncView />);

    fireEvent.click(screen.getByRole("button", { name: /enter journal key/i }));

    expect(screen.getByText(/Sync → show\s+journal key/i)).toBeTruthy();
    expect(screen.getByText(/keeps\s+everything it already has/i)).toBeTruthy();
  });

  test("takes the key it is given, through the path made for a connected device", () => {
    // takeJournalKey rather than provideJournalKey: this device is already
    // connected, so the connect that collects the later epochs has to be forced.
    render(<SyncView />);
    fireEvent.click(screen.getByRole("button", { name: /enter journal key/i }));

    fireEvent.change(screen.getByLabelText(/journal key/i), {
      target: { value: "J1-ABCD-EFGH-JKMN" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /give this device the journal key/i })
    );

    expect(takeJournalKey).toHaveBeenCalledWith("J1-ABCD-EFGH-JKMN");
  });

  test("a key that does not fit says so and leaves the entry open", () => {
    takeJournalKey.mockRejectedValueOnce(
      new Error("That journal key does not match this account's journal")
    );
    render(<SyncView />);
    fireEvent.click(screen.getByRole("button", { name: /enter journal key/i }));
    fireEvent.change(screen.getByLabelText(/journal key/i), {
      target: { value: "J1-WRON-GKEY-XXXX" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /give this device the journal key/i })
    );

    return waitFor(() => {
      expect(screen.getByText(/does not match this account/i)).toBeTruthy();
      expect(screen.getByLabelText(/journal key/i)).toBeTruthy();
    });
  });

  test("a device that does hold the key is offered showing it instead", () => {
    canEnrol = true;
    render(<SyncView />);

    expect(
      screen.getByRole("button", { name: /show journal key/i })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /enter journal key/i })
    ).toBeNull();
  });
});

// The nag (spec §6.1e, §12.1 phase 5). First run forces neither the passkey nor the
// code, and this line is what makes that safe: it stays until the key has been
// saved once. The wording is the load-bearing part, because a reminder that reads
// like a check somebody has failed sends them looking for the setting that turns it
// off — and there is none, since nothing here can see where a code has been put.
describe("the reminder to save the journal key", () => {
  beforeEach(() => {
    canEnrol = true;
    localStorage.clear();
  });

  test("shows on a device that holds the key and has not saved it", () => {
    render(<SyncView />);

    expect(screen.getByText(/not saved yet, as far as this device can tell/i))
      .toBeTruthy();
    expect(
      screen.getByRole("button", { name: /I have saved it/i })
    ).toBeTruthy();
  });

  test("says why it cannot know, and that another device does not clear it", () => {
    // Both halves are honest limits rather than manners: the flag is local because
    // §6.5 forbids the server holding it and the journal doc is per volume, so a
    // save on the Mac genuinely cannot silence the phone.
    render(<SyncView />);

    expect(screen.getByText(/Nothing here can see where you keep it/i)).toBeTruthy();
    expect(screen.getByText(/saving it from another device does not clear/i))
      .toBeTruthy();
  });

  test("goes when told it is done, and stays gone", () => {
    render(<SyncView />);

    fireEvent.click(screen.getByRole("button", { name: /I have saved it/i }));

    expect(screen.queryByText(/not saved yet/i)).toBeNull();
    cleanup();
    render(<SyncView />);
    expect(screen.queryByText(/not saved yet/i)).toBeNull();
  });

  test("never appears on a device that cannot produce the key", () => {
    // A device linked by approval has nothing to save, so reminding it to save
    // something would be an instruction it cannot follow.
    canEnrol = false;
    render(<SyncView />);

    expect(screen.queryByText(/not saved yet/i)).toBeNull();
  });
});

// Taking rows out of the register (12 August 2026, Gary, looking at a list with six
// removed rows above the two devices he uses). Forgetting is about the record; removal
// is about access. The screen has to keep those apart, because conflating them is how
// somebody comes to believe they have cut a device off when they have tidied a list.
describe("forgetting rows for devices that have gone", () => {
  beforeEach(() => {
    forgotten = [];
    canRemove = true;
    deviceRows = [
      { id: "a", name: "Installed app, Safari and Chrome (macOS)", firstSeen: 1, lastSeen: Date.now(), isThisDevice: true },
      { id: "b", name: "Installed app (iOS)", firstSeen: 2, lastSeen: Date.now(), isThisDevice: false },
      { id: "c", name: "Chrome (macOS)", firstSeen: 3, lastSeen: 3, removedAt: Date.now(), isThisDevice: false },
      { id: "d", name: "Safari (macOS)", firstSeen: 4, lastSeen: 4, removedAt: Date.now(), isThisDevice: false },
    ];
  });

  test("offers it on a row that has gone, and not on one still in use", () => {
    render(<SyncView />);

    // Two gone rows, so two of these; the live devices get "remove this device".
    expect(screen.getAllByRole("button", { name: /forget this row/i })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /remove this device/i })).toBeTruthy();
  });

  test("forgetting one takes that row and leaves the rest", () => {
    render(<SyncView />);

    fireEvent.click(screen.getAllByRole("button", { name: /forget this row/i })[0]);

    expect(forgotten).toEqual(["c"]);
    expect(screen.getByText("Installed app (iOS)")).toBeTruthy();
  });

  test("and offers to clear them together once there are two", () => {
    render(<SyncView />);

    expect(screen.getByText(/2 rows are for devices that have already gone/i))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /forget all 2 rows/i }));

    expect(forgotten.sort()).toEqual(["c", "d"]);
  });

  test("saying what forgetting does and does not do", () => {
    // The distinction that matters: these devices have no access either way, and one
    // that is ever added back will list itself again. Neither is obvious from the word.
    render(<SyncView />);

    expect(screen.getByText(/clears the record here and nothing\s+else/i)).toBeTruthy();
    expect(screen.getByText(/no access either way/i)).toBeTruthy();
    expect(screen.getByText(/list themselves again/i)).toBeTruthy();
  });

  test("no bulk control for a single gone row, which has its own", () => {
    deviceRows = deviceRows.filter((r) => r.id !== "d");
    render(<SyncView />);

    expect(screen.queryByText(/rows are for devices/i)).toBeNull();
    expect(screen.getByRole("button", { name: /forget this row/i })).toBeTruthy();
  });
});
