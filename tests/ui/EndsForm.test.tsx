// @vitest-environment jsdom
// The "when it ends" control (spec §11 Q17). Most of this is about the words:
// on the first day of use an end was set whose last occurrence was that same
// day, and the control reported it as flatly as it reported any other date, so
// the repeat left the future log with nothing anywhere saying why.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EndsForm, {
  endsDraftFor,
  endsSaveLabel,
  resolveEnds,
} from "../../src/ui/EndsForm";
import type { Recurrence } from "../../src/lib/types";
import type { EditEnds } from "../../src/ui/types";

afterEach(cleanup);

const TODAY = "2026-08-26"; // Wednesday
/** Weekly Wednesdays from 3 June 2026; today is the thirteenth of them. */
const rule = (over: Partial<Recurrence> = {}): Recurrence => ({
  id: "r1",
  text: "Send out the agenda",
  type: "task",
  priority: false,
  everyN: 1,
  unit: "week",
  pageScope: "day",
  anchor: "2026-06-03",
  materialisedThrough: TODAY,
  createdAt: 0,
  ...over,
});
const draft = (over: Partial<EditEnds> = {}): EditEnds => ({
  mode: "never",
  date: "2026-09-30",
  count: "25",
  ...over,
});

describe("what the draft is understood to mean", () => {
  test("never is never", () => {
    const res = resolveEnds(rule(), draft(), TODAY);
    expect(res.state).toBe("never");
    expect(res.last).toBeNull();
  });

  test("an end still ahead is an ordinary end", () => {
    const res = resolveEnds(rule(), draft({ mode: "date" }), TODAY);
    expect(res.state).toBe("later");
    expect(res.last).toBe("2026-09-30");
  });

  test("an end landing on today is named as the last one, not as a date", () => {
    const res = resolveEnds(rule(), draft({ mode: "date", date: TODAY }), TODAY);
    expect(res.state).toBe("now");
    expect(res.last).toBe(TODAY);
  });

  test("an end whose last occurrence has already gone says nothing more", () => {
    // Thursday: the rule's last Wednesday is behind us, and an end of Friday
    // adds no occurrence, so this repeat is over.
    const res = resolveEnds(
      rule(),
      draft({ mode: "date", date: "2026-08-28" }),
      "2026-08-27"
    );
    expect(res.state).toBe("past");
    expect(res.last).toBe(TODAY);
  });

  test("a count below what has come round is refused in words", () => {
    const res = resolveEnds(rule(), draft({ mode: "count", count: "2" }), TODAY);
    expect(res.state).toBe("error");
    expect(res.error).toMatch(/13 have already come round/);
  });

  test("a count at the floor is allowed, and means today is the last one", () => {
    const res = resolveEnds(
      rule(),
      draft({ mode: "count", count: "13" }),
      TODAY
    );
    expect(res.state).toBe("now");
    expect(res.last).toBe(TODAY);
  });

  test("making a repeat that would occur once is refused rather than described", () => {
    const res = resolveEnds(
      rule({ anchor: TODAY }),
      draft({ mode: "count", count: "1" }),
      TODAY,
      true
    );
    expect(res.state).toBe("error");
    expect(res.error).toMatch(/one occurrence, which is the entry you already/);
  });
});

describe("what the button says", () => {
  const label = (v: Partial<EditEnds>, today = TODAY) =>
    endsSaveLabel(resolveEnds(rule(), draft(v), today), rule());

  test("an ordinary end", () => {
    expect(label({ mode: "date" })).toBe("Save when it ends");
  });
  test("no end", () => {
    expect(label({})).toBe("Save: no end");
  });
  test("today is the last one", () => {
    expect(label({ mode: "date", date: TODAY })).toBe(
      "Save: today is the last one"
    );
  });
  test("nothing more at all", () => {
    expect(label({ mode: "date", date: "2026-08-28" }, "2026-08-27")).toBe(
      "Save: nothing more after 26 Aug"
    );
  });
  test("a week-scope rule says this week rather than today", () => {
    const weekly = rule({ pageScope: "week", unit: "week", anchor: "2026-06-03" });
    const res = resolveEnds(weekly, draft({ mode: "date", date: TODAY }), TODAY);
    expect(endsSaveLabel(res, weekly)).toBe("Save: this week is the last one");
  });
});

describe("the draft a rule opens with", () => {
  test("no end: a dozen more, with both forms naming the same day", () => {
    const d = endsDraftFor(rule(), TODAY);
    expect(d.mode).toBe("never");
    // thirteen have come round, so the twenty-fifth is a dozen further on
    expect(d.count).toBe("25");
    expect(d.date).toBe("2026-11-18");
    const byDate = resolveEnds(rule(), { ...d, mode: "date" }, TODAY);
    const byCount = resolveEnds(rule(), { ...d, mode: "count" }, TODAY);
    expect(byDate.last).toBe(byCount.last);
  });

  test("the default sits well clear of the count's floor", () => {
    const d = endsDraftFor(rule(), TODAY);
    expect(Number(d.count)).toBeGreaterThan(13 + 1);
  });

  test("an existing end is carried into both forms, so switching moves nothing", () => {
    const d = endsDraftFor(rule({ endsOn: "2026-09-30" }), TODAY);
    expect(d.mode).toBe("date");
    expect(d.date).toBe("2026-09-30");
    expect(
      resolveEnds(rule(), { ...d, mode: "count" }, TODAY).last
    ).toBe("2026-09-30");
  });
});

describe("what the box says", () => {
  const show = (v: Partial<EditEnds>, creating = false) =>
    render(
      <EndsForm
        base={rule()}
        value={draft(v)}
        onChange={vi.fn()}
        today={TODAY}
        creating={creating}
        idPrefix="t"
      />
    );

  test("an end still ahead names the occurrence", () => {
    show({ mode: "date" });
    expect(screen.getByText(/Last occurrence: Wed 30 Sept/)).toBeTruthy();
  });

  test("an end landing on today says so first, and says what survives", () => {
    show({ mode: "date", date: TODAY });
    expect(screen.getByText(/Today is the last one\./)).toBeTruthy();
    expect(screen.getByText(/What is already on a page stays/)).toBeTruthy();
  });

  test("a date that is not one of its days explains the day it moved to", () => {
    show({ mode: "date", date: "2026-10-01" });
    expect(screen.getByText(/Last occurrence: Wed 30 Sept/)).toBeTruthy();
    expect(screen.getByText(/is not one of its days/)).toBeTruthy();
  });
});
