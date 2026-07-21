// Recurrence materialiser: turns rules into ordinary entries, client-side.
// A recurring entry only needs to exist when a page is looked at, so each
// device materialises any occurrences due up to today. Instances are
// normal entries tagged with recurrenceId; two devices racing offline can
// double-create, so a deterministic dedupe pass keeps the earliest twin.

import { dkey, todayKey, toDate } from "../lib/dates";
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

export const nextOccurrence = (r: Recurrence, after: string): string => {
  // Walk forward from the anchor in rule-sized steps until past `after`
  const d = toDate(r.anchor);
  let k = r.anchor;
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
    k = dkey(d);
  }
  return k;
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
      let through = rule.materialisedThrough;
      for (let i = 0; i < MAX_CATCHUP; i++) {
        const next = nextOccurrence(rule, through);
        if (next > today) break;
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
            remindAt: remindAtFor(rule, next),
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
