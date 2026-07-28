// Threading (spec §4.4): page references carried by an entry — the margin
// page number of the paper method. Pure helpers shared by the entry sheet,
// the entry line and the back-reference sections; the store owns the writes.

import { SCOPES, SCOPE_LABEL, keyScope, pageLabel } from "./dates";
import type { Scope } from "./dates";
import type { Collection, Entry } from "./types";
import { colPageKey } from "./types";

const COL_PREFIX = "col:";

export const isColPageKey = (pk: string): boolean => pk.startsWith(COL_PREFIX);

export const colIdFromKey = (pk: string): string => pk.slice(COL_PREFIX.length);

/**
 * Plain wording for a page reference. Collections read as their own name;
 * period pages read as the period, named absolutely ("Week 31", "Jul 2026")
 * rather than relatively ("this week"), because a reference outlives the
 * period it was written in — exactly as a page number does on paper.
 */
export const pageRefLabel = (pk: string, collections: Collection[]): string => {
  if (isColPageKey(pk)) {
    const id = colIdFromKey(pk);
    return collections.find((c) => c.id === id)?.name ?? "a deleted collection";
  }
  return keyScope(pk) ? pageLabel(pk) : pk;
};

export interface ThreadTarget {
  pageKey: string;
  label: string;
  /** what kind of page this is, or which period — shown beside the label */
  hint?: string;
}

/**
 * Pages an entry can be threaded to: every collection — habit trackers
 * included — plus the four current period pages, minus the page the entry
 * already lives on. Deliberately not every past and future page: the picker
 * stays a glance, and a reference to an arbitrary past day is a use case
 * nobody has asked for yet.
 *
 * Habit trackers were excluded at first on the grounds that they hold no
 * entry list for the reciprocal listing to sit in. That was backwards: the
 * method threads page numbers, and every page has a number regardless of
 * what is drawn on it, so the tracker's own layout was never a reason to
 * refuse. The listing goes under the grid instead (spec §4.4).
 */
export const threadTargets = (
  ownPageKey: string,
  collections: Collection[],
  nowKeys: Record<Scope, string>
): ThreadTarget[] => {
  const periods: ThreadTarget[] = SCOPES.filter(
    (sc) => nowKeys[sc] !== ownPageKey
  ).map((sc) => ({
    pageKey: nowKeys[sc],
    label: SCOPE_LABEL[sc],
    hint: pageLabel(nowKeys[sc]),
  }));
  const cols: ThreadTarget[] = collections
    .filter((c) => colPageKey(c.id) !== ownPageKey)
    .map((c) => ({
      pageKey: colPageKey(c.id),
      label: c.name,
      hint: c.kind === "habits" ? "habit tracker" : "collection",
    }));
  return [...cols, ...periods];
};

/**
 * Entries elsewhere in the journal that reference this page — the reciprocal
 * margin number, derived rather than stored so a merge can never leave half a
 * pair. Ordered by page then creation, so the list reads chronologically.
 */
export const threadedHere = (
  pageKey: string,
  days: Record<string, Entry[]>
): Entry[] =>
  Object.values(days)
    .flat()
    .filter((e) => e.pageKey !== pageKey && e.threads?.includes(pageKey))
    .sort((a, b) =>
      a.pageKey === b.pageKey
        ? a.createdAt - b.createdAt
        : a.pageKey < b.pageKey
          ? -1
          : 1
    );
