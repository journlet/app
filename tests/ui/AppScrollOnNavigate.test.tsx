// @vitest-environment jsdom
//
// Where a screen opens (4 September 2026).
//
// Reported from the installed app on build 8514f96: tapping the feedback row at
// the foot of a long day page opened the feedback screen part way into its own
// diagnostics box. <main style={S.paper}> is the app's only scroller and it
// lives outside every view, so nothing moved it when the view changed and each
// screen inherited the last one's offset, clamped to its own height. Older than
// the row and wider than feedback — menu, index and search all did it from a
// scrolled page — and unavoidable now that the row is at the foot of every
// screen, since tapping it on a long page means being scrolled to the bottom.
//
// What is asserted here is the offsets written to the scroller and their order,
// because jsdom has no layout: scrollTop is a property nothing clamps, so these
// tests can prove what the app asked for and not what a browser would then do
// with it. The behaviour was also measured in a real browser, in
// spec/journlet-prototype-v28-scroll-on-navigate.html.

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const snapshot = {
  status: "synced" as const,
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
vi.mock("../../src/SyncView", () => ({ default: () => <div>sync view</div> }));
vi.mock("../../src/store/usage", () => ({ serverUsage: async () => null }));
vi.mock("../../src/store/reminders", () => ({
  notificationsSupported: () => false,
  notificationPermission: () => "default",
  requestNotificationPermission: async () => "default",
}));
vi.mock("../../src/store/metrics", () => ({
  measureVolume: () => ({ docBytes: 1, entries: 1, recurrences: 0, collections: 0, habits: 0 }),
  logVolumeMetrics: () => ({ docBytes: 1, entries: 1 }),
}));

vi.mock("../../src/store/useJournal", () => ({
  useJournal: () => ({
    loaded: true,
    days: { "2026-09-04": [{ id: "e1", text: "a line on a long page", type: "task", created: 1 }] },
    collections: [],
    habits: [],
    recurrences: [],
  }),
}));

const { default: App, scrollKey } = await import("../../src/App");

// jsdom does not lay out, so scrollTop is stubbed on the prototype: reads give
// whatever was last written, and every write is recorded in order. That is
// exactly the assertion these tests want — which offset the app asked for, and
// when — and it is honest about being no evidence of what a browser then does.
let offset = 0;
let writes: number[] = [];

beforeAll(() => {
  // jsdom does not implement it, and the followed-result path calls it.
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get: () => offset,
    set: (v: number) => {
      offset = v;
      writes.push(v);
    },
  });
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

beforeEach(() => {
  offset = 0;
  writes = [];
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Somebody has read their way down a long page. */
const scrolledDownTo = (px: number) => {
  offset = px;
  writes = [];
};

const rowButton = () => screen.getByRole("button", { name: /^send feedback$/i });

describe("opening a screen from a page that was scrolled", () => {
  test("opens it at the top rather than at the last page's offset", () => {
    render(<App />);
    scrolledDownTo(226);

    fireEvent.click(rowButton());

    expect(screen.getByRole("heading", { name: /send feedback/i })).toBeTruthy();
    expect(writes.at(-1)).toBe(0);
  });

  test("and back returns to where that page was left", () => {
    render(<App />);
    scrolledDownTo(226);

    fireEvent.click(rowButton());
    expect(writes.at(-1)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    // The point of the whole change: the reason you were at the bottom of a long
    // page is that you were reading it, and feedback is a detour rather than a
    // destination.
    expect(writes.at(-1)).toBe(226);
    expect(screen.getByText(/a line on a long page/i)).toBeTruthy();
  });

  test("a page never left is opened at the top, not at nothing", () => {
    // Nothing remembered for the Menu, so the fallback has to be 0 rather than
    // undefined finding its way into scrollTop.
    render(<App />);
    scrolledDownTo(400);

    fireEvent.click(screen.getByRole("button", { name: /^menu$/i }));
    expect(writes.at(-1)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(writes.at(-1)).toBe(400);
  });
});

describe("following a search result", () => {
  // The guard inside the layout effect, and the reason it is there. A followed
  // result navigates and marks the entry in the same handler, so both land in
  // one commit, and the ref callback that scrolls the entry into view runs
  // before layout effects. Resetting the scroller in that commit would undo it
  // and leave the reader at the top of a page with a marked line somewhere
  // below — a fix for one navigation quietly breaking another.
  test("is left where it scrolled itself", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /find an entry/i }));
    fireEvent.change(screen.getByPlaceholderText(/find an entry/i), {
      target: { value: "long page" },
    });
    const before = writes.length;

    fireEvent.click(screen.getByRole("button", { name: /a line on a long page/i }));

    expect(writes.length).toBe(before);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe("what a remembered offset belongs to", () => {
  // The spread is one scrolling page holding four sections with their own
  // browsing anchors, and the view does not change when you step to another day.
  // So the key carries the anchors: a day that rolled over while you were away
  // is a miss, and a miss opens at the top.
  test("the spread's key moves with its anchors", () => {
    expect(scrollKey("spread", "2026-09-04|w|m|y")).not.toBe(
      scrollKey("spread", "2026-09-05|w|m|y")
    );
  });

  test("and every other page is keyed by itself", () => {
    expect(scrollKey("menu", "a")).toBe(scrollKey("menu", "b"));
    expect(scrollKey({ col: "reading" }, "a")).toBe(scrollKey({ col: "reading" }, "b"));
    expect(scrollKey({ col: "reading" }, "a")).not.toBe(scrollKey({ col: "house" }, "a"));
    expect(scrollKey("menu", "a")).not.toBe(scrollKey("index", "a"));
  });
});
