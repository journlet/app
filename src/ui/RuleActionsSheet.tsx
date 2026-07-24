// Rule-actions sheet: opened from a recurrence-preview row's ⋯ menu. Lets the
// user skip the shown occurrence or stop the rule. Presentational — App
// resolves the rule and owns the open/close state; the two store mutators are
// imported directly as elsewhere.

import { GLYPH } from "../lib/types";
import type { Recurrence, RecurrenceUnit } from "../lib/types";
import { pageLabel } from "../lib/dates";
import { endRecurrence } from "../store/journal";
import { skipOccurrence } from "../store/recurrence";
import { S } from "./styles";

interface RuleActionsSheetProps {
  rule: Recurrence;
  dayKey: string;
  onClose: () => void;
  cadenceLabel: (n: number, unit: RecurrenceUnit) => string;
}

export default function RuleActionsSheet({
  rule,
  dayKey,
  onClose,
  cadenceLabel,
}: RuleActionsSheetProps) {
  return (
    <div style={S.sheetBackdrop} onClick={onClose}>
      <div
        style={S.sheet}
        role="dialog"
        aria-label="Repeating entry actions"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={S.sheetHandle} />
        <div style={S.sheetGroupLabel}>Repeating entry</div>
        <div className="entry" style={{ pointerEvents: "none" }}>
          <span className="bullet" aria-hidden="true">
            {GLYPH[rule.type]}
          </span>
          <span className="etext">
            {rule.priority && <span className="prio"><i>*</i></span>}
            {rule.inspiration && <span className="insp">!</span>}
            {rule.text}
            <span
              style={{
                fontSize: 11.5,
                color: "var(--ink-soft)",
                marginLeft: 8,
              }}
            >
              repeats {cadenceLabel(rule.everyN, rule.unit)} — next:{" "}
              {pageLabel(dayKey)}
            </span>
          </span>
        </div>
        <button
          className="sheetBtn"
          onClick={() => {
            skipOccurrence(rule, dayKey);
            onClose();
          }}
        >
          Skip this occurrence ({pageLabel(dayKey)}) — it stays on its page,
          struck out
        </button>
        <button
          className="sheetBtn"
          onClick={() => {
            endRecurrence(rule.id);
            onClose();
          }}
        >
          Stop repeating ({cadenceLabel(rule.everyN, rule.unit)})
        </button>
        <button className="sheetBtn isQuiet" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
