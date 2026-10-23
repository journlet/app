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
//
// A second step since 23 October 2026 (requirements FR3): the repeat's
// reminder, shown here and changeable from today's occurrence onward. Same
// shape as the end step, for the same reason.

import { useState } from "react";
import { GLYPH } from "../lib/types";
import type { Recurrence } from "../lib/types";
import { DEFAULT_REMIND_HOUR, pageLabel, periodKey } from "../lib/dates";
import { endRecurrence, setRecurrenceEnd } from "../store/journal";
import {
  applySeriesReminder,
  cadenceLabel,
  isSpent,
  lastOccurrence,
  ruleSentence,
  seriesTimeLabel,
  skipOccurrence,
} from "../store/recurrence";
import {
  notificationPermission,
  requestNotificationPermission,
} from "../store/reminders";
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
  /** the reminder time being chosen, "HH:MM"; null while the step is closed */
  const [remind, setRemind] = useState<string | null>(null);
  const [remindRefused, setRemindRefused] = useState<string | null>(null);
  const remindLabel = seriesTimeLabel(rule);
  // A stopped or spent repeat makes nothing more, so a reminder for it would
  // reach nothing: it is shown, but not offered for change.
  const live = !isSpent(rule, today);
  const timeIsValid =
    remind !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(remind);

  /**
   * Change the repeat's reminder from the current period on (requirements FR3).
   * Today's occurrence is updated if it is open and follows the repeat; earlier
   * pages and any occurrence with a reminder of its own are left alone, which
   * is applySeriesReminder's rule rather than this sheet's. A refusal (the rule
   * went while the step was open) is said in place rather than swallowed.
   */
  const saveRemind = async (time: string | null) => {
    if (time !== null && notificationPermission() === "default")
      await requestNotificationPermission();
    try {
      applySeriesReminder(rule, {
        from: periodKey(rule.pageScope, today),
        via: "settings",
        time,
      });
    } catch (err) {
      console.error("journlet series reminder:", err);
      setRemindRefused(
        "That reminder could not be saved because the repeat changed. Try again."
      );
      return;
    }
    onClose();
  };

  return (
    <BottomSheet
      label={
        ends
          ? "When this repeat ends"
          : remind !== null
            ? "Reminder for this repeat"
            : "Repeating entry actions"
      }
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
      <p style={S.subLede} data-testid="rule-reminder-current">
        {remindLabel ? `Reminder: ${remindLabel}` : "No reminder"}
      </p>

      {remind !== null ? (
        <>
          <div style={S.formLbl}>
            Remind me at, from{" "}
            {pageLabel(periodKey(rule.pageScope, today))} on
          </div>
          <input
            type="time"
            value={remind}
            onChange={(ev) => setRemind(ev.target.value)}
            style={{ ...S.sheetInput, maxWidth: 160 }}
            aria-label="Reminder time for this repeat"
            data-testid="rule-reminder-time"
          />
          <p style={S.subLede}>
            {rule.pageScope === "day"
              ? "On the day of each occurrence."
              : "On the first day of each one."}{" "}
            Any occurrence with a reminder of its own keeps it.
          </p>
          {remindRefused && (
            <div style={S.sheetWarn} role="alert">
              {remindRefused}
            </div>
          )}
          <button
            className="sheetBtn"
            disabled={!timeIsValid}
            onClick={() => void saveRemind(remind)}
            data-testid="rule-reminder-save"
          >
            Save reminder
          </button>
          {remindLabel && (
            <button
              className="sheetBtn isDanger"
              onClick={() => void saveRemind(null)}
              data-testid="rule-reminder-remove"
            >
              Remove reminder
            </button>
          )}
          <button
            className="sheetBtn isQuiet"
            onClick={() => {
              setRemindRefused(null);
              setRemind(null);
            }}
            data-testid="rule-reminder-back"
          >
            Back
          </button>
        </>
      ) : ends ? (
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
          {live && (
            <button
              className="sheetBtn"
              onClick={() =>
                setRemind(
                  rule.remindTime ??
                    `${String(DEFAULT_REMIND_HOUR).padStart(2, "0")}:00`
                )
              }
              data-testid="rule-reminder-set"
            >
              {remindLabel ? "Change reminder…" : "Set reminder…"}
            </button>
          )}
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
