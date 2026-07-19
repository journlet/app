// Journal store: one Yjs CRDT document, persisted locally via y-indexeddb.
// This is the same document that will later be encrypted and synced through
// Supabase Realtime (spec §4.5, §6) — no data migration needed then.

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Entry, EntryState, EntryType } from "../lib/types";
import { uid } from "../lib/types";

const DOC_NAME = "journlet-journal-v1";

export const doc = new Y.Doc();

// A single flat list of entries; each entry is a Y.Map so concurrent edits
// to different fields of the same entry merge cleanly. Pages are derived by
// grouping on the pageKey field, which makes "move" a one-field change.
export const entries = doc.getArray<Y.Map<unknown>>("entries");

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
  return m;
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
