// Recurrence materialiser: turns rules into ordinary entries, client-side.
// A recurring entry only needs to exist when a page is looked at, so each
// device materialises any occurrences due up to today. Instances are
// normal entries tagged with recurrenceId; two devices racing offline can
// double-create, so a deterministic dedupe pass keeps the earliest twin.
//
// One rule governs both passes (added 15 August 2026, spec §11 Q15): a
// migrated copy carries recurrenceId for provenance — it says "repeats" and
// belongs to its rule — but it is never the occurrence for the page it
// landed on. Migrating Wednesday's unfinished occurrence onto today produced
// two entries sharing rule+page, and the dedupe pass, which cannot tell a
// deliberate migrate from an offline race twin, deleted the later one
// (always the migrated copy), leaving Wednesday's entry reading › and
// pointing at nothing. So migrated copies are skipped by the dedupe below,
// and left out of `existing` so they never suppress the rule's own
// occurrence either.
//
// The dedupe pass discards an entry, so it must never discard what somebody
// said about it (reported 18 August 2026: "I marked something as complete and
// an hour or two later the item had re-appeared without any sign as to why").
// It was blind to state, so if the twin that got ticked off happened to be the
// later-created one, it was deleted and its still-open sibling survived under a
// new id, leaving no trace of either the completion or the deletion. Two devices
// materialising the same day before they have seen each other is the ordinary
// case, not an exotic one: y-indexeddb has no cross-tab channel, so an installed
// PWA and a browser tab on one machine are two replicas that meet only through
// the server. So the pass now carries the strongest thing said about an
// occurrence onto the twin it keeps, and refuses to delete a twin that carries
// anything else of its own.

import { dkey, periodKey, todayKey, toDate } from "../lib/dates";
import type { Entry, EntryState, Recurrence } from "../lib/types";
import { uid } from "../lib/types";
import {
  adoptEntryState,
  advanceRecurrence,
  doc,
  insertEntry,
  readAll,
  readRecurrences,
  removeEntry,
  REMOTE_ORIGIN,
} from "./journal";

const MAX_CATCHUP = 100; // occurrences per rule per pass — safety valve

// The next occurrence key strictly after `after`, expressed in the rule's
// pageScope (a day key for day-scope rules, else an ISO week / month / year
// key). We walk forward from the anchor in cadence-sized (`unit`) steps and
// project each landing day onto its pageScope period; `after` is compared in
// that same period space. For day-scope rules periodKey is the identity, so
// this is exactly the original day-key behaviour.
export const nextOccurrence = (r: Recurrence, after: string): string => {
  const d = toDate(r.anchor);
  let k = periodKey(r.pageScope, r.anchor);
  for (let i = 0; k <= after && i < 10000; i++) {
    if (r.unit === "day") d.setDate(d.getDate() + r.everyN);
    else if (r.unit === "week") d.setDate(d.getDate() + 7 * r.everyN);
    else if (r.unit === "month") {
      const dom = toDate(r.anchor).getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + r.everyN);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dom, last));
    } else d.setFullYear(d.getFullYear() + r.everyN);
    k = periodKey(r.pageScope, dkey(d));
  }
  return k;
};

// Skip a single upcoming occurrence: materialise it immediately as a
// struck entry — Carroll's notation for "no longer relevant", honestly
// recorded on its page. The materialiser never recreates an existing
// rule+day instance (any state), so the skip holds on every device.
export const skipOccurrence = (rule: Recurrence, occKey: string): void => {
  insertEntry({
    id: uid(),
    type: rule.type,
    text: rule.text,
    priority: rule.priority,
    inspiration: rule.inspiration,
    state: "struck",
    pageKey: occKey,
    createdAt: Date.now(),
    recurrenceId: rule.id,
  });
};

const remindAtFor = (r: Recurrence, dayKey: string): number | undefined => {
  if (!r.remindTime) return undefined;
  const m = r.remindTime.match(/^(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const d = toDate(dayKey);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
};

/**
 * How closed an occurrence is.
 *
 * A dedupe cannot ask which twin the person meant, so it converges on the
 * strongest thing said about the occurrence by a fixed order every device
 * computes identically. "migrated" and "scheduled" rank together: both say the
 * work moved, and which word is used depends only on where it moved to.
 */
const CLOSED_RANK: Record<EntryState, number> = {
  done: 4,
  struck: 3,
  migrated: 2,
  scheduled: 2,
  open: 0,
};

/**
 * Does this twin hold anything a state cannot carry?
 *
 * Everything a materialised occurrence starts life with comes from the rule, so
 * two twins of the same occurrence begin identical. Any difference beyond state
 * is therefore something a person did to one of them and not the other, and a
 * dedupe has no business deleting it — better a visible duplicate on the page,
 * which can be struck out in one tap, than a silently discarded edit.
 */
const carriesItsOwn = (twin: Entry, keep: Entry): boolean =>
  twin.text !== keep.text ||
  (twin.details ?? "") !== (keep.details ?? "") ||
  twin.priority !== keep.priority ||
  (twin.remindAt ?? 0) !== (keep.remindAt ?? 0) ||
  Boolean(twin.threads?.length) ||
  Boolean(twin.parentId);

/**
 * Collapse twin occurrences of one rule on one page, losing nothing.
 *
 * Concurrent materialisation on two replicas double-creates; the survivor is the
 * earliest-created twin (tie-broken on id) so that every device converges on the
 * same one. What is new since 18 August 2026 is that the survivor inherits the
 * strongest state of the group before its twins go, and that a twin is kept
 * rather than deleted when deleting it would lose something: content of its own
 * (see carriesItsOwn), or the far end of a migration, whose `migratedFrom` would
 * otherwise point at nothing — the mirror image of the fault §11 Q15 fixed.
 *
 * A migrated copy is exempt from the whole pass: it is a deliberate act with its
 * own provenance, not a twin.
 */
const dedupeOccurrences = (): void => {
  const all = readAll();
  const migrationSources = new Set(
    all.flatMap((e) => (e.migratedFrom ? [e.migratedFrom] : []))
  );

  const groups = new Map<string, Entry[]>();
  for (const e of all) {
    if (!e.recurrenceId || e.migratedFrom) continue;
    const key = `${e.recurrenceId}:${e.pageKey}`;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }

  for (const twins of groups.values()) {
    if (twins.length < 2) continue;
    const keep = twins.reduce((a, b) =>
      b.createdAt < a.createdAt ||
      (b.createdAt === a.createdAt && b.id < a.id)
        ? b
        : a
    );
    const losers = twins.filter(
      (e) =>
        e.id !== keep.id &&
        !migrationSources.has(e.id) &&
        !carriesItsOwn(e, keep)
    );
    if (losers.length === 0) continue;
    // Carried before the deletes, so a throw between the two leaves the state
    // on an entry that still exists rather than on nothing.
    const strongest = [keep, ...losers].reduce((a, b) =>
      CLOSED_RANK[b.state] > CLOSED_RANK[a.state] ? b : a
    );
    adoptEntryState(keep.id, strongest.state);
    losers.forEach((e) => removeEntry(e.id));
  }
};

let running = false;

export const materialiseRecurrences = (): void => {
  if (running) return;
  running = true;
  try {
    const today = todayKey();
    const all = readAll();

    // Existing instances per rule+day (any state — a completed or struck
    // occurrence must never be recreated). Migrated copies are not
    // occurrences (see the head of this file): a copy carried onto a page
    // must not stand in for that page's own occurrence, or the rule would
    // silently skip a day.
    const existing = new Set(
      all
        .filter((e) => e.recurrenceId && !e.migratedFrom)
        .map((e) => `${e.recurrenceId}:${e.pageKey}`)
    );

    for (const rule of readRecurrences()) {
      if (rule.endedAt) continue;
      // Stop at the current period of the rule's own scope (this month for a
      // monthly-page rule, today for a day rule) — never materialise ahead.
      const todayPeriod = periodKey(rule.pageScope, today);
      let through = rule.materialisedThrough;
      for (let i = 0; i < MAX_CATCHUP; i++) {
        const next = nextOccurrence(rule, through);
        if (next > todayPeriod) break;
        if (!existing.has(`${rule.id}:${next}`)) {
          insertEntry({
            id: uid(),
            type: rule.type,
            text: rule.text,
            priority: rule.priority,
            inspiration: rule.inspiration,
            state: "open",
            pageKey: next,
            createdAt: Date.now(),
            // Timed reminders only make sense on day pages; a week/month/year
            // occurrence has no single clock time.
            remindAt:
              rule.pageScope === "day" ? remindAtFor(rule, next) : undefined,
            recurrenceId: rule.id,
          });
          existing.add(`${rule.id}:${next}`);
        }
        through = next;
      }
      if (through !== rule.materialisedThrough)
        advanceRecurrence(rule.id, through);
    }

    dedupeOccurrences();
  } finally {
    running = false;
  }
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const debounced = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(materialiseRecurrences, 800);
};

export const startRecurrenceLoop = (): void => {
  materialiseRecurrences();

  // day rollover while the app stays open
  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) {
      lastDay = todayKey();
      materialiseRecurrences();
    }
  }, 60_000);

  // new rules or instances arriving from another device
  doc.on("update", (_u: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) debounced();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") debounced();
  });
};
