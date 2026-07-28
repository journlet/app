// Threading helpers (src/lib/threads.ts): labelling page references, choosing
// the targets offered, and deriving the reciprocal listing on a target page
// (spec §4.4 Threading).

import { describe, expect, test } from "vitest";
import {
  colIdFromKey,
  isColPageKey,
  pageRefLabel,
  threadTargets,
  threadedHere,
} from "../src/lib/threads";
import type { Collection, Entry } from "../src/lib/types";
import type { Scope } from "../src/lib/dates";

const collections: Collection[] = [
  { id: "c1", kind: "list", name: "Reading list", createdAt: 1 },
  { id: "c2", kind: "habits", name: "Routines", createdAt: 2 },
];

const nowKeys: Record<Scope, string> = {
  day: "2026-07-28",
  week: "2026-W31",
  month: "2026-07",
  year: "2026",
};

const entry = (over: Partial<Entry> & { id: string }): Entry => ({
  type: "task",
  text: "x",
  priority: false,
  state: "open",
  pageKey: "2026-07-28",
  createdAt: 0,
  ...over,
});

describe("page keys", () => {
  test("collection keys are recognised and unpacked", () => {
    expect(isColPageKey("col:c1")).toBe(true);
    expect(isColPageKey("2026-07-28")).toBe(false);
    expect(colIdFromKey("col:c1")).toBe("c1");
  });
});

describe("pageRefLabel", () => {
  test("names a collection by its own name", () => {
    expect(pageRefLabel("col:c1", collections)).toBe("Reading list");
  });

  test("names period pages absolutely, not relatively", () => {
    // a reference outlives the period it was written in, so "This week" would
    // start lying the following Monday
    expect(pageRefLabel("2026-W31", collections)).toBe("Week 31");
    expect(pageRefLabel("2026", collections)).toBe("2026");
  });

  test("says so plainly when the collection has gone", () => {
    expect(pageRefLabel("col:missing", collections)).toBe(
      "a deleted collection"
    );
  });
});

describe("threadTargets", () => {
  test("offers list collections and the current period pages", () => {
    const t = threadTargets("2026-07-28", collections, nowKeys);
    expect(t.map((x) => x.pageKey)).toEqual([
      "col:c1",
      "2026-W31",
      "2026-07",
      "2026",
    ]);
    // habit trackers hold no entries to relate to; today is the entry's own page
    expect(t.map((x) => x.label)).not.toContain("Routines");
    expect(t.map((x) => x.label)).not.toContain("Today");
  });

  test("excludes the collection an entry already lives on", () => {
    const t = threadTargets("col:c1", collections, nowKeys);
    expect(t.map((x) => x.pageKey)).not.toContain("col:c1");
    expect(t.map((x) => x.pageKey)).toContain("2026-07-28");
  });
});

describe("threadedHere", () => {
  const days: Record<string, Entry[]> = {
    "2026-07-27": [entry({ id: "b", pageKey: "2026-07-27", threads: ["col:c1"], createdAt: 2 })],
    "2026-07-28": [
      entry({ id: "a", threads: ["col:c1", "2026-W31"], createdAt: 1 }),
      entry({ id: "c", createdAt: 3 }),
    ],
    "col:c1": [entry({ id: "own", pageKey: "col:c1", createdAt: 4 })],
  };

  test("finds entries referencing the page, in page order", () => {
    expect(threadedHere("col:c1", days).map((e) => e.id)).toEqual(["b", "a"]);
  });

  test("period pages collect references too", () => {
    expect(threadedHere("2026-W31", days).map((e) => e.id)).toEqual(["a"]);
  });

  test("never lists the page's own entries or unrelated ones", () => {
    const ids = threadedHere("col:c1", days).map((e) => e.id);
    expect(ids).not.toContain("own");
    expect(ids).not.toContain("c");
  });
});
