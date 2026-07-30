// Local search (spec §6, §10: "search runs locally"). The server only ever
// holds ciphertext, so it can never search on your behalf — and it doesn't
// need to: the whole journal is already decrypted in memory on this device,
// so search is a filter over an array rather than an index. That stays true
// until a journal gets large enough for the linear scan to show; MAX_HITS
// caps the render, and a token index can slot in behind this same interface
// without any caller changing.
//
// Pure — no store, no React. Everything here is a function of its arguments.

import type { Collection, Entry, Habit } from "./types";
import { keyScope, pageLabel } from "./dates";
import { isColPageKey, colIdFromKey } from "./threads";

/** Beyond this many entry hits the list stops being something you scan. */
export const MAX_HITS = 300;

/**
 * Fold case and strip diacritics, so "cafe" finds "café" and "Café" finds
 * "cafe". NFD splits an accented letter into base + combining mark; the mark
 * is then dropped.
 */
export const normalise = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Query words. Every word must appear somewhere in an entry for it to match. */
export const tokenise = (q: string): string[] =>
  normalise(q).split(/\s+/).filter(Boolean);

/**
 * Fold a string while keeping a map back to the original character offsets,
 * so a match found in folded text can be highlighted in the text as written.
 * Per-character folding: a combining mark folds to "" and drops out of the
 * map; every other character contributes at least one entry.
 */
const foldWithMap = (s: string): { folded: string; map: number[] } => {
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const f = normalise(s[i]);
    for (let j = 0; j < f.length; j++) {
      folded += f[j];
      map.push(i);
    }
  }
  return { folded, map };
};

/** Which part of an entry the query was found in. */
export type MatchField = "text" | "details" | "thread";

const FIELD_ORDER: MatchField[] = ["text", "details", "thread"];

export interface EntryHit {
  entry: Entry;
  /** fields the query words were found in, in FIELD_ORDER */
  fields: MatchField[];
}

export interface PageGroup {
  pageKey: string;
  /** plain wording for the page: a collection's name, or the period */
  label: string;
  hits: EntryHit[];
  /** newest entry in the group — the group ordering key */
  latest: number;
}

/** A page whose own name matched: a collection, or a habit on a tracker. */
export interface PageHit {
  kind: "collection" | "habit";
  /** collection to open (a habit opens the tracker it lives on) */
  collectionId: string;
  name: string;
  /** the tracker's name, for habit hits */
  parentName?: string;
}

export interface SearchResults {
  tokens: string[];
  groups: PageGroup[];
  pageHits: PageHit[];
  /** entries listed in groups — at most MAX_HITS */
  entryCount: number;
  /** entries that matched in the whole journal, cap or no cap */
  totalCount: number;
  /** true when the list was cut at MAX_HITS — totalCount is the honest number */
  truncated: boolean;
}

export const EMPTY_RESULTS: SearchResults = {
  tokens: [],
  groups: [],
  pageHits: [],
  entryCount: 0,
  totalCount: 0,
  truncated: false,
};

/** Does every query word appear somewhere in this entry? */
const matchEntry = (
  entry: Entry,
  tokens: string[],
  threadText: string
): MatchField[] | null => {
  const text = normalise(entry.text);
  const details = entry.details ? normalise(entry.details) : "";
  const found = new Set<MatchField>();
  for (const t of tokens) {
    let any = false;
    if (text.includes(t)) {
      found.add("text");
      any = true;
    }
    if (details.includes(t)) {
      found.add("details");
      any = true;
    }
    if (threadText.includes(t)) {
      found.add("thread");
      any = true;
    }
    // AND across words: a word nobody carries rules the entry out
    if (!any) return null;
  }
  return FIELD_ORDER.filter((f) => found.has(f));
};

const matchName = (name: string, tokens: string[]): boolean => {
  const n = normalise(name);
  return tokens.every((t) => n.includes(t));
};

const pageLabelFor = (pk: string, byId: Map<string, Collection>): string => {
  if (isColPageKey(pk))
    return byId.get(colIdFromKey(pk))?.name ?? "Deleted collection";
  return keyScope(pk) ? pageLabel(pk) : pk;
};

/**
 * Search the whole journal. Every state is included — done, struck and
 * migrated entries too, because a lost entry is as often a finished one, and
 * an honest record is the point of the method.
 */
export const searchJournal = (
  query: string,
  days: Record<string, Entry[]>,
  collections: Collection[],
  habits: Habit[]
): SearchResults => {
  const tokens = tokenise(query);
  if (tokens.length === 0) return EMPTY_RESULTS;

  // One lookup table rather than a linear find per threaded reference per
  // entry per keystroke
  const byId = new Map(collections.map((c) => [c.id, c]));

  const groups: PageGroup[] = [];
  let totalCount = 0;

  for (const pageKey of Object.keys(days)) {
    const hits: EntryHit[] = [];
    let latest = 0;
    for (const entry of days[pageKey]) {
      // Page references read as their plain wording, so searching a
      // collection's name also finds the entries threaded to it
      const threadText = (entry.threads ?? [])
        .map((t) => normalise(pageLabelFor(t, byId)))
        .join(" ");
      const fields = matchEntry(entry, tokens, threadText);
      if (!fields) continue;
      totalCount++;
      hits.push({ entry, fields });
      if (entry.createdAt > latest) latest = entry.createdAt;
    }
    if (hits.length === 0) continue;
    // Newest first within a page: the entry you just lost is the likely one
    hits.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
    groups.push({
      pageKey,
      label: pageLabelFor(pageKey, byId),
      hits,
      latest,
    });
  }

  // Most recently written page first, for the same reason
  groups.sort((a, b) => b.latest - a.latest);

  // Trim only after ordering, so a capped list keeps the newest entries
  // rather than whichever pages happened to come first out of the store.
  // The full count is still reported — the app never quietly under-states
  // how much of your journal matched.
  let entryCount = 0;
  const shown: PageGroup[] = [];
  for (const g of groups) {
    if (entryCount >= MAX_HITS) break;
    const room = MAX_HITS - entryCount;
    const hits = g.hits.length > room ? g.hits.slice(0, room) : g.hits;
    entryCount += hits.length;
    shown.push(hits === g.hits ? g : { ...g, hits });
  }

  const pageHits: PageHit[] = [];
  for (const c of collections)
    if (matchName(c.name, tokens))
      pageHits.push({ kind: "collection", collectionId: c.id, name: c.name });
  for (const h of habits)
    if (matchName(h.name, tokens))
      pageHits.push({
        kind: "habit",
        collectionId: h.collectionId,
        name: h.name,
        parentName: collections.find((c) => c.id === h.collectionId)?.name,
      });

  return {
    tokens,
    groups: shown,
    pageHits,
    entryCount,
    totalCount,
    truncated: totalCount > entryCount,
  };
};

/** A run of text, flagged if it is part of a matched word. */
export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * Split text into highlighted and plain runs. Matching happens on the folded
 * form and the ranges are mapped back, so the text renders exactly as written
 * — accents and case intact.
 */
export const highlight = (text: string, tokens: string[]): Segment[] => {
  if (tokens.length === 0 || text === "") return [{ text, hit: false }];
  const { folded, map } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const t of tokens) {
    if (!t) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(t, from);
      if (at === -1) break;
      const past = at + t.length;
      // The range ends where the *next* folded character begins, not one past
      // the last matched one. Text typed on a Mac or iPhone often arrives
      // decomposed ("e" + a combining acute), and those marks fold away: end
      // one past the "e" and the accent is orphaned outside the highlight.
      // The Math.max covers the reverse case, one character folding to
      // several, where the next entry can point at the same character.
      const end =
        past < map.length
          ? Math.max(map[past], map[past - 1] + 1)
          : text.length;
      ranges.push([map[at], end]);
      from = past;
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const out: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
};

/**
 * A short piece of an entry's details centred on the first match, so a hit
 * that only exists in the details can be recognised without opening it.
 */
export const detailsSnippet = (
  details: string,
  tokens: string[],
  span = 120
): string => {
  if (details.length <= span) return details;
  const { folded, map } = foldWithMap(details);
  let at = -1;
  for (const t of tokens) {
    const i = folded.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  // map the folded offset back before slicing: folded and original offsets
  // drift apart by every combining mark that was dropped along the way
  const found = at === -1 ? 0 : map[at];
  const start = Math.max(0, found - Math.floor(span / 3));
  const end = Math.min(details.length, start + span);
  return (
    (start > 0 ? "…" : "") + details.slice(start, end) + (end < details.length ? "…" : "")
  );
};
