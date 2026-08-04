// The Future log page (spec §4.2). Presentational only: App computes the
// grouped rows and owns fold state; rows are rendered via the same
// renderScheduledRow closure App uses elsewhere, passed in as renderRow so
// behaviour stays identical to the inline version this was extracted from.

import type { ReactNode } from "react";
import { pageLabel } from "../lib/dates";
import type { EntryFilter } from "../lib/filter";
import { filterRows } from "./spreadData";
import { S } from "./styles";
import type { ScheduledRow } from "./types";

interface FutureLogViewProps {
  count: number;
  groups: { gk: string; rows: ScheduledRow[] }[];
  folds: Record<string, boolean>;
  onToggleFold: (gk: string) => void;
  /** entry visibility filter (remediation item 7) */
  filter: EntryFilter;
  renderRow: (row: ScheduledRow, grouped: boolean) => ReactNode;
}

export default function FutureLogView({
  count,
  groups,
  folds,
  onToggleFold,
  filter,
  renderRow,
}: FutureLogViewProps) {
  // Groups that empty out are dropped rather than left as a heading with
  // nothing under it; the count below says how many rows that came to.
  const groupsShown = groups
    .map(({ gk, rows }) => ({ gk, rows: filterRows(rows, filter) }))
    .filter((g) => g.rows.length > 0);
  const shown = groupsShown.reduce((n, g) => n + g.rows.length, 0);
  const hidden = count - shown;
  return (
    <section style={S.section}>
      <div style={S.sectionHead}>
        <h2 style={S.sectionTitle}>Future log</h2>
        <span style={S.sectionSub}>
          from next month on — items surface on their page when the period
          arrives
        </span>
      </div>
      {count === 0 && (
        <div style={S.empty}>
          Nothing scheduled ahead — choose "date…" in the entry form to log an
          entry to a future page.
        </div>
      )}
      {count > 0 && shown === 0 && (
        <div style={S.empty}>
          Nothing matching — {hidden} item{hidden === 1 ? "" : "s"} scheduled
          ahead {hidden === 1 ? "is" : "are"} hidden by the filter.
        </div>
      )}
      {groupsShown.map(({ gk, rows }) => (
        <div key={gk}>
          <div style={S.flGroupHead}>
            <span style={S.subGroupLabel}>{pageLabel(gk)}</span>
            <button
              className="miniBtn"
              onClick={() => onToggleFold(gk)}
              aria-expanded={!folds[gk]}
            >
              {rows.length} item{rows.length === 1 ? "" : "s"} ·{" "}
              {folds[gk] ? "show" : "hide"}
            </button>
          </div>
          {!folds[gk] && (
            <ul style={S.list}>{rows.map((row) => renderRow(row, true))}</ul>
          )}
        </div>
      ))}
    </section>
  );
}
