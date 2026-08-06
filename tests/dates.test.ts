// Date/period-key helpers (src/lib/dates.ts). These underpin which page an
// entry lands on, so a regression here is a spec-level bug.

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  defaultRemindAt,
  dkey,
  isFutureKey,
  isoWeekKey,
  keyScope,
  keyToAnchor,
  mondayOf,
  monthGrid,
  periodKey,
  periodName,
  shiftAnchor,
  toDate,
  weeksOfMonth,
  todayKey,
} from "../src/lib/dates";

describe("dkey / toDate", () => {
  test("dkey zero-pads month and day", () => {
    expect(dkey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dkey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  test("toDate -> dkey round trips", () => {
    for (const k of ["2026-01-05", "2026-07-24", "2026-12-31"]) {
      expect(dkey(toDate(k))).toBe(k);
    }
  });
});

describe("keyScope", () => {
  test("classifies a key by its shape", () => {
    expect(keyScope("2026-07-24")).toBe("day");
    expect(keyScope("2026-W29")).toBe("week");
    expect(keyScope("2026-07")).toBe("month");
    expect(keyScope("2026")).toBe("year");
  });

  test("returns null for a collection page key", () => {
    expect(keyScope("col:abc123")).toBeNull();
  });
});

describe("periodKey", () => {
  test("projects a day anchor onto each scope", () => {
    expect(periodKey("day", "2026-07-24")).toBe("2026-07-24");
    expect(periodKey("month", "2026-07-24")).toBe("2026-07");
    expect(periodKey("year", "2026-07-24")).toBe("2026");
    expect(periodKey("week", "2026-07-24")).toBe(isoWeekKey("2026-07-24"));
  });
});

describe("isoWeekKey", () => {
  test("1 Jan 2026 (a Thursday) is ISO week 2026-W01", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  test("mondayOf returns the Monday of the containing week", () => {
    // 24 Jul 2026 is a Friday; its Monday is the 20th.
    expect(dkey(mondayOf("2026-07-24"))).toBe("2026-07-20");
  });
});

describe("isFutureKey", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0)); // 24 Jul 2026
  });
  afterAll(() => vi.useRealTimers());

  test("todayKey reflects the mocked clock", () => {
    expect(todayKey()).toBe("2026-07-24");
  });

  test("a later day/month/year is in the future", () => {
    expect(isFutureKey("2026-07-25")).toBe(true);
    expect(isFutureKey("2026-08")).toBe(true);
    expect(isFutureKey("2027")).toBe(true);
  });

  test("today and earlier are not in the future", () => {
    expect(isFutureKey("2026-07-24")).toBe(false);
    expect(isFutureKey("2026-07-23")).toBe(false);
    expect(isFutureKey("2026")).toBe(false); // current year, not ahead
    expect(isFutureKey("2025")).toBe(false);
  });

  test("an unrecognised key shape is never future", () => {
    expect(isFutureKey("col:abc")).toBe(false);
  });
});

describe("shiftAnchor", () => {
  test("steps a day anchor by whole days", () => {
    expect(shiftAnchor("day", "2026-07-24", 1)).toBe("2026-07-25");
    expect(shiftAnchor("day", "2026-07-24", -1)).toBe("2026-07-23");
  });

  test("steps a week anchor by seven days", () => {
    expect(shiftAnchor("week", "2026-07-24", 1)).toBe("2026-07-31");
  });

  test("month step normalises to the first of the month", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
  });

  test("year step moves whole years", () => {
    expect(shiftAnchor("year", "2026-07-24", -1)).toBe("2025-07-24");
  });
});

describe("keyToAnchor", () => {
  test("returns a day inside the page the key refers to", () => {
    expect(keyToAnchor("2026-07-24")).toBe("2026-07-24");
    expect(keyToAnchor("2026-07")).toBe("2026-07-01");
    expect(keyToAnchor("2026")).toBe("2026-01-01");
    // week -> its Monday
    expect(keyToAnchor("2026-W01")).toBe("2025-12-29");
  });
});

describe("defaultRemindAt", () => {
  // A reminder defaults to the day the entry is written for, not the day the
  // sheet was opened. Bug: a task on tomorrow's page prefilled today, so it
  // fired early and showed up in Due before it was due.
  const at = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m - 1, d, h, min).getTime();

  test("future day page prefills that day at 09:00", () => {
    const now = at(2026, 7, 27, 14, 20);
    expect(defaultRemindAt("2026-07-28", now)).toBe(at(2026, 7, 28, 9));
  });

  test("today's page before 09:00 still prefills 09:00 today", () => {
    const now = at(2026, 7, 27, 6, 30);
    expect(defaultRemindAt("2026-07-27", now)).toBe(at(2026, 7, 27, 9));
  });

  test("today's page after 09:00 falls back to an hour from now", () => {
    const now = at(2026, 7, 27, 14, 20);
    expect(defaultRemindAt("2026-07-27", now)).toBe(now + 3600_000);
  });

  test("past page falls back to an hour from now, never a past instant", () => {
    const now = at(2026, 7, 27, 14, 20);
    const got = defaultRemindAt("2026-07-20", now);
    expect(got).toBe(now + 3600_000);
    expect(got).toBeGreaterThan(now);
  });

  test("week and month pages anchor to the first day of the period", () => {
    const now = at(2026, 7, 27, 14, 20);
    // 2026-W32 starts Monday 3 August
    expect(defaultRemindAt("2026-W32", now)).toBe(at(2026, 8, 3, 9));
    expect(defaultRemindAt("2026-08", now)).toBe(at(2026, 8, 1, 9));
    expect(defaultRemindAt("2027", now)).toBe(at(2027, 1, 1, 9));
  });

  test("an unrecognisable key falls back rather than throwing", () => {
    const now = at(2026, 7, 27, 14, 20);
    expect(defaultRemindAt("not-a-key", now)).toBe(now + 3600_000);
  });
});

describe("periodName", () => {
  test("names the page a day falls in, at each scope", () => {
    expect(periodName("day", "2026-08-12")).toBe("Wed, 12 Aug 2026");
    // a week number alone doesn't say which days it covers, so both are given
    expect(periodName("week", "2026-08-12")).toBe("Week 33 · 10 Aug – 16 Aug");
    expect(periodName("month", "2026-08-12")).toBe("August 2026");
    expect(periodName("year", "2026-08-12")).toBe("2026");
  });

  test("every day in a period names the same page", () => {
    expect(periodName("week", "2026-08-10")).toBe(periodName("week", "2026-08-16"));
    expect(periodName("month", "2026-08-01")).toBe(periodName("month", "2026-08-31"));
  });
});

describe("month grid and weeks of a month (ui/PeriodChooser)", () => {
  test("a month grid is always six Monday-first rows", () => {
    const g = monthGrid("2026-08-12");
    expect(g).toHaveLength(42);
    // August 2026 starts on a Saturday, so the grid opens on 27 July
    expect(g[0]).toBe("2026-07-27");
    expect(g[6]).toBe("2026-08-02");
    expect(g).toContain("2026-08-31");
  });

  test("every day of the month is in its grid, whatever the month", () => {
    for (const m of ["2026-02-01", "2026-05-01", "2027-01-01"]) {
      const g = monthGrid(m);
      const inMonth = g.filter((d) => d.slice(0, 7) === m.slice(0, 7));
      expect(inMonth[0]).toBe(`${m.slice(0, 7)}-01`);
      expect(new Set(g).size).toBe(42);
    }
  });

  test("weeks of a month are Mondays, including the ones that straddle it", () => {
    const w = weeksOfMonth("2026-08-12");
    expect(w[0]).toBe("2026-07-27"); // week 31 covers 27 Jul – 2 Aug
    expect(w[w.length - 1]).toBe("2026-08-31"); // week 36 runs into September
    expect(w.every((d) => toDate(d).getDay() === 1)).toBe(true);
  });
});
