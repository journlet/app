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

import { dkey, endLabel, periodKey, todayKey, toDate } from "../lib/dates";
import type {
  Entry,
  EntryState,
  Recurrence,
  RecurrenceUnit,
} from "../lib/types";
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

/** The cadence in words. Lives here rather than in App so the caption builders
 *  below and the sheets can say the same thing without one passing it to the
 *  other. */
export const cadenceLabel = (n: number, unit: RecurrenceUnit): string =>
  `every ${n > 1 ? `${n} ` : ""}${unit}${n > 1 ? "s" : ""}`;

/** The nth occurrence key, 1-based, counting the anchor's own period as the
 *  first. That is what a person counts: making an entry repeat is the first of
 *  the ten, not the one before them. */
export const occurrenceKey = (r: Recurrence, n: number): string => {
  let k = periodKey(r.pageScope, r.anchor);
  for (let i = 1; i < Math.max(1, Math.floor(n)); i++) k = nextOccurrence(r, k);
  return k;
};

/** How many of a rule's occurrences have come round by `through`, inclusive.
 *  Counted by walking the cadence from the anchor, not by counting entries: a
 *  rule made from a past-dated entry starts materialising at the current period
 *  and never invents overdue occurrences, so it can be several periods old with
 *  one occurrence in the journal (spec §11 Q17). */
export const occurrencesThrough = (r: Recurrence, through: string): number => {
  const end = periodKey(r.pageScope, through);
  let k = periodKey(r.pageScope, r.anchor);
  if (k > end) return 0;
  for (let n = 1; n < 10000; n++) {
    const next = nextOccurrence(r, k);
    if (next > end) return n;
    k = next;
  }
  return 0;
};

/** The rule's last occurrence on or before a period, or null if the rule starts
 *  after it. This is what makes an end date resolve onto one of the rule's own
 *  days: an end of Thursday 1 October on a Wednesday rule means Wednesday 30
 *  September, because a caption naming 1 October would be promising a day on
 *  which nothing happens (found in prototype v18, spec §11 Q17). */
const lastOnOrBefore = (r: Recurrence, cap: string): string | null => {
  let k = periodKey(r.pageScope, r.anchor);
  if (k > cap) return null;
  for (let i = 0; i < 10000; i++) {
    const next = nextOccurrence(r, k);
    if (next > cap) return k;
    k = next;
  }
  return k;
};

/**
 * The last occurrence this rule will ever make, or null for a rule with no
 * planned end.
 *
 * Both forms can be set at once — one device saying "until September" while
 * another says "after ten", each clearing the key the other set — so the
 * earlier of the two resulting ends wins. That is settled here rather than at
 * the write, so every device reaches the same answer from the same fields, and
 * because there is no reading of the two in which the later one is the safer
 * guess.
 *
 * `endedAt` is deliberately not consulted: stopping a rule by hand is a
 * separate fact, and an occurrence already on a page still wants to be able to
 * say what its rule's last one was.
 */
export const lastOccurrence = (r: Recurrence): string | null => {
  const byCount =
    r.endsAfter && r.endsAfter > 0 ? occurrenceKey(r, r.endsAfter) : null;
  const byDate = r.endsOn
    ? lastOnOrBefore(r, periodKey(r.pageScope, r.endsOn))
    : null;
  if (byCount && byDate) return byDate < byCount ? byDate : byCount;
  return byCount ?? byDate;
};

/**
 * Has this rule nothing left to make?
 *
 * Derived on every read and never written. The materialiser could stamp
 * `endedAt` on a rule that has run out, but that would be a write to synced
 * content triggered by whichever device happened to look at a rule nobody had
 * touched, and the fact needs no writing: it follows from fields every device
 * already holds (spec §11 Q17).
 */
export const isSpent = (r: Recurrence, today: string): boolean => {
  if (r.endedAt) return true;
  const last = lastOccurrence(r);
  return last !== null && last < periodKey(r.pageScope, today);
};

/**
 * What a day page says beside an occurrence.
 *
 * The page has only ever said the bare word `repeats` — the cadence lives in
 * the Scheduled ahead preview and in the ⋯ view, where the rule is being read
 * rather than glanced at — so an end is added to that word rather than to a
 * sentence. The last occurrence names itself instead of naming its date,
 * because the page it sits on already says the date, and because the day the
 * end matters is the day after, when the next page is simply empty. Prototype
 * v18 settled both, and measured the difference: the longer form wrapped to a
 * second grid row on three of four rows at 375px (spec §11 Q17).
 */
export const repeatCaption = (
  r: Recurrence | undefined,
  pageKey: string,
  today: string
): string => {
  if (!r) return "repeats";
  const last = lastOccurrence(r);
  if (r.endedAt) return "repeated";
  if (!last) return "repeats";
  if (last < periodKey(r.pageScope, today))
    return `repeated until ${endLabel(last)}`;
  if (pageKey === last) return "repeats, last one";
  return `repeats until ${endLabel(last)}`;
};

/** The end clause a Scheduled ahead preview adds after the cadence, or "" for a
 *  rule with no end. Split out so the call sites cannot drift in their wording;
 *  pass the occurrence being previewed and the last one names itself. */
export const endClause = (r: Recurrence, occKey?: string): string => {
  const last = lastOccurrence(r);
  if (!last) return "";
  if (occKey && occKey === last) return ", last one";
  return ` until ${endLabel(last)}`;
};

/** The rule in one sentence, for the ⋯ view and the rule sheet, where there is
 *  room to say a count as a count. A count-based rule names the number, how many
 *  have come round and the date it lands on: the number is what was said, and
 *  the date is the part you can act on. */
export const ruleSentence = (r: Recurrence, today: string): string => {
  const cadence = cadenceLabel(r.everyN, r.unit);
  if (r.endedAt) return `repeated ${cadence}, stopped`;
  const last = lastOccurrence(r);
  if (!last) return `repeats ${cadence}`;
  if (r.endsAfter)
    return `repeats ${cadence}, stops after ${r.endsAfter} (${occurrencesThrough(
      r,
      today
    )} have come round), last one ${endLabel(last)}`;
  return `repeats ${cadence}, last one ${endLabel(last)}`;
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
 * What the dedupe pass discarded, and why it was safe to.
 *
 * The same instrument as recordPush in store/sync.ts, for the same reason. That
 * one exists because duplicate rows had been chased twice on timing and length
 * alone, which cannot distinguish one update sent twice from two that happen to
 * be the same size, so it records what was actually sent and the question becomes
 * answerable rather than inferable. This pass is the only code in the app that
 * destroys the person's content on its own initiative and it had no such record
 * at all: the completion lost on 18 August 2026 left no trace anywhere, and
 * finding out why cost a bug report and a read of the whole sync engine. It is
 * also the second policy error in this one function, after the one Q15 fixed on
 * 15 August, which is the argument for instrumenting the function rather than
 * trusting the next policy to be right.
 *
 * One record per discarded twin rather than per group, because the question asked
 * of it is always about a single entry that went missing.
 *
 * Readable on a phone via window.__journletDedupeLog, and from code via
 * recentDedupes() below.
 */
export interface DedupeRecord {
  at: string;
  /** the rule and page whose twins these were */
  rule: string;
  page: string;
  kept: string;
  keptState: EntryState;
  discarded: string;
  discardedState: EntryState;
  /** the state moved onto the survivor, absent when it already held it */
  carried?: EntryState;
}

const DEDUPE_LOG_MAX = 50;
const dedupeLog: DedupeRecord[] = [];

/** The recent dedupe decisions, oldest first. */
export const recentDedupes = (): DedupeRecord[] => [...dedupeLog];

const recordDedupe = (r: DedupeRecord): void => {
  dedupeLog.push(r);
  if (dedupeLog.length > DEDUPE_LOG_MAX) dedupeLog.shift();
  console.info(
    `journlet dedupe ${r.rule}:${r.page} kept ${r.kept} (${r.keptState}) ` +
      `discarded ${r.discarded} (${r.discardedState})` +
      (r.carried ? ` carried ${r.carried}` : "") +
      ` ${r.at}`
  );
  if (typeof window !== "undefined")
    (window as unknown as { __journletDedupeLog?: DedupeRecord[] })
      .__journletDedupeLog = dedupeLog;
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
    /**
     * The invariant this pass now has to hold: nothing is discarded until what it
     * said is on the entry that survives. adoptEntryState answers false only when
     * the survivor is no longer in the document, which the snapshot above cannot
     * see: a concurrent delete, or a future caller reordering the two halves.
     * Deleting the twins then would put a completion nowhere, which is the fault
     * of 18 August 2026 exactly, so it discards nothing and says so at the level a
     * developer will actually see. A visible duplicate is the safe failure here.
     */
    if (!adoptEntryState(keep.id, strongest.state)) {
      console.error(
        `journlet dedupe: the survivor of ${keep.recurrenceId}:${keep.pageKey} ` +
          `(${keep.id}) is no longer in the journal, so ${losers.length} ` +
          `twin(s) were left in place rather than discarded`
      );
      continue;
    }
    const at = new Date().toISOString();
    const carried =
      strongest.state === keep.state ? undefined : strongest.state;
    losers.forEach((e) => {
      removeEntry(e.id);
      recordDedupe({
        at,
        rule: e.recurrenceId as string,
        page: e.pageKey,
        kept: keep.id,
        keptState: strongest.state,
        discarded: e.id,
        discardedState: e.state,
        carried,
      });
    });
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
      // Never past the rule's own planned end either (spec §11 Q17). Read here
      // rather than written back to the rule when it passes — see isSpent.
      const last = lastOccurrence(rule);
      let through = rule.materialisedThrough;
      for (let i = 0; i < MAX_CATCHUP; i++) {
        const next = nextOccurrence(rule, through);
        if (next > todayPeriod) break;
        if (last && next > last) break;
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
