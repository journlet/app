// The "when it ends" control (spec §11 Q17), in one place because it is offered
// in three: the Repeat step where a repeat is made, the ⋯ view's own step, and
// the rule sheet reached from a Scheduled ahead preview. Two forms, never and
// the two ways of saying an end, with the answer resolved in front of you.
//
// Why the resolution is on screen rather than implied. An end date does not have
// to be one of the rule's own days, and a count is a number rather than a date,
// so in both forms what you type and what actually happens can differ. The
// prototype (v18) made that plain the first time a Thursday was picked for a
// Wednesday rule, so the box below always names the occurrence the end lands on,
// and says why when it is not the day that was chosen.
//
// Presentational. The draft lives in App beside the other sheet drafts; the save
// button belongs to whichever surface opened this, since only it knows what the
// button should say.

import { keyScope, keyToAnchor, pageLabel, periodKey } from "../lib/dates";
import type { Recurrence } from "../lib/types";
import {
  lastOccurrence,
  occurrenceKey,
  occurrencesThrough,
} from "../store/recurrence";
import { S } from "./styles";
import type { EditEnds } from "./types";

interface EndsFormProps {
  /** the rule as it would be with no end set — real, or the one about to be
   *  made by the Repeat step */
  base: Recurrence;
  value: EditEnds;
  onChange: (v: EditEnds) => void;
  today: string;
  /** prefix for the input ids, so two of these can never collide */
  idPrefix: string;
}

export interface EndsResolution {
  /** the rule with the draft applied, ready to hand to lastOccurrence */
  draft: Recurrence;
  /** the occurrence the end lands on, null when the draft sets no end */
  last: string | null;
  /** why this draft cannot be saved, in words for the person */
  error: string | null;
  /** how many occurrences have already come round */
  comeRound: number;
}

/** The one place the draft is turned into an answer, so the form and the save
 *  that follows it cannot disagree about what was chosen. */
export const resolveEnds = (
  base: Recurrence,
  value: EditEnds,
  today: string
): EndsResolution => {
  const comeRound = occurrencesThrough(base, today);
  const count = Math.max(1, parseInt(value.count, 10) || 1);
  const draft: Recurrence = {
    ...base,
    endsOn: value.mode === "date" ? value.date : undefined,
    endsAfter: value.mode === "count" ? count : undefined,
  };
  if (value.mode === "never")
    return { draft, last: null, error: null, comeRound };
  const last = lastOccurrence(draft);
  let error: string | null = null;
  if (value.mode === "date" && !value.date) error = "Pick a day.";
  else if (!last)
    error =
      "That is before this entry's first occurrence, so nothing would repeat. Pick a later day.";
  else if (value.mode === "count" && count < comeRound)
    error = `${comeRound} have already come round, so the fewest this can be is ${comeRound}.`;
  return { draft, last, error, comeRound };
};

/**
 * The draft an existing rule opens with, shared by the two surfaces that offer
 * the step so their defaults cannot drift.
 *
 * A rule with no end opens on one of its own days rather than on an arbitrary
 * date: a dozen more occurrences for a daily or weekly rule, a couple more for
 * a monthly or yearly one, which is a plausible unit at either speed and means
 * the picker never opens on a day the rule does not fall on. Two defaults are
 * deliberately avoided — today, which offers the one answer nobody came for,
 * and a past date, which the control cannot express anyway.
 */
export const endsDraftFor = (r: Recurrence, today: string): EditEnds => {
  const comeRound = occurrencesThrough(r, today);
  const ahead = r.pageScope === "day" || r.pageScope === "week" ? 12 : 2;
  return {
    mode: r.endsAfter ? "count" : r.endsOn ? "date" : "never",
    date:
      r.endsOn && r.endsOn >= today
        ? r.endsOn
        : keyToAnchor(occurrenceKey(r, comeRound + ahead)),
    count: String(r.endsAfter ?? comeRound + 1),
  };
};

export default function EndsForm({
  base,
  value,
  onChange,
  today,
  idPrefix,
}: EndsFormProps) {
  const res = resolveEnds(base, value, today);
  const dateId = `${idPrefix}-endDate`;
  const countId = `${idPrefix}-endCount`;
  const scope = base.pageScope;
  const unitWord = scope === "day" ? "day" : `${scope} page`;

  const modes: { key: EditEnds["mode"]; label: string }[] = [
    { key: "never", label: "Never" },
    { key: "date", label: "On a date" },
    { key: "count", label: "After a number" },
  ];

  return (
    <>
      <div style={S.filterTrack} role="group" aria-label="When it ends">
        {modes.map((m) => (
          <button
            key={m.key}
            className={"scopeBtn" + (value.mode === m.key ? " isActive" : "")}
            style={{
              background: value.mode === m.key ? "var(--surface)" : "none",
            }}
            aria-pressed={value.mode === m.key}
            onClick={() => onChange({ ...value, mode: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {value.mode === "date" && (
        <>
          <label style={S.formLbl} htmlFor={dateId}>
            Last {unitWord} it may fall on
          </label>
          <input
            id={dateId}
            type="date"
            min={today}
            value={value.date}
            onChange={(ev) => onChange({ ...value, date: ev.target.value })}
            style={{ ...S.sheetInput, maxWidth: 210 }}
          />
        </>
      )}

      {value.mode === "count" && (
        <>
          <label style={S.formLbl} htmlFor={countId}>
            How many in total
          </label>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <input
              id={countId}
              type="number"
              min={Math.max(1, res.comeRound)}
              max={400}
              value={value.count}
              onChange={(ev) => onChange({ ...value, count: ev.target.value })}
              style={{ ...S.sheetInput, width: 84, marginBottom: 0 }}
            />
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              counting from the first one
            </span>
          </div>
        </>
      )}

      <p style={S.endsResolved} role="status">
        {res.error
          ? res.error
          : value.mode === "never"
            ? "No end. It repeats until you stop it, which is how every repeat works today."
            : `Last occurrence: ${pageLabel(res.last as string)}`}
        {!res.error && value.mode === "date" && res.last && (
          <span style={S.endsWhy}>
            {periodKey(scope, value.date) === res.last
              ? "That is one of its own days."
              : `${
                  keyScope(value.date) === "day"
                    ? pageLabel(value.date)
                    : value.date
                } is not one of its days, so the last one is the ${
                  scope === "day" ? "day" : scope
                } before.`}
          </span>
        )}
        {!res.error && value.mode === "count" && res.last && (
          <span style={S.endsWhy}>
            {res.comeRound} of {Math.max(1, parseInt(value.count, 10) || 1)} have
            already come round.
          </span>
        )}
      </p>
      <p style={S.subLede}>
        Occurrences already on their pages stay exactly as they are, in whatever
        state they are in. An end only stops new ones being made. To end a repeat
        now rather than later, use Stop repeating.
      </p>
    </>
  );
}
