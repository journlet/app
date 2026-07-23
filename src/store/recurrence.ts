// Recurrence materialiser: turns rules into ordinary entries, client-side.
// A recurring entry only needs to exist when a page is looked at, so each
// device materialises any occurrences due up to today. Instances are
// normal entries tagged with recurrenceId; two devices racing offline can
// double-create, so a deterministic dedupe pass keeps the earliest twin.

import { dkey, periodKey, todayKey, toDate } from "../lib/dates";
import type { Recurrence } from "../lib/types";
import { uid } from "../lib/types";
import {
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

let running = false;

export const materialiseRecurrences = (): void => {
  if (running) return;
  running = true;
  try {
    const today = todayKey();
    const all = readAll();

    // Existing instances per rule+day (any state — a completed or struck
    // occurrence must never be recreated)
    const existing = new Set(
      all
        .filter((e) => e.recurrenceId)
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

    // Dedupe: concurrent materialisation on two offline devices — keep the
    // earliest-created twin (tie-break on id) so every device converges
    const seen = new Map<string, { id: string; createdAt: number }>();
    for (const e of readAll()) {
      if (!e.recurrenceId) continue;
      const key = `${e.recurrenceId}:${e.pageKey}`;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { id: e.id, createdAt: e.createdAt });
        continue;
      }
      const loser =
        e.createdAt < prev.createdAt ||
        (e.createdAt === prev.createdAt && e.id < prev.id)
          ? prev
          : { id: e.id, createdAt: e.createdAt };
      if (loser === prev) seen.set(key, { id: e.id, createdAt: e.createdAt });
      removeEntry(loser.id);
    }
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
