// Reading a journal this build did not write.
//
// Every record in the doc arrives from another device, a merge of two of them, or
// a build that is not this one, and the decoders used to read it back with bare
// `as string` casts. These tests pin the policy store/decode.ts sets out: a record
// with nothing to place it by is rejected and counted, a field this build cannot
// read is repaired to a bland default and counted, and neither is ever silent.
//
// Written by hand-building Y.Maps rather than through addEntry, because addEntry
// cannot produce any of these: that is the point, the writer is not this build.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  collections,
  doc,
  entries,
  habits,
  migrateEntry,
  readAll,
  readCollections,
  readHabits,
  readRecurrences,
  recurrences,
  removeCollection,
} from "../src/store/journal";
import { decodeFaultLine, decodeFaults, resetDecodeFaults } from "../src/store/decode";

const reset = () => {
  doc.transact(() => {
    entries.delete(0, entries.length);
    collections.delete(0, collections.length);
    habits.delete(0, habits.length);
    recurrences.delete(0, recurrences.length);
  });
  resetDecodeFaults();
};

beforeEach(() => {
  reset();
  // Every reject and repair warns once. Silenced here so a passing run is quiet,
  // and asserted on its own below.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** A raw entry map with the given fields, bypassing every writer in the app. */
const rawEntry = (fields: Record<string, unknown>): void => {
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    for (const [k, v] of Object.entries(fields)) m.set(k, v);
    entries.push([m]);
  });
};

const goodEntry = {
  id: "e1",
  type: "task",
  text: "write report",
  state: "open",
  pageKey: "2026-07-24",
  createdAt: 1000,
};

describe("an entry that cannot be placed", () => {
  test("is not shown when it has no id, because nothing could act on it", () => {
    // The worst of the three. findMap() matches on id, so an entry with none
    // cannot be completed, edited or deleted: it would sit on the page refusing
    // every tap, which is the app lying about what its own rows do.
    rawEntry({ ...goodEntry, id: undefined });
    expect(readAll()).toHaveLength(0);
    expect(decodeFaults().rejected.entry).toBe(1);
  });

  test("is not shown when its page key is missing", () => {
    rawEntry({ ...goodEntry, pageKey: "" });
    expect(readAll()).toHaveLength(0);
  });

  test("is not shown when its created time is not a number", () => {
    // NaN is the reason this is a rejection rather than a repair: every
    // comparison against it is false, so one bad row scrambles the order of a
    // whole page rather than misplacing itself.
    rawEntry({ ...goodEntry, createdAt: "yesterday" });
    expect(readAll()).toHaveLength(0);
  });

  test("does not take the rest of the page with it", () => {
    rawEntry({ ...goodEntry, id: "e0" });
    rawEntry({ ...goodEntry, id: undefined });
    rawEntry({ ...goodEntry, id: "e2" });
    expect(readAll().map((e) => e.id)).toEqual(["e0", "e2"]);
  });
});

describe("an entry field this build cannot read", () => {
  test("keeps the entry, and shows an unknown type as a note", () => {
    // A later build's fourth entry type. Dropping the entry would read as data
    // loss when nothing is lost, and leaving the type alone would draw no
    // bullet at all, because GLYPH has no key for it. A note asserts least.
    rawEntry({ ...goodEntry, type: "habit-tick" });
    const all = readAll();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("note");
    expect(decodeFaults().repaired["entry.type"]).toBe(1);
  });

  test("shows an unknown state as open", () => {
    rawEntry({ ...goodEntry, state: "delegated" });
    expect(readAll()[0].state).toBe("open");
  });

  test("shows missing text as empty, so the row can be typed into", () => {
    rawEntry({ ...goodEntry, text: undefined });
    expect(readAll()[0].text).toBe("");
    expect(decodeFaults().repaired["entry.text"]).toBe(1);
  });

  test("drops an optional field of the wrong shape rather than passing it on", () => {
    rawEntry({ ...goodEntry, remindAt: "8am", parentId: 7, details: {} });
    const e = readAll()[0];
    expect(e.remindAt).toBeUndefined();
    expect(e.parentId).toBeUndefined();
    expect(e.details).toBeUndefined();
  });

  test("survives threads that are not a map", () => {
    rawEntry({ ...goodEntry, threads: ["2026-07"] });
    expect(readAll()[0].threads).toBeUndefined();
  });
});

describe("a recurrence rule", () => {
  const goodRule = {
    id: "r1",
    text: "water the plants",
    type: "task",
    everyN: 1,
    unit: "week",
    anchor: "2026-07-24",
    materialisedThrough: "2026-07-24",
    createdAt: 1000,
  };

  const rawRule = (fields: Record<string, unknown>): void => {
    const m = new Y.Map<unknown>();
    doc.transact(() => {
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      recurrences.push([m]);
    });
  };

  test("is rejected when its cadence cannot be read, rather than defaulted", () => {
    // The one rejection that is a choice rather than a necessity. A rule is
    // executed, not just drawn: reading an unknown unit as "day" would put
    // thirty entries on thirty pages where somebody meant one a month. The
    // occurrences already materialised are their own entries and stay put, so
    // stopping here loses nothing that exists.
    rawRule({ ...goodRule, unit: "fortnight" });
    expect(readRecurrences()).toHaveLength(0);
    expect(decodeFaults().rejected.recurrence).toBe(1);
  });

  test("is rejected with no anchor to walk from", () => {
    rawRule({ ...goodRule, anchor: undefined });
    expect(readRecurrences()).toHaveLength(0);
  });

  test("reads a nonsensical interval as one, which is what the form offers", () => {
    // "every 0 days" walks nowhere and "every -1" walks backwards; both would
    // hang or reverse the materialiser rather than misdraw a row.
    rawRule({ ...goodRule, everyN: 0 });
    expect(readRecurrences()[0].everyN).toBe(1);
    reset();
    rawRule({ ...goodRule, everyN: -1 });
    expect(readRecurrences()[0].everyN).toBe(1);
    reset();
    rawRule({ ...goodRule, everyN: 1.5 });
    expect(readRecurrences()[0].everyN).toBe(1);
  });

  test("still defaults a missing pageScope to day, as it always did", () => {
    // Rules written before the field existed have none, so this is the original
    // behaviour rather than new leniency.
    rawRule({ ...goodRule, pageScope: undefined });
    expect(readRecurrences()[0].pageScope).toBe("day");
  });
});

describe("collections and habits", () => {
  const rawIn = (list: typeof collections, fields: Record<string, unknown>) => {
    const m = new Y.Map<unknown>();
    doc.transact(() => {
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      list.push([m]);
    });
    return m;
  };

  test("an unknown collection kind is shown as a list, not dropped", () => {
    // Dropping it would take the page away while its entries kept a col:<id>
    // page key pointing at nothing, so the entries would disappear with it.
    rawIn(collections, {
      id: "c1",
      kind: "grid",
      name: "Reading",
      createdAt: 1,
    });
    const all = readCollections();
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("list");
  });

  test("a habit with no marks reads as unticked instead of throwing", () => {
    // It threw. `marks` was read with a bare cast and a bare .forEach, so one
    // row that had never been ticked took the whole tracker down with it.
    rawIn(habits, {
      id: "h1",
      collectionId: "c1",
      name: "Read",
      createdAt: 1,
    });
    expect(() => readHabits()).not.toThrow();
    expect(readHabits()[0].marks).toEqual({});
  });

  test("a habit belonging to nothing is not shown", () => {
    rawIn(habits, { id: "h1", name: "Read", createdAt: 1 });
    expect(readHabits()).toHaveLength(0);
  });
});

describe("writes that read a record first", () => {
  test("migrating an unreadable entry does nothing rather than copying a blank", () => {
    // The interface can never have offered this: readAll() filtered the row out,
    // so there was no bullet to tap. Belt and braces, because migrateEntry
    // reaches the map by id and not through readAll.
    const m = new Y.Map<unknown>();
    doc.transact(() => {
      m.set("id", "e1");
      m.set("pageKey", "2026-07-24");
      m.set("createdAt", "not a time");
      entries.push([m]);
    });
    migrateEntry("e1", "2026-07-25");
    expect(entries.length).toBe(1);
  });

  test("deleting an unreadable collection reports not-found rather than a broken undo", () => {
    const m = new Y.Map<unknown>();
    doc.transact(() => {
      m.set("id", "c1");
      m.set("createdAt", 1);
      collections.push([m]);
    });
    expect(removeCollection("c1")).toBeNull();
  });
});

describe("the tally", () => {
  test("says nothing when there is nothing to say", () => {
    expect(decodeFaultLine()).toBe("none");
  });

  test("names what was not shown and what was defaulted", () => {
    rawEntry({ ...goodEntry, id: undefined });
    rawEntry({ ...goodEntry, type: "habit-tick" });
    readAll();
    const line = decodeFaultLine();
    expect(line).toContain("1 not shown");
    expect(line).toContain("entry 1");
    expect(line).toContain("entry.type 1");
  });

  test("warns once per fault, not once per read", () => {
    // readAll() runs on any change to the doc and on several renders after it,
    // so a warning per occurrence would bury the first one, which is the only
    // one anybody will read.
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    rawEntry({ ...goodEntry, type: "habit-tick" });
    readAll();
    readAll();
    readAll();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(decodeFaults().repaired["entry.type"]).toBe(3);
  });

  test("carries no entry text, because it travels in a feedback report", () => {
    // The line goes into the diagnostics block, which promises to hold nothing
    // anybody wrote (lib/feedback.ts). It is built from record kinds and field
    // names out of this app's own vocabulary, never from a value in a record.
    rawEntry({
      ...goodEntry,
      text: "ring the clinic about the results",
      state: "delegated",
    });
    rawEntry({ ...goodEntry, id: undefined, text: "buy a birthday present" });
    readAll();
    const line = decodeFaultLine();
    expect(line).not.toContain("clinic");
    expect(line).not.toContain("birthday");
    expect(line).not.toContain("2026-07-24");
    expect(line).toContain("entry.state");
  });

  test("counts every occurrence even though it warns once", () => {
    rawEntry({ ...goodEntry, id: "a", state: "delegated" });
    rawEntry({ ...goodEntry, id: "b", state: "delegated" });
    readAll();
    expect(decodeFaults().repaired["entry.state"]).toBe(2);
  });
});
