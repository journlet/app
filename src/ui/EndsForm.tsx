// The "when it ends" control (spec §11 Q17), in one place because it is offered
// in three: the Repeat step where a repeat is made, the ⋯ view's own step, and
// the rule sheet reached from a preview row. Two forms, never and the two ways
// of saying an end, with the answer resolved in front of you.
//
// Why the resolution is on screen rather than implied. An end date does not have
// to be one of the rule's own days, and a count is a number rather than a date,
// so in both forms what you type and what actually happens can differ. The
// prototype (v18) made that plain the first time a Thursday was picked for a
// Wednesday rule.
//
// Why it now says which *kind* of answer it is (26 August 2026). On the first
// day of use an end was set whose last occurrence was that same day. The app did
// exactly what it was told, the repeat left the future log, and nothing anywhere
// explained it: the box had reported the most consequential setting available
// here in the flattest words it had, "Last occurrence: Wed, 26 Aug", which reads
// like a receipt for something harmless. An end landing on the current period is
// not "it finishes later", it is "this is the last one", and an end landing
// before it is "nothing more at all" — which is Stop repeating wearing different
// words. Both now say so, in the box and on the button, and creating a repeat
// that would produce a single occurrence is refused rather than allowed to look
// like a repeat.
//
// Presentational. The draft lives in App beside the other sheet drafts, except
// in the rule sheet, which owns its own; the save belongs to whichever surface
// opened this, since only it knows what happens next.

import {
  SCOPE_NOW_WORD,
  endLabel,
  keyScope,
  keyToAnchor,
  pageLabel,
  periodKey,
} from "../lib/dates";
import type { Recurrence } from "../lib/types";
import {
  lastOccurrence,
  occurrenceKey,
  occurrencesThrough,
} from "../store/recurrence";
import { S } from "./styles";
import type { EditEnds } from "./types";

interface EndsFormProps {
  /** the rule as it would be with no end set — real, or the one the Repeat step
   *  is about to make */
  base: Recurrence;
  value: EditEnds;
  onChange: (v: EditEnds) => void;
  today: string;
  /** true in the Repeat step: the rule does not exist yet, so an end that would
   *  leave a single occurrence is refused rather than described */
  creating?: boolean;
  /** prefix for the input ids, so two of these can never collide */
  idPrefix: string;
}

/**
 * What the draft would do, named rather than merely dated.
 *
 * - `never`  no end at all
 * - `later`  it carries on and stops on a named occurrence
 * - `now`    the current period is the last one
 * - `past`   nothing more would be made; the last one has already gone
 * - `error`  it cannot be saved, and `error` says why in words
 */
export type EndsState = "never" | "later" | "now" | "past" | "error";

export interface EndsResolution {
  /** the rule with the draft applied, ready to hand to lastOccurrence */
  draft: Recurrence;
  /** the occurrence the end lands on, null when the draft sets no end */
  last: string | null;
  state: EndsState;
  /** why this draft cannot be saved, in words for the person */
  error: string | null;
  /** how many occurrences have already come round */
  comeRound: number;
}

/** The one place the draft is turned into an answer, so the form, the button and
 *  the save that follows cannot disagree about what was chosen. */
export const resolveEnds = (
  base: Recurrence,
  value: EditEnds,
  today: string,
  creating = false
): EndsResolution => {
  const comeRound = occurrencesThrough(base, today);
  const count = Math.max(1, parseInt(value.count, 10) || 1);
  const draft: Recurrence = {
    ...base,
    endsOn: value.mode === "date" ? value.date : undefined,
    endsAfter: value.mode === "count" ? count : undefined,
  };
  if (value.mode === "never")
    return { draft, last: null, state: "never", error: null, comeRound };

  const last = lastOccurrence(draft);
  const nowPeriod = periodKey(base.pageScope, today);
  const anchorPeriod = periodKey(base.pageScope, base.anchor);
  // A new rule materialises from the later of its page and the current period,
  // so an end at or before that point leaves the entry that is already there and
  // nothing else.
  const floor = anchorPeriod > nowPeriod ? anchorPeriod : nowPeriod;

  let error: string | null = null;
  if (value.mode === "date" && !value.date) error = "Pick a day.";
  else if (!last)
    error =
      "That is before this entry's first occurrence, so nothing would repeat. Pick a later day.";
  else if (value.mode === "count" && count < comeRound)
    error = `${comeRound} have already come round, so the fewest this can be is ${comeRound}.`;
  else if (creating && last <= floor)
    error =
      "That would give one occurrence, which is the entry you already have. A repeat needs a later end.";
  if (error) return { draft, last, state: "error", error, comeRound };

  const state: EndsState =
    last === nowPeriod ? "now" : (last as string) < nowPeriod ? "past" : "later";
  return { draft, last, state, error: null, comeRound };
};

/** What the button that writes this draft should say. Never "Save when it ends"
 *  for an end that has already arrived: the label is the last thing read before
 *  the tap, so it carries the consequence. */
export const endsSaveLabel = (res: EndsResolution, base: Recurrence): string => {
  if (res.state === "never") return "Save: no end";
  if (res.state === "now")
    return `Save: ${SCOPE_NOW_WORD[base.pageScope]} is the last one`;
  if (res.state === "past")
    return `Save: nothing more after ${endLabel(res.last as string)}`;
  return "Save when it ends";
};

/**
 * The draft an existing rule opens with, shared by the two surfaces that offer
 * the step so their defaults cannot drift.
 *
 * Three things it is careful about. A rule with no end opens on one of its own
 * days rather than an arbitrary date: a dozen more occurrences for a daily or
 * weekly rule, two more for a monthly or yearly one. The count opens on the same
 * occurrence as the date, so switching between the forms to see what each means
 * does not quietly move the end. And that default sits a dozen steps above the
 * count's floor rather than one, because the floor is "this is the last one" and
 * a single tap of a spinner is no way to arrive there.
 */
export const endsDraftFor = (r: Recurrence, today: string): EditEnds => {
  const comeRound = occurrencesThrough(r, today);
  const ahead = r.pageScope === "day" || r.pageScope === "week" ? 12 : 2;
  const last = lastOccurrence(r);
  const target = keyToAnchor(last ?? occurrenceKey(r, comeRound + ahead));
  return {
    mode: r.endsAfter ? "count" : r.endsOn ? "date" : "never",
    date: r.endsOn && r.endsOn >= today ? r.endsOn : target,
    count: String(r.endsAfter ?? occurrencesThrough(r, target)),
  };
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export default function EndsForm({
  base,
  value,
  onChange,
  today,
  creating = false,
  idPrefix,
}: EndsFormProps) {
  const res = resolveEnds(base, value, today, creating);
  const dateId = `${idPrefix}-endDate`;
  const countId = `${idPrefix}-endCount`;
  const scope = base.pageScope;
  const unitWord = scope === "day" ? "day" : `${scope} page`;
  const nowWord = SCOPE_NOW_WORD[scope];

  const modes: { key: EditEnds["mode"]; label: string }[] = [
    { key: "never", label: "Never" },
    { key: "date", label: "On a date" },
    { key: "count", label: "After a number" },
  ];

  /** The headline in the resolution box: what this draft does, in a sentence. */
  const said = (): string => {
    if (res.state === "error") return res.error as string;
    if (res.state === "never")
      return "No end. It repeats until you stop it, which is how every repeat works today.";
    if (res.state === "now") return `${capitalise(nowWord)} is the last one.`;
    if (res.state === "past") return "Nothing more would be made.";
    return `Last occurrence: ${pageLabel(res.last as string)}`;
  };

  /** The quieter second line: why, or what it costs. */
  const because = (): string | null => {
    if (res.state === "error") return null;
    if (res.state === "now")
      return `Nothing new after ${pageLabel(
        res.last as string
      )}. What is already on a page stays exactly as it is.`;
    if (res.state === "past")
      return `The last one was ${pageLabel(
        res.last as string
      )}, which has gone, so this ends the repeat where it stands.`;
    if (res.state === "later" && value.mode === "date")
      return periodKey(scope, value.date) === res.last
        ? "That is one of its own days."
        : `${
            keyScope(value.date) === "day" ? pageLabel(value.date) : value.date
          } is not one of its days, so the last one is the ${
            scope === "day" ? "day" : scope
          } before.`;
    if (res.state === "later" && value.mode === "count")
      return `${res.comeRound} of ${Math.max(
        1,
        parseInt(value.count, 10) || 1
      )} have already come round.`;
    return null;
  };

  const why = because();

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

      <p
        style={{
          ...S.endsResolved,
          // An end that has already arrived is a different kind of answer from
          // one that is still ahead, so it does not wear the same quiet edge.
          borderLeftColor:
            res.state === "now" || res.state === "past" || res.state === "error"
              ? "var(--danger)"
              : "var(--ink)",
        }}
        role="status"
      >
        {said()}
        {why && <span style={S.endsWhy}>{why}</span>}
      </p>
      <p style={S.subLede}>
        Occurrences already on their pages stay exactly as they are, in whatever
        state they are in. An end only stops new ones being made. To end a repeat
        now rather than later, use Stop repeating.
      </p>
    </>
  );
}
