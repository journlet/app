// Migration history for one entry: the chain of pages a task has been carried
// across, walked in both directions from the entry in hand (spec §4.3).
//
// Lifted out of App unchanged, for two reasons. It walks the whole journal and
// builds two Maps, so the App-side call has to be memoised (Finding 18), and a
// memo is only worth having if something proves it holds. Both are testable
// here and neither was reachable inline. Pure: reads the snapshot, writes
// nothing, exactly like ./spreadData.

import type { Entry } from "../lib/types";

/**
 * Shared empty result. Returned by identity rather than as a fresh `[]` so a
 * closed sheet hands the same array down on every render.
 */
export const NO_HISTORY: string[] = [];

/**
 * How far to follow the chain in each direction. A migratedFrom cycle would
 * otherwise loop forever; the resolver in store/pageOrder repairs cycles in
 * the nesting tree, but nothing repairs this one, so the cap is the guard.
 */
const MAX_HOPS = 20;

/**
 * The page keys `entry` has lived on, oldest first, or an empty array when it
 * has only ever been on one page. Callers render this as a trail, so a
 * single-page "chain" is nothing to show rather than a chain of one.
 */
export function buildMigrationHistory(
  days: Record<string, Entry[]>,
  entry: Entry | null
): string[] {
  if (!entry) return NO_HISTORY;
  const all = Object.values(days).flat();
  const byId = new Map(all.map((e) => [e.id, e]));
  const byFrom = new Map(
    all.filter((e) => e.migratedFrom).map((e) => [e.migratedFrom as string, e])
  );
  const chain: string[] = [entry.pageKey];
  let cur: Entry | undefined = entry;
  for (let i = 0; i < MAX_HOPS && cur?.migratedFrom; i++) {
    cur = byId.get(cur.migratedFrom);
    if (!cur) break;
    chain.unshift(cur.pageKey);
  }
  cur = entry;
  for (let i = 0; i < MAX_HOPS; i++) {
    cur = byFrom.get(cur!.id);
    if (!cur) break;
    chain.push(cur.pageKey);
  }
  return chain.length > 1 ? chain : NO_HISTORY;
}
