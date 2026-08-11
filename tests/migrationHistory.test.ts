// The migratedFrom chain walk (src/ui/migrationHistory.ts), lifted out of App
// by Finding 18. Pure logic, so tested directly in the node environment.
//
// It had no test at all while it lived inline: EntryActionsSheet.test.tsx
// passes `sheetHistory: []` and every other test renders a view with hand-made
// props, so nothing exercised the walk that produces it.

import { describe, expect, test } from "vitest";
import {
  NO_HISTORY,
  buildMigrationHistory,
} from "../src/ui/migrationHistory";
import type { Entry } from "../src/lib/types";

const entry = (
  over: Partial<Entry> & { id: string; pageKey: string }
): Entry => ({
  type: "task",
  text: over.id,
  priority: false,
  state: "open",
  createdAt: 0,
  ...over,
});

const asDays = (entries: Entry[]): Record<string, Entry[]> => {
  const d: Record<string, Entry[]> = {};
  for (const e of entries) (d[e.pageKey] ||= []).push(e);
  return d;
};

describe("buildMigrationHistory", () => {
  test("no entry means no history", () => {
    expect(buildMigrationHistory({}, null)).toEqual([]);
  });

  test("an entry that has never moved has no history to show", () => {
    const a = entry({ id: "a", pageKey: "2026-07-01" });
    expect(buildMigrationHistory(asDays([a]), a)).toEqual([]);
  });

  test("a single-page chain returns the shared empty array, not a fresh one", () => {
    // The App-side memo hands this straight down as a prop. Returning a new []
    // each time would give a stable memo an unstable value.
    const a = entry({ id: "a", pageKey: "2026-07-01" });
    expect(buildMigrationHistory(asDays([a]), a)).toBe(NO_HISTORY);
    expect(buildMigrationHistory({}, null)).toBe(NO_HISTORY);
  });

  test("walks backwards from the entry in hand, oldest page first", () => {
    const a = entry({ id: "a", pageKey: "2026-07-01" });
    const b = entry({ id: "b", pageKey: "2026-07-02", migratedFrom: "a" });
    const c = entry({ id: "c", pageKey: "2026-07-03", migratedFrom: "b" });
    expect(buildMigrationHistory(asDays([a, b, c]), c)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  test("walks forwards too, so the middle of a chain sees both ends", () => {
    const a = entry({ id: "a", pageKey: "2026-07-01" });
    const b = entry({ id: "b", pageKey: "2026-07-02", migratedFrom: "a" });
    const c = entry({ id: "c", pageKey: "2026-07-03", migratedFrom: "b" });
    expect(buildMigrationHistory(asDays([a, b, c]), b)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  test("a chain crossing scopes keeps every page it touched", () => {
    const a = entry({ id: "a", pageKey: "2026-07-01" });
    const b = entry({ id: "b", pageKey: "2026-W31", migratedFrom: "a" });
    const c = entry({ id: "c", pageKey: "2026-08", migratedFrom: "b" });
    expect(buildMigrationHistory(asDays([a, b, c]), c)).toEqual([
      "2026-07-01",
      "2026-W31",
      "2026-08",
    ]);
  });

  test("a broken link stops the walk rather than dropping the entry", () => {
    // The predecessor was deleted. The entry still has a page of its own, and
    // one page is not a chain, so there is nothing to show.
    const b = entry({ id: "b", pageKey: "2026-07-02", migratedFrom: "gone" });
    expect(buildMigrationHistory(asDays([b]), b)).toEqual([]);
  });

  test("a broken link mid-chain keeps the half that resolves", () => {
    const b = entry({ id: "b", pageKey: "2026-07-02", migratedFrom: "gone" });
    const c = entry({ id: "c", pageKey: "2026-07-03", migratedFrom: "b" });
    expect(buildMigrationHistory(asDays([b, c]), c)).toEqual([
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  test("a cycle terminates instead of looping forever", () => {
    // Nothing in the store repairs a migratedFrom cycle, so the hop cap is the
    // only thing standing between this and a hung render.
    const a = entry({ id: "a", pageKey: "2026-07-01", migratedFrom: "b" });
    const b = entry({ id: "b", pageKey: "2026-07-02", migratedFrom: "a" });
    const out = buildMigrationHistory(asDays([a, b]), a);
    expect(out.length).toBeLessThanOrEqual(42);
    expect(out.length).toBeGreaterThan(1);
  });

  test("a long chain is capped rather than walked to the end", () => {
    const all: Entry[] = [];
    for (let i = 0; i < 30; i++) {
      all.push(
        entry({
          id: `e${i}`,
          pageKey: `2026-07-${String(i + 1).padStart(2, "0")}`,
          ...(i > 0 ? { migratedFrom: `e${i - 1}` } : {}),
        })
      );
    }
    const last = all[all.length - 1];
    const out = buildMigrationHistory(asDays(all), last);
    // 20 hops backwards plus the entry's own page
    expect(out).toHaveLength(21);
    expect(out[out.length - 1]).toBe(last.pageKey);
  });
});
