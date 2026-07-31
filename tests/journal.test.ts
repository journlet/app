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
  setDetails,
  setParent,
  setText,
  toggleDone,
  toggleHabitMark,
  toggleStruck,
  toggleThread,
  restoreCollection,
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

  test("addEntry captures optional details (trimmed, omitted when blank)", () => {
    const withD = addEntry("2026-07-24", "task", "read", false, false, "  see https://x.com  ");
    expect(readAll().find((e) => e.id === withD.id)?.details).toBe("see https://x.com");
    const blank = addEntry("2026-07-24", "task", "plain", false, false, "   ");
    expect(readAll().find((e) => e.id === blank.id)?.details).toBeUndefined();
  });

  test("setDetails stores, trims, and clears free-form details", () => {
    const e = addEntry("2026-07-24", "task", "read paper", false);
    expect(readAll()[0].details).toBeUndefined();
    setDetails(e.id, "  https://example.com/paper  ");
    expect(readAll()[0].details).toBe("https://example.com/paper");
    setDetails(e.id, "");
    expect(readAll()[0].details).toBeUndefined();
    setDetails(e.id, "note");
    setDetails(e.id, null);
    expect(readAll()[0].details).toBeUndefined();
  });

  test("details survive a migrate (copied to the fresh open entry)", () => {
    const e = addEntry("2026-07-24", "task", "read paper", false);
    setDetails(e.id, "https://example.com");
    migrateEntry(e.id, "2026-07-25");
    const copy = readAll().find((x) => x.migratedFrom === e.id);
    expect(copy?.details).toBe("https://example.com");
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

describe("setParent (nesting, one level deep — spec §4.1)", () => {
  const pk = "2026-07-24";
  const parentOf = (id: string) =>
    readAll().find((e) => e.id === id)?.parentId;

  test("nests under any top-level entry on the page, not just the one above", () => {
    const first = addEntry(pk, "task", "first", false);
    addEntry(pk, "task", "second", false);
    const third = addEntry(pk, "task", "third", false);
    // "second" sits between them, so this was previously impossible
    expect(setParent(third.id, first.id)).toBe(true);
    expect(parentOf(third.id)).toBe(first.id);
  });

  test("moves an existing sub-bullet to a different parent", () => {
    const a = addEntry(pk, "task", "a", false);
    const b = addEntry(pk, "task", "b", false);
    const child = addEntry(pk, "task", "child", false);
    setParent(child.id, a.id);
    expect(setParent(child.id, b.id)).toBe(true);
    expect(parentOf(child.id)).toBe(b.id);
  });

  test("null returns the entry to top level", () => {
    const p = addEntry(pk, "task", "parent", false);
    const c = addEntry(pk, "task", "child", false);
    setParent(c.id, p.id);
    expect(setParent(c.id, null)).toBe(true);
    expect(parentOf(c.id)).toBeUndefined();
  });

  test("refuses a parent that is itself a sub-bullet (no third level)", () => {
    const top = addEntry(pk, "task", "top", false);
    const mid = addEntry(pk, "task", "mid", false);
    const low = addEntry(pk, "task", "low", false);
    setParent(mid.id, top.id);
    expect(setParent(low.id, mid.id)).toBe(false);
    expect(parentOf(low.id)).toBeUndefined();
  });

  test("refuses to nest an entry that already has sub-bullets", () => {
    const a = addEntry(pk, "task", "a", false);
    const b = addEntry(pk, "task", "b", false);
    const kid = addEntry(pk, "task", "kid", false);
    setParent(kid.id, b.id);
    expect(setParent(b.id, a.id)).toBe(false);
    expect(parentOf(b.id)).toBeUndefined();
  });

  test("refuses a parent on another page", () => {
    const here = addEntry(pk, "task", "here", false);
    const elsewhere = addEntry("2026-07-25", "task", "elsewhere", false);
    expect(setParent(here.id, elsewhere.id)).toBe(false);
    expect(parentOf(here.id)).toBeUndefined();
  });

  test("refuses to nest an entry under itself, or under a missing entry", () => {
    const a = addEntry(pk, "task", "a", false);
    expect(setParent(a.id, a.id)).toBe(false);
    expect(setParent(a.id, "no-such-id")).toBe(false);
    expect(parentOf(a.id)).toBeUndefined();
  });

  // The store's idea of the tree must match the drawn page, or the app offers
  // actions it then refuses. Deleting or moving a parent leaves its sub-bullets
  // pointing at an entry that is no longer on the page; the page draws those at
  // top level, so the store must accept them as parents and as nestable.
  test("accepts a parent whose own parent has left the page", () => {
    const gone = addEntry(pk, "task", "gone", false);
    const orphan = addEntry(pk, "task", "orphan", false);
    const other = addEntry(pk, "task", "other", false);
    setParent(orphan.id, gone.id);
    removeEntry(gone.id); // orphan still stores parentId, but draws top level

    expect(setParent(other.id, orphan.id)).toBe(true);
    expect(parentOf(other.id)).toBe(orphan.id);
  });

  test("an entry whose sub-bullets have left the page can be nested again", () => {
    const parent = addEntry(pk, "task", "parent", false);
    const child = addEntry(pk, "task", "child", false);
    setParent(child.id, parent.id);
    moveTo(parent.id, "2026-07-25"); // child stays behind, still naming parent
    const target = addEntry("2026-07-25", "task", "target", false);

    // On its new page the moved entry has no sub-bullets, so this must work
    expect(setParent(parent.id, target.id)).toBe(true);
    expect(parentOf(parent.id)).toBe(target.id);
  });

  test("capture accepts a parent whose own parent has left the page", () => {
    const gone = addEntry(pk, "task", "gone", false);
    const orphan = addEntry(pk, "task", "orphan", false);
    setParent(orphan.id, gone.id);
    removeEntry(gone.id);

    // The sheet offers "Add a sub-bullet" on it, so capture must honour that
    const c = addEntry(pk, "task", "child", false, false, "", orphan.id);
    expect(c.parentId).toBe(orphan.id);
  });
});

describe("addEntry with a parent (capturing a sub-bullet)", () => {
  const pk = "2026-07-24";

  test("lands nested under the given parent", () => {
    const p = addEntry(pk, "task", "parent", false);
    const c = addEntry(pk, "note", "detail", false, false, "", p.id);
    expect(c.parentId).toBe(p.id);
    expect(readAll().find((e) => e.id === c.id)?.parentId).toBe(p.id);
  });

  test("ignores a parent on another page rather than losing the entry", () => {
    const p = addEntry("2026-07-25", "task", "parent", false);
    const c = addEntry(pk, "task", "child", false, false, "", p.id);
    expect(c.parentId).toBeUndefined();
    expect(readAll().find((e) => e.id === c.id)?.pageKey).toBe(pk);
  });

  test("ignores a parent that is itself a sub-bullet (no third level)", () => {
    const top = addEntry(pk, "task", "top", false);
    const mid = addEntry(pk, "task", "mid", false);
    setParent(mid.id, top.id);
    const c = addEntry(pk, "task", "child", false, false, "", mid.id);
    expect(c.parentId).toBeUndefined();
  });

  test("ignores a parent that no longer exists", () => {
    const c = addEntry(pk, "task", "child", false, false, "", "gone");
    expect(c.parentId).toBeUndefined();
    expect(readAll().find((e) => e.id === c.id)).toBeTruthy();
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

// Threading (spec §4.4): page references on an entry — the margin page number
// of the paper method. Never a move, never a copy, never a glyph change.
describe("toggleThread (page references)", () => {
  test("adds and removes a reference without touching page, state or type", () => {
    const c = addCollection("list", "Reading list");
    const e = addEntry("2026-07-24", "note", "Sam recommended Dark Matter", false);

    toggleThread(e.id, colPageKey(c.id));
    let stored = readAll()[0];
    expect(stored.threads).toEqual([colPageKey(c.id)]);
    expect(stored.pageKey).toBe("2026-07-24");
    expect(stored.state).toBe("open");
    expect(stored.type).toBe("note");

    toggleThread(e.id, colPageKey(c.id));
    stored = readAll()[0];
    expect(stored.threads).toBeUndefined();
    expect(stored.pageKey).toBe("2026-07-24");
  });

  test("holds several references, deduplicated and stably ordered", () => {
    const e = addEntry("2026-07-24", "task", "quotes", false);
    toggleThread(e.id, "2026-W30");
    toggleThread(e.id, "col:abc");
    toggleThread(e.id, "col:abc"); // same page again: toggles off, not duplicated
    toggleThread(e.id, "col:abc");
    expect(readAll()[0].threads).toEqual(["2026-W30", "col:abc"]);
  });

  test("refuses to reference the page the entry lives on", () => {
    const e = addEntry("2026-07-24", "task", "x", false);
    toggleThread(e.id, "2026-07-24");
    expect(readAll()[0].threads).toBeUndefined();
  });

  test("references are inherited by a migrated copy, and the original keeps its own", () => {
    const e = addEntry("2026-07-24", "task", "Get three quotes", false);
    toggleThread(e.id, "col:flat");
    migrateEntry(e.id, "2026-07-25");
    const original = readAll().find((x) => x.id === e.id);
    const copy = readAll().find((x) => x.migratedFrom === e.id);
    expect(original?.threads).toEqual(["col:flat"]);
    expect(original?.state).toBe("migrated");
    expect(copy?.threads).toEqual(["col:flat"]);
    expect(copy?.state).toBe("open");
  });

  test("references survive a move, except one pointing at the destination", () => {
    const e = addEntry("2026-07-24", "task", "x", false);
    toggleThread(e.id, "col:flat");
    toggleThread(e.id, "2026-W30");
    moveTo(e.id, "2026-W30");
    const stored = readAll()[0];
    expect(stored.pageKey).toBe("2026-W30");
    expect(stored.threads).toEqual(["col:flat"]);
  });

  test("delete and undo of an entry keeps its references", () => {
    const e = addEntry("2026-07-24", "task", "x", false);
    toggleThread(e.id, "col:flat");
    const snap = removeEntry(e.id);
    expect(snap?.threads).toEqual(["col:flat"]);
    restoreEntry(snap!);
    expect(readAll()[0].threads).toEqual(["col:flat"]);
  });

  test("deleting a collection clears references to it, and undo puts them back", () => {
    const c = addCollection("list", "Reading list");
    const e = addEntry("2026-07-24", "note", "Dark Matter", false);
    toggleThread(e.id, colPageKey(c.id));

    const snap = removeCollection(c.id);
    expect(snap?.threadedFrom).toEqual([e.id]);
    expect(readAll().find((x) => x.id === e.id)?.threads).toBeUndefined();

    restoreCollection(snap!);
    expect(readAll().find((x) => x.id === e.id)?.threads).toEqual([
      colPageKey(c.id),
    ]);
  });
});
