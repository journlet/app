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
  Recurrence,
} from "../lib/types";
import {
  COLLECTION_KINDS,
  ENTRY_STATES,
  ENTRY_TYPES,
  RECURRENCE_UNITS,
  colPageKey,
  uid,
} from "../lib/types";
import {
  readCount,
  readKeys,
  readNumber,
  readOneOf,
  readString,
  rejectRecord,
  repairField,
} from "./decode";
import { isFutureKey } from "../lib/dates";
import { docNameForVolume, getActiveVolume } from "../lib/volume";
import { REMOTE_ORIGIN_TAG } from "../lib/storageKeys";
import { canNest } from "./pageOrder";
import type { Nestable } from "./pageOrder";

// Origin tag for updates applied from the sync layer (shared so other
// modules can distinguish remote from local changes). The literal lives in
// lib/storageKeys.ts with every other `journlet-` name, so the inventory that
// the erase enumerates can be checked exhaustively.
export const REMOTE_ORIGIN = REMOTE_ORIGIN_TAG;

// Per-volume IndexedDB name. With the default volume this is still
// `journlet-journal-v1`, so existing local journals load unchanged.
const DOC_NAME = docNameForVolume(getActiveVolume());

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

// Recurring entry rules; instances are ordinary entries tagged with
// recurrenceId, materialised client-side (no server-side code)
export const recurrences = doc.getArray<Y.Map<unknown>>("recurrences");

// Device register (decision 28 Jul, Gary). Deliberately inside the journal
// doc rather than a Supabase table: as a table it would be plaintext device
// labels, platforms and last-seen times sitting beside the ciphertext, which
// is the metadata §6.4 says we do not hold — activity times and device count
// are not nothing. In the doc it is encrypted like everything else and the
// server learns none of it.
//
// Informational only, never a security boundary. It cannot be otherwise: a
// device holding the data key can write to this map as freely as any other,
// so a compromised device can remove or rename its own row. Its actual worth
// is that you can see three devices when you expected two, which is how you
// would learn you had been compromised at all. A Y.Map keyed by device id
// means two devices registering at once cannot collide.
export const devices = doc.getMap<Y.Map<unknown>>("devices");

/**
 * The credential register: which saved passkey route is which (§6.1l, 13 August
 * 2026). Here rather than in a `keeper_wraps` column for the reason the device
 * register is here — a row naming its credential would tell the operator which
 * password manager somebody uses (§6.5) — and keyed by the wrap id the server
 * already holds. Informational, like `devices`: see store/credentials.ts.
 */
export const credentials = doc.getMap<Y.Map<unknown>>("credentials");

export const persistence = new IndexeddbPersistence(DOC_NAME, doc);

/**
 * Erase this volume's journal from local IndexedDB (explicit sign-out, item
 * 11). The in-memory doc is untouched, so callers reload the app straight
 * after to start from an empty, freshly persisted document.
 */
export const wipeLocalJournal = (): Promise<void> => persistence.clearData();

// ---------- reads ----------

// Threads are held as a Y.Map keyed by page key (value always true) rather
// than an array: two devices threading the same entry to different pages
// both survive the merge, and threading to the same page twice can't
// duplicate. Read back as a sorted list so render order is stable.
const readThreads = (m: Y.Map<unknown>): string[] | undefined => {
  const keys = readKeys(m, "threads");
  return keys.length > 0 ? keys : undefined;
};

/**
 * An entry, or null if there is nowhere to put it.
 *
 * Three fields are load-bearing rather than merely present. Without an id it
 * cannot be found, edited or deleted; without a page key there is no page to
 * draw it on; without a created time it has no place in any order, and a NaN
 * spreads through every comparison that touches it. Everything else degrades:
 * see store/decode.ts for why repairing beats rejecting on the rest.
 */
const toEntry = (m: Y.Map<unknown>): Entry | null => {
  const id = readString(m, "id");
  if (!id) return rejectRecord("entry", "no id");
  const pageKey = readString(m, "pageKey");
  if (!pageKey) return rejectRecord("entry", "no page key");
  const createdAt = readNumber(m, "createdAt");
  if (createdAt === undefined)
    return rejectRecord("entry", "no created time");
  return {
    id,
    // An unknown type draws no bullet at all, because GLYPH has no entry for it,
    // and an entry with no bullet is not notation. A note is the least
    // assertive of the three: it claims nothing about being done or happening.
    type:
      readOneOf(m, "type", ENTRY_TYPES) ??
      repairField("entry", "type", "note" as const),
    // Missing text is shown as empty rather than dropped: the entry keeps its
    // place, is visibly wrong, and can be typed into.
    text: readString(m, "text") ?? repairField("entry", "text", ""),
    priority: Boolean(m.get("priority")),
    inspiration: Boolean(m.get("inspiration")) || undefined,
    parentId: readString(m, "parentId"),
    details: readString(m, "details"),
    threads: readThreads(m),
    state:
      readOneOf(m, "state", ENTRY_STATES) ??
      repairField("entry", "state", "open" as const),
    pageKey,
    createdAt,
    migratedFrom: readString(m, "migratedFrom"),
    remindAt: readNumber(m, "remindAt"),
    recurrenceId: readString(m, "recurrenceId"),
  };
};

export const readAll = (): Entry[] =>
  entries.map(toEntry).filter((e): e is Entry => e !== null);

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
  if (e.inspiration) m.set("inspiration", true);
  if (e.parentId) m.set("parentId", e.parentId);
  if (e.details) m.set("details", e.details);
  if (e.migratedFrom) m.set("migratedFrom", e.migratedFrom);
  if (e.remindAt) m.set("remindAt", e.remindAt);
  if (e.recurrenceId) m.set("recurrenceId", e.recurrenceId);
  return m;
};

/**
 * Append an entry to the shared array, including any page references it
 * carries. The threads sub-map is attached after the entry map is in the
 * document rather than while it is still preliminary: a Yjs type nested
 * inside another un-integrated type doesn't carry its content across, which
 * silently dropped references on migrated copies and undone deletes.
 * Callers wrap this in their own transaction.
 */
const pushEntry = (e: Entry): void => {
  const m = makeMap(e);
  entries.push([m]);
  // never reference the page the entry itself lives on
  const refs = (e.threads ?? []).filter((pk) => pk !== e.pageKey);
  if (refs.length === 0) return;
  const t = new Y.Map<unknown>();
  m.set("threads", t);
  refs.forEach((pk) => t.set(pk, true));
};

/** Insert a fully-formed entry (used by the recurrence materialiser). */
export const insertEntry = (e: Entry): void => {
  doc.transact(() => pushEntry(e));
};

export const tagEntryRecurrence = (id: string, ruleId: string): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() => m.set("recurrenceId", ruleId));
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
  priority: boolean,
  inspiration = false,
  details = "",
  /** nest the new entry under this parent (spec §4.1, one level deep). The
   *  parent must be a top-level entry on the same page; anything else is
   *  ignored and the entry lands at top level rather than being lost. */
  parentId?: string
): Entry => {
  const trimmedDetails = details.trim();
  const id = uid();
  // Same resolver the page is drawn with, so a parent the UI offered is never
  // silently refused here — the entry would land at top level while the capture
  // form still claimed it was nesting.
  const parentOk = Boolean(
    parentId &&
      findMap(parentId)?.get("pageKey") === pageKey &&
      canNest([...pageNesting(pageKey), { id }], id, parentId)
  );
  const e: Entry = {
    id,
    type,
    text,
    priority,
    inspiration: inspiration || undefined,
    details: trimmedDetails || undefined,
    parentId: parentOk ? parentId : undefined,
    state: "open",
    pageKey,
    createdAt: Date.now(),
  };
  doc.transact(() => pushEntry(e));
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

/**
 * Set or clear a signifier on an existing entry (spec §4.1a, added 26 August
 * 2026). A non-priority becomes a priority: the commonest change there was no
 * way to make, since * and ! could only be chosen at capture.
 *
 * Lossless and exactly self-reversing — nothing else about the entry moves,
 * the bullet included, because a signifier is a mark on an entry and not a
 * kind of entry. That is what lets the UI write it on tap rather than behind
 * a save step.
 *
 * `inspiration` is optional in the model, so clearing it deletes the key
 * rather than writing `false`: the export, the snapshot and every merge stay
 * free of signifiers nobody set.
 */
export const setSignifier = (
  id: string,
  which: "priority" | "inspiration",
  on: boolean
): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() => {
    if (which === "priority") m.set("priority", on);
    else if (on) m.set("inspiration", true);
    else m.delete("inspiration");
  });
};

/**
 * Change an entry's type after the fact (spec §4.1a, added 26 August 2026).
 * Until now the only route was the glyph tap, which cycles event → note →
 * task but completes a *task* instead, so a task logged by mistake could not
 * become a note at all.
 *
 * The task states are what make this more than a field write:
 *
 *   × is a completed task, and purist notation has no completed note, so a
 *     task that stops being a task stops being complete — the state goes back
 *     to open and the UI says so before the save, never after.
 *   › and ‹ are half of a pair: the marker stays here and the live copy sits
 *     on the page it was carried to. Dropping one the way × is dropped would
 *     leave a trail that no longer joins up, so the change is refused. The
 *     entry view offers the row inert with the reason on it; this is the
 *     backstop for any other caller.
 *
 * A strikethrough survives any type — irrelevant applies to anything.
 * Returns false when refused, true when the entry already had that type.
 */
export const setEntryType = (id: string, type: EntryType): boolean => {
  const m = findMap(id);
  if (!m) return false;
  const state = m.get("state") as EntryState;
  if (state === "migrated" || state === "scheduled") return false;
  if (m.get("type") === type) return true;
  doc.transact(() => {
    m.set("type", type);
    if (state === "done" && type !== "task") m.set("state", "open");
  });
  return true;
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

/** Set or clear an entry's free-form details (empty/null removes it). */
export const setDetails = (id: string, details: string | null): void => {
  const m = findMap(id);
  if (!m) return;
  const trimmed = details?.trim() ?? "";
  doc.transact(() => {
    if (trimmed === "") m.delete("details");
    else m.set("details", trimmed);
  });
};

/**
 * Add or remove a page reference on an entry (spec §4.4 Threading). Not a
 * move and not a migration: the entry stays on its own page, no glyph
 * changes, nothing is copied. Threading to the entry's own page is a no-op —
 * the paper equivalent would be writing a page's own number in its margin.
 */
export const toggleThread = (id: string, pageKey: string): void => {
  const m = findMap(id);
  if (!m || m.get("pageKey") === pageKey) return;
  doc.transact(() => {
    let t = m.get("threads");
    if (!(t instanceof Y.Map)) {
      t = new Y.Map<unknown>();
      m.set("threads", t);
    }
    const map = t as Y.Map<unknown>;
    if (map.has(pageKey)) map.delete(pageKey);
    else map.set(pageKey, true);
  });
};

/**
 * Drop a page reference from every entry that holds it — used when the page
 * it pointed at is deleted, so no entry is left referencing a page that has
 * gone. Returns the ids and keys removed so the caller's undo can put them
 * back (deleting a collection is undoable, spec §4.4).
 */
export const dropThreadsTo = (pageKey: string): string[] => {
  const affected: string[] = [];
  doc.transact(() => {
    for (let i = 0; i < entries.length; i++) {
      const t = entries.get(i).get("threads");
      if (t instanceof Y.Map && t.has(pageKey)) {
        affected.push(entries.get(i).get("id") as string);
        t.delete(pageKey);
      }
    }
  });
  return affected;
};

/** Re-add a page reference to a set of entries (undo of dropThreadsTo). */
export const restoreThreadsTo = (pageKey: string, ids: string[]): void => {
  doc.transact(() => ids.forEach((id) => toggleThreadOn(id, pageKey)));
};

// Set (rather than toggle) — restore must be idempotent
const toggleThreadOn = (id: string, pageKey: string): void => {
  const m = findMap(id);
  if (!m || m.get("pageKey") === pageKey) return;
  let t = m.get("threads");
  if (!(t instanceof Y.Map)) {
    t = new Y.Map<unknown>();
    m.set("threads", t);
  }
  (t as Y.Map<unknown>).set(pageKey, true);
};

export const moveTo = (id: string, targetPageKey: string): void => {
  const m = findMap(id);
  if (!m || m.get("pageKey") === targetPageKey) return;
  doc.transact(() => {
    m.set("pageKey", targetPageKey);
    // nesting doesn't survive a move — the parent stays behind
    m.delete("parentId");
    // page references survive a move (spec §4.4), except one pointing at the
    // page the entry has just landed on, which would reference itself
    const t = m.get("threads");
    if (t instanceof Y.Map) t.delete(targetPageKey);
  });
};

/** The nesting shape of one page, as the rendered page sees it. */
const pageNesting = (pageKey: string): Nestable[] => {
  const page: Nestable[] = [];
  for (let i = 0; i < entries.length; i++) {
    const m = entries.get(i);
    if (m.get("pageKey") !== pageKey) continue;
    page.push({
      id: m.get("id") as string,
      parentId: (m.get("parentId") as string | undefined) ?? undefined,
    });
  }
  return page;
};

/**
 * Nest an entry under any top-level entry on its own page, or pass null to
 * return it to top level (spec §4.1, one level deep). Render order follows
 * the parent — a sub-bullet is drawn directly beneath it wherever it sits on
 * the page — so no position is stored and `createdAt` stays the sort key.
 *
 * The one-level rule is checked here, not only in the UI, so a stale screen or
 * an odd merge can't write a grandchild. The check goes through the same
 * resolver the page is drawn with (store/pageOrder), so the store can never
 * refuse something the UI has just offered.
 *
 * Returns whether it nested, so callers can say so instead of failing silently.
 */
export const setParent = (id: string, parentId: string | null): boolean => {
  const m = findMap(id);
  if (!m) return false;
  if (parentId === null) {
    doc.transact(() => m.delete("parentId"));
    return true;
  }
  const pk = m.get("pageKey") as string;
  const p = findMap(parentId);
  if (!p || p.get("pageKey") !== pk) return false; // same page only
  if (!canNest(pageNesting(pk), id, parentId)) return false;
  doc.transact(() => m.set("parentId", parentId));
  return true;
};

export const removeEntry = (id: string): Entry | null => {
  const i = indexOfId(id);
  if (i === -1) return null;
  const snapshot = toEntry(entries.get(i));
  doc.transact(() => entries.delete(i, 1));
  return snapshot;
};

export const restoreEntry = (e: Entry): void => {
  doc.transact(() => pushEntry(e));
};

// Migrate: mark the original on its old page, copy forward as open.
// Purist notation (spec §4.1): > when the copy lands on a current or past
// page, < ("scheduled") when it lands on a future page.
// Honest history — the original never moves or disappears (spec §4.3).
export const migrateEntry = (id: string, targetPageKey: string): void => {
  const m = findMap(id);
  if (!m) return;
  // An entry this build cannot read cannot be copied forward either, and the
  // interface can never have offered it: readAll() has already filtered it out,
  // so there is no row to have tapped. Nothing is lost by stopping here.
  const original = toEntry(m);
  if (!original) return;
  doc.transact(() => {
    m.set("state", isFutureKey(targetPageKey) ? "scheduled" : "migrated");
    // page references are inherited by the copy (spec §4.4): paper rewrites
    // the margin reference along with the entry
    pushEntry({
      ...original,
      id: uid(),
      state: "open",
      pageKey: targetPageKey,
      createdAt: Date.now(),
      migratedFrom: original.id,
      parentId: undefined, // nesting stays with the original page
    });
  });
};

export const strikeEntry = (id: string): void => {
  const m = findMap(id);
  if (!m) return;
  doc.transact(() => m.set("state", "struck"));
};

/**
 * Set an entry's state outright, for the recurrence dedupe and nothing else.
 *
 * Every other writer in this file is a named human action — complete, strike,
 * migrate — because a state is a thing somebody said about an entry. The dedupe
 * pass is the one caller that has to move a state rather than make one: when it
 * discards a twin of an occurrence it must carry what was said about that twin
 * onto the copy it keeps, or a completion made on one device disappears when
 * another device's twin merges in (reported 18 August 2026). Deliberately not
 * offered to the UI, which has the named actions.
 *
 * Answers whether the entry now holds that state, which is false only when it is
 * no longer in the document. The dedupe treats that as a reason to delete
 * nothing: carrying a state onto an entry that has gone is how a completion
 * disappears, and it is the one failure here worth refusing rather than logging.
 */
export const adoptEntryState = (id: string, state: EntryState): boolean => {
  const m = findMap(id);
  if (!m) return false;
  if (m.get("state") !== state) doc.transact(() => m.set("state", state));
  return true;
};

// ---------- collections ----------

const toCollection = (m: Y.Map<unknown>): Collection | null => {
  const id = readString(m, "id");
  if (!id) return rejectRecord("collection", "no id");
  const name = readString(m, "name");
  if (!name) return rejectRecord("collection", "no name");
  const createdAt = readNumber(m, "createdAt");
  if (createdAt === undefined)
    return rejectRecord("collection", "no created time");
  return {
    id,
    // A kind this build does not know is shown as a list rather than dropped.
    // Dropping it would take the page away while its entries kept a col:<id>
    // page key pointing at nothing, so the entries would vanish with it.
    kind:
      readOneOf(m, "kind", COLLECTION_KINDS) ??
      repairField("collection", "kind", "list" as const),
    name,
    createdAt,
  };
};

const toHabit = (m: Y.Map<unknown>): Habit | null => {
  const id = readString(m, "id");
  if (!id) return rejectRecord("habit", "no id");
  const collectionId = readString(m, "collectionId");
  if (!collectionId) return rejectRecord("habit", "no collection");
  const name = readString(m, "name");
  if (!name) return rejectRecord("habit", "no name");
  const createdAt = readNumber(m, "createdAt");
  if (createdAt === undefined) return rejectRecord("habit", "no created time");
  // `marks` was read with a bare cast and a `.forEach`, so a row that had never
  // been ticked threw here and took the whole tracker down with it.
  const marks: Record<string, true> = {};
  for (const k of readKeys(m, "marks")) marks[k] = true;
  return { id, collectionId, name, createdAt, marks };
};

export const readCollections = (): Collection[] =>
  collections
    .map(toCollection)
    .filter((c): c is Collection => c !== null)
    .sort((a, b) => a.createdAt - b.createdAt);

export const readHabits = (): Habit[] =>
  habits.map(toHabit).filter((h): h is Habit => h !== null);

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
  /** ids of entries elsewhere that referenced this collection (spec §4.4) */
  threadedFrom: string[];
}

// Delete a collection with everything on it; returns a snapshot for undo
export const removeCollection = (id: string): CollectionSnapshot | null => {
  let ci = -1;
  for (let i = 0; i < collections.length; i++) {
    if (collections.get(i).get("id") === id) ci = i;
  }
  if (ci === -1) return null;
  // Same reasoning as migrateEntry: an undecodable collection is not in the list
  // this was chosen from, and an undo snapshot that cannot describe what it is
  // restoring is worse than refusing. Reported as "not found", which it is as
  // far as anything above here is concerned.
  const collection = toCollection(collections.get(ci));
  if (!collection) return null;
  const pk = colPageKey(id);
  const snap: CollectionSnapshot = {
    collection,
    entries: readAll().filter((e) => e.pageKey === pk),
    habits: readHabits().filter((h) => h.collectionId === id),
    threadedFrom: dropThreadsTo(pk),
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

// ---------- recurrences ----------

/**
 * A recurrence rule, or null if it has no cadence that can be walked.
 *
 * The one place in this file where an unknown value is rejected rather than
 * repaired. Every other record only has to be drawn; a rule is executed, and the
 * materialiser writes entries from it. Defaulting a `unit` this build cannot read
 * to "day" would turn somebody's monthly rule into a daily one and then put
 * thirty entries on thirty pages, which is worse than the rule going quiet: the
 * occurrences already on pages are their own entries and stay where they are, so
 * rejecting here stops the future and destroys nothing.
 */
const toRecurrence = (m: Y.Map<unknown>): Recurrence | null => {
  const id = readString(m, "id");
  if (!id) return rejectRecord("recurrence", "no id");
  const unit = readOneOf(m, "unit", RECURRENCE_UNITS);
  if (!unit) return rejectRecord("recurrence", "unreadable cadence");
  const anchor = readString(m, "anchor");
  if (!anchor) return rejectRecord("recurrence", "no anchor");
  const materialisedThrough = readString(m, "materialisedThrough");
  if (!materialisedThrough)
    return rejectRecord("recurrence", "no materialised-through");
  const createdAt = readNumber(m, "createdAt");
  if (createdAt === undefined)
    return rejectRecord("recurrence", "no created time");
  return {
    id,
    text: readString(m, "text") ?? repairField("recurrence", "text", ""),
    type:
      readOneOf(m, "type", ENTRY_TYPES) ??
      repairField("recurrence", "type", "task" as const),
    priority: Boolean(m.get("priority")),
    inspiration: Boolean(m.get("inspiration")) || undefined,
    // "every 0 days" walks nowhere and "every -1" walks backwards. One is the
    // cadence the interface offers by default, so it is the safe reading.
    everyN: readCount(m, "everyN") ?? repairField("recurrence", "everyN", 1),
    unit,
    // Unlike `unit`, a bad pageScope only says which kind of page the rule
    // belongs to. It was already defaulted to "day" before this change, because
    // rules written before the field existed have none.
    pageScope: readOneOf(m, "pageScope", RECURRENCE_UNITS) ?? "day",
    anchor,
    remindTime: readString(m, "remindTime"),
    materialisedThrough,
    endsOn: readString(m, "endsOn"),
    endsAfter: readCount(m, "endsAfter"),
    endedAt: readNumber(m, "endedAt"),
    createdAt,
  };
};

export const readRecurrences = (): Recurrence[] =>
  recurrences.map(toRecurrence).filter((r): r is Recurrence => r !== null);

const findRecurrenceMap = (id: string): Y.Map<unknown> | null => {
  for (let i = 0; i < recurrences.length; i++) {
    const m = recurrences.get(i);
    if (m.get("id") === id) return m;
  }
  return null;
};

export const addRecurrence = (
  r: Omit<Recurrence, "id" | "createdAt">
): Recurrence => {
  const rule: Recurrence = { ...r, id: uid(), createdAt: Date.now() };
  const m = new Y.Map<unknown>();
  m.set("id", rule.id);
  m.set("text", rule.text);
  m.set("type", rule.type);
  m.set("priority", rule.priority);
  if (rule.inspiration) m.set("inspiration", true);
  m.set("everyN", rule.everyN);
  m.set("unit", rule.unit);
  m.set("pageScope", rule.pageScope);
  m.set("anchor", rule.anchor);
  if (rule.remindTime) m.set("remindTime", rule.remindTime);
  if (rule.endsOn) m.set("endsOn", rule.endsOn);
  if (rule.endsAfter) m.set("endsAfter", rule.endsAfter);
  m.set("materialisedThrough", rule.materialisedThrough);
  m.set("createdAt", rule.createdAt);
  doc.transact(() => recurrences.push([m]));
  return rule;
};

/**
 * Set or clear a rule's planned end (spec §11 Q17).
 *
 * Exactly one form is stored, so setting either clears the other in the same
 * transaction. Both can still end up present, because Yjs resolves each key on
 * its own and two devices can set different ends while apart; `lastOccurrence`
 * settles that by taking the earlier of the two, identically on every device,
 * rather than this write trying to guess which one was meant.
 *
 * This is the first edit a rule has ever had. Everything else about a rule is
 * written once at creation, `materialisedThrough` is advanced only by the
 * materialiser, and `endedAt` is a one-way switch; an end that can be changed
 * after the fact is the reason this function exists at all.
 */
export const setRecurrenceEnd = (
  id: string,
  end: { on: string } | { after: number } | null
): void => {
  const m = findRecurrenceMap(id);
  if (!m) return;
  doc.transact(() => {
    m.delete("endsOn");
    m.delete("endsAfter");
    if (end && "on" in end) m.set("endsOn", end.on);
    if (end && "after" in end)
      m.set("endsAfter", Math.max(1, Math.floor(end.after)));
  });
};

export const endRecurrence = (id: string): void => {
  const m = findRecurrenceMap(id);
  if (!m) return;
  doc.transact(() => m.set("endedAt", Date.now()));
};

export const advanceRecurrence = (id: string, through: string): void => {
  const m = findRecurrenceMap(id);
  if (!m) return;
  if ((m.get("materialisedThrough") as string) >= through) return;
  doc.transact(() => m.set("materialisedThrough", through));
};

export const restoreCollection = (snap: CollectionSnapshot): void => {
  doc.transact(() => {
    collections.push([makeCollectionMap(snap.collection)]);
    snap.entries.forEach((e) => pushEntry(e));
    snap.habits.forEach((h) => habits.push([makeHabitMap(h)]));
    restoreThreadsTo(colPageKey(snap.collection.id), snap.threadedFrom ?? []);
  });
};
