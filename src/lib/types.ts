// Journlet entry model — purist Ryder Carroll notation throughout.

export type EntryType = "task" | "event" | "note";

export type EntryState = "open" | "done" | "struck" | "migrated";

export interface Entry {
  id: string;
  type: EntryType;
  text: string;
  priority: boolean;
  state: EntryState;
  /** Period the entry lives on: YYYY-MM-DD | YYYY-Www | YYYY-MM | YYYY */
  pageKey: string;
  createdAt: number;
  /** id of the original entry this one was migrated from, if any */
  migratedFrom?: string;
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

// × complete
export const STATE_GLYPH = { done: "×" } as const;

export const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
