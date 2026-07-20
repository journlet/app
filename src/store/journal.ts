// Journal store: one Yjs CRDT document, persisted locally via y-indexeddb.
// This is the same document that will later be encrypted and synced through
// Supabase Realtime (spec §4.5, §6) — no data migration needed then.

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import type {
  Collection,
  CollectionKind,
  Entry,
  EntryState,
  EntryType,
  Habit,
} from "../lib/types";
import { colPageKey, uid } from "../lib/types";

const DOC_NAME = "journlet-journal-v1";

export const doc = new Y.Doc();

// A single flat list of entries; each entry is a Y.Map so concurrent edits
// to different fields of the same entry merge cleanly. Pages are derived by
// grouping on the pageKey field, which makes "move" a one-field change.
export const entries = doc.getArray<Y.Map<unknown>>("entries");

// Collections (spec §4.4): freeform named pages. List collections keep
// their entries in the same flat entries array under a col:<id> page key;
// habit trackers hold habits with per-day marks.
export const collections = doc.getArray<Y.Map<unknown>>("collections");
export const habits = doc.getArray<Y.Map<unknown>>("habits");

export const persistence = new IndexeddbPersistence(DOC_NAME, doc);

// ---------- reads ----------

const toEntry = (m: Y.Map<unknown>): Entry => ({
  id: m.get("id") as string,
  type: m.get("type") as EntryType,
  text: m.get("text") as string,
  priority: Boolean(m.get("priority")),
  state: m.get("state") as EntryState,
  pageKey: m.get("pageKey") as string,
  createdAt: m.get("createdAt") as number,
  migratedFrom: (m.get("migratedFrom") as string | undefined) ?? undefined,
  remindAt: (m.get("remindAt") as number | undefined) ?? undefined,
});

export const readAll = (): Entry[] => entries.map(toEntry);

const findMap = (id: string): Y.Map<unknown> | null => {
  for (let i = 0; i < entries.length; i++) {
    const m = entries.get(i);
    if (m.get("id") === id) return m;
  }
  return null;
};

const indexOfId = (id: string): number => {
  for (let i = 0; i < entries.length; i++) {
    if (entries.get(i).get("id") === id) return i;
  }
  return -1;
};

// ---------- writes ----------

const makeMap = (e: Entry): Y.Map<unknown> => {
  const m = new Y.Map<unknown>();
  m.set("id", e.id);
  m.set("type", e.type);
  m.set("text", e.text);
  m.set("priority", e.priority);
  m.set("state", e.state);
  m.set("pageKey", e.pageKey);
  m.set("createdAt", e.createdAt);
  if (e.migratedFrom) m.set("migratedFrom", e.migratedFrom);
  if (e.remindAt) m.set("remindAt", e.remindAt);
  return m;
};

export const setReminder = (id: string, remindAt: number | null): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() => {
    if (remindAt === null) m.delete("remindAt");
    else m.set("remindAt", remindAt);
  });
};

export const addEntry = (
  pageKey: string,
  type: EntryType,
  text: string,
  priority: boolean
): Entry => {
  const e: Entry = {
    id: uid(),
    type,
    text,
    priority,
    state: "open",
    pageKey,
    createdAt: Date.now(),
  };
  doc.transact(() => entries.push([makeMap(e)]));
  return e;
};

export const toggleDone = (id: string): void => {
  const m = findMap(id);
  if (!m || m.get("type") !== "task") return;
  doc.transact(() =>
    m.set("state", m.get("state") === "done" ? "open" : "done")
  );
};

export const cycleType = (id: string): void => {
  const m = findMap(id);
  if (!m || m.get("state") !== "open") return;
  const t = m.get("type") as EntryType;
  const next: EntryType = t === "task" ? "event" : t === "event" ? "note" : "task";
  doc.transact(() => m.set("type", next));
};

export const toggleStruck = (id: string): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() =>
    m.set("state", m.get("state") === "struck" ? "open" : "struck")
  );
};

export const setText = (id: string, text: string): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() => m.set("text", text));
};

export const moveTo = (id: string, targetPageKey: string): void => {
  const m = findMap(id);
  if (!m || m.get("pageKey") === targetPageKey) return;
  doc.transact(() => m.set("pageKey", targetPageKey));
};

export const removeEntry = (id: string): Entry | null => {
  const i = indexOfId(id);
  if (i === -1) return null;
  const snapshot = toEntry(entries.get(i));
  doc.transact(() => entries.delete(i, 1));
  return snapshot;
};

export const restoreEntry = (e: Entry): void => {
  doc.transact(() => entries.push([makeMap(e)]));
};

// Migrate: mark the original > on its old page, copy forward as open.
// Honest history — the original never moves or disappears (spec §4.3).
export const migrateEntry = (id: string, targetPageKey: string): void => {
  const m = findMap(id);
  if (!m) return;
  const original = toEntry(m);
  doc.transact(() => {
    m.set("state", "migrated");
    entries.push([
      makeMap({
        ...original,
        id: uid(),
        state: "open",
        pageKey: targetPageKey,
        createdAt: Date.now(),
        migratedFrom: original.id,
      }),
    ]);
  });
};

export const strikeEntry = (id: string): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() => m.set("state", "struck"));
};

// ---------- collections ----------

const toCollection = (m: Y.Map<unknown>): Collection => ({
  id: m.get("id") as string,
  kind: m.get("kind") as CollectionKind,
  name: m.get("name") as string,
  createdAt: m.get("createdAt") as number,
});

const toHabit = (m: Y.Map<unknown>): Habit => {
  const marks: Record<string, true> = {};
  (m.get("marks") as Y.Map<unknown>).forEach((_v, k) => (marks[k] = true));
  return {
    id: m.get("id") as string,
    collectionId: m.get("collectionId") as string,
    name: m.get("name") as string,
    createdAt: m.get("createdAt") as number,
    marks,
  };
};

export const readCollections = (): Collection[] =>
  collections.map(toCollection).sort((a, b) => a.createdAt - b.createdAt);

export const readHabits = (): Habit[] => habits.map(toHabit);

const makeCollectionMap = (c: Collection): Y.Map<unknown> => {
  const m = new Y.Map<unknown>();
  m.set("id", c.id);
  m.set("kind", c.kind);
  m.set("name", c.name);
  m.set("createdAt", c.createdAt);
  return m;
};

const makeHabitMap = (h: Habit): Y.Map<unknown> => {
  const m = new Y.Map<unknown>();
  m.set("id", h.id);
  m.set("collectionId", h.collectionId);
  m.set("name", h.name);
  m.set("createdAt", h.createdAt);
  const marks = new Y.Map<unknown>();
  Object.keys(h.marks).forEach((k) => marks.set(k, true));
  m.set("marks", marks);
  return m;
};

export const addCollection = (kind: CollectionKind, name: string): Collection => {
  const c: Collection = { id: uid(), kind, name, createdAt: Date.now() };
  doc.transact(() => collections.push([makeCollectionMap(c)]));
  return c;
};

export const addHabit = (collectionId: string, name: string): Habit => {
  const h: Habit = { id: uid(), collectionId, name, createdAt: Date.now(), marks: {} };
  doc.transact(() => habits.push([makeHabitMap(h)]));
  return h;
};

export const toggleHabitMark = (habitId: string, dayKey: string): void => {
  for (let i = 0; i < habits.length; i++) {
    const m = habits.get(i);
    if (m.get("id") !== habitId) continue;
    const marks = m.get("marks") as Y.Map<unknown>;
    doc.transact(() => {
      if (marks.has(dayKey)) marks.delete(dayKey);
      else marks.set(dayKey, true);
    });
    return;
  }
};

export interface CollectionSnapshot {
  collection: Collection;
  entries: Entry[];
  habits: Habit[];
}

// Delete a collection with everything on it; returns a snapshot for undo
export const removeCollection = (id: string): CollectionSnapshot | null => {
  let ci = -1;
  for (let i = 0; i < collections.length; i++) {
    if (collections.get(i).get("id") === id) ci = i;
  }
  if (ci === -1) return null;
  const pk = colPageKey(id);
  const snap: CollectionSnapshot = {
    collection: toCollection(collections.get(ci)),
    entries: readAll().filter((e) => e.pageKey === pk),
    habits: readHabits().filter((h) => h.collectionId === id),
  };
  doc.transact(() => {
    collections.delete(ci, 1);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries.get(i).get("pageKey") === pk) entries.delete(i, 1);
    }
    for (let i = habits.length - 1; i >= 0; i--) {
      if (habits.get(i).get("collectionId") === id) habits.delete(i, 1);
    }
  });
  return snap;
};

export const restoreCollection = (snap: CollectionSnapshot): void => {
  doc.transact(() => {
    collections.push([makeCollectionMap(snap.collection)]);
    snap.entries.forEach((e) => entries.push([makeMap(e)]));
    snap.habits.forEach((h) => habits.push([makeHabitMap(h)]));
  });
};
