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
