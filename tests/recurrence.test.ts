// Recurrence engine (src/store/recurrence.ts). nextOccurrence is pure; the
// materialiser writes to the shared journal doc, so those tests reset it and
// pin the clock.

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Recurrence } from "../src/lib/types";
import {
  materialiseRecurrences,
  nextOccurrence,
  skipOccurrence,
} from "../src/store/recurrence";
import {
  addRecurrence,
  collections,
  doc,
  entries,
  habits,
  readAll,
  readRecurrences,
  recurrences,
} from "../src/store/journal";

const rule = (over: Partial<Recurrence>): Recurrence => ({
  id: "r1",
  text: "Standup",
  type: "task",
  priority: false,
  everyN: 1,
  unit: "day",
  pageScope: "day",
  anchor: "2026-01-01",
  materialisedThrough: "2026-01-01",
  createdAt: 0,
  ...over,
});

describe("nextOccurrence", () => {
  test("daily rule steps one day past `after`", () => {
    const r = rule({ unit: "day", everyN: 1, anchor: "2026-01-01" });
    expect(nextOccurrence(r, "2026-01-01")).toBe("2026-01-02");
    expect(nextOccurrence(r, "2026-01-05")).toBe("2026-01-06");
  });

  test("every-3-day cadence lands on the right day", () => {
    const r = rule({ unit: "day", everyN: 3, anchor: "2026-01-01" });
    expect(nextOccurrence(r, "2026-01-01")).toBe("2026-01-04");
  });

  test("monthly cadence on day pages clamps to the last valid day", () => {
    // 31 Jan has no 31 Feb: February 2026 has 28 days.
    const r = rule({
      unit: "month",
      everyN: 1,
      anchor: "2026-01-31",
      pageScope: "day",
    });
    expect(nextOccurrence(r, "2026-01-31")).toBe("2026-02-28");
  });

  test("monthly rule on month pages returns a month key", () => {
    const r = rule({
      unit: "month",
      everyN: 1,
      anchor: "2026-01-15",
      pageScope: "month",
      materialisedThrough: "2026-01",
    });
    expect(nextOccurrence(r, "2026-01")).toBe("2026-02");
  });

  test("yearly rule on year pages returns a year key", () => {
    const r = rule({
      unit: "year",
      everyN: 1,
      anchor: "2026-03-10",
      pageScope: "year",
      materialisedThrough: "2026",
    });
    expect(nextOccurrence(r, "2026")).toBe("2027");
  });
});

describe("materialiseRecurrences", () => {
  const reset = () =>
    doc.transact(() => {
      entries.delete(0, entries.length);
      collections.delete(0, collections.length);
      habits.delete(0, habits.length);
      recurrences.delete(0, recurrences.length);
    });

  beforeEach(reset);
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0)); // 24 Jul 2026
  });
  afterAll(() => vi.useRealTimers());

  test("fills every due day up to today and advances the rule", () => {
    const r = addRecurrence({
      text: "Standup",
      type: "task",
      priority: false,
      everyN: 1,
      unit: "day",
      pageScope: "day",
      anchor: "2026-07-20",
      materialisedThrough: "2026-07-20",
    });

    materialiseRecurrences();

    const made = readAll()
      .filter((e) => e.recurrenceId === r.id)
      .map((e) => e.pageKey)
      .sort();
    expect(made).toEqual([
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
    ]);
    expect(readAll().every((e) => e.state === "open")).toBe(true);
    expect(readRecurrences()[0].materialisedThrough).toBe("2026-07-24");
  });

  test("is idempotent: a second pass creates nothing new", () => {
    addRecurrence({
      text: "Standup",
      type: "task",
      priority: false,
      everyN: 1,
      unit: "day",
      pageScope: "day",
      anchor: "2026-07-20",
      materialisedThrough: "2026-07-20",
    });
    materialiseRecurrences();
    const first = readAll().length;
    materialiseRecurrences();
    expect(readAll().length).toBe(first);
  });

  test("a skipped occurrence stays struck and is never recreated", () => {
    const r = addRecurrence({
      text: "Standup",
      type: "task",
      priority: false,
      everyN: 1,
      unit: "day",
      pageScope: "day",
      anchor: "2026-07-20",
      materialisedThrough: "2026-07-20",
    });

    skipOccurrence(r, "2026-07-22");
    materialiseRecurrences();

    const onDay = readAll().filter((e) => e.pageKey === "2026-07-22");
    expect(onDay).toHaveLength(1);
    expect(onDay[0].state).toBe("struck");
  });
});
