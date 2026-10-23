// @vitest-environment jsdom
//
// Reminders on repeating items (23 October 2026, intent 261023-series-reminders).
// The rule's reminder time can now change after creation, from an occurrence
// or from the rule's own settings, and reach the occurrences that follow it
// without touching ones that carry a reminder of their own. These tests use the
// real journal document, reset between tests, with the clock pinned. jsdom only
// for the browser globals checkReminders reads (window, localStorage).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FIRED_REMINDERS_KEY } from "../src/lib/storageKeys";
import type { Recurrence } from "../src/lib/types";
import { buildSpreadData } from "../src/ui/spreadData";
import {
  addRecurrence,
  collections,
  doc,
  entries,
  habits,
  migrateEntry,
  readAll,
  readRecurrences,
  recurrences,
  setRecurrenceRemindTime,
  setReminder,
  toggleDone,
} from "../src/store/journal";
import { checkReminders } from "../src/store/reminders";
import {
  applySeriesReminder,
  materialiseRecurrences,
  remindAtForPeriod,
  remindTimeOf,
  seriesTimeLabel,
} from "../src/store/recurrence";

const reset = () =>
  doc.transact(() => {
    entries.delete(0, entries.length);
    collections.delete(0, collections.length);
    habits.delete(0, habits.length);
    recurrences.delete(0, recurrences.length);
  });

const daily = (remindTime?: string, over: Partial<Recurrence> = {}) =>
  addRecurrence({
    text: "Stretch",
    type: "task",
    priority: false,
    everyN: 1,
    unit: "day",
    pageScope: "day",
    anchor: "2026-10-20",
    materialisedThrough: "2026-10-20",
    remindTime,
    ...over,
  });

const at = (mo: number, d: number, h: number, mi = 0, y = 2026) =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

/** The rule's own occurrence on a page (never a migrated copy). */
const occ = (ruleId: string, pageKey: string) => {
  const e = readAll().find(
    (x) => x.recurrenceId === ruleId && x.pageKey === pageKey && !x.migratedFrom
  );
  if (!e) throw new Error(`no occurrence of ${ruleId} on ${pageKey}`);
  return e;
};

const ruleTime = (id: string) =>
  readRecurrences().find((r) => r.id === id)?.remindTime;

beforeEach(() => {
  reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0)); // Fri 23 Oct 2026
});
afterEach(() => vi.useRealTimers());

describe("setRecurrenceRemindTime", () => {
  test("sets, changes and clears a rule's reminder time", () => {
    const r = daily();
    expect(ruleTime(r.id)).toBeUndefined();
    setRecurrenceRemindTime(r.id, "08:30");
    expect(ruleTime(r.id)).toBe("08:30");
    setRecurrenceRemindTime(r.id, "21:00");
    expect(ruleTime(r.id)).toBe("21:00");
    setRecurrenceRemindTime(r.id, null);
    expect(ruleTime(r.id)).toBeUndefined();
  });

  test("rejects a malformed time and leaves the rule as it was", () => {
    const r = daily("08:30");
    expect(() => setRecurrenceRemindTime(r.id, "25:00")).toThrow(RangeError);
    expect(() => setRecurrenceRemindTime(r.id, "8:30")).toThrow(RangeError);
    expect(() => setRecurrenceRemindTime(r.id, "12:60")).toThrow(RangeError);
    expect(ruleTime(r.id)).toBe("08:30");
  });

  test("an unknown rule id is a no-op", () => {
    const r = daily("08:30");
    expect(() => setRecurrenceRemindTime("nope", "09:00")).not.toThrow();
    expect(readRecurrences()).toHaveLength(1);
    expect(ruleTime(r.id)).toBe("08:30");
  });
});

// Fri 23 Oct is today. A daily rule anchored on Tue 20 Oct materialises
// Wed 21, Thu 22 and Fri 23 when the materialiser runs.
const rule = (id: string) => {
  const r = readRecurrences().find((x) => x.id === id);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};

describe("applySeriesReminder from an occurrence", () => {
  // AC2.1, AC2.3
  test("adds 08:30 from today's occurrence onward and leaves earlier ones", () => {
    const r = daily();
    materialiseRecurrences();
    const today = occ(r.id, "2026-10-23");

    const changed = applySeriesReminder(r, {
      from: "2026-10-23",
      via: "entry",
      actedOnId: today.id,
      time: "08:30",
    });

    expect(changed).toEqual([today.id]);
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 8, 30));
    expect(occ(r.id, "2026-10-22").remindAt).toBeUndefined();
    expect(ruleTime(r.id)).toBe("08:30");

    vi.setSystemTime(new Date(2026, 9, 24, 7, 0, 0));
    materialiseRecurrences();
    expect(occ(r.id, "2026-10-24").remindAt).toBe(at(9, 24, 8, 30));
  });

  // AC2.2
  test("a reminder set for the evening before becomes 21:00 on each day", () => {
    const r = daily();
    materialiseRecurrences();
    const today = occ(r.id, "2026-10-23");
    const eveningBefore = at(9, 22, 21, 0);

    applySeriesReminder(r, {
      from: today.pageKey,
      via: "entry",
      actedOnId: today.id,
      time: remindTimeOf(eveningBefore),
    });

    expect(ruleTime(r.id)).toBe("21:00");
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 21, 0));
    vi.setSystemTime(new Date(2026, 9, 24, 7, 0, 0));
    materialiseRecurrences();
    expect(occ(r.id, "2026-10-24").remindAt).toBe(at(9, 24, 21, 0));
  });

  // AC2.4, AC5.2
  test("removing for the whole item clears followers and keeps an own 10:00", () => {
    const r = daily("08:30", {
      anchor: "2026-10-19",
      materialisedThrough: "2026-10-19",
    });
    materialiseRecurrences();
    setReminder(occ(r.id, "2026-10-23").id, at(9, 23, 10, 0));
    const acted = occ(r.id, "2026-10-21");

    const changed = applySeriesReminder(r, {
      from: "2026-10-21",
      via: "entry",
      actedOnId: acted.id,
      time: null,
    });

    expect(ruleTime(r.id)).toBeUndefined();
    expect(occ(r.id, "2026-10-20").remindAt).toBe(at(9, 20, 8, 30)); // earlier
    expect(occ(r.id, "2026-10-21").remindAt).toBeUndefined();
    expect(occ(r.id, "2026-10-22").remindAt).toBeUndefined();
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 10, 0)); // own
    expect(changed.sort()).toEqual(
      [acted.id, occ(r.id, "2026-10-22").id].sort()
    );
  });

  // AC5.1, AC5.3 and D3: a hand-set 08:30 cannot be told from the series one,
  // so it moves with it. That is the comparison rule, stated as a test.
  test("changing 08:30 to 09:00 keeps an own 10:00 and moves a hand-set 08:30", () => {
    const r = daily("08:30", {
      anchor: "2026-10-19",
      materialisedThrough: "2026-10-19",
    });
    materialiseRecurrences();
    const handSet = occ(r.id, "2026-10-22");
    setReminder(handSet.id, null);
    setReminder(handSet.id, at(9, 22, 8, 30));
    setReminder(occ(r.id, "2026-10-23").id, at(9, 23, 10, 0));

    applySeriesReminder(r, {
      from: "2026-10-21",
      via: "entry",
      actedOnId: occ(r.id, "2026-10-21").id,
      time: "09:00",
    });

    expect(occ(r.id, "2026-10-21").remindAt).toBe(at(9, 21, 9, 0));
    expect(occ(r.id, "2026-10-22").remindAt).toBe(at(9, 22, 9, 0));
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 10, 0));
    expect(occ(r.id, "2026-10-20").remindAt).toBe(at(9, 20, 8, 30));
  });

  // FR5.2 (review R-03): with no series reminder, any reminder is the
  // occurrence's own; after a clear, the followers follow again.
  test("own reminders survive add, clear and re-add; followers come back", () => {
    const r = daily(undefined, {
      anchor: "2026-10-19",
      materialisedThrough: "2026-10-19",
    });
    materialiseRecurrences();
    setReminder(occ(r.id, "2026-10-23").id, at(9, 23, 10, 0));
    const acted = occ(r.id, "2026-10-21").id;
    const apply = (time: string | null) =>
      applySeriesReminder(rule(r.id), {
        from: "2026-10-21",
        via: "entry",
        actedOnId: acted,
        time,
      });

    apply("08:30");
    expect(occ(r.id, "2026-10-22").remindAt).toBe(at(9, 22, 8, 30));
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 10, 0));

    apply(null);
    expect(occ(r.id, "2026-10-21").remindAt).toBeUndefined();
    expect(occ(r.id, "2026-10-22").remindAt).toBeUndefined();
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 10, 0));

    apply("09:00");
    expect(occ(r.id, "2026-10-21").remindAt).toBe(at(9, 21, 9, 0));
    expect(occ(r.id, "2026-10-22").remindAt).toBe(at(9, 22, 9, 0));
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 10, 0));
  });

  test("the acted-on occurrence changes even when completed; a later done one does not", () => {
    const r = daily("08:30", {
      anchor: "2026-10-20",
      materialisedThrough: "2026-10-20",
    });
    materialiseRecurrences();
    const acted = occ(r.id, "2026-10-21");
    toggleDone(acted.id);
    toggleDone(occ(r.id, "2026-10-22").id);

    applySeriesReminder(r, {
      from: "2026-10-21",
      via: "entry",
      actedOnId: acted.id,
      time: "09:00",
    });

    expect(occ(r.id, "2026-10-21").remindAt).toBe(at(9, 21, 9, 0));
    expect(occ(r.id, "2026-10-22").remindAt).toBe(at(9, 22, 8, 30));
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 9, 0));
  });

  test("bad calls are refused before anything is written", () => {
    const r = daily("08:30");
    materialiseRecurrences();
    const today = occ(r.id, "2026-10-23");

    expect(() =>
      applySeriesReminder(r, {
        from: "2026-10-23",
        via: "entry",
        actedOnId: today.id,
        time: "8:30",
      })
    ).toThrow(RangeError);
    expect(() =>
      applySeriesReminder(r, {
        from: "2026-10-23",
        via: "entry",
        time: "09:00",
      })
    ).toThrow(/occurrence's id/);
    expect(() =>
      applySeriesReminder(r, {
        from: "2026-10-23",
        via: "entry",
        actedOnId: "nope",
        time: "09:00",
      })
    ).toThrow(/not an occurrence/);
    expect(ruleTime(r.id)).toBe("08:30");
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 8, 30));
  });

  test("a rule that has gone changes nothing and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = daily("08:30");
    reset();
    expect(
      applySeriesReminder(r, {
        from: "2026-10-23",
        via: "settings",
        time: "09:00",
      })
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(r.id));
    warn.mockRestore();
  });
});

describe("applySeriesReminder from the repeating item's settings", () => {
  // AC3.2, AC3.3, AC3.4
  test("today's open occurrence follows, a done one and earlier days do not", () => {
    const open = daily("08:30");
    const done = daily("08:30", { text: "Read" });
    materialiseRecurrences();
    toggleDone(occ(done.id, "2026-10-23").id);

    for (const r of [open, done])
      applySeriesReminder(r, {
        from: "2026-10-23",
        via: "settings",
        time: "07:15",
      });

    expect(occ(open.id, "2026-10-23").remindAt).toBe(at(9, 23, 7, 15));
    expect(occ(open.id, "2026-10-22").remindAt).toBe(at(9, 22, 8, 30));
    expect(occ(done.id, "2026-10-23").remindAt).toBe(at(9, 23, 8, 30));
  });

  test("today not yet materialised gets the new reminder when it is made", () => {
    const r = daily(undefined, {
      anchor: "2026-10-22",
      materialisedThrough: "2026-10-22",
    });
    expect(readAll()).toHaveLength(0);

    const changed = applySeriesReminder(r, {
      from: "2026-10-23",
      via: "settings",
      time: "18:45",
    });
    expect(changed).toEqual([]);

    materialiseRecurrences();
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 18, 45));
  });
});

describe("week, month and year repeats", () => {
  // AC4.1, AC4.2, AC4.3
  test("materialise with a reminder on the Monday, the 1st and 1 January", () => {
    const week = daily("09:00", {
      unit: "week",
      pageScope: "week",
      anchor: "2026-10-05",
      materialisedThrough: "2026-W41",
    });
    const month = daily("09:00", {
      unit: "month",
      pageScope: "month",
      anchor: "2026-09-15",
      materialisedThrough: "2026-09",
    });
    const year = daily("09:00", {
      unit: "year",
      pageScope: "year",
      anchor: "2025-03-10",
      materialisedThrough: "2025",
    });

    materialiseRecurrences();

    expect(occ(week.id, "2026-W43").remindAt).toBe(at(9, 19, 9, 0));
    expect(occ(month.id, "2026-10").remindAt).toBe(at(9, 1, 9, 0));
    expect(occ(year.id, "2026").remindAt).toBe(at(0, 1, 9, 0));
    expect(seriesTimeLabel(rule(week.id))).toBe("09:00 each Monday");
    expect(seriesTimeLabel(rule(month.id))).toBe("09:00 on the 1st");
    expect(seriesTimeLabel(rule(year.id))).toBe("09:00 on 1 January");
  });

  test("labels and instants for day rules, and nothing for bad input", () => {
    const every = daily("08:30");
    const weekly = daily("08:30", { unit: "week" });
    expect(seriesTimeLabel(rule(every.id))).toBe("08:30 each day");
    expect(seriesTimeLabel(rule(weekly.id))).toBe(
      "08:30 on each day it repeats"
    );
    expect(
      seriesTimeLabel({ ...rule(every.id), remindTime: undefined })
    ).toBeUndefined();
    expect(
      remindAtForPeriod({ ...rule(every.id), remindTime: "8:30" }, "2026-10-23")
    ).toBeUndefined();
    expect(remindAtForPeriod(rule(every.id), "col:abc")).toBeUndefined();
  });
});

describe("edge cases", () => {
  class MockNotification {
    static permission: NotificationPermission = "granted";
    static fired: string[] = [];
    constructor(title: string) {
      MockNotification.fired.push(title);
    }
  }
  beforeEach(() => {
    MockNotification.fired = [];
    vi.stubGlobal("Notification", MockNotification);
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  // AC4.4, D7: set mid-week, this week's reminder is already behind us. It is
  // marked seen without a notification and shows as overdue in the Due list.
  test("a weekly reminder set on a Wednesday is overdue, not fired", async () => {
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0, 0)); // Wed 21 Oct
    const r = daily(undefined, {
      unit: "week",
      pageScope: "week",
      anchor: "2026-10-05",
      materialisedThrough: "2026-W41",
    });
    materialiseRecurrences();

    applySeriesReminder(r, {
      from: "2026-W43",
      via: "settings",
      time: "09:00",
    });
    const o = occ(r.id, "2026-W43");
    expect(o.remindAt).toBe(at(9, 19, 9, 0));

    await checkReminders();
    expect(MockNotification.fired).toEqual([]);
    const seen = JSON.parse(localStorage.getItem(FIRED_REMINDERS_KEY) ?? "{}");
    expect(seen[`rec:${r.id}:2026-W43`]).toBe(o.remindAt);

    const { dueItems } = buildSpreadData(
      { "2026-W43": [o] },
      [rule(r.id)],
      "2026-10-21"
    );
    expect(dueItems.map((d) => d.entry.id)).toEqual([o.id]);
  });

  test("a migrated copy is never changed", () => {
    const r = daily("08:30");
    materialiseRecurrences();
    const yesterday = occ(r.id, "2026-10-22");
    migrateEntry(yesterday.id, "2026-10-23");
    const copy = readAll().find((e) => e.migratedFrom === yesterday.id);
    expect(copy?.remindAt).toBe(at(9, 22, 8, 30));

    const changed = applySeriesReminder(r, {
      from: "2026-10-23",
      via: "settings",
      time: "09:00",
    });

    expect(changed).toEqual([occ(r.id, "2026-10-23").id]);
    expect(readAll().find((e) => e.id === copy?.id)?.remindAt).toBe(
      at(9, 22, 8, 30)
    );
    expect(() =>
      applySeriesReminder(rule(r.id), {
        from: "2026-10-23",
        via: "entry",
        actedOnId: copy?.id,
        time: "10:00",
      })
    ).toThrow(/not an occurrence/);
  });

  // AC1.3: "only this entry" is the existing one-entry write.
  test("this entry only changes one occurrence and leaves the rule", () => {
    const r = daily("08:30", {
      anchor: "2026-10-19",
      materialisedThrough: "2026-10-19",
    });
    materialiseRecurrences();
    setReminder(occ(r.id, "2026-10-22").id, at(9, 22, 20, 0));

    expect(ruleTime(r.id)).toBe("08:30");
    expect(occ(r.id, "2026-10-22").remindAt).toBe(at(9, 22, 20, 0));
    expect(occ(r.id, "2026-10-21").remindAt).toBe(at(9, 21, 8, 30));
    expect(occ(r.id, "2026-10-23").remindAt).toBe(at(9, 23, 8, 30));
  });
});
