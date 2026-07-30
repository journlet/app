import { describe, expect, test } from "vitest";
import {
  MAX_HITS,
  detailsSnippet,
  highlight,
  normalise,
  searchJournal,
  tokenise,
} from "../src/lib/search";
import type { Collection, Entry, Habit } from "../src/lib/types";
import { colPageKey } from "../src/lib/types";

let seq = 0;
const entry = (over: Partial<Entry> & { text: string; pageKey: string }): Entry => ({
  id: `e${++seq}`,
  type: "task",
  priority: false,
  state: "open",
  createdAt: seq,
  ...over,
});

const daysOf = (...list: Entry[]): Record<string, Entry[]> => {
  const days: Record<string, Entry[]> = {};
  for (const e of list) (days[e.pageKey] ??= []).push(e);
  return days;
};

const run = (
  q: string,
  days: Record<string, Entry[]>,
  collections: Collection[] = [],
  habits: Habit[] = []
) => searchJournal(q, days, collections, habits);

const texts = (r: ReturnType<typeof run>) =>
  r.groups.flatMap((g) => g.hits.map((h) => h.entry.text));

describe("normalise and tokenise", () => {
  test("folds case and diacritics", () => {
    expect(normalise("Café")).toBe("cafe");
    expect(normalise("ÀÉÎÕÜ")).toBe("aeiou");
  });

  test("splits a query into words and drops empties", () => {
    expect(tokenise("  book   Ticket ")).toEqual(["book", "ticket"]);
    expect(tokenise("   ")).toEqual([]);
  });
});

describe("searchJournal", () => {
  test("an empty query finds nothing rather than everything", () => {
    const days = daysOf(entry({ text: "call the vet", pageKey: "2026-07-30" }));
    expect(run("", days).entryCount).toBe(0);
    expect(run("   ", days).groups).toEqual([]);
  });

  test("matches entry text, case and accent insensitively", () => {
    const days = daysOf(entry({ text: "Book café table", pageKey: "2026-07-30" }));
    expect(texts(run("cafe", days))).toEqual(["Book café table"]);
    expect(texts(run("CAFÉ", days))).toEqual(["Book café table"]);
  });

  test("every word must appear — words are ANDed, not ORed", () => {
    const days = daysOf(
      entry({ text: "book the vet", pageKey: "2026-07-30" }),
      entry({ text: "book a table", pageKey: "2026-07-30" })
    );
    expect(texts(run("book vet", days))).toEqual(["book the vet"]);
    expect(run("book unicorn", days).entryCount).toBe(0);
  });

  test("words may match across different fields of the same entry", () => {
    const days = daysOf(
      entry({
        text: "call plumber",
        details: "quote was 240 pounds",
        pageKey: "2026-07-30",
      })
    );
    const r = run("plumber quote", days);
    expect(r.entryCount).toBe(1);
    expect(r.groups[0].hits[0].fields).toEqual(["text", "details"]);
  });

  test("finds an entry by its details alone", () => {
    const days = daysOf(
      entry({ text: "renew it", details: "policy number QX-7741", pageKey: "2026-07-30" })
    );
    const r = run("qx-7741", days);
    expect(r.entryCount).toBe(1);
    expect(r.groups[0].hits[0].fields).toEqual(["details"]);
  });

  test("includes done, struck and migrated entries — a lost entry is often finished", () => {
    const days = daysOf(
      entry({ text: "ring dentist", state: "done", pageKey: "2026-07-28" }),
      entry({ text: "ring bank", state: "struck", pageKey: "2026-07-28" }),
      entry({ text: "ring school", state: "migrated", pageKey: "2026-07-28" }),
      entry({ text: "ring vet", state: "scheduled", pageKey: "2026-07-28" })
    );
    expect(run("ring", days).entryCount).toBe(4);
  });

  test("finds entries by the page they are threaded to", () => {
    const cols: Collection[] = [
      { id: "c1", kind: "list", name: "Reading list", createdAt: 1 },
    ];
    const days = daysOf(
      entry({
        text: "the long ships",
        threads: [colPageKey("c1")],
        pageKey: "2026-07-30",
      })
    );
    const r = run("reading list", days, cols);
    expect(r.entryCount).toBe(1);
    expect(r.groups[0].hits[0].fields).toEqual(["thread"]);
  });

  test("groups hits by page, newest page and newest entry first", () => {
    const days = daysOf(
      entry({ text: "old note", pageKey: "2026-07-01", createdAt: 10 }),
      entry({ text: "new note", pageKey: "2026-07-30", createdAt: 30 }),
      entry({ text: "newer note", pageKey: "2026-07-30", createdAt: 40 })
    );
    const r = run("note", days);
    expect(r.groups.map((g) => g.pageKey)).toEqual(["2026-07-30", "2026-07-01"]);
    expect(texts(r)).toEqual(["newer note", "new note", "old note"]);
  });

  test("labels a period page and a collection page in plain words", () => {
    const cols: Collection[] = [
      { id: "c1", kind: "list", name: "Reading list", createdAt: 1 },
    ];
    const days = daysOf(
      entry({ text: "a book", pageKey: colPageKey("c1"), createdAt: 20 }),
      entry({ text: "a book", pageKey: "2026-07", createdAt: 10 })
    );
    const r = run("book", days, cols);
    expect(r.groups.map((g) => g.label)).toEqual(["Reading list", "Jul 2026"]);
  });

  test("matches collection and habit names as pages, not entries", () => {
    const cols: Collection[] = [
      { id: "c1", kind: "list", name: "Reading list", createdAt: 1 },
      { id: "c2", kind: "habits", name: "Health", createdAt: 2 },
    ];
    const habits: Habit[] = [
      { id: "h1", collectionId: "c2", name: "Read 20 minutes", createdAt: 3, marks: {} },
    ];
    const r = run("read", {}, cols, habits);
    expect(r.entryCount).toBe(0);
    expect(r.pageHits).toEqual([
      { kind: "collection", collectionId: "c1", name: "Reading list" },
      {
        kind: "habit",
        collectionId: "c2",
        name: "Read 20 minutes",
        parentName: "Health",
      },
    ]);
  });

  test("caps the hit list, reports the true total, and keeps the newest", () => {
    // One entry per day page, oldest page inserted first — the order the
    // store hands them over. Capping before ordering would keep exactly the
    // oldest 300 and drop the entry you wrote this morning.
    const dayKey = (i: number) => {
      const d = new Date(2025, 0, 1);
      d.setDate(d.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    };
    const many = Array.from({ length: MAX_HITS + 20 }, (_, i) =>
      entry({ text: `note ${i}`, pageKey: dayKey(i), createdAt: i })
    );
    const r = run("note", daysOf(...many));
    expect(r.entryCount).toBe(MAX_HITS);
    expect(r.totalCount).toBe(MAX_HITS + 20);
    expect(r.truncated).toBe(true);
    const kept = texts(r);
    expect(kept[0]).toBe(`note ${MAX_HITS + 19}`);
    expect(kept).not.toContain("note 0");
    expect(kept).not.toContain("note 19");
    expect(kept).toContain("note 20");
  });

  test("an uncapped search is not marked truncated", () => {
    const days = daysOf(entry({ text: "note", pageKey: "2026-07-30" }));
    const r = run("note", days);
    expect(r.totalCount).toBe(1);
    expect(r.truncated).toBe(false);
  });
});

describe("highlight", () => {
  test("marks the matched run and leaves the rest alone", () => {
    expect(highlight("book a table", ["book"])).toEqual([
      { text: "book", hit: true },
      { text: " a table", hit: false },
    ]);
  });

  test("marks every occurrence, and each word of a multi-word query", () => {
    expect(highlight("vet then vet again", ["vet"]).filter((s) => s.hit)).toHaveLength(2);
    expect(highlight("book a table", ["book", "table"]).filter((s) => s.hit)).toHaveLength(2);
  });

  test("maps back to the text as written — accents and case survive", () => {
    expect(highlight("Café Nero", ["cafe"])).toEqual([
      { text: "Café", hit: true },
      { text: " Nero", hit: false },
    ]);
  });

  test("keeps a decomposed accent inside the mark, not orphaned after it", () => {
    // Text typed on a Mac or iPhone arrives decomposed: "e" + combining acute.
    // Ending the mark one past the "e" leaves the accent stranded outside it.
    const nfd = "Cafe\u0301 Nero";
    const segs = highlight(nfd, ["cafe"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["Cafe\u0301"]);
    expect(segs.map((s) => s.text).join("")).toBe(nfd);
  });

  test("a match at the very end of decomposed text keeps its mark", () => {
    const nfd = "go to cafe\u0301";
    const segs = highlight(nfd, ["cafe"]);
    expect(segs).toEqual([
      { text: "go to ", hit: false },
      { text: "cafe\u0301", hit: true },
    ]);
  });


  test("merges overlapping matches rather than nesting them", () => {
    expect(highlight("bookcase", ["book", "ookc"])).toEqual([
      { text: "bookc", hit: true },
      { text: "ase", hit: false },
    ]);
  });

  test("no query, or no match, is one plain run", () => {
    expect(highlight("plain", [])).toEqual([{ text: "plain", hit: false }]);
    expect(highlight("plain", ["zzz"])).toEqual([{ text: "plain", hit: false }]);
  });
});

describe("detailsSnippet", () => {
  test("short details are returned whole", () => {
    expect(detailsSnippet("a short note", ["note"])).toBe("a short note");
  });

  test("long details are cut around the first match", () => {
    const long = "x".repeat(200) + " needle " + "y".repeat(200);
    const snip = detailsSnippet(long, ["needle"]);
    expect(snip).toContain("needle");
    expect(snip.length).toBeLessThan(140);
    expect(snip.startsWith("…")).toBe(true);
    expect(snip.endsWith("…")).toBe(true);
  });

  test("the window lands on the match even when accents shift the offsets", () => {
    // Every dropped combining mark pulls the folded offset ahead of the real
    // one, so a folded offset used to slice the original misses the match
    const long = "é".repeat(120) + " needle " + "y".repeat(200);
    expect(detailsSnippet(long, ["needle"])).toContain("needle");
  });
});
