// @vitest-environment jsdom
//
// Collection pages (spec §4.4): a list logged like the journal, or a habit grid.
//
// Untested until 28 August 2026, and the streak is the reason that mattered. It
// carries a product decision that looks like an off-by-one and is not: a day not
// yet ticked does not break the run, because a tracker read at breakfast should
// not tell you that you have lost a fortnight's streak by not having done the
// thing yet. Somebody tidying that `continue` away would be fixing a bug that
// isn't one, and nothing would have failed.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CollectionView from "../../src/CollectionView";
import { dkey } from "../../src/lib/dates";
import type { Collection, Entry, Habit } from "../../src/lib/types";
import type { EntryFilter } from "../../src/lib/filter";

// The page writes through the store for habits; the entry rows are handed in.
vi.mock("../../src/store/journal", () => ({
  addHabit: vi.fn(),
  toggleHabitMark: vi.fn(),
}));

import { addHabit, toggleHabitMark } from "../../src/store/journal";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

/** A local date key `n` days before today, which is how marks are keyed. */
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dkey(d);
};

const marksFor = (...offsets: number[]): Record<string, true> =>
  Object.fromEntries(offsets.map((o) => [daysAgo(o), true as const]));

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: "h1",
  collectionId: "c1",
  name: "Read",
  createdAt: 1,
  marks: {},
  ...over,
});

const tracker: Collection = {
  id: "c1",
  kind: "habits",
  name: "Habits",
  createdAt: 1,
};
const list: Collection = {
  id: "c1",
  kind: "list",
  name: "Reading list",
  createdAt: 1,
};

const setup = (over: Partial<Parameters<typeof CollectionView>[0]> = {}) => {
  const props = {
    collection: tracker,
    entries: [] as Entry[],
    habits: [] as Habit[],
    renderEntry: (e: Entry) => <li key={e.id}>{e.text}</li>,
    filter: "all" as EntryFilter,
    order: "logged" as const,
    threadedHere: null,
    onDelete: vi.fn(),
    ...over,
  };
  render(<CollectionView {...props} />);
  return props;
};

describe("the streak", () => {
  test("counts consecutive days up to and including today", () => {
    setup({ habits: [habit({ marks: marksFor(0, 1, 2) })] });
    expect(screen.getByText("3 days")).toBeTruthy();
  });

  test("is not broken by today not being ticked yet", () => {
    // The decision. Read at breakfast, a run of three unticked today is still a
    // run of three, not a run of nothing.
    setup({ habits: [habit({ marks: marksFor(1, 2, 3) })] });
    expect(screen.getByText("3 days")).toBeTruthy();
  });

  test("is broken by a gap that is not today", () => {
    // Ticked today and the day before yesterday, with yesterday missed: the run
    // is one, not two, and certainly not three.
    setup({ habits: [habit({ marks: marksFor(0, 2, 3) })] });
    expect(screen.getByText("1 day")).toBeTruthy();
  });

  test("says day rather than days for one", () => {
    setup({ habits: [habit({ marks: marksFor(0) })] });
    expect(screen.getByText("1 day")).toBeTruthy();
  });

  test("shows nothing at all rather than a zero", () => {
    // A column of noughts across a new tracker reads as failure. An empty cell
    // reads as not started, which is what it is.
    setup({ habits: [habit({ marks: {} })] });
    expect(screen.queryByText(/\bdays?\b/)).toBeNull();
  });

  test("counts a run that ends today after a long gap correctly", () => {
    setup({ habits: [habit({ marks: marksFor(0, 1, 5, 6, 7) })] });
    expect(screen.getByText("2 days")).toBeTruthy();
  });
});

describe("the habit grid", () => {
  test("offers a fortnight of days, ending today", () => {
    setup({ habits: [habit()] });
    // One button per day per habit, labelled by date so a tap is unambiguous.
    expect(
      screen.getAllByRole("button", { name: /^Read on \d{4}-\d{2}-\d{2}/ }).length
    ).toBe(14);
    expect(
      screen.getByRole("button", { name: new RegExp(`Read on ${daysAgo(0)}`) })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: new RegExp(`Read on ${daysAgo(14)}`) })
    ).toBeNull();
  });

  test("says in the label whether a day is done", () => {
    // The grid is circles, so the state has to reach a screen reader some other
    // way (spec §4: every action plainly labelled).
    setup({ habits: [habit({ marks: marksFor(1) })] });
    expect(
      screen.getByRole("button", {
        name: new RegExp(`Read on ${daysAgo(1)}, done`),
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`Read on ${daysAgo(0)}, not done`),
      })
    ).toBeTruthy();
  });

  test("toggles the day it names", () => {
    setup({ habits: [habit()] });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`Read on ${daysAgo(3)}`) })
    );
    expect(toggleHabitMark).toHaveBeenCalledWith("h1", daysAgo(3));
  });

  test("explains the grid only when there is a grid to explain", () => {
    setup({ habits: [habit()] });
    expect(screen.getByText(/tap a circle to fill it/i)).toBeTruthy();
    cleanup();

    setup({ habits: [] });
    expect(screen.queryByText(/tap a circle to fill it/i)).toBeNull();
  });
});

describe("adding a habit", () => {
  test("writes a trimmed name and closes the field", () => {
    setup({ habits: [] });
    fireEvent.click(screen.getByRole("button", { name: /add habit/i }));
    const field = screen.getByLabelText("Habit name");
    fireEvent.change(field, { target: { value: "  Stretch  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(addHabit).toHaveBeenCalledWith("c1", "Stretch");
  });

  test("refuses a name that is only whitespace", () => {
    setup({ habits: [] });
    fireEvent.click(screen.getByRole("button", { name: /add habit/i }));
    const field = screen.getByLabelText("Habit name");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(addHabit).not.toHaveBeenCalled();
  });
});

describe("a list collection", () => {
  const entry = (over: Partial<Entry> = {}): Entry => ({
    id: "e1",
    type: "task",
    text: "read the thing",
    priority: false,
    state: "open",
    pageKey: "col:c1",
    createdAt: 1,
    ...over,
  });

  test("renders its entries through the row renderer it is given", () => {
    // The same renderer the spread uses, so a collection reads like the journal.
    setup({ collection: list, entries: [entry()] });
    expect(screen.getByText("read the thing")).toBeTruthy();
  });

  test("says nothing logged when it is empty", () => {
    setup({ collection: list, entries: [] });
    expect(screen.getByText(/nothing logged/i)).toBeTruthy();
  });

  test("distinguishes an empty page from one the filter emptied", () => {
    // Two different facts, and telling somebody "nothing logged" about a page
    // holding four entries they cannot see would be the app lying to them.
    setup({
      collection: list,
      entries: [entry({ state: "done" }), entry({ id: "e2", state: "done" })],
      // "open only" against two done tasks hides both.
      filter: "open" as EntryFilter,
    });

    expect(screen.getByText(/nothing matching/i)).toBeTruthy();
    expect(screen.getByText(/2 entries hidden by the filter/i)).toBeTruthy();
  });

  test("says entry rather than entries for one hidden", () => {
    setup({
      collection: list,
      entries: [entry({ state: "done" })],
      filter: "open" as EntryFilter,
    });
    expect(screen.getByText(/1 entry hidden by the filter/i)).toBeTruthy();
  });

  test("names the kind, so the page says what it is", () => {
    setup({ collection: list });
    expect(screen.getByText("collection")).toBeTruthy();
    cleanup();
    setup({ collection: tracker });
    expect(screen.getByText("habit tracker")).toBeTruthy();
  });
});
