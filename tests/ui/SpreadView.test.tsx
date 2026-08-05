// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SpreadView from "../../src/ui/SpreadView";
import { periodKey } from "../../src/lib/dates";
import type { Scope } from "../../src/lib/dates";
import type { Entry } from "../../src/lib/types";
import type { EntryFilter } from "../../src/lib/filter";

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
  renderScheduledRow: vi.fn(() => null),
  renderThreadedHere: vi.fn(() => null),
  setAnchors: vi.fn(),
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
    filter: "all" as const,
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
