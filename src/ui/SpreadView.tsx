// The "spread": the home journal view. Renders the past-tasks review banner,
// the Due section, the four scope sections (day/week/month/year) with their
// navigation, and the Future log summary link. Presentational — App computes
// all the derived lists and owns the render helpers (shared with the
// collection and future-log views) and navigation; date helpers are imported
// directly so the JSX matches the inline version verbatim.

import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  SCOPES,
  SCOPE_LABEL,
  keyScope,
  keyToAnchor,
  pageLabel,
  periodKey,
  periodSub,
  shiftAnchor,
  todayKey,
} from "../lib/dates";
import type { Scope } from "../lib/dates";
import { applyFilter, entryVisible } from "../lib/filter";
import type { EntryFilter } from "../lib/filter";
import type { Entry } from "../lib/types";
import { filterRows } from "./spreadData";
import { S } from "./styles";
import type { ScheduledRow } from "./types";

interface SpreadViewProps {
  renderEntry: (e: Entry, pk: string, sc: Scope | null) => ReactNode;
  renderScheduledRow: (row: ScheduledRow, grouped: boolean) => ReactNode;
  /** entries elsewhere referencing this page (spec §4.4 Threading) */
  renderThreadedHere: (pk: string) => ReactNode;
  pastOpen: { pk: string; entry: Entry }[];
  dueItems: { pk: string; entry: Entry }[];
  days: Record<string, Entry[]>;
  anchors: Record<Scope, string>;
  setAnchors: Dispatch<SetStateAction<Record<Scope, string>>>;
  nowKeys: Record<Scope, string>;
  scheduledRows: ScheduledRow[];
  laterThisMonth: ScheduledRow[];
  futureLogCount: number;
  /** entry visibility filter (remediation item 7) — applied to every section,
   *  the Due list and the within-period scheduled rows */
  filter: EntryFilter;
  onReview: () => void;
  onOpenFutureLog: () => void;
}

export default function SpreadView({
  renderEntry,
  renderScheduledRow,
  renderThreadedHere,
  pastOpen,
  dueItems,
  days,
  anchors,
  setAnchors,
  nowKeys,
  scheduledRows,
  laterThisMonth,
  futureLogCount,
  filter,
  onReview,
  onOpenFutureLog,
}: SpreadViewProps) {
  // The past-tasks banner counts open tasks, so the filter has nothing to say
  // about it. Due does: a completed entry with a stale reminder is exactly the
  // sort of row "open only" is for.
  const due = dueItems.filter(({ entry }) => entryVisible(entry, filter));
  return (
    <>
        {pastOpen.length > 0 && (
          <button className="reviewBanner" onClick={onReview}>
            <span style={{ fontWeight: 600 }}>
              {pastOpen.length} open task{pastOpen.length === 1 ? "" : "s"} from
              past pages
            </span>
            {/* 13px line box so the smaller text can't stretch the
                banner's 22px line and push content off the grid */}
            <span style={{ fontSize: 12.5, lineHeight: "13px" }}>
              Review and migrate ›
            </span>
          </button>
        )}
        {due.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <h2 style={S.sectionTitle}>Due</h2>
              <span style={S.sectionSub}>reminders — overdue and today</span>
            </div>
            <ul style={S.list}>
              {due.map(({ pk, entry }) =>
                renderEntry(entry, pk, keyScope(pk))
              )}
            </ul>
          </section>
        )}
        {SCOPES.map((sc) => {
            const pk = periodKey(sc, anchors[sc]);
            const isCurrent = pk === nowKeys[sc];
            const isFuture = pk > nowKeys[sc];
            const onPage = days[pk] || [];
            const entries = applyFilter(onPage, filter);
            const hidden = onPage.length - entries.length;
            const step = (delta: number) =>
              setAnchors((a) => ({
                ...a,
                [sc]: shiftAnchor(sc, a[sc], delta),
              }));
            // Browsing a future week/month/year: also list everything
            // scheduled *within* the period (on finer-grained pages or as
            // recurrence previews) — the page's own entries alone would
            // contradict the Future log
            const withinRows =
              sc !== "day" && isFuture
                ? filterRows(
                    scheduledRows.filter((r) => {
                      const rpk = r.kind === "entry" ? r.pk : r.dayKey;
                      if (rpk === pk) return false;
                      const anchor = keyToAnchor(rpk);
                      return periodKey(sc, anchor) === pk;
                    }),
                    filter
                  )
                : [];
            return (
              <section key={sc} style={S.section}>
                <div style={S.sectionHead}>
                  <h2 style={S.sectionTitle}>
                    {isCurrent ? SCOPE_LABEL[sc] : pageLabel(pk)}
                  </h2>
                  <span style={S.sectionSub}>
                    {isCurrent
                      ? periodSub(sc, anchors[sc])
                      : isFuture
                        ? "future"
                        : "past"}
                  </span>
                  <span style={S.sectionNav}>
                    <button
                      className="miniBtn"
                      onClick={() => step(-1)}
                      aria-label={`Previous ${sc}`}
                    >
                      ‹ <span className="navLong">previous</span>
                      <span className="navShort">prev</span>
                    </button>
                    {!isCurrent && (
                      <button
                        className="miniBtn"
                        onClick={() =>
                          setAnchors((a) => ({ ...a, [sc]: todayKey() }))
                        }
                        aria-label={`Back to current ${sc}`}
                      >
                        <span className="navLong">back to now</span>
                        <span className="navShort">now</span>
                      </button>
                    )}
                    <button
                      className="miniBtn"
                      onClick={() => step(1)}
                      aria-label={`Next ${sc}`}
                    >
                      next ›
                    </button>
                  </span>
                </div>
                {/* An emptied-out section says which of the two it is: a
                    page with nothing on it, or a page whose entries the
                    filter is holding back. Sections that still show
                    something say nothing extra — the note under the filter
                    row already names what is hidden, and four running
                    counts would put back the clutter the filter removes. */}
                {entries.length === 0 && (
                  <div style={S.sectionEmpty}>
                    {hidden === 0
                      ? "nothing logged"
                      : `nothing matching — ${hidden} entr${
                          hidden === 1 ? "y" : "ies"
                        } hidden by the filter`}
                  </div>
                )}
                <ul style={S.list}>
                  {entries.map((e) => renderEntry(e, pk, sc))}
                </ul>
                {sc === "month" && isCurrent && filterRows(laterThisMonth, filter).length > 0 && (
                  <>
                    <div style={S.subGroupLabel}>Later this month</div>
                    <ul style={S.list}>
                      {filterRows(laterThisMonth, filter).map((row) =>
                        renderScheduledRow(row, true)
                      )}
                    </ul>
                  </>
                )}
                {withinRows.length > 0 && (
                  <>
                    <div style={S.subGroupLabel}>
                      Scheduled in {pageLabel(pk)}
                    </div>
                    <ul style={S.list}>
                      {withinRows.map((row) =>
                        renderScheduledRow(row, sc !== "year")
                      )}
                    </ul>
                  </>
                )}
                {renderThreadedHere(pk)}
              </section>
            );
          })}
        {/* Future log lives on its own page, like the front of a physical
            journal (spec §4.2, revised 21 July 2026) — the spread keeps only
            a one-line summary link so the "now" page stays uncluttered */}
        {futureLogCount > 0 && (
          <button
            className="indexRow"
            style={S.futureLogLink}
            onClick={onOpenFutureLog}
          >
            <span style={{ fontWeight: 600 }}>Future log</span>
            <span
              style={{ fontSize: 11.5, lineHeight: "13px", color: "var(--ink-soft)" }}
            >
              {futureLogCount} item{futureLogCount === 1 ? "" : "s"} · from
              next month on ›
            </span>
          </button>
        )}
    </>
  );
}
