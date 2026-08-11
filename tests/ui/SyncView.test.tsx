// @vitest-environment jsdom
//
// Account deletion is the one irreversible action in the app, so these tests
// pin the gate rather than the styling: it stays shut until the account's own
// email is typed, and a failed delete says plainly that nothing was destroyed.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";

const EMAIL = "gary@example.com";

const signOutAndWipe = vi.fn();

// useSyncExternalStore compares snapshots by identity and warns about an
// infinite loop if getSnapshot returns a fresh object every call, so this
// caches like the real store does and only rebuilds when the status changes.
const SNAPSHOT = { status: "synced", error: null, revision: 0 };


vi.mock("../../src/store/sync", () => {
  return {
    signOutAndWipe: (...a: unknown[]) => signOutAndWipe(...a),
    getJournalKeyCode: vi.fn(async () => "J1-TESTKEY"),
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

const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
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

// Assessment Finding 24, settled 11 August 2026: account deletion left the app,
// so the flow these tests covered no longer exists. What is left is a block that
// says where to ask and what you can still do here, which is worth pinning
// because a dead end would be worse than the button was.
describe("the delete-account block, now that it is a signpost", () => {
  test("says deletion is done by asking, and gives the address", () => {
    render(<SyncView />);

    expect(screen.getByText(/done by asking/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /privacy@journlet\.com/i })
    ).toBeTruthy();
  });

  test("offers no button that would delete anything", () => {
    render(<SyncView />);

    expect(
      screen.queryByRole("button", { name: /delete account/i })
    ).toBeNull();
  });

  test("says you will be written to first, and that there is a wait", () => {
    // The two safeguards that replaced the code comparison. Someone reading this
    // block should learn that a request nobody made can be stopped.
    render(<SyncView />);

    expect(screen.getByText(/written to at that address/i)).toBeTruthy();
    expect(screen.getByText(/there is a wait/i)).toBeTruthy();
  });

  test("points at what can still be done here and now", () => {
    // Not a dead end. Sign out clears this device, export keeps a readable copy,
    // and those are what people usually mean in the moment.
    render(<SyncView />);

    expect(screen.getByText(/removes this journal and its keys/i)).toBeTruthy();
    expect(screen.getByText(/readable copy/i)).toBeTruthy();
  });
});
