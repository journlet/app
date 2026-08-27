// Rule-actions sheet: opened from a recurrence-preview row's ⋯ menu. Lets the
// user skip the shown occurrence, say when the rule ends, or stop it now.
// Presentational — App resolves the rule and owns the open/close state; the
// store mutators are imported directly as elsewhere.
//
// It has one step of its own since 26 August 2026 (spec §11 Q17): the end
// control replaces the action list rather than unfolding beneath it, which is
// the rule §4.1a set for the entry view and the reason that view stopped
// overflowing a phone. Its draft is local because nothing outside this sheet
// outlives it — unlike the entry view's, which App holds because the row that
// opens it is one of sixteen.

import { useState } from "react";
import { GLYPH } from "../lib/types";
import type { Recurrence } from "../lib/types";
import { pageLabel } from "../lib/dates";
import { endRecurrence, setRecurrenceEnd } from "../store/journal";
import {
  cadenceLabel,
  lastOccurrence,
  ruleSentence,
  skipOccurrence,
} from "../store/recurrence";
import EndsForm, {
  endsDraftFor,
  endsSaveLabel,
  resolveEnds,
} from "./EndsForm";
import { S } from "./styles";
import BottomSheet from "./BottomSheet";
import type { EditEnds } from "./types";

interface RuleActionsSheetProps {
  rule: Recurrence;
  dayKey: string;
  today: string;
  onClose: () => void;
}

export default function RuleActionsSheet({
  rule,
  dayKey,
  today,
  onClose,
}: RuleActionsSheetProps) {
  const [ends, setEnds] = useState<EditEnds | null>(null);
  const base: Recurrence = { ...rule, endsOn: undefined, endsAfter: undefined };
  const endsRes = ends ? resolveEnds(base, ends, today) : null;

  return (
    <BottomSheet
      label={ends ? "When this repeat ends" : "Repeating entry actions"}
      onClose={onClose}
    >
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
            {ruleSentence(rule, today)} — next: {pageLabel(dayKey)}
          </span>
        </span>
      </div>

      {ends ? (
        <>
          <EndsForm
            base={base}
            value={ends}
            onChange={setEnds}
            today={today}
            idPrefix="rule"
          />
          <button
            className="sheetBtn"
            disabled={endsRes?.error != null}
            onClick={() => {
              setRecurrenceEnd(
                rule.id,
                ends.mode === "date"
                  ? { on: ends.date }
                  : ends.mode === "count"
                    ? { after: Math.max(1, parseInt(ends.count, 10) || 1) }
                    : null
              );
              onClose();
            }}
          >
            {endsRes ? endsSaveLabel(endsRes, base) : "Save when it ends"}
          </button>
          <button
            className="sheetBtn isQuiet"
            onClick={() => setEnds(null)}
          >
            Back
          </button>
        </>
      ) : (
        <>
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
            onClick={() => setEnds(endsDraftFor(rule, today))}
          >
            {lastOccurrence(rule)
              ? "Change when it ends…"
              : "Set when it ends…"}
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
        </>
      )}
    </BottomSheet>
  );
}
