// Derived view-model (src/ui/spreadData.ts): past/future/due lists and the
// Future log grouping. Pure logic, so tested directly in the node environment.

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { buildSpreadData } from "../src/ui/spreadData";
import { periodKey } from "../src/lib/dates";
import type { Entry, Recurrence } from "../src/lib/types";

const TODAY = "2026-07-24";

const entry = (over: Partial<Entry> & { id: string; pageKey: string }): Entry => ({
  type: "task",
  text: over.id,
  priority: false,
  state: "open",
  createdAt: 0,
  ...over,
});

// group days by pageKey the way the journal snapshot does
const asDays = (entries: Entry[]): Record<string, Entry[]> => {
  const d: Record<string, Entry[]> = {};
  for (const e of entries) (d[e.pageKey] ||= []).push(e);
  return d;
};

const dailyRule = (over: Partial<Recurrence> = {}): Recurrence => ({
  id: "r1",
  text: "Standup",
  type: "task",
  priority: false,
  everyN: 1,
  unit: "day",
  pageScope: "day",
  anchor: "2026-07-20",
  materialisedThrough: "2026-07-24",
  createdAt: 0,
  ...over,
});

test("nowKeys projects today onto each scope", () => {
  const { nowKeys } = buildSpreadData({}, [], TODAY);
  expect(nowKeys.day).toBe("2026-07-24");
  expect(nowKeys.month).toBe("2026-07");
  expect(nowKeys.year).toBe("2026");
  expect(nowKeys.week).toBe(periodKey("week", TODAY));
});

describe("pastOpen", () => {
  test("includes only open tasks on expired pages", () => {
    const days = asDays([
      entry({ id: "past-open", pageKey: "2026-07-20" }),
      entry({ id: "past-done", pageKey: "2026-07-20", state: "done" }),
      entry({ id: "past-note", pageKey: "2026-07-20", type: "note" }),
      entry({ id: "today", pageKey: "2026-07-24" }),
      entry({ id: "future", pageKey: "2026-07-28" }),
    ]);
    const { pastOpen } = buildSpreadData(days, [], TODAY);
    expect(pastOpen.map((p) => p.entry.id)).toEqual(["past-open"]);
  });
});

describe("scheduled rows and the future log", () => {
  test("later-this-month rows stay out of the future-log groups", () => {
    const days = asDays([
      entry({ id: "this-month", pageKey: "2026-07-28" }),
      entry({ id: "next-month", pageKey: "2026-08-05" }),
    ]);
    const { laterThisMonth, futureLogGroups, futureLogCount } = buildSpreadData(
      days,
      [],
      TODAY
    );
    expect(laterThisMonth.map((r) => (r.kind === "entry" ? r.entry.id : "")))
      .toContain("this-month");
    // only next month made it into the grouped future log
    expect(futureLogGroups.map((g) => g.gk)).toEqual(["2026-08"]);
    expect(futureLogCount).toBe(1);
  });

  test("an active rule adds a preview row for its next occurrence", () => {
    const { scheduledRows } = buildSpreadData({}, [dailyRule()], TODAY);
    const preview = scheduledRows.find((r) => r.kind === "rule");
    expect(preview).toBeTruthy();
    // next occurrence after today's day period is tomorrow
    expect(preview?.kind === "rule" && preview.dayKey).toBe("2026-07-25");
  });

  test("a materialised future entry suppresses the duplicate rule preview", () => {
    const rule = dailyRule();
    // a real future entry already tagged to the rule on its next-occ page
    const days = asDays([
      entry({
        id: "materialised",
        pageKey: "2026-07-25",
        recurrenceId: rule.id,
      }),
    ]);
    const { scheduledRows } = buildSpreadData(days, [rule], TODAY);
    expect(scheduledRows.filter((r) => r.kind === "rule")).toHaveLength(0);
    expect(scheduledRows.filter((r) => r.kind === "entry")).toHaveLength(1);
  });
});

describe("dueItems", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0));
  });
  afterAll(() => vi.useRealTimers());

  test("collects open entries due by end of today, earliest first", () => {
    const earlier = new Date(2026, 6, 24, 9, 0).getTime();
    const laterToday = new Date(2026, 6, 24, 18, 0).getTime();
    const tomorrow = new Date(2026, 6, 25, 9, 0).getTime();
    const days = asDays([
      entry({ id: "b", pageKey: "2026-07-24", remindAt: laterToday }),
      entry({ id: "a", pageKey: "2026-07-24", remindAt: earlier }),
      entry({ id: "future", pageKey: "2026-07-25", remindAt: tomorrow }),
      entry({
        id: "done",
        pageKey: "2026-07-24",
        remindAt: earlier,
        state: "done",
      }),
    ]);
    const { dueItems } = buildSpreadData(days, [], TODAY);
    expect(dueItems.map((d) => d.entry.id)).toEqual(["a", "b"]);
  });
});
