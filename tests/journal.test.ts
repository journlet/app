// Journal store (src/store/journal.ts): the CRDT-backed entry model and the
// Ryder Carroll notation semantics. A single module-level Yjs doc is shared,
// so each test starts from a clean document.

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { colPageKey } from "../src/lib/types";
import {
  addCollection,
  addEntry,
  addHabit,
  collections,
  cycleType,
  doc,
  entries,
  habits,
  migrateEntry,
  moveTo,
  readAll,
  readCollections,
  readHabits,
  recurrences,
  removeCollection,
  removeEntry,
  restoreEntry,
  setParent,
  setText,
  toggleDone,
  toggleHabitMark,
  toggleStruck,
} from "../src/store/journal";

const reset = () =>
  doc.transact(() => {
    entries.delete(0, entries.length);
    collections.delete(0, collections.length);
    habits.delete(0, habits.length);
    recurrences.delete(0, recurrences.length);
  });

beforeEach(reset);

describe("addEntry / readAll", () => {
  test("adds an open entry and reads it back", () => {
    const e = addEntry("2026-07-24", "task", "Buy milk", false);
    const all = readAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: e.id,
      type: "task",
      text: "Buy milk",
      state: "open",
      pageKey: "2026-07-24",
      priority: false,
    });
  });

  test("setText edits the text in place", () => {
    const e = addEntry("2026-07-24", "note", "draft", false);
    setText(e.id, "final");
    expect(readAll()[0].text).toBe("final");
  });
});

describe("toggleDone (× complete)", () => {
  test("toggles a task open <-> done", () => {
    const e = addEntry("2026-07-24", "task", "task", false);
    toggleDone(e.id);
    expect(readAll()[0].state).toBe("done");
    toggleDone(e.id);
    expect(readAll()[0].state).toBe("open");
  });

  test("does nothing to a non-task", () => {
    const e = addEntry("2026-07-24", "event", "party", false);
    toggleDone(e.id);
    expect(readAll()[0].state).toBe("open");
  });
});

describe("cycleType", () => {
  test("cycles task -> event -> note -> task while open", () => {
    const e = addEntry("2026-07-24", "task", "x", false);
    cycleType(e.id);
    expect(readAll()[0].type).toBe("event");
    cycleType(e.id);
    expect(readAll()[0].type).toBe("note");
    cycleType(e.id);
    expect(readAll()[0].type).toBe("task");
  });

  test("refuses to change type once the entry is not open", () => {
    const e = addEntry("2026-07-24", "task", "x", false);
    toggleDone(e.id); // now done
    cycleType(e.id);
    expect(readAll()[0].type).toBe("task");
  });
});

describe("toggleStruck (strikethrough)", () => {
  test("toggles open <-> struck", () => {
    const e = addEntry("2026-07-24", "note", "irrelevant", false);
    toggleStruck(e.id);
    expect(readAll()[0].state).toBe("struck");
    toggleStruck(e.id);
    expect(readAll()[0].state).toBe("open");
  });
});

describe("moveTo", () => {
  test("changes the page and drops nesting (the parent stays behind)", () => {
    const parent = addEntry("2026-07-24", "task", "parent", false);
    const child = addEntry("2026-07-24", "task", "child", false);
    setParent(child.id, parent.id);
    expect(readAll().find((e) => e.id === child.id)?.parentId).toBe(parent.id);

    moveTo(child.id, "2026-07-25");
    const moved = readAll().find((e) => e.id === child.id);
    expect(moved?.pageKey).toBe("2026-07-25");
    expect(moved?.parentId).toBeUndefined();
  });
});

describe("migrateEntry (> migrated / < scheduled)", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0)); // 24 Jul 2026
  });
  afterAll(() => vi.useRealTimers());

  test("marks the original migrated and copies an open entry forward", () => {
    const e = addEntry("2020-01-01", "task", "carry over", false);
    migrateEntry(e.id, "2026-07-24"); // current day, not future

    const all = readAll();
    expect(all).toHaveLength(2);
    const original = all.find((x) => x.id === e.id);
    const copy = all.find((x) => x.id !== e.id);
    expect(original?.state).toBe("migrated");
    expect(copy).toMatchObject({
      state: "open",
      pageKey: "2026-07-24",
      migratedFrom: e.id,
      text: "carry over",
    });
  });

  test("marks the original scheduled when the target is a future page", () => {
    const e = addEntry("2026-07-24", "task", "later", false);
    migrateEntry(e.id, "2099-01-01"); // clearly future
    const original = readAll().find((x) => x.id === e.id);
    expect(original?.state).toBe("scheduled");
  });
});

describe("removeEntry / restoreEntry (undo)", () => {
  test("removes and returns a snapshot, then restores it", () => {
    const e = addEntry("2026-07-24", "task", "oops", false);
    const snap = removeEntry(e.id);
    expect(readAll()).toHaveLength(0);
    expect(snap?.id).toBe(e.id);

    restoreEntry(snap!);
    expect(readAll()).toHaveLength(1);
    expect(readAll()[0].text).toBe("oops");
  });

  test("removeEntry on an unknown id returns null", () => {
    expect(removeEntry("nope")).toBeNull();
  });
});

describe("collections and habits", () => {
  test("addCollection is read back, sorted by creation", () => {
    const a = addCollection("list", "Books");
    const b = addCollection("habits", "Routines");
    const read = readCollections();
    expect(read.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  test("toggleHabitMark fills and clears a day", () => {
    const c = addCollection("habits", "Routines");
    const h = addHabit(c.id, "Water");
    toggleHabitMark(h.id, "2026-07-24");
    expect(readHabits()[0].marks["2026-07-24"]).toBe(true);
    toggleHabitMark(h.id, "2026-07-24");
    expect(readHabits()[0].marks["2026-07-24"]).toBeUndefined();
  });

  test("removeCollection snapshots and clears its entries and habits", () => {
    const c = addCollection("habits", "Routines");
    const h = addHabit(c.id, "Water");
    const onPage = addEntry(colPageKey(c.id), "note", "a list item", false);
    // an unrelated entry on a normal page must survive
    addEntry("2026-07-24", "task", "unrelated", false);

    const snap = removeCollection(c.id);
    expect(snap?.collection.id).toBe(c.id);
    expect(snap?.entries.map((e) => e.id)).toContain(onPage.id);
    expect(snap?.habits.map((x) => x.id)).toContain(h.id);

    expect(readCollections()).toHaveLength(0);
    expect(readHabits()).toHaveLength(0);
    expect(readAll().map((e) => e.pageKey)).toEqual(["2026-07-24"]);
  });
});
