// @vitest-environment jsdom
//
// The index (spec §4.2): every page holding entries, and every collection.
//
// This view had no test at all until 28 August 2026. It is 223 lines of pure
// prop-driven rendering, which makes it cheap to cover and easy to get subtly
// wrong: most of what it does is count things and then say the count in English,
// and both halves have rules. The count of "open" is the notation rule from §4.1,
// a task that is still a task, so a done task, an event and a note must all be
// excluded; the English is singular against plural, which nothing was checking.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import IndexView from "../../src/IndexView";
import { colPageKey } from "../../src/lib/types";
import type { Collection, Entry, Habit } from "../../src/lib/types";
import type { Scope } from "../../src/lib/dates";

afterEach(cleanup);

const nowKeys: Record<Scope, string> = {
  day: "2026-07-24",
  week: "2026-W30",
  month: "2026-07",
  year: "2026",
};

let n = 0;
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`,
  type: "task",
  text: "something",
  priority: false,
  state: "open",
  pageKey: "2026-07-24",
  createdAt: n,
  ...over,
});

const setup = (over: Partial<Parameters<typeof IndexView>[0]> = {}) => {
  const props = {
    days: {} as Record<string, Entry[]>,
    nowKeys,
    collections: [] as Collection[],
    habits: [] as Habit[],
    futureCount: 0,
    onOpen: vi.fn(),
    onOpenCollection: vi.fn(),
    onOpenFutureLog: vi.fn(),
    onNewCollection: vi.fn(),
    ...over,
  };
  render(<IndexView {...props} />);
  return props;
};

describe("which pages appear", () => {
  test("lists a page holding entries and omits one holding none", () => {
    // `days` can carry an empty array for a page that has been emptied out, and
    // an index row for a page with nothing on it is a row that opens a blank.
    setup({
      days: { "2026-07-24": [entry()], "2026-07-23": [] },
    });

    expect(screen.getByRole("button", { name: /Fri 24 Jul/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thu 23 Jul/ })).toBeNull();
  });

  test("groups by scope, newest first inside each group", () => {
    // Newest first because the index is read to get back to recent work, and
    // reverse-sorting the keys is only correct because they sort lexically.
    setup({
      days: {
        "2026-07-22": [entry()],
        "2026-07-24": [entry()],
        "2026-07-23": [entry()],
        "2026-07": [entry({ pageKey: "2026-07" })],
      },
    });

    const rows = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => /Jul/.test(t));
    const days = rows.filter((t) => /\d\d Jul/.test(t));
    expect(days[0]).toMatch(/24 Jul/);
    expect(days[1]).toMatch(/23 Jul/);
    expect(days[2]).toMatch(/22 Jul/);
    expect(screen.getByText("Days")).toBeTruthy();
    expect(screen.getByText("Months")).toBeTruthy();
  });

  test("marks the current period, and only that one", () => {
    setup({
      days: { "2026-07-24": [entry()], "2026-07-23": [entry()] },
    });

    const current = screen.getByRole("button", { name: /Fri 24 Jul/ });
    expect(current.textContent).toContain("current");
    expect(
      screen.getByRole("button", { name: /Thu 23 Jul/ }).textContent
    ).not.toContain("current");
  });

  test("says so plainly when there are no pages at all", () => {
    setup();
    expect(screen.getByText(/No pages yet/i)).toBeTruthy();
  });

  test("does not say that once a page exists", () => {
    setup({ days: { "2026-07-24": [entry()] } });
    expect(screen.queryByText(/No pages yet/i)).toBeNull();
  });
});

describe("the counts on a page row", () => {
  test("counts entries, and says entry or entries", () => {
    setup({ days: { "2026-07-24": [entry()] } });
    expect(screen.getByRole("button", { name: /1 entry\b/ })).toBeTruthy();
    cleanup();

    setup({ days: { "2026-07-24": [entry(), entry()] } });
    expect(screen.getByRole("button", { name: /2 entries/ })).toBeTruthy();
  });

  test("counts only open tasks as open", () => {
    // The notation rule (§4.1). A completed task is not open, and an event or a
    // note is not a task, so none of the three belongs in this number. Getting
    // it wrong would overstate what is left to do on every page in the index.
    setup({
      days: {
        "2026-07-24": [
          entry({ type: "task", state: "open" }),
          entry({ type: "task", state: "done" }),
          entry({ type: "task", state: "struck" }),
          entry({ type: "task", state: "migrated" }),
          entry({ type: "event", state: "open" }),
          entry({ type: "note", state: "open" }),
        ],
      },
    });

    const row = screen.getByRole("button", { name: /6 entries/ });
    expect(row.textContent).toContain("1 open");
  });

  test("says nothing about open when nothing is open", () => {
    setup({
      days: { "2026-07-24": [entry({ state: "done" })] },
    });
    expect(screen.getByRole("button", { name: /1 entry/ }).textContent).not.toContain(
      "open"
    );
  });
});

describe("the future log row", () => {
  test("appears only when something is in it", () => {
    setup({ futureCount: 0 });
    expect(screen.queryByRole("button", { name: /Future log/ })).toBeNull();
    cleanup();

    setup({ futureCount: 3 });
    expect(
      screen.getByRole("button", { name: /Future log.*3 items/ })
    ).toBeTruthy();
  });

  test("says item rather than items for one", () => {
    setup({ futureCount: 1 });
    expect(screen.getByRole("button", { name: /1 item\b/ })).toBeTruthy();
  });

  test("opens the future log when tapped", () => {
    const props = setup({ futureCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Future log/ }));
    expect(props.onOpenFutureLog).toHaveBeenCalledTimes(1);
  });
});

describe("collections", () => {
  const list: Collection = {
    id: "c1",
    kind: "list",
    name: "Reading list",
    createdAt: 1,
  };
  const tracker: Collection = {
    id: "c2",
    kind: "habits",
    name: "Habits",
    createdAt: 2,
  };

  test("names the kind, so a tracker is not mistaken for a list", () => {
    setup({ collections: [list, tracker] });
    expect(screen.getByText("list")).toBeTruthy();
    expect(screen.getByText("habit tracker")).toBeTruthy();
  });

  test("counts entries for a list, taken from its own page key", () => {
    setup({
      collections: [list],
      days: {
        [colPageKey(list.id)]: [
          entry({ pageKey: colPageKey(list.id) }),
          entry({ pageKey: colPageKey(list.id), state: "done" }),
        ],
      },
    });

    const row = screen.getByRole("button", { name: /Reading list/ });
    expect(row.textContent).toContain("2 entries");
    expect(row.textContent).toContain("1 open");
  });

  test("counts habits for a tracker, not entries", () => {
    // A tracker holds habits and marks rather than rapid-logged entries, so a
    // count of entries there would always read zero and mean nothing.
    setup({
      collections: [tracker],
      habits: [
        { id: "h1", collectionId: "c2", name: "Read", createdAt: 1, marks: {} },
        { id: "h2", collectionId: "c9", name: "Elsewhere", createdAt: 2, marks: {} },
      ],
    });

    const row = screen.getByRole("button", { name: /Habits/ });
    expect(row.textContent).toContain("1 habit");
    expect(row.textContent).not.toContain("2 habits");
  });

  test("explains what a collection is when there are none", () => {
    setup();
    expect(screen.getByText(/No collections yet/i)).toBeTruthy();
  });

  test("opens the collection it names, and offers a new one", () => {
    const props = setup({ collections: [list] });

    fireEvent.click(screen.getByRole("button", { name: /Reading list/ }));
    expect(props.onOpenCollection).toHaveBeenCalledWith("c1");

    fireEvent.click(screen.getByRole("button", { name: /new collection/i }));
    expect(props.onNewCollection).toHaveBeenCalledTimes(1);
  });
});

describe("opening a page", () => {
  test("hands back the page key, not the label", () => {
    const props = setup({ days: { "2026-07-24": [entry()] } });
    fireEvent.click(screen.getByRole("button", { name: /Fri 24 Jul/ }));
    expect(props.onOpen).toHaveBeenCalledWith("2026-07-24");
  });
});
