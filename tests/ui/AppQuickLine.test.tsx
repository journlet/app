// @vitest-environment jsdom
//
// Quick task entry, wired into the app (26 October 2026, quick capture option
// A). The component tests cover the line and where each view puts it; these
// cover what only App can: one line at a time across sections, the line
// surviving everything but Log and Cancel, "more", the "Logged" message and its
// Undo, and the two speed targets.
//
// The journal store is the real one, on fake-indexeddb (tests/setup.ts), so a
// logged task really is written and really renders. It is shared by every test
// in the file, so each test writes text of its own and looks only for that.
// The sync engine and the screens that talk to the server are stubbed, as in
// AppScrollOnNavigate.test.tsx.

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  addCollection,
  addEntry,
  readAll,
  setText,
  toggleThread,
} from "../../src/store/journal";
import { colPageKey } from "../../src/lib/types";
import { dkey, periodKey, todayKey } from "../../src/lib/dates";
import { CAPTURE_STICKY_KEY, FILTER_KEY } from "../../src/lib/storageKeys";

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

const { default: App } = await import("../../src/App");

beforeAll(() => {
  // jsdom has no matchMedia (theme, reduced motion) and no scrollIntoView
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
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const HEADING = { day: "Today", week: "This week" } as const;
type Section = keyof typeof HEADING;

const start = async () => {
  render(<App />);
  await screen.findByTestId("quick-tap-day");
};

/** A still finger tap on a section's tap area, as a phone sends it. */
const tap = (sc: Section) => {
  const el = screen.getByTestId(`quick-tap-${sc}`);
  fireEvent.pointerDown(el, { clientX: 30, clientY: 30, pointerType: "touch" });
  fireEvent.pointerUp(el, { clientX: 31, clientY: 30, pointerType: "touch" });
  fireEvent.click(el);
};
const input = (sc: Section) =>
  screen.getByLabelText(`New task, ${HEADING[sc]}`) as HTMLInputElement;
const isOpen = (sc: Section) => input(sc).closest("[hidden]") === null;
const type = (sc: Section, text: string) =>
  fireEvent.change(input(sc), { target: { value: text } });
/** The Log button on the line that is open (the closed ones are hidden). */
const logButton = () => screen.getByRole("button", { name: "Log" });
/** The one message slot. The app has other status regions (sync, install),
 *  so it is found by its test id; it is always in the page (review R-04). */
const message = () => screen.getByTestId("toast-region");
const undoButtons = () =>
  within(message()).queryAllByRole("button", { name: "Undo" });

describe("one line at a time", () => {
  test("a tap under another section opens nothing while the line has words (FR5.1, FR5.2)", async () => {
    await start();
    tap("day");
    type("day", "half a thought");
    tap("week");
    expect(isOpen("day")).toBe(true);
    expect(isOpen("week")).toBe(false);
    expect(input("day").value).toBe("half a thought");
  });

  test("an empty line moves to the new spot (FR5.3)", async () => {
    await start();
    tap("day");
    tap("week");
    expect(isOpen("day")).toBe(false);
    expect(isOpen("week")).toBe(true);
    expect(document.activeElement).toBe(input("week"));
  });

  test("the words survive a tap elsewhere and the app going to the background (FR5.4)", async () => {
    await start();
    tap("day");
    type("day", "still here");
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    input("day").blur();
    const setVisibility = (v: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: v });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(isOpen("day")).toBe(true);
    expect(input("day").value).toBe("still here");
  });
});

describe("a line belongs to its page (review R-01, R-02)", () => {
  test("is drawn only under its own page, keeps its words while away, and logs only there", async () => {
    // A link from this week's page to the day after tomorrow: following it
    // moves the day section without touching its previous or next
    const inTwoDays = new Date();
    inTwoDays.setDate(inTwoDays.getDate() + 2);
    const farDay = dkey(inTwoDays);
    const link = addEntry(periodKey("week", todayKey()), "note", "a link to two days on", false);
    toggleThread(link.id, farDay);
    await start();

    // Open a line on tomorrow's page; that section is now pinned to it
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    // what the day section now reads as, e.g. "Tue 27 Oct"
    const tomorrowLabel = screen
      .getByTestId("quick-tap-day")
      .getAttribute("aria-label")!
      .replace("Add a task to ", "");
    expect(tomorrowLabel).not.toBe("Today");
    tap("day");
    fireEvent.change(screen.getByLabelText(`New task, ${tomorrowLabel}`), {
      target: { value: "only for tomorrow" },
    });
    for (const name of ["Previous day", "Next day", "Back to current day"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);

    // Jump away along the link: the line is not drawn under the other day
    const linkRow = screen.getAllByText(/a link to two days on/)[0].closest("li")!;
    fireEvent.click(linkRow.querySelector("button.detailsToggle")!);
    expect(screen.queryByDisplayValue("only for tomorrow")).toBeNull();
    expect((screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement).disabled).toBe(false);

    // A tap here opens nothing, and says where the unfinished task is
    tap("day");
    expect(screen.getByTestId("quick-tap-day").closest("[hidden]")).toBeNull();
    expect(message().textContent).toContain(
      `Finish or cancel the task you started on ${tomorrowLabel} first`
    );
    expect(undoButtons()).toHaveLength(0);

    // Back on tomorrow, the line is there with its words, and logs there
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    const line = screen.getByDisplayValue("only for tomorrow");
    expect(line.closest("[hidden]")).toBeNull();
    fireEvent.click(logButton());
    const logged = readAll().find((e) => e.text === "only for tomorrow")!;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(logged.pageKey).toBe(dkey(tomorrow));
  });
});

// A list collection's line, driven from the app (26 October 2026, review R-07,
// R-08). Each test makes a collection of its own and a link to it from this
// week's page, which is how it gets there without the index screen.
describe("a collection's line", () => {
  const collectionWithLink = (name: string) => {
    const col = addCollection("list", name);
    const link = addEntry(periodKey("week", todayKey()), "note", `link to ${name}`, false);
    toggleThread(link.id, colPageKey(col.id));
    return col;
  };
  const followLink = (name: string) => {
    const row = screen.getAllByText(new RegExp(`link to ${name}`))[0].closest("li")!;
    fireEvent.click(row.querySelector("button.detailsToggle")!);
  };
  const tapCollection = () => {
    const el = screen.getByTestId("quick-tap-collection");
    fireEvent.pointerDown(el, { clientX: 30, clientY: 30, pointerType: "touch" });
    fireEvent.pointerUp(el, { clientX: 31, clientY: 30, pointerType: "touch" });
    fireEvent.click(el);
  };
  const colInput = (name: string) =>
    screen.getByLabelText(`New task, ${name}`) as HTMLInputElement;
  /** "back" until the home page is showing */
  const goHome = () => {
    for (let i = 0; i < 4 && !screen.queryByTestId("quick-tap-day"); i++)
      fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("quick-tap-day")).toBeTruthy();
  };

  test("logs into the collection (FR1.2, review R-08)", async () => {
    const col = collectionWithLink("Shelf one");
    await start();
    followLink("Shelf one");
    tapCollection();
    expect(document.activeElement).toBe(colInput("Shelf one"));
    fireEvent.change(colInput("Shelf one"), { target: { value: "lend Middlemarch" } });
    fireEvent.click(logButton());
    const logged = readAll().find((e) => e.text === "lend Middlemarch")!;
    expect(logged.pageKey).toBe(colPageKey(col.id));
    expect(logged.type).toBe("task");
    expect(message().textContent).toContain("Logged “lend Middlemarch” to Shelf one");
  });

  test("off screen with words in it, a tap at home is refused and the note names the collection (FR5.2, review R-08)", async () => {
    collectionWithLink("Shelf two");
    await start();
    followLink("Shelf two");
    tapCollection();
    fireEvent.change(colInput("Shelf two"), { target: { value: "half written" } });
    goHome();
    tap("day");
    expect(isOpen("day")).toBe(false);
    expect(message().textContent).toContain(
      "Finish or cancel the task you started on Shelf two first"
    );
  });

  test("deleting the collection drops its line, so the day's tap area works again (review R-07)", async () => {
    collectionWithLink("Shelf three");
    await start();
    followLink("Shelf three");
    tapCollection();
    fireEvent.change(colInput("Shelf three"), { target: { value: "stranded" } });
    fireEvent.click(screen.getByRole("button", { name: "delete collection" }));
    goHome();
    tap("day");
    expect(isOpen("day")).toBe(true);
    expect(document.activeElement).toBe(input("day"));
  });

  test("Undo of that deletion brings the line back with its words (review R-07)", async () => {
    collectionWithLink("Shelf four");
    await start();
    followLink("Shelf four");
    tapCollection();
    fireEvent.change(colInput("Shelf four"), { target: { value: "kept through undo" } });
    fireEvent.click(screen.getByRole("button", { name: "delete collection" }));
    expect(message().textContent).toContain("Collection deleted");
    fireEvent.click(within(message()).getByRole("button", { name: "Undo" }));
    goHome();
    // still blocking, because the words are still waiting
    tap("day");
    expect(isOpen("day")).toBe(false);
    followLink("Shelf four");
    expect(colInput("Shelf four").value).toBe("kept through undo");
    expect(colInput("Shelf four").closest("[hidden]")).toBeNull();
  });
});

describe("Undo after a line was started since (review R-09)", () => {
  test("Undo of a collection deletion does not overwrite a newer line with words in it (FR5.4)", async () => {
    const col = addCollection("list", "Shelf five");
    const link = addEntry(periodKey("week", todayKey()), "note", "link to Shelf five", false);
    toggleThread(link.id, colPageKey(col.id));
    await start();
    const row = screen.getAllByText(/link to Shelf five/)[0].closest("li")!;
    fireEvent.click(row.querySelector("button.detailsToggle")!);
    const tapEl = screen.getByTestId("quick-tap-collection");
    fireEvent.pointerDown(tapEl, { clientX: 30, clientY: 30, pointerType: "touch" });
    fireEvent.pointerUp(tapEl, { clientX: 31, clientY: 30, pointerType: "touch" });
    fireEvent.click(tapEl);
    fireEvent.change(screen.getByLabelText("New task, Shelf five"), {
      target: { value: "the older line" },
    });
    fireEvent.click(screen.getByRole("button", { name: "delete collection" }));
    for (let i = 0; i < 4 && !screen.queryByTestId("quick-tap-day"); i++)
      fireEvent.click(screen.getByRole("button", { name: "back" }));

    // A new line, started within the deletion's 6 seconds
    tap("day");
    type("day", "the newer line");
    fireEvent.click(within(message()).getByRole("button", { name: "Undo" }));

    expect(isOpen("day")).toBe(true);
    expect(input("day").value).toBe("the newer line");
    // and the collection is back, reachable from its link again
    await screen.findAllByText(/link to Shelf five/);
    const back = screen.getAllByText(/link to Shelf five/)[0].closest("li")!;
    expect(back.querySelector("button.detailsToggle")).not.toBeNull();
    fireEvent.click(back.querySelector("button.detailsToggle")!);
    expect(screen.getByRole("heading", { name: "Shelf five" })).toBeTruthy();
  });
});

describe("more", () => {
  test("moves the words to the full form as a task on the line's page, for that opening only (FR3.5, FR3.6)", async () => {
    // Remembered choices that differ from what "more" asks for
    const remembered = JSON.stringify({
      type: "note",
      priority: false,
      inspiration: false,
      scope: "week",
    });
    localStorage.setItem(CAPTURE_STICKY_KEY, remembered);
    await start();
    tap("day");
    type("day", "needs a date");
    fireEvent.click(screen.getByRole("button", { name: "more" }));

    expect(screen.getByDisplayValue("needs a date")).toBeTruthy();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("day");
    expect(screen.getByRole("button", { name: /task/, pressed: true })).toBeTruthy();
    expect(localStorage.getItem(CAPTURE_STICKY_KEY)).toBe(remembered);

    // Closed and opened again from the bar: its own remembered choices
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(isOpen("day")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Log an entry/ }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("week");
    expect(screen.getByRole("button", { name: /note/, pressed: true })).toBeTruthy();
    expect(localStorage.getItem(CAPTURE_STICKY_KEY)).toBe(remembered);
  });
});

describe("more, then Log in the form", () => {
  test("logs from the form without touching the remembered choices (FR3.6, review R-06)", async () => {
    const remembered = JSON.stringify({
      type: "event",
      priority: false,
      inspiration: false,
      scope: "month",
    });
    localStorage.setItem(CAPTURE_STICKY_KEY, remembered);
    await start();
    tap("day");
    type("day", "finished in the form");
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    const logged = readAll().find((e) => e.text === "finished in the form")!;
    expect(logged.type).toBe("task");
    expect(logged.pageKey).toBe(todayKey());
    expect(localStorage.getItem(CAPTURE_STICKY_KEY)).toBe(remembered);
    // and closing the form brings the remembered ones back
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: /^Log an entry/ }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("month");
    expect(screen.getByRole("button", { name: /event/, pressed: true })).toBeTruthy();
  });
});

describe("the Logged message", () => {
  test("names the task and the page, cutting long text at 39 characters (FR4.2)", async () => {
    await start();
    tap("day");
    // 45 characters
    type("day", "write the long overdue letter to aunt mildred");
    fireEvent.click(logButton());
    // the first 39 characters, then the ellipsis
    expect("write the long overdue letter to aunt m").toHaveLength(39);
    expect(message().textContent).toContain(
      "Logged “write the long overdue letter to aunt m…” to Today"
    );
    expect(readAll().some((e) => e.text === "write the long overdue letter to aunt mildred" && e.type === "task")).toBe(true);
  });

  test("a newer message replaces the older, whose Undo goes with it (FR4.5)", async () => {
    await start();
    tap("day");
    type("day", "first of two");
    fireEvent.click(logButton());
    tap("week");
    type("week", "second of two");
    fireEvent.click(logButton());
    expect(message().textContent).toContain("Logged “second of two” to This week");
    expect(message().textContent).not.toContain("first of two");
    expect(undoButtons()).toHaveLength(1);
  });

  test("Undo removes the task it names, even after it has been edited (FR4.4)", async () => {
    await start();
    tap("day");
    type("day", "about to be undone");
    fireEvent.click(logButton());
    const logged = readAll().find((e) => e.text === "about to be undone")!;
    act(() => setText(logged.id, "edited since"));
    await screen.findByText("edited since");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(readAll().some((e) => e.id === logged.id)).toBe(false);
    await waitFor(() => expect(screen.queryByText("edited since")).toBeNull());
  });

  test("shows under a filter, and leaves the filter as it was (FR4.3)", async () => {
    // Every filter there is keeps an open task, so this is the case where a
    // filter is on; the message must not depend on the row being in view
    localStorage.setItem(FILTER_KEY, "open");
    await start();
    tap("day");
    type("day", "logged under a filter");
    fireEvent.click(logButton());
    expect(message().textContent).toContain("Logged “logged under a filter” to Today");
    expect(localStorage.getItem(FILTER_KEY)).toBe("open");
  });
});

describe("speed (NFR1, NFR2)", () => {
  test("from the tap to the cursor in the line is under 0.5s", async () => {
    await start();
    const t0 = performance.now();
    tap("day");
    const elapsed = performance.now() - t0;
    expect(document.activeElement).toBe(input("day"));
    expect(elapsed).toBeLessThan(500);
  });

  test("from Log to the task on the page is under 0.5s", async () => {
    await start();
    tap("day");
    type("day", "timed from the tap on Log");
    const t0 = performance.now();
    fireEvent.click(logButton());
    const row = await screen.findByText(
      "timed from the tap on Log",
      { selector: ".etext" },
      { timeout: 500 }
    );
    expect(performance.now() - t0).toBeLessThan(500);
    // and it lands highlighted, the mark that fades over 1.6s (FR4.1)
    expect(row.closest("li")!.className).toContain("isFresh");
  });
});
