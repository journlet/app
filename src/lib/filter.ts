// Entry visibility filter (remediation item 7). A one-page spread grows
// crowded with everything that has already been dealt with, so the journal
// gets a plainly labelled filter row: all / tasks only / open only.
//
// Filtering hides rows; it never touches notation. A completed task is still
// × when shown, never a different glyph and never rewritten — visibility is
// the only thing this file decides (spec §4.1, purist notation).

import type { Entry } from "./types";

export type EntryFilter = "all" | "tasks" | "open";

export const FILTERS: EntryFilter[] = ["all", "tasks", "open"];

/** Button wording. Spelled out — no icon, no glyph, nothing to work out. */
export const FILTER_LABEL: Record<EntryFilter, string> = {
  all: "all",
  tasks: "tasks only",
  open: "open only",
};

/** What the current filter is keeping out, said in words under the row, so a
 *  missing entry is never a mystery (no-guessing rule). */
export const FILTER_NOTE: Record<EntryFilter, string> = {
  all: "showing everything on the page",
  tasks: "hiding notes and events",
  open: "hiding completed, struck out, migrated and scheduled",
};

/** The badge value on a narrow screen. "menu", a named filter and a signed-out
 *  sync badge together overrun a 375px header — measured, not guessed — so the
 *  value drops its second word there, exactly as the section nav drops
 *  "previous" for "prev". The full wording stays in the accessible name and in
 *  the row itself, so nothing is lost, only shortened. */
export const FILTER_SHORT: Record<EntryFilter, string> = {
  all: "",
  tasks: "tasks",
  open: "open",
};

/** The header badge, which has to carry the state while the row is closed:
 *  a page can be filtered with the control out of sight, so the button says
 *  which filter is on rather than only that one is. Same shape as the sync
 *  badge ("sync · offline"), for the same reason. */
export const filterBadge = (f: EntryFilter): string =>
  f === "all" ? "filter" : `filter · ${FILTER_LABEL[f]}`;

/** Accessible name for each button — the note as a sentence. */
export const FILTER_ARIA: Record<EntryFilter, string> = {
  all: "Show all entries",
  tasks: "Show tasks only, hiding notes and events",
  open: "Show open only, hiding completed, struck out, migrated and scheduled entries",
};

/**
 * Does this entry survive the filter on its own merits?
 *
 * "open" is state-based rather than type-based, so a note or an event stays
 * on the page — neither has an open/closed life, and a journal with its notes
 * stripped out is no longer the day's record. Striking a note out does close
 * it, and that one is hidden.
 */
export const entryVisible = (e: Entry, f: EntryFilter): boolean => {
  if (f === "all") return true;
  if (f === "tasks") return e.type === "task";
  return e.state === "open";
};

/**
 * Apply the filter to one page's entries, in page order.
 *
 * A hidden parent whose sub-bullet survives is kept as context: an indented
 * bullet with nothing above it reads as a mistake, and the branch it belongs
 * to is the point of nesting. So "open only" on a completed parent with one
 * open child shows both — the outstanding work is what you came for, and the
 * line it sits under is what makes it mean anything.
 */
export const applyFilter = (entries: Entry[], f: EntryFilter): Entry[] => {
  if (f === "all") return entries;
  const kept = new Set<string>();
  const parents = new Set<string>();
  entries.forEach((e) => {
    if (!entryVisible(e, f)) return;
    kept.add(e.id);
    if (e.parentId) parents.add(e.parentId);
  });
  return entries.filter((e) => kept.has(e.id) || parents.has(e.id));
};

const KEY = "journlet-filter-v1";
const OPEN_KEY = "journlet-filter-open-v1";

/** Persisted like the sticky capture prefs: a filter you chose is a way of
 *  reading your journal, not a one-off, and it survives a relaunch. */
export const loadFilter = (): EntryFilter => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && (FILTERS as string[]).includes(raw)
      ? (raw as EntryFilter)
      : "all";
  } catch {
    return "all";
  }
};

export const saveFilter = (f: EntryFilter): void => {
  try {
    localStorage.setItem(KEY, f);
  } catch {
    // storage unavailable (private mode etc.) — the choice simply won't
    // survive a relaunch
  }
};

/** Is the filter row showing? The row itself is chrome, so it starts closed
 *  and the header badge is the way in — but a row you deliberately opened
 *  stays open across launches, like the future log's folds. Never affects
 *  what is filtered: closing the row hides the control, not its effect. */
export const loadFilterOpen = (): boolean => {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
};

export const saveFilterOpen = (open: boolean): void => {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // storage unavailable — the row simply starts closed next launch
  }
};
