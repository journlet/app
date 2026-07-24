// Derived view-model for the journal shell, computed from the journal snapshot
// (days + recurrences) and the current day. Pure and side-effect free — no
// writes, so recurrence rows here are display-only previews. Extracted from
// App so the grouping/scheduling logic can be unit-tested directly.

import { SCOPES, keyScope, keyToAnchor, periodKey } from "../lib/dates";
import type { Scope } from "../lib/dates";
import type { Entry, Recurrence } from "../lib/types";
import { nextOccurrence } from "../store/recurrence";
import type { ScheduledRow } from "./types";

export interface SpreadData {
  nowKeys: Record<Scope, string>;
  /** Open tasks on expired pages, awaiting a migration decision. */
  pastOpen: { pk: string; entry: Entry }[];
  /** Entries scheduled onto future pages. */
  futureItems: { pk: string; scope: Scope; entry: Entry }[];
  /** Future entries plus recurrence-rule previews, sorted by landing day. */
  scheduledRows: ScheduledRow[];
  /** Scheduled rows that fall inside the current month. */
  laterThisMonth: ScheduledRow[];
  /** Scheduled rows beyond this month, grouped by month (or year bucket). */
  futureLogGroups: { gk: string; rows: ScheduledRow[] }[];
  futureLogCount: number;
  /** Overdue and due-today reminders on open entries. */
  dueItems: { pk: string; entry: Entry }[];
}

export function buildSpreadData(
  days: Record<string, Entry[]>,
  recurrences: Recurrence[],
  today: string
): SpreadData {
  const nowKeys = {} as Record<Scope, string>;
  SCOPES.forEach((sc) => (nowKeys[sc] = periodKey(sc, today)));

  const pastOpen: { pk: string; entry: Entry }[] = [];
  Object.keys(days).forEach((k) => {
    const sc = keyScope(k);
    if (!sc) return;
    if (k >= nowKeys[sc]) return;
    (days[k] || []).forEach((e) => {
      if (e.type === "task" && e.state === "open")
        pastOpen.push({ pk: k, entry: e });
    });
  });

  const futureItems: { pk: string; scope: Scope; entry: Entry }[] = [];
  Object.keys(days)
    .sort()
    .forEach((k) => {
      const sc = keyScope(k);
      if (!sc) return;
      if (k <= nowKeys[sc]) return;
      (days[k] || []).forEach((e) =>
        futureItems.push({ pk: k, scope: sc, entry: e })
      );
    });

  const scheduledRows: ScheduledRow[] = [
    ...futureItems.map(
      ({ pk, entry }): ScheduledRow => ({
        kind: "entry",
        sort: keyToAnchor(pk),
        pk,
        entry,
      })
    ),
    ...(() => {
      // A rule's next occurrence may already exist as a real entry (the
      // entry made recurring sits on a future page, or an instance was
      // materialised) — skip the preview then, the real row covers it
      const covered = new Set(
        futureItems
          .filter((f) => f.entry.recurrenceId)
          .map((f) => `${f.entry.recurrenceId}:${f.pk}`)
      );
      return recurrences
        .filter((r) => !r.endedAt)
        .map((r) => {
          const occKey = nextOccurrence(r, periodKey(r.pageScope, today));
          // sort by the period's first day so week/month/year previews
          // interleave correctly with dated entries
          return {
            kind: "rule" as const,
            sort: keyToAnchor(occKey),
            dayKey: occKey,
            rule: r,
          };
        })
        .filter((row) => !covered.has(`${row.rule.id}:${row.dayKey}`));
    })(),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

  // Future log (spec §4.2; §11 Q9 resolved 21 July 2026): Carroll's Future
  // Log starts where the current month ends. Rows landing later this month
  // stay with the This Month section; everything beyond groups by month
  // (weeks file under their Monday's month), and year-scoped items sit in
  // a year bucket until they gain a date. Empty months are skipped — the
  // paper method pre-draws them only because paper must be allocated.
  const rowGroupKey = (r: ScheduledRow): string => {
    const pk = r.kind === "entry" ? r.pk : r.dayKey;
    if (keyScope(pk) === "year") return pk;
    // keyToAnchor turns any period key into a day inside it, so week/month
    // rule previews file under the right month (weeks under their Monday's)
    return keyToAnchor(pk).slice(0, 7);
  };
  const laterThisMonth = scheduledRows.filter(
    (r) => rowGroupKey(r) === nowKeys.month
  );
  const futureLogGroups: { gk: string; rows: ScheduledRow[] }[] = [];
  scheduledRows.forEach((r) => {
    const gk = rowGroupKey(r);
    if (gk === nowKeys.month) return;
    const g = futureLogGroups.find((x) => x.gk === gk);
    if (g) g.rows.push(r);
    else futureLogGroups.push({ gk, rows: [r] });
  });
  futureLogGroups.sort((a, b) => (a.gk < b.gk ? -1 : 1));
  const futureLogCount = futureLogGroups.reduce((n, g) => n + g.rows.length, 0);

  // Due view (spec §4.6): overdue and due-today reminders on open entries
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const dueItems: { pk: string; entry: Entry }[] = [];
  Object.keys(days).forEach((k) => {
    (days[k] || []).forEach((e) => {
      if (!e.remindAt || e.state !== "open") return;
      if (e.remindAt <= endOfToday.getTime()) dueItems.push({ pk: k, entry: e });
    });
  });
  dueItems.sort((a, b) => (a.entry.remindAt ?? 0) - (b.entry.remindAt ?? 0));

  return {
    nowKeys,
    pastOpen,
    futureItems,
    scheduledRows,
    laterThisMonth,
    futureLogGroups,
    futureLogCount,
    dueItems,
  };
}
