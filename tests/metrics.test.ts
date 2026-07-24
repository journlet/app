// Volume-size instrumentation (src/store/metrics.ts). Runs in the default node
// env; measureVolume is pure over the shared CRDT doc. logVolumeMetrics touches
// window/console and is browser-only, so it is not exercised here.

import { beforeEach, expect, test } from "vitest";
import { addEntry, collections, doc, entries, habits, recurrences } from "../src/store/journal";
import { measureVolume } from "../src/store/metrics";

beforeEach(() =>
  doc.transact(() => {
    entries.delete(0, entries.length);
    collections.delete(0, collections.length);
    habits.delete(0, habits.length);
    recurrences.delete(0, recurrences.length);
  })
);

test("reports a non-empty encoded doc and counts entries", () => {
  const before = measureVolume();
  expect(before.docBytes).toBeGreaterThan(0);
  expect(before.entries).toBe(0);

  addEntry("2026-07-24", "task", "measure me", false);
  const after = measureVolume();
  expect(after.entries).toBe(1);
  expect(after.docBytes).toBeGreaterThan(before.docBytes);
});
