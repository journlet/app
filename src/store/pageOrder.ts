// Nesting shape for a single page: which entry is really whose sub-bullet, and
// the render order that follows. Pure — no CRDT, no React — so the rules can be
// tested directly, and so the store and the UI can share one answer.
//
// This module is the single source of truth for the nesting tree. The store's
// write guards (journal.ts) and the rendered page both go through it, because
// when they disagreed the app lied: an action the UI offered would be refused
// by the store and quietly do nothing.

import type { Entry } from "../lib/types";
import { compareTop } from "../lib/order";
import type { EntryOrder } from "../lib/order";

/** The minimum an entry needs for its nesting to be resolved. */
export interface Nestable {
  id: string;
  parentId?: string;
}

/**
 * The parent each entry effectively has, given the whole page. Keyed by entry
 * id; a missing or undefined value means the entry sits at top level.
 *
 * The stored tree is resolved rather than trusted, because offline edits on two
 * devices can merge into shapes the UI would never write, and because deleting
 * or moving a parent leaves its sub-bullets pointing at an entry that is no
 * longer on the page. Every entry is walked up to the topmost ancestor still
 * present on the page:
 *   - parent not on the page → the entry rises to top level
 *   - grandchild (A under B, B under C) → A re-attaches to C, so the one-level
 *     rule (spec §4.1) holds however the stored tree got that way
 *   - an ancestor whose own parent has gone → the entry attaches to that
 *     ancestor, which is itself rising to top level
 *   - a cycle (A under B, B under A) → every entry in the cycle rises to top
 *     level, so nothing is hidden by a shape that has no top
 *
 * Resolution reads only the stored parents, never a value written during the
 * same pass, so the answer doesn't depend on the order entries are visited —
 * every device repairs the same merge the same way.
 */
export const effectiveParents = <T extends Nestable>(
  page: T[]
): Map<string, string | undefined> => {
  const byId = new Map<string, T>();
  for (const e of page) if (!byId.has(e.id)) byId.set(e.id, e);

  // The topmost ancestor of `from` still present on the page. Returns `from`
  // itself when it has no reachable parent, or when its chain closes a cycle.
  const topmost = (from: T): T => {
    const seen = new Set<string>();
    let cur = from;
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId)!;
    }
    return cur;
  };

  const out = new Map<string, string | undefined>();
  // Walked over byId rather than the list, so an id that appears twice (two
  // devices undoing the same delete) is resolved from the same row everything
  // else follows — otherwise the answer for an id could contradict the chain
  // walked through it, and the one-level rule would break on the output.
  for (const e of byId.values()) {
    const top = topmost(e);
    // Landing on itself means there was nothing above it to attach to
    out.set(e.id, top.id === e.id ? undefined : top.id);
  }
  return out;
};

/** Can `childId` be nested under `parentId`, given this page? (spec §4.1) */
export const canNest = <T extends Nestable>(
  page: T[],
  childId: string,
  parentId: string
): boolean => {
  if (childId === parentId) return false;
  const eff = effectiveParents(page);
  if (!eff.has(childId) || !eff.has(parentId)) return false;
  // One level deep: the parent must be top level, and the child must not
  // already be a parent itself
  if (eff.get(parentId) !== undefined) return false;
  for (const [, p] of eff) if (p === childId) return false;
  return true;
};

/**
 * Order one page: top-level entries by creation time, each followed by its own
 * sub-bullets in creation time order (one level deep, spec §4.1).
 *
 * A sub-bullet is drawn directly beneath its parent wherever that parent sits,
 * which is what lets an entry be nested under *any* entry on the page without
 * storing a position — `createdAt` stays the only sort key.
 *
 * `parentId` is rewritten on the entries passed in (fresh objects read out of
 * the doc, never the doc itself) to the effective parent, so the indent drawn
 * always matches the position: an entry can never be drawn as the child of
 * something it is not sitting under. Nothing is ever dropped or repeated,
 * whatever shape the stored tree was in.
 */
export const orderPage = (list: Entry[]): Entry[] => {
  // Stable sort, so entries logged in the same millisecond keep document order
  // — the order they were typed, and one Yjs converges on across devices
  list.sort((a, b) => a.createdAt - b.createdAt);
  const eff = effectiveParents(list);
  for (const e of list) e.parentId = eff.get(e.id);

  const kids = new Map<string, Entry[]>();
  for (const e of list) {
    if (!e.parentId) continue;
    const sibs = kids.get(e.parentId);
    if (sibs) sibs.push(e);
    else kids.set(e.parentId, [e]);
  }

  const ordered: Entry[] = [];
  const placed = new Set<string>();
  // Two rows can share an id — undoing the same delete on two devices merges
  // into exactly that — so guard against drawing one entry twice.
  const place = (e: Entry) => {
    if (placed.has(e.id)) return;
    placed.add(e.id);
    ordered.push(e);
  };
  for (const e of list) {
    if (e.parentId) continue;
    place(e);
    for (const child of kids.get(e.id) ?? []) place(child);
  }
  // Safety net: no tree, however broken, can make an entry vanish from its page
  for (const e of list)
    if (!placed.has(e.id)) {
      e.parentId = undefined;
      place(e);
    }
  return ordered;
};

/** Group all entries by page key, each page in render order. */
export const groupByPage = (list: Entry[]): Record<string, Entry[]> => {
  const days: Record<string, Entry[]> = {};
  for (const e of list) (days[e.pageKey] ??= []).push(e);
  for (const k of Object.keys(days)) days[k] = orderPage(days[k]);
  return days;
};

/**
 * Read one page in a different order (spec §4.9a, §11 Q16).
 *
 * Top-level entries move; a sub-bullet never does. It stays directly beneath
 * its parent wherever the parent lands, which is the same rule `orderPage`
 * follows and the reason a reading order needs no stored position: the page
 * is re-read, not rewritten, and `createdAt` is still the only thing the
 * journal holds about sequence.
 *
 * Applied after the filter, to what the filter left. An entry whose parent is
 * not in the list is drawn at top level rather than dropped, so this cannot
 * lose a row however it is called — the same promise `orderPage` makes.
 */
export const applyOrder = (page: Entry[], order: EntryOrder): Entry[] => {
  if (order === "logged") return page;

  const present = new Set(page.map((e) => e.id));
  const kids = new Map<string, Entry[]>();
  const tops: Entry[] = [];
  for (const e of page) {
    const parent = e.parentId && present.has(e.parentId) ? e.parentId : undefined;
    if (!parent) {
      tops.push(e);
      continue;
    }
    const sibs = kids.get(parent);
    if (sibs) sibs.push(e);
    else kids.set(parent, [e]);
  }

  // Sort a copy: the array belongs to the caller, and re-reading a page must
  // never be a write, however far from the store it happens.
  const ordered: Entry[] = [];
  for (const top of [...tops].sort(compareTop(order))) {
    ordered.push(top);
    for (const child of kids.get(top.id) ?? []) ordered.push(child);
  }
  return ordered;
};
