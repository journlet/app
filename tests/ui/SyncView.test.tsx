// @vitest-environment jsdom
//
// Account deletion is the one irreversible action in the app, so these tests
// pin the gate rather than the styling: it stays shut until the account's own
// email is typed, and a failed delete says plainly that nothing was destroyed.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const EMAIL = "gary@example.com";

const deleteAccount = vi.fn();
const signOutAndWipe = vi.fn();

// useSyncExternalStore compares snapshots by identity and warns about an
// infinite loop if getSnapshot returns a fresh object every call, so this
// caches like the real store does and only rebuilds when the status changes.
const SNAPSHOT = { status: "synced", error: null, revision: 0 };

let hasKey = true;

vi.mock("../../src/store/sync", () => {
  // A real class, so the component's `instanceof` branch is exercised rather
  // than stubbed past.
  class DeviceNotClearedError extends Error {
    constructor(detail: string) {
      super(detail);
      this.name = "DeviceNotClearedError";
    }
  }
  return {
    DeviceNotClearedError,
    deleteAccount: (...a: unknown[]) => deleteAccount(...a),
    signOutAndWipe: (...a: unknown[]) => signOutAndWipe(...a),
    getJournalKeyCode: vi.fn(async () => "J1-TESTKEY"),
    // Whether this device holds the account's journal key code. It decides
    // whether the confirmation box will take an email address as well as a code
    // (assessment Finding 24).
    holdsJournalKey: () => hasKey,
    getSessionEmail: () => EMAIL,
    getSyncError: () => null,
    getSyncStatus: () => "synced",
    getSyncSnapshot: () => SNAPSHOT,
    subscribeSync: () => () => {},
    isConfigured: () => true,
    lostDevice: vi.fn(),
    onSyncStatus: (fn: (s: string) => void) => {
      fn("synced");
      return () => {};
    },
    provideJournalKey: vi.fn(),
    signIn: vi.fn(),
    verifyEmailCode: vi.fn(),
  };
});

import SyncView from "../../src/SyncView";
import { DeviceNotClearedError } from "../../src/store/sync";

const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  hasKey = true;
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, origin: "https://app.journlet.com", reload },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

const openDelete = () => {
  render(<SyncView />);
  fireEvent.click(
    screen.getByRole("button", { name: /delete account and all synced data/i })
  );
};

const confirmField = () =>
  screen.getByLabelText(/confirm account deletion/i);

const deleteButton = () =>
  screen.getByRole("button", { name: "Delete account and all synced data" });

describe("the delete action is not reachable by accident", () => {
  test("starts collapsed, showing only the labelled opener", () => {
    render(<SyncView />);
    expect(
      screen.getByRole("button", {
        name: /delete account and all synced data/i,
      })
    ).toBeTruthy();
    expect(screen.queryByLabelText(/type your email address/i)).toBeNull();
  });

  test("says plainly that it cannot be undone", () => {
    openDelete();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(screen.getByText(/no grace period/i)).toBeTruthy();
  });

  test("admits that other devices keep their copy", () => {
    openDelete();
    expect(screen.getByText(/nothing can erase a device remotely/i)).toBeTruthy();
  });

  test("is disabled until something is typed", () => {
    openDelete();
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("stays disabled for a different email", () => {
    openDelete();
    fireEvent.change(confirmField(), {
      target: { value: "someone.else@example.com" },
    });
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("stays disabled for a near miss", () => {
    openDelete();
    fireEvent.change(confirmField(), { target: { value: "gary@example.co" } });
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("arms once the account's own email is typed", () => {
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(false);
  });

  test("tolerates case and surrounding whitespace", () => {
    openDelete();
    fireEvent.change(confirmField(), {
      target: { value: "  GARY@Example.com  " },
    });
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(false);
  });

  test("cancelling clears what was typed, so reopening is disarmed", () => {
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /delete account and all synced data/i,
      })
    );
    expect((confirmField() as HTMLInputElement).value).toBe("");
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("running the delete", () => {
  test("calls deleteAccount once and reloads", async () => {
    deleteAccount.mockResolvedValueOnce(undefined);
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  test("a failure reports the reason and says nothing was deleted", async () => {
    deleteAccount.mockRejectedValueOnce(new Error("permission denied"));
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    await waitFor(() =>
      expect(screen.getByText(/permission denied/i)).toBeTruthy()
    );
    expect(screen.getByText(/your journal is untouched/i)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  test("does nothing while the gate is shut", () => {
    openDelete();
    fireEvent.click(deleteButton());
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  // The dangerous case: the account is already gone and only the local clear-up
  // failed. Saying "your journal is untouched" here would be a lie at the one
  // moment it does real harm, so the two failures must read differently.
  test("a wipe failure after deletion does not claim the journal survived", async () => {
    deleteAccount.mockRejectedValueOnce(
      new DeviceNotClearedError("QuotaExceededError")
    );
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    await waitFor(() =>
      expect(screen.getByText(/are deleted/i)).toBeTruthy()
    );
    expect(screen.queryByText(/untouched/i)).toBeNull();
    expect(screen.getByText(/QuotaExceededError/)).toBeTruthy();
    expect(screen.getByText(/clear this site's data/i)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});

// Assessment Finding 24: deleting the account now needs the code derived from
// the journal key code, so a device that does not hold it cannot do it. The rule
// this screen already follows for removing a device is to offer an action only
// where it can be carried out, rather than offering it and then failing.
describe("a device that does not hold the journal key code", () => {
  test("asks for the journal key code instead of the email address", () => {
    hasKey = false;
    openDelete();

    expect(
      screen.getByText(/type your/i).textContent
    ).toMatch(/journal key code/i);
    expect(screen.getByText(/does not hold that code/i)).toBeTruthy();
  });

  test("the email address does not arm it", () => {
    // It would have nothing to derive from. Arming on it would produce a button
    // that fails, which is the thing this screen does not do.
    hasKey = false;
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });

    expect(deleteButton().hasAttribute("disabled")).toBe(true);
  });

  test("a journal key code arms it, and is what gets sent", () => {
    hasKey = false;
    openDelete();
    fireEvent.change(confirmField(), {
      target: { value: "J1-ABCD-EFGH-JKMN-PQRS" },
    });
    fireEvent.click(deleteButton());

    expect(deleteAccount).toHaveBeenCalledWith("J1-ABCD-EFGH-JKMN-PQRS");
  });

  test("it is still offered at all, rather than hidden", () => {
    // Hiding it would leave someone hunting for a control that is deliberately
    // absent, which reads as a missing feature rather than a stated limit.
    hasKey = false;
    render(<SyncView />);

    expect(screen.getByText("Delete account")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /delete account and all synced data/i })
    ).toBeTruthy();
  });
});

describe("a device that does hold it", () => {
  test("takes either the email address or the code", () => {
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    expect(deleteButton().hasAttribute("disabled")).toBe(false);

    fireEvent.change(confirmField(), {
      target: { value: "J1-ABCD-EFGH-JKMN-PQRS" },
    });
    expect(deleteButton().hasAttribute("disabled")).toBe(false);
  });

  test("and passes on whichever was typed", () => {
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    expect(deleteAccount).toHaveBeenCalledWith(EMAIL);
  });

  test("a near miss on the email still does not arm it", () => {
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL + "x" } });
    expect(deleteButton().hasAttribute("disabled")).toBe(true);
  });
});
