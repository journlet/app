// Journlet entry model — purist Ryder Carroll notation throughout.

export type EntryType = "task" | "event" | "note";

export type EntryState = "open" | "done" | "struck" | "migrated" | "scheduled";

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

export type RecurrenceUnit = "day" | "week" | "month" | "year";

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
  /** scope of the pages instances land on (day pages unless the rule was
   *  created on a week/month/year page). Legacy rules default to "day". */
  pageScope: RecurrenceUnit;
  /** first occurrence day (YYYY-MM-DD); a day inside the first period */
  anchor: string;
  /** optional reminder time for each occurrence, "HH:MM" */
  remindTime?: string;
  /** occurrences up to and including this day already exist */
  materialisedThrough: string;
  /** set when the user stops the recurrence */
  endedAt?: number;
  createdAt: number;
}

export type CollectionKind = "list" | "habits";

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

export const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
