// Journlet entry model — purist Ryder Carroll notation throughout.

import type { Scope } from "./dates";

/**
 * Every value of these unions, as a runtime list as well as a type.
 *
 * The list is what store/decode.ts checks an incoming field against, and the
 * type is derived from the list rather than written twice, so the two cannot
 * drift: adding a state without teaching the decoder about it is now impossible
 * rather than merely unlikely.
 */
export const ENTRY_TYPES = ["task", "event", "note"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_STATES = [
  "open",
  "done",
  "struck",
  "migrated",
  "scheduled",
] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

export interface Entry {
  id: string;
  type: EntryType;
  text: string;
  priority: boolean;
  /** ! signifier (spec §4.1) */
  inspiration?: boolean;
  /** parent entry id — sub-bullets one level deep (spec §4.1, §9) */
  parentId?: string;
  /** free-form details attached to the entry — notes, a read-later link, etc.
   *  Metadata only; never appears in quick capture, added later via the ⋯
   *  sheet (spec §9). Orthogonal to the purist glyphs — not a notation change. */
  details?: string;
  /** page keys this entry references — collections or period pages (spec §4.4
   *  Threading). The margin page number of the paper method: the entry stays
   *  where it happened and nothing is copied, so this is metadata only and
   *  the purist glyphs are untouched. The reciprocal listing on the target
   *  page is derived from these, never stored twice. */
  threads?: string[];
  state: EntryState;
  /** Period the entry lives on: YYYY-MM-DD | YYYY-Www | YYYY-MM | YYYY */
  pageKey: string;
  createdAt: number;
  /** id of the original entry this one was migrated from, if any */
  migratedFrom?: string;
  /** reminder time (epoch ms) — synced encrypted like all content (spec §4.6) */
  remindAt?: number;
  /** id of the recurrence rule that materialised this entry */
  recurrenceId?: string;
}

/**
 * The unit a repeat counts in.
 *
 * Deliberately not the same type as `Scope` in lib/dates.ts, though today it has
 * the same four members, and this comment used to say they should be unified. They
 * should not, because they are different things that happen to coincide: a `Scope`
 * is a kind of page the journal has, and a `RecurrenceUnit` is a cadence. The
 * foreseeable divergence goes one way only. "Every fortnight" is an ordinary thing
 * to want from a repeat and there is no fortnight page, so a unit could be added
 * that is not a scope; a page scope that is not a usable cadence is hard to
 * imagine.
 *
 * So the relationship is a subset, `Scope` ⊆ `RecurrenceUnit`, rather than an
 * equality, and it is load-bearing: on a week, month or year page the cadence is
 * locked to that page's scope, so a Scope is assigned straight into `unit` (see
 * saveRepeat in ui/EntryActionsSheet.tsx).
 *
 * The assertion below states that invariant. It is not the only thing that would
 * catch breaking it, and it is honest to say so: adding a page scope produces
 * about a dozen errors, mostly from the `Record<Scope, …>` tables that have to be
 * exhaustive. This is the one that names the rule rather than a consequence of it,
 * which is worth having when a reader is working out why the build went red.
 */
export const RECURRENCE_UNITS = ["day", "week", "month", "year"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

/** Compile-time only: every page scope must remain a usable cadence. */
const _scopeIsAUnit: RecurrenceUnit = "day" as Scope;
void _scopeIsAUnit;

/** A recurring entry rule; instances materialise client-side, no server */
export interface Recurrence {
  id: string;
  text: string;
  type: EntryType;
  priority: boolean;
  inspiration?: boolean;
  everyN: number;
  /** cadence unit; on non-day pages this always equals pageScope */
  unit: RecurrenceUnit;
  /**
   * Scope of the pages instances land on: day pages unless the rule was created
   * on a week, month or year page. Legacy rules default to "day".
   *
   * A `Scope`, not a `RecurrenceUnit`, which it was typed as until 28 August 2026
   * on the strength of the two unions being identical. Every consumer already
   * treated it as a scope: periodKey, SCOPE_NOW_WORD and shiftAnchor all take one,
   * and it compiled only because the members happened to line up. Typed as what it
   * is, so the day the two diverge this field stays correct.
   */
  pageScope: Scope;
  /** first occurrence day (YYYY-MM-DD); a day inside the first period */
  anchor: string;
  /** optional reminder time for each occurrence, "HH:MM" */
  remindTime?: string;
  /** occurrences up to and including this day already exist */
  materialisedThrough: string;
  /** planned end, as a date: the last day an occurrence may fall on (spec §11
   *  Q17). Stored as the day that was picked and projected onto the rule's
   *  pageScope when compared, so "until 30 September" means September is the
   *  last one on a monthly rule. Never set alongside endsAfter by intent. */
  endsOn?: string;
  /** planned end, as a count: how many occurrences in total, counted from the
   *  anchor in cadence steps rather than from rows in the journal, which can
   *  differ (spec §11 Q17). Never set alongside endsOn by intent. */
  endsAfter?: number;
  /** set when the user stops the recurrence by hand. A rule that has simply
   *  passed its planned end is spent without this being written (§11 Q17). */
  endedAt?: number;
  createdAt: number;
}

export const COLLECTION_KINDS = ["list", "habits"] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export interface Collection {
  id: string;
  kind: CollectionKind;
  name: string;
  createdAt: number;
}

export interface Habit {
  id: string;
  collectionId: string;
  name: string;
  createdAt: number;
  /** ISO day keys that are filled */
  marks: Record<string, true>;
}

/** Page key for a collection's entries (never matches a period key shape) */
export const colPageKey = (id: string): string => `col:${id}`;

// • task, ○ event, — note (never substituted, per spec §4.1)
export const GLYPH: Record<EntryType, string> = {
  task: "•",
  event: "○",
  note: "—",
};

// × complete, > migrated (moved to a current page), < scheduled (moved to a
// future page) — spec §4.1
export const STATE_GLYPH = { done: "×", migrated: ">", scheduled: "<" } as const;

/** Plain words for the task states, for anywhere a glyph alone would be a
 *  guess — pickers, read-only context rows, accessible labels (no-guessing
 *  rule). The glyphs themselves stay purist (spec §4.1); this never replaces
 *  one, it only ever accompanies it. */
export const STATE_WORD: Record<EntryState, string> = {
  open: "open",
  done: "completed",
  struck: "struck out",
  migrated: "migrated",
  scheduled: "scheduled",
};

export const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
