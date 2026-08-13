// @vitest-environment jsdom
//
// The one thing the predicate tests cannot check: that App actually puts the
// screen in front of the journal, and that nothing gets past it.
//
// Worth a mounted test rather than another unit one, because the failure it
// guards is a wiring failure. Six screens are rendered as six independent
// conditions in one tree, and the journal's own fourteen call sites used to
// repeat the same five negations: a gate added without one of them renders the
// journal *behind* the screen meant to replace it, which type-checks, lints and
// passes every component test. This is the assertion that would not.

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const snapshot = {
  status: "signed-out" as const,
  error: null,
  linkCode: null,
  linkStage: null,
  requests: [],
  removed: false,
};

vi.mock("../../src/store/sync", () => ({
  // Signed out, with sync configured: without `isConfigured` there is nothing to
  // sign into and no gate at all, which is the development build.
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

// Not under test, and it reads half the sync store on mount. Stubbed rather than
// satisfied, so this file mocks what the gates need and nothing else.
vi.mock("../../src/ui/LinkPrompts", () => ({ default: () => null }));

// The journal itself: one entry is enough to make this a device that holds
// content, which is what divides this screen from onboarding.
vi.mock("../../src/store/useJournal", () => ({
  useJournal: () => ({
    loaded: true,
    saveState: "saved",
    days: {
      "2026-08-13": [
        {
          id: "e1",
          text: "a task from before the session lapsed",
          type: "task",
          created: 1,
        },
      ],
    },
    collections: [],
    habits: [],
    recurrences: [],
  }),
}));

// Stands in for the sign-in form. SignedOutView takes it as a child, so what
// matters here is that App passes it something, not what SyncView renders.
vi.mock("../../src/SyncView", () => ({
  default: () => <div>sync view</div>,
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
});

/** The capture bar. Present only when the journal is what is on screen. */
const launcher = () => screen.queryByRole("button", { name: /log an entry/i });

describe("a signed-out device holding a journal", () => {
  test("meets the choices instead of the journal", () => {
    render(<App />);

    expect(screen.getByText(/This device is signed out/i)).toBeTruthy();
    // The entry it holds is not on screen, and neither is the way to add
    // another. Capture is the one that would matter: an entry logged here goes
    // into a journal reaching nothing, which is the state being reported.
    expect(
      screen.queryByText(/a task from before the session lapsed/i)
    ).toBeNull();
    expect(launcher()).toBeNull();
  });

  test("and there is no way through to it", () => {
    // The version that shipped first had "keep writing on this device only" here,
    // which meant a journal readable and writable on a device with nobody signed
    // in, for as long as somebody kept tapping past this. Decision 3 says
    // otherwise, and this is the assertion that keeps it that way: the only
    // buttons on screen belong to signing in or erasing.
    render(<App />);

    for (const label of [/keep writing/i, /carry on/i, /continue/i, /not now/i, /skip/i])
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(screen.queryByText(/a task from before the session lapsed/i)).toBeNull();
    expect(launcher()).toBeNull();
  });

  test("the capture form cannot be opened behind it either", () => {
    // /?capture opens the form on launch without touching the launcher, which is
    // how an app-icon shortcut walks past a gate. An entry logged there would go
    // into a journal on a device with no account behind it.
    window.history.replaceState(null, "", "/?capture");
    render(<App />);

    // The dialog itself, by role and name, rather than a placeholder string: the
    // placeholder varies with what is being captured, and an assertion pointed at
    // it passed while the form was on screen.
    expect(screen.queryByRole("dialog", { name: /new entry/i })).toBeNull();
    expect(screen.getByText(/This device is signed out/i)).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });
});
