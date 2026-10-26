// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SpreadView from "../../src/ui/SpreadView";
import QuickLine from "../../src/ui/QuickLine";
import { TAP_AREA_MIN_PX } from "../../src/ui/quickTap";
import { periodKey } from "../../src/lib/dates";
import type { Scope } from "../../src/lib/dates";
import type { Entry, Recurrence } from "../../src/lib/types";
import type { EntryFilter } from "../../src/lib/filter";
import type { ScheduledRow } from "../../src/ui/types";

afterEach(cleanup);

const anchor = "2026-07-24";
const anchors: Record<Scope, string> = {
  day: anchor,
  week: anchor,
  month: anchor,
  year: anchor,
};
// nowKeys built from the same anchor so every section reads as "current".
const nowKeys: Record<Scope, string> = {
  day: periodKey("day", anchor),
  week: periodKey("week", anchor),
  month: periodKey("month", anchor),
  year: periodKey("year", anchor),
};

const entry: Entry = {
  id: "e1",
  type: "task",
  text: "on today's page",
  priority: false,
  state: "open",
  pageKey: nowKeys.day,
  createdAt: 0,
};

type Props = Parameters<typeof SpreadView>[0];

/**
 * The render callbacks and handlers as spies, kept out of the overridable set.
 *
 * `renderEntry` now declares all three parameters the component passes it. It
 * used to declare only the entry, so `mock.calls.map(([e]) => e.id)` fell back
 * to `any` and the property being read was never checked. Spreading `over` on
 * top of the spies also widened them to "spy, or the real prop signature",
 * which is why `.mock` did not typecheck.
 */
const spies = () => ({
  renderEntry: vi.fn((e: Entry, _pk: string, _sc: Scope | null) => (
    <li key={e.id}>{e.text}</li>
  )),
  renderScheduledRow: vi.fn((_row: ScheduledRow, _grouped: boolean) => null),
  renderThreadedHere: vi.fn(() => null),
  setAnchors: vi.fn(),
  onToggleFold: vi.fn(),
  onReview: vi.fn(),
  onOpenFutureLog: vi.fn(),
});

const setup = (
  over: Partial<Omit<Props, keyof ReturnType<typeof spies>>> = {}
) => {
  const props = {
    pastOpen: [] as { pk: string; entry: Entry }[],
    dueItems: [] as { pk: string; entry: Entry }[],
    days: { [nowKeys.day]: [entry] } as Record<string, Entry[]>,
    anchors,
    nowKeys,
    scheduledRows: [],
    laterThisMonth: [],
    futureLogCount: 0,
    folds: {} as Record<string, boolean>,
    filter: "all" as const,
    order: "logged" as const,
    filterRow: <div data-testid="filter-row">filter row</div>,
    ...over,
    ...spies(),
  };
  render(<SpreadView {...props} />);
  return props;
};

test("renders the four current scope sections", () => {
  setup();
  expect(screen.getByText("Today")).toBeTruthy();
  expect(screen.getByText("This week")).toBeTruthy();
  expect(screen.getByText("This month")).toBeTruthy();
  expect(screen.getByText("This year")).toBeTruthy();
});

test("delegates entry rendering and shows empty sections", () => {
  const props = setup();
  // the one entry lives on the day page
  expect(props.renderEntry).toHaveBeenCalledWith(entry, nowKeys.day, "day");
  // week/month/year pages are empty
  expect(screen.getAllByText("nothing logged")).toHaveLength(3);
});

test("past-tasks banner appears and triggers review", () => {
  const props = setup({
    pastOpen: [{ pk: "2026-07-01", entry }],
  });
  fireEvent.click(screen.getByText(/open task.*from\s+past pages/i));
  expect(props.onReview).toHaveBeenCalledTimes(1);
});

test("Due section renders when there are due items", () => {
  setup({ dueItems: [{ pk: nowKeys.day, entry }] });
  expect(screen.getByText("Due")).toBeTruthy();
});

// The Due section is the second renderEntry call site and its scope is derived
// from the row's own page key, not from the section being drawn. Nothing
// asserted that until the spy declared the parameters it is actually passed.
test("a Due row carries its own page key and the scope that key implies", () => {
  const props = setup({ dueItems: [{ pk: "2026-06", entry }], days: {} });
  expect(props.renderEntry).toHaveBeenCalledTimes(1);
  expect(props.renderEntry).toHaveBeenCalledWith(entry, "2026-06", "month");
});

test("stepping a section forward updates the anchors", () => {
  const props = setup();
  fireEvent.click(screen.getAllByRole("button", { name: /Next/ })[0]);
  expect(props.setAnchors).toHaveBeenCalledTimes(1);
});

test("Future log link appears and opens the future log", () => {
  const props = setup({ futureLogCount: 3 });
  fireEvent.click(screen.getByText("Future log"));
  expect(props.onOpenFutureLog).toHaveBeenCalledTimes(1);
});

// The filter (remediation item 7). The point of it is the one thing Gary
// asked for: see what is still outstanding, without the done work in the way.
describe("filter", () => {
  const done: Entry = {
    ...entry,
    id: "e2",
    text: "already done",
    state: "done",
  };
  const note: Entry = { ...entry, id: "e3", text: "a note", type: "note" };

  const setupWith = (filter: EntryFilter) =>
    setup({
      filter,
      days: { [nowKeys.day]: [entry, done, note] },
    });

  test("'all' shows everything on the page", () => {
    const props = setupWith("all");
    expect(props.renderEntry).toHaveBeenCalledTimes(3);
  });

  test("'open only' hides the completed task and keeps the note", () => {
    const props = setupWith("open");
    const shown = props.renderEntry.mock.calls.map(([e]) => e.id);
    expect(shown).toEqual(["e1", "e3"]);
  });

  test("'tasks only' hides the note and keeps both tasks", () => {
    const props = setupWith("tasks");
    const shown = props.renderEntry.mock.calls.map(([e]) => e.id);
    expect(shown).toEqual(["e1", "e2"]);
  });

  test("a hidden parent is kept as context for a sub-bullet that survives", () => {
    const parent: Entry = { ...entry, id: "p", text: "parent", state: "done" };
    const child: Entry = { ...entry, id: "c", text: "child", parentId: "p" };
    const props = setup({
      filter: "open",
      days: { [nowKeys.day]: [parent, child] },
    });
    // the completed parent stays so the indented child is not orphaned
    expect(props.renderEntry.mock.calls.map(([e]) => e.id)).toEqual(["p", "c"]);
  });

  test("a section emptied by the filter says how many are hidden, not 'nothing logged'", () => {
    setup({ filter: "open", days: { [nowKeys.day]: [done] } });
    expect(screen.getByText(/1 entry hidden by the filter/)).toBeTruthy();
    // the three genuinely empty sections still read as empty
    expect(screen.getAllByText("nothing logged")).toHaveLength(3);
  });

  test("a completed entry with a stale reminder drops out of Due", () => {
    setup({ filter: "open", dueItems: [{ pk: nowKeys.day, entry: done }] });
    expect(screen.queryByText("Due")).toBeNull();
  });
});

// Ordering, corrected after seeing it on device (4 Aug 2026): the filter row
// went in above every banner, which split the alerts into two groups either
// side of a control. Alerts first, then the way you are reading the page, then
// the page.
test("the filter row sits after the review banner and before the journal", () => {
  setup({
    pastOpen: [{ pk: "2026-07-01", entry }],
    dueItems: [{ pk: nowKeys.day, entry }],
  });
  const banner = screen.getByText(/open task.*from\s+past pages/i).closest("button")!;
  const row = screen.getByTestId("filter-row");
  const due = screen.getByText("Due");
  // Node.compareDocumentPosition: 4 = the argument follows the reference node
  expect(banner.compareDocumentPosition(row) & 4).toBeTruthy();
  expect(row.compareDocumentPosition(due) & 4).toBeTruthy();
});

// "Later this month" (spec §11 Q19). The section is one line per active
// repeating rule most months, which put twelve grid rows of chores between the
// month's own intentions and This Year. What folds is what the app predicted;
// what you dated by hand never folds.
describe("later this month", () => {
  const rule = (id: string): Recurrence => ({
    id,
    text: id,
    type: "task",
    priority: false,
    everyN: 1,
    unit: "week",
    pageScope: "day",
    anchor: "2026-07-24",
    materialisedThrough: "2026-07-24",
    createdAt: 0,
  });
  const preview = (id: string): ScheduledRow => ({
    kind: "rule",
    sort: "2026-07-28",
    dayKey: "2026-07-28",
    rule: rule(id),
  });
  const dated = (id: string): ScheduledRow => ({
    kind: "entry",
    sort: "2026-07-28",
    pk: "2026-07-28",
    entry: { ...entry, id, text: id, pageKey: "2026-07-28" },
  });
  const foldKey = `later:${nowKeys.month}`;
  const shown = (props: ReturnType<typeof setup>) =>
    props.renderScheduledRow.mock.calls.map(([r]) =>
      r.kind === "entry" ? r.entry.id : r.rule.id
    );

  test("repeats start folded, with a count and the label saying what they are", () => {
    const props = setup({ laterThisMonth: [preview("bins"), preview("shop")] });
    expect(screen.getByText("Later this month · repeating")).toBeTruthy();
    expect(screen.getByRole("button", { name: /2 items · show/ })).toBeTruthy();
    expect(shown(props)).toEqual([]);
  });

  test("unfolded, the previews render", () => {
    const props = setup({
      laterThisMonth: [preview("bins"), preview("shop")],
      folds: { [foldKey]: false },
    });
    expect(shown(props)).toEqual(["bins", "shop"]);
    expect(screen.getByRole("button", { name: /2 items · hide/ })).toBeTruthy();
  });

  test("tapping it asks App to unfold, carrying folded-by-default", () => {
    const props = setup({ laterThisMonth: [preview("bins")] });
    fireEvent.click(screen.getByRole("button", { name: /1 item · show/ }));
    expect(props.onToggleFold).toHaveBeenCalledWith(foldKey, true);
  });

  test("a row dated by hand stays on the page while the repeats fold", () => {
    const props = setup({
      laterThisMonth: [dated("dentist"), preview("bins")],
    });
    expect(shown(props)).toEqual(["dentist"]);
    expect(screen.getByText("Later this month")).toBeTruthy();
    expect(screen.getByText("Repeating, later this month")).toBeTruthy();
  });

  test("a migrated copy counts as written, not as a repeat (§11 Q15)", () => {
    const copy: ScheduledRow = {
      kind: "entry",
      sort: "2026-07-28",
      pk: "2026-07-28",
      entry: {
        ...entry,
        id: "copy",
        pageKey: "2026-07-28",
        recurrenceId: "r1",
        migratedFrom: "mon",
      },
    };
    const props = setup({ laterThisMonth: [copy, preview("bins")] });
    expect(shown(props)).toEqual(["copy"]);
  });

  test("nothing is drawn when the filter empties the group", () => {
    const done: Entry = { ...entry, id: "d", state: "done", pageKey: "2026-07-28" };
    setup({
      filter: "open",
      laterThisMonth: [{ kind: "entry", sort: "2026-07-28", pk: "2026-07-28", entry: done }],
    });
    expect(screen.queryByText(/Later this month/)).toBeNull();
  });
});

// Quick task entry, add in place (26 October 2026, quick capture option A).
// The line itself is QuickLine's business and App's; what the spread owns is
// where each section's line goes, which sections get one, and the navigation
// it locks. The real QuickLine is drawn, closed, so the tests read the page a
// person would.
describe("quick task line", () => {
  const quickLine = (
    sc: Scope,
    _pk: string,
    heading: string,
    emptyText: string | null
  ) => (
    <QuickLine
      sectionKey={sc}
      pageLabel={heading}
      open={false}
      text=""
      emptyText={emptyText}
      onOpen={() => {}}
      onChangeText={() => {}}
      onLog={() => {}}
      onCancel={() => {}}
      onMore={() => {}}
    />
  );
  // Node.compareDocumentPosition: 4 = the argument follows the reference node
  const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & 4) !== 0;

  test("sits under the section's own entries, above what is drawn from elsewhere (FR1.1)", () => {
    const later: ScheduledRow = {
      kind: "entry",
      sort: "2026-07-28",
      pk: "2026-07-28",
      entry: { ...entry, id: "l1", text: "later on", pageKey: "2026-07-28" },
    };
    const monthEntry: Entry = { ...entry, id: "m1", text: "month goal", pageKey: nowKeys.month };
    setup({
      renderQuickLine: quickLine,
      days: { [nowKeys.day]: [entry], [nowKeys.month]: [monthEntry] },
      laterThisMonth: [later],
    });
    expect(follows(screen.getByText("on today's page"), screen.getByTestId("quick-tap-day"))).toBe(true);
    const monthTap = screen.getByTestId("quick-tap-month");
    expect(follows(screen.getByText("month goal"), monthTap)).toBe(true);
    expect(follows(monthTap, screen.getByText("Later this month"))).toBe(true);
  });

  test("the tap area is a visible \"+ add a task\" row (27 October 2026)", () => {
    setup({ renderQuickLine: quickLine });
    const tap = screen.getByTestId("quick-tap-day");
    expect(tap.tagName).toBe("BUTTON");
    expect(tap.textContent).toBe("+add a task");
  });

  test("an empty section shows the add row instead of \"nothing logged\" (FR1.3)", () => {
    setup({ renderQuickLine: quickLine, days: {} });
    expect(screen.getByTestId("quick-tap-day").textContent).toBe("+add a task");
    // all four sections are current, so none says "nothing logged" as well
    expect(screen.queryAllByText("nothing logged")).toHaveLength(0);
  });

  test("the filter's note stays, as plain text above the add row (FR1.3)", () => {
    const done: Entry = { ...entry, state: "done" };
    setup({ renderQuickLine: quickLine, filter: "open", days: { [nowKeys.day]: [done] } });
    const note = screen.getByText("nothing matching — 1 entry hidden by the filter");
    expect(note.tagName).not.toBe("BUTTON");
    expect(follows(note, screen.getByTestId("quick-tap-day"))).toBe(true);
  });

  test("a section showing a past period has none, and its empty text stays plain (FR1.6)", () => {
    setup({
      renderQuickLine: quickLine,
      days: {},
      anchors: { ...anchors, day: "2026-07-20" },
    });
    expect(screen.queryByTestId("quick-tap-day")).toBeNull();
    // the other three are still current
    expect(screen.getByTestId("quick-tap-week")).toBeTruthy();
    // three tap areas wear the words; the past day's are plain text
    const plain = screen
      .getAllByText("nothing logged")
      .filter((el) => el.tagName !== "BUTTON");
    expect(plain).toHaveLength(1);
  });

  test("previous and next are disabled in the section with a line open, and only there (FR5.5)", () => {
    setup({ renderQuickLine: quickLine, quickPage: nowKeys.day });
    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(disabled("Previous day")).toBe(true);
    expect(disabled("Next day")).toBe(true);
    expect(disabled("Previous week")).toBe(false);
    expect(disabled("Next week")).toBe(false);
  });

  test("so is \"back to now\", so a future page cannot slide away from under the line (FR5.5, review R-01)", () => {
    const tomorrow = periodKey("day", "2026-07-25");
    setup({
      renderQuickLine: quickLine,
      anchors: { ...anchors, day: "2026-07-25" },
      quickPage: tomorrow,
    });
    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(disabled("Back to current day")).toBe(true);
    expect(disabled("Previous day")).toBe(true);
    expect(disabled("Next day")).toBe(true);
  });

  test("a section moved off the line's page some other way is not locked, so the way back is open (review R-01)", () => {
    // The line is on the 25th; a jump to an entry's page has put the day
    // section on the 26th, where the line is not drawn
    setup({
      renderQuickLine: quickLine,
      anchors: { ...anchors, day: "2026-07-26" },
      quickPage: periodKey("day", "2026-07-25"),
    });
    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(disabled("Previous day")).toBe(false);
    expect(disabled("Back to current day")).toBe(false);
  });

  test("each tap area is a button named for its page (NFR5)", () => {
    setup({ renderQuickLine: quickLine });
    for (const name of [
      "Add a task to Today",
      "Add a task to This week",
      "Add a task to This month",
      "Add a task to This year",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  test("the tap area is at least one 33px dot row high and spans the list (FR1.5)", () => {
    setup({ renderQuickLine: quickLine });
    const tap = screen.getByTestId("quick-tap-day");
    expect(parseFloat(tap.style.height)).toBeGreaterThanOrEqual(TAP_AREA_MIN_PX);
    expect(tap.style.width).toBe("100%");
  });
});
