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
import type { Entry } from "../lib/types";
import { S } from "./styles";
import type { ScheduledRow } from "./types";

interface SpreadViewProps {
  renderEntry: (e: Entry, pk: string, sc: Scope | null) => ReactNode;
  renderScheduledRow: (row: ScheduledRow, grouped: boolean) => ReactNode;
  pastOpen: { pk: string; entry: Entry }[];
  dueItems: { pk: string; entry: Entry }[];
  days: Record<string, Entry[]>;
  anchors: Record<Scope, string>;
  setAnchors: Dispatch<SetStateAction<Record<Scope, string>>>;
  nowKeys: Record<Scope, string>;
  scheduledRows: ScheduledRow[];
  laterThisMonth: ScheduledRow[];
  futureLogCount: number;
  onReview: () => void;
  onOpenFutureLog: () => void;
}

export default function SpreadView({
  renderEntry,
  renderScheduledRow,
  pastOpen,
  dueItems,
  days,
  anchors,
  setAnchors,
  nowKeys,
  scheduledRows,
  laterThisMonth,
  futureLogCount,
  onReview,
  onOpenFutureLog,
}: SpreadViewProps) {
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
        {dueItems.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <h2 style={S.sectionTitle}>Due</h2>
              <span style={S.sectionSub}>reminders — overdue and today</span>
            </div>
            <ul style={S.list}>
              {dueItems.map(({ pk, entry }) =>
                renderEntry(entry, pk, keyScope(pk))
              )}
            </ul>
          </section>
        )}
        {SCOPES.map((sc) => {
            const pk = periodKey(sc, anchors[sc]);
            const isCurrent = pk === nowKeys[sc];
            const isFuture = pk > nowKeys[sc];
            const entries = days[pk] || [];
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
                ? scheduledRows.filter((r) => {
                    const rpk = r.kind === "entry" ? r.pk : r.dayKey;
                    if (rpk === pk) return false;
                    const anchor = keyToAnchor(rpk);
                    return periodKey(sc, anchor) === pk;
                  })
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
                {entries.length === 0 && (
                  <div style={S.sectionEmpty}>nothing logged</div>
                )}
                <ul style={S.list}>
                  {entries.map((e) => renderEntry(e, pk, sc))}
                </ul>
                {sc === "month" && isCurrent && laterThisMonth.length > 0 && (
                  <>
                    <div style={S.subGroupLabel}>Later this month</div>
                    <ul style={S.list}>
                      {laterThisMonth.map((row) =>
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
