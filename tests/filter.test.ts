// @vitest-environment jsdom
//
// The entry visibility filter (src/lib/filter.ts, remediation item 7).
//
// The rule being pinned here is that filtering decides visibility and nothing
// else: no entry is rewritten, no glyph is swapped, and page order survives —
// a filtered page has to read like the same page with fewer lines on it.

import { afterEach, describe, expect, test } from "vitest";
import {
  applyFilter,
  entryVisible,
  filterBadge,
  filterDays,
  loadFilter,
  loadFilterOpen,
  saveFilter,
  saveFilterOpen,
} from "../src/lib/filter";
import type { Entry, EntryState, EntryType } from "../src/lib/types";

const entry = (
  id: string,
  over: Partial<Entry> = {}
): Entry => ({
  id,
  type: "task",
  text: id,
  priority: false,
  state: "open",
  pageKey: "2026-08-04",
  createdAt: 0,
  ...over,
});

describe("entryVisible", () => {
  test("'all' keeps every type in every state", () => {
    const types: EntryType[] = ["task", "event", "note"];
    const states: EntryState[] = [
      "open",
      "done",
      "struck",
      "migrated",
      "scheduled",
    ];
    types.forEach((type) =>
      states.forEach((state) =>
        expect(entryVisible(entry("x", { type, state }), "all")).toBe(true)
      )
    );
  });

  test("'tasks only' judges on type, whatever the state", () => {
    expect(entryVisible(entry("t", { state: "done" }), "tasks")).toBe(true);
    expect(entryVisible(entry("n", { type: "note" }), "tasks")).toBe(false);
    expect(entryVisible(entry("e", { type: "event" }), "tasks")).toBe(false);
  });

  test("'open only' judges on state, so notes and events stay", () => {
    expect(entryVisible(entry("t"), "open")).toBe(true);
    expect(entryVisible(entry("n", { type: "note" }), "open")).toBe(true);
    expect(entryVisible(entry("e", { type: "event" }), "open")).toBe(true);
    // everything already dealt with goes
    (["done", "struck", "migrated", "scheduled"] as EntryState[]).forEach(
      (state) => expect(entryVisible(entry("x", { state }), "open")).toBe(false)
    );
    // including a note that was struck out — striking does close it
    expect(
      entryVisible(entry("n", { type: "note", state: "struck" }), "open")
    ).toBe(false);
  });
});

describe("applyFilter", () => {
  const page = [
    entry("open-task"),
    entry("done-task", { state: "done" }),
    entry("note", { type: "note" }),
    entry("struck-note", { type: "note", state: "struck" }),
  ];

  test("'all' returns the page untouched, same array", () => {
    expect(applyFilter(page, "all")).toBe(page);
  });

  test("'open only' leaves the outstanding work and the live note", () => {
    expect(applyFilter(page, "open").map((e) => e.id)).toEqual([
      "open-task",
      "note",
    ]);
  });

  test("'tasks only' leaves both tasks, done included", () => {
    expect(applyFilter(page, "tasks").map((e) => e.id)).toEqual([
      "open-task",
      "done-task",
    ]);
  });

  test("page order is preserved, never re-sorted", () => {
    const scrambled = [entry("c"), entry("a"), entry("b")];
    expect(applyFilter(scrambled, "open").map((e) => e.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("entries are returned as they are — nothing is rewritten", () => {
    const [kept] = applyFilter([entry("t", { priority: true })], "open");
    expect(kept.state).toBe("open");
    expect(kept.priority).toBe(true);
    expect(kept.type).toBe("task");
  });

  test("a hidden parent is kept as context when a sub-bullet survives", () => {
    const rows = [
      entry("parent", { state: "done" }),
      entry("child", { parentId: "parent" }),
    ];
    expect(applyFilter(rows, "open").map((e) => e.id)).toEqual([
      "parent",
      "child",
    ]);
  });

  test("a hidden parent whose children are all hidden goes with them", () => {
    const rows = [
      entry("parent", { state: "done" }),
      entry("child", { parentId: "parent", state: "done" }),
    ];
    expect(applyFilter(rows, "open")).toEqual([]);
  });

  test("a visible parent does not drag a hidden child back into view", () => {
    const rows = [entry("parent"), entry("child", { parentId: "parent", state: "done" })];
    expect(applyFilter(rows, "open").map((e) => e.id)).toEqual(["parent"]);
  });
});

describe("filterDays", () => {
  const days = {
    "2026-08-04": [entry("a"), entry("b", { state: "done" })],
    "2026-08": [entry("c", { state: "done" })],
  };

  test("filters every page and keeps pages that empty out", () => {
    const out = filterDays(days, "open");
    expect(out["2026-08-04"].map((e) => e.id)).toEqual(["a"]);
    // the page stays, empty — a section still has to say it is hiding things
    expect(out["2026-08"]).toEqual([]);
    expect(Object.keys(out)).toEqual(Object.keys(days));
  });

  test("'all' hands back the same snapshot", () => {
    expect(filterDays(days, "all")).toBe(days);
  });
});

describe("persistence", () => {
  afterEach(() => localStorage.clear());

  test("defaults to 'all' with nothing stored", () => {
    expect(loadFilter()).toBe("all");
  });

  test("a saved choice survives a relaunch", () => {
    saveFilter("open");
    expect(loadFilter()).toBe("open");
  });

  test("a corrupted or unknown stored value falls back to 'all'", () => {
    localStorage.setItem("journlet-filter-v1", "everything");
    expect(loadFilter()).toBe("all");
  });
});

// The header badge has to answer "why is this page showing me less?" with the
// row shut, so it names the filter rather than only flagging that one is on.
describe("filterBadge", () => {
  test("says only 'filter' when nothing is filtered", () => {
    expect(filterBadge("all")).toBe("filter");
  });

  test("names the filter that is on", () => {
    expect(filterBadge("open")).toBe("filter · open only");
    expect(filterBadge("tasks")).toBe("filter · tasks only");
  });
});

describe("row open state", () => {
  afterEach(() => localStorage.clear());

  test("starts closed — the row is chrome, the badge is the way in", () => {
    expect(loadFilterOpen()).toBe(false);
  });

  test("a row you opened stays open across launches", () => {
    saveFilterOpen(true);
    expect(loadFilterOpen()).toBe(true);
    saveFilterOpen(false);
    expect(loadFilterOpen()).toBe(false);
  });

  test("it is a separate preference from the filter itself, so closing the row cannot change what is hidden", () => {
    saveFilter("open");
    saveFilterOpen(false);
    expect(loadFilter()).toBe("open");
    expect(loadFilterOpen()).toBe(false);
  });
});
