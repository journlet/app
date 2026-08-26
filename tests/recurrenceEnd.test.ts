// An end on a repeating entry (spec §11 Q17). The maths is pure — the walk from
// the anchor, the resolution of an end date onto one of the rule's own days, and
// the two forms disagreeing — so most of this needs no document; the last two
// blocks do, and reset it the way tests/recurrence.test.ts does.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { Recurrence } from "../src/lib/types";
import {
  endClause,
  isSpent,
  lastOccurrence,
  materialiseRecurrences,
  occurrenceKey,
  occurrencesThrough,
  repeatCaption,
  ruleSentence,
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
  setRecurrenceEnd,
} from "../src/store/journal";
import { buildSpreadData } from "../src/ui/spreadData";

/** Wednesdays, weekly, from 3 June 2026. "Today" in these tests is Wed 26 Aug
 *  2026, which is the ninth of them — the prototype's own dates, so a failure
 *  here can be checked against the page it was validated on. */
const rule = (over: Partial<Recurrence> = {}): Recurrence => ({
  id: "r1",
  text: "Water the plants",
  type: "task",
  priority: false,
  everyN: 1,
  unit: "week",
  pageScope: "day",
  anchor: "2026-06-03",
  materialisedThrough: "2026-08-26",
  createdAt: 0,
  ...over,
});

const TODAY = "2026-08-26";

describe("counting occurrences", () => {
  test("the anchor is the first one, not the one before them", () => {
    expect(occurrenceKey(rule(), 1)).toBe("2026-06-03");
    expect(occurrenceKey(rule(), 2)).toBe("2026-06-10");
    expect(occurrenceKey(rule(), 13)).toBe("2026-08-26");
  });

  test("a count below one still names the anchor rather than nothing", () => {
    expect(occurrenceKey(rule(), 0)).toBe("2026-06-03");
  });

  test("come-round counts periods from the anchor, not rows in the journal", () => {
    // Thirteen Wednesdays from 3 June to 26 August inclusive.
    expect(occurrencesThrough(rule(), TODAY)).toBe(13);
    // A rule whose anchor is still ahead has had none of them.
    expect(occurrencesThrough(rule({ anchor: "2026-09-02" }), TODAY)).toBe(0);
  });
});

describe("lastOccurrence", () => {
  test("no end means no last occurrence", () => {
    expect(lastOccurrence(rule())).toBeNull();
  });

  test("a count lands on the nth occurrence", () => {
    expect(lastOccurrence(rule({ endsAfter: 14 }))).toBe("2026-09-02");
  });

  test("an end date that is one of its days is that day", () => {
    expect(lastOccurrence(rule({ endsOn: "2026-09-30" }))).toBe("2026-09-30");
  });

  test("an end date that is not one of its days resolves back to one", () => {
    // Thursday 1 October, on a Wednesday rule: the last one is 30 September,
    // because a caption naming 1 October would promise a day nothing happens on.
    expect(lastOccurrence(rule({ endsOn: "2026-10-01" }))).toBe("2026-09-30");
  });

  test("an end date before the first occurrence ends nothing", () => {
    expect(lastOccurrence(rule({ endsOn: "2026-05-01" }))).toBeNull();
  });

  test("both forms set: the earlier of the two ends wins", () => {
    // Two devices apart, one saying "until 30 September", the other "after 14".
    const earlierByDate = rule({ endsOn: "2026-08-26", endsAfter: 14 });
    expect(lastOccurrence(earlierByDate)).toBe("2026-08-26");
    const earlierByCount = rule({ endsOn: "2026-10-28", endsAfter: 14 });
    expect(lastOccurrence(earlierByCount)).toBe("2026-09-02");
  });

  test("a month-scope rule takes the whole period the date falls in", () => {
    const monthly = rule({
      unit: "month",
      pageScope: "month",
      anchor: "2026-06-15",
      materialisedThrough: "2026-08",
      endsOn: "2026-09-30",
    });
    expect(lastOccurrence(monthly)).toBe("2026-09");
  });
});

describe("isSpent", () => {
  test("a rule with no end is never spent", () => {
    expect(isSpent(rule(), TODAY)).toBe(false);
  });

  test("a rule is not spent on the day of its last occurrence", () => {
    expect(isSpent(rule({ endsOn: TODAY }), TODAY)).toBe(false);
  });

  test("a rule whose last occurrence has passed is spent", () => {
    expect(isSpent(rule({ endsOn: "2026-08-19" }), TODAY)).toBe(true);
  });

  test("a rule stopped by hand is spent whatever its end says", () => {
    expect(isSpent(rule({ endsOn: "2026-12-30", endedAt: 1 }), TODAY)).toBe(
      true
    );
  });
});

describe("what the page says", () => {
  test("a rule with no end says only what it has always said", () => {
    expect(repeatCaption(rule(), TODAY, TODAY)).toBe("repeats");
  });

  test("an end is named until the last one, which names itself", () => {
    const r = rule({ endsOn: "2026-09-30" });
    expect(repeatCaption(r, TODAY, TODAY)).toBe("repeats until 30 Sept");
    expect(repeatCaption(r, "2026-09-30", TODAY)).toBe("repeats, last one");
  });

  test("a spent rule speaks in the past, so an old page still explains itself", () => {
    const r = rule({ endsOn: "2026-08-19" });
    expect(repeatCaption(r, "2026-08-19", TODAY)).toBe("repeated until 19 Aug");
  });

  test("an entry whose rule has gone keeps the bare word", () => {
    expect(repeatCaption(undefined, TODAY, TODAY)).toBe("repeats");
  });

  test("the preview clause names the end, and the last one names itself", () => {
    const r = rule({ endsOn: "2026-09-30" });
    expect(endClause(r, "2026-09-02")).toBe(" until 30 Sept");
    expect(endClause(r, "2026-09-30")).toBe(", last one");
    expect(endClause(rule())).toBe("");
  });

  test("the sheet says a count as a count, with the date it lands on", () => {
    expect(ruleSentence(rule({ endsAfter: 18 }), TODAY)).toBe(
      "repeats every week, stops after 18 (13 have come round), last one 30 Sept"
    );
    expect(ruleSentence(rule({ endsOn: "2026-09-30" }), TODAY)).toBe(
      "repeats every week, last one 30 Sept"
    );
    expect(ruleSentence(rule(), TODAY)).toBe("repeats every week");
  });
});

describe("the materialiser stops at the end", () => {
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
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0)); // Wed 26 Aug 2026
  });
  afterAll(() => vi.useRealTimers());

  const add = (over: Partial<Recurrence> = {}) =>
    addRecurrence({
      text: "Antibiotics",
      type: "task",
      priority: false,
      everyN: 1,
      unit: "day",
      pageScope: "day",
      anchor: "2026-08-20",
      materialisedThrough: "2026-08-20",
      ...over,
    });

  const madeFor = (id: string) =>
    readAll()
      .filter((e) => e.recurrenceId === id)
      .map((e) => e.pageKey)
      .sort();

  test("nothing is made past the last occurrence", () => {
    const r = add({ endsOn: "2026-08-23" });
    materialiseRecurrences();
    expect(madeFor(r.id)).toEqual([
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });

  test("a count ends it in the same place a date would", () => {
    const r = add({ endsAfter: 4 }); // 20, 21, 22, 23 August
    materialiseRecurrences();
    expect(madeFor(r.id)).toEqual([
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });

  test("the rule is left alone rather than stamped as ended", () => {
    // Spent is derived on every read (isSpent), so nothing writes to a rule
    // nobody touched — the point of not stamping endedAt here.
    const r = add({ endsOn: "2026-08-23" });
    materialiseRecurrences();
    const after = readRecurrences().find((x) => x.id === r.id) as Recurrence;
    expect(after.endedAt).toBeUndefined();
    expect(after.materialisedThrough).toBe("2026-08-23");
    expect(isSpent(after, "2026-08-26")).toBe(true);
  });

  test("an end never removes what is already on a page", () => {
    const r = add();
    materialiseRecurrences(); // 21 to 26 August exist
    expect(madeFor(r.id)).toHaveLength(6);
    setRecurrenceEnd(r.id, { on: "2026-08-22" });
    materialiseRecurrences();
    expect(madeFor(r.id)).toHaveLength(6);
  });

  test("setting one form clears the other", () => {
    const r = add({ endsOn: "2026-08-23" });
    setRecurrenceEnd(r.id, { after: 4 });
    let after = readRecurrences().find((x) => x.id === r.id) as Recurrence;
    expect(after.endsOn).toBeUndefined();
    expect(after.endsAfter).toBe(4);
    setRecurrenceEnd(r.id, null);
    after = readRecurrences().find((x) => x.id === r.id) as Recurrence;
    expect(after.endsAfter).toBeUndefined();
    expect(lastOccurrence(after)).toBeNull();
  });
});

describe("the Scheduled ahead preview", () => {
  const preview = (r: Recurrence) =>
    buildSpreadData({}, [r], TODAY).scheduledRows.filter(
      (row) => row.kind === "rule"
    );

  test("a running rule previews its next occurrence", () => {
    const rows = preview(rule({ endsOn: "2026-09-30" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "rule" && rows[0].dayKey).toBe("2026-09-02");
  });

  test("a spent rule previews nothing at all", () => {
    expect(preview(rule({ endsOn: "2026-08-19" }))).toHaveLength(0);
  });

  test("nothing is previewed past the last occurrence", () => {
    // Today is the last one, so there is no next occurrence to show — which is
    // the silence the "last one" caption exists to announce beforehand.
    expect(preview(rule({ endsOn: TODAY }))).toHaveLength(0);
  });
});
