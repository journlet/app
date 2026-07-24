// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SpreadView from "../../src/ui/SpreadView";
import { periodKey } from "../../src/lib/dates";
import type { Scope } from "../../src/lib/dates";
import type { Entry } from "../../src/lib/types";

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

const setup = (over: Partial<Parameters<typeof SpreadView>[0]> = {}) => {
  const props = {
    renderEntry: vi.fn((e: Entry) => <li key={e.id}>{e.text}</li>),
    renderScheduledRow: vi.fn(() => null),
    pastOpen: [] as { pk: string; entry: Entry }[],
    dueItems: [] as { pk: string; entry: Entry }[],
    days: { [nowKeys.day]: [entry] } as Record<string, Entry[]>,
    anchors,
    setAnchors: vi.fn(),
    nowKeys,
    scheduledRows: [],
    laterThisMonth: [],
    futureLogCount: 0,
    onReview: vi.fn(),
    onOpenFutureLog: vi.fn(),
    ...over,
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
