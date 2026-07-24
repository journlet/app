// Date/period-key helpers (src/lib/dates.ts). These underpin which page an
// entry lands on, so a regression here is a spec-level bug.

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  dkey,
  isFutureKey,
  isoWeekKey,
  keyScope,
  keyToAnchor,
  mondayOf,
  periodKey,
  shiftAnchor,
  toDate,
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
