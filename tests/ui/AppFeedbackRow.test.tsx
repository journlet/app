// @vitest-environment jsdom
//
// The feedback row, on every screen (4 September 2026).
//
// What this file guards is the thing §13.1 had recorded as a hole and nothing had
// closed: the route to Send feedback lived behind the Menu, the Menu exists only
// when the journal is on screen, so the four states somebody would most want to
// write in from — sign-in, signed out, unlock, a removed device, and cannot-load
// with them — could not reach it at all.
//
// Three assertions, and each of them is a wiring failure that would type-check,
// lint and pass every component test:
//
//   1. the row is on a screen that stands in front of the journal, and on the
//      journal itself;
//   2. it opens the feedback screen there, without letting the journal through
//      behind it — the gate stands aside rather than being defeated;
//   3. `back` exists on that screen and returns to the gate, which the first
//      version of this did not, because Header's back button is wired to
//      journalOnScreen.
//
// And one that is not wiring but a lie: the diagnostics block reports the entry
// count from the in-memory doc, which is empty on every gate, so opened from one
// it used to describe an intact journal as an empty one.

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Mutable so one file can mount both a gate and the journal: the gates are
// derived from the status, and each test renders fresh, so setting it before
// render is enough.
const snapshot = {
  status: "signed-out" as
    | "signed-out"
    | "synced"
    | "needs-key",
  error: null as string | null,
  linkCode: null,
  linkStage: null,
  requests: [],
  removed: false,
};

vi.mock("../../src/store/sync", () => ({
  isConfigured: () => true,
  getSyncSnapshot: () => snapshot,
  subscribeSync: () => () => {},
  hasSyncedOnce: () => true,
  countUpdates: async () => 0,
  getJournalKeyCode: async () => null,
  askForApproval: async () => {},
  signOutAndWipe: async () => {},
  retryConnect: async () => {},
}));

vi.mock("../../src/ui/LinkPrompts", () => ({ default: () => null }));

vi.mock("../../src/store/useJournal", () => ({
  useJournal: () => ({
    loaded: true,
    days: {
      "2026-09-04": [
        { id: "e1", text: "a task in a journal that is on screen", type: "task", created: 1 },
      ],
    },
    collections: [],
    habits: [],
    recurrences: [],
  }),
}));

vi.mock("../../src/SyncView", () => ({ default: () => <div>sync view</div> }));

// The Menu reads both of these on mount, and neither is under test here.
vi.mock("../../src/store/usage", () => ({ serverUsage: async () => null }));
vi.mock("../../src/store/reminders", () => ({
  notificationsSupported: () => false,
  notificationPermission: () => "default",
  requestNotificationPermission: async () => "default",
}));

// Deterministic, and the reason matters for the last test: these are the numbers
// the block must *not* report when the journal is shut.
vi.mock("../../src/store/metrics", () => ({
  measureVolume: () => ({
    docBytes: 98700,
    entries: 412,
    recurrences: 0,
    collections: 0,
    habits: 0,
  }),
  logVolumeMetrics: () => ({ docBytes: 98700, entries: 412 }),
}));

const { default: App } = await import("../../src/App");

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  snapshot.status = "signed-out";
  snapshot.error = null;
});

/** The row's button. Named apart from the screen's own heading of the same words. */
const rowButton = () => screen.queryByRole("button", { name: /^send feedback$/i });
/** The screen itself, by role, so the row's label cannot stand in for it. */
const feedbackScreen = () => screen.queryByRole("heading", { name: /send feedback/i });
const reportBox = () =>
  screen.getByLabelText("The report that will be attached") as HTMLTextAreaElement;

describe("the feedback row", () => {
  test("is on a screen that stands in front of the journal", () => {
    render(<App />);

    expect(screen.getByText(/This device is signed out/i)).toBeTruthy();
    expect(rowButton()).toBeTruthy();
  });

  test("is on the journal too", () => {
    snapshot.status = "synced";
    render(<App />);

    expect(screen.getByText(/a task in a journal that is on screen/i)).toBeTruthy();
    expect(rowButton()).toBeTruthy();
  });

  // The Menu had its own copy of this section until the row existed everywhere,
  // and then it had one copy too many. Rendered from one place now, so this is
  // the assertion that keeps it that way: two call sites is how the wording, the
  // rule above it and the measurements drift apart, one screen at a time.
  test("appears exactly once on the Menu, which no longer keeps its own", () => {
    snapshot.status = "synced";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^menu$/i }));

    expect(screen.getByRole("heading", { name: /^Menu$/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^send feedback$/i })).toHaveLength(1);
  });

  test("opens the feedback screen from a gate, and the journal stays behind it", () => {
    render(<App />);
    fireEvent.click(rowButton() as HTMLElement);

    expect(feedbackScreen()).toBeTruthy();
    // The gate stands aside rather than being defeated: its own screen is gone,
    // and so is the journal it was standing in front of. A gate suppressed by the
    // wrong condition would show one or the other.
    expect(screen.queryByText(/This device is signed out/i)).toBeNull();
    expect(screen.queryByText(/a task in a journal that is on screen/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /log an entry/i })).toBeNull();
  });

  test("and back returns to the gate it was opened from", () => {
    render(<App />);
    fireEvent.click(rowButton() as HTMLElement);
    const back = screen.getByRole("button", { name: /^back$/i });
    fireEvent.click(back);

    expect(screen.getByText(/This device is signed out/i)).toBeTruthy();
    expect(feedbackScreen()).toBeNull();
    expect(rowButton()).toBeTruthy();
  });

  test("and the report it composes does not claim an empty journal", () => {
    snapshot.error = "PGRST301 JWT expired";
    render(<App />);
    fireEvent.click(rowButton() as HTMLElement);

    const text = reportBox().value;
    expect(text).toContain("journal: not open on this device");
    expect(text).not.toContain("412 entries");
    // The lines that make a report from a gate worth having are still there.
    expect(text).toContain("sync error: PGRST301 JWT expired");
  });
});
