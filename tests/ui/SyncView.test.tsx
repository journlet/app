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

vi.mock("../../src/store/sync", () => ({
  deleteAccount: (...a: unknown[]) => deleteAccount(...a),
  signOutAndWipe: (...a: unknown[]) => signOutAndWipe(...a),
  getJournalKeyCode: vi.fn(async () => "J1-TESTKEY"),
  getSessionEmail: () => EMAIL,
  getSyncError: () => null,
  getSyncStatus: () => "synced",
  isConfigured: () => true,
  lostDevice: vi.fn(),
  onSyncStatus: (fn: (s: string) => void) => {
    fn("synced");
    return () => {};
  },
  provideJournalKey: vi.fn(),
  signIn: vi.fn(),
  verifyEmailCode: vi.fn(),
}));

import SyncView from "../../src/SyncView";

const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, origin: "https://app.journlet.com", reload },
  });
});

afterEach(cleanup);

const openDelete = () => {
  render(<SyncView />);
  fireEvent.click(
    screen.getByRole("button", { name: /delete account and all synced data/i })
  );
};

const confirmField = () =>
  screen.getByLabelText(/type your email address to confirm/i);

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

  test("a failure leaves the journal alone", async () => {
    deleteAccount.mockRejectedValueOnce(new Error("network"));
    openDelete();
    fireEvent.change(confirmField(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
    expect(signOutAndWipe).not.toHaveBeenCalled();
  });
});
