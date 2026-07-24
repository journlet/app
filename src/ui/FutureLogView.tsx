// The Future log page (spec §4.2). Presentational only: App computes the
// grouped rows and owns fold state; rows are rendered via the same
// renderScheduledRow closure App uses elsewhere, passed in as renderRow so
// behaviour stays identical to the inline version this was extracted from.

import type { ReactNode } from "react";
import { pageLabel } from "../lib/dates";
import { S } from "./styles";
import type { ScheduledRow } from "./types";

interface FutureLogViewProps {
  count: number;
  groups: { gk: string; rows: ScheduledRow[] }[];
  folds: Record<string, boolean>;
  onToggleFold: (gk: string) => void;
  renderRow: (row: ScheduledRow, grouped: boolean) => ReactNode;
}

export default function FutureLogView({
  count,
  groups,
  folds,
  onToggleFold,
  renderRow,
}: FutureLogViewProps) {
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
      {groups.map(({ gk, rows }) => (
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
