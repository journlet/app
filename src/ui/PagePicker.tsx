// The one page chooser (spec §4.1, §4.2). Pick the kind of page — day, week,
// month or year — then which one of them. Shared by the capture form's "Log
// into" and the entry sheet's "Move to", so where an entry goes is one control
// learned once, whether the entry is being written or being put right.
//
// Superseded the earlier pair of rows (Today / This week / This month / This
// year, plus a "date…" tab revealing a second row of the same four words),
// recorded 5 August 2026: the four words appeared twice, meaning two different
// things, and "today" was a button rather than simply where the picker starts.
//
// Nothing here is implied. The granularity row names the four kinds of page,
// the line beneath names the chosen page in full ("Week 32 · 3 Aug – 9 Aug"),
// and the current period is said in words ("today", "this week") rather than
// left to a highlight. Stepping moves by the chosen unit, reusing the spread's
// own ‹ previous / next › idiom; the date field jumps further in one go.
//
// Why an in-app stepper rather than native week and month inputs: Safari, on
// iOS and macOS both, supports neither and silently degrades them to a
// free-text box — so a picker built on them would be a typing exercise on the
// platform this journal is mainly kept on.

import { useState } from "react";
import {
  SCOPES,
  SCOPE_NOW_WORD,
  periodKey,
  periodName,
  shiftAnchor,
} from "../lib/dates";
import type { Scope } from "../lib/dates";
import PeriodChooser from "./PeriodChooser";
import { S } from "./styles";

interface PagePickerProps {
  /** the group label, e.g. "Log into" or "Move to" */
  label: string;
  gran: Scope;
  setGran: (scope: Scope) => void;
  /** a day inside the chosen page; the page itself is periodKey(gran, anchor) */
  anchor: string;
  setAnchor: (anchor: string) => void;
  today: string;
  /** earliest page on offer, as a day key — capture never logs into the past */
  minAnchor?: string;
  /** run after any change, e.g. to put focus back in the entry field */
  onChanged?: () => void;
}

export default function PagePicker({
  label,
  gran,
  setGran,
  anchor,
  setAnchor,
  today,
  minAnchor,
  onChanged,
}: PagePickerProps) {
  // The chooser panel is closed until asked for: most entries are logged for
  // the page the picker already shows, and a grid on screen for all of them
  // would be a decision demanded of someone who has not asked to make one.
  const [choosing, setChoosing] = useState(false);
  const isNow = periodKey(gran, anchor) === periodKey(gran, today);
  const floor = minAnchor ? periodKey(gran, minAnchor) : null;
  // Stepping back off the floor is refused rather than hidden, so the row
  // never changes shape as you move along it
  const canPrev =
    floor === null || periodKey(gran, shiftAnchor(gran, anchor, -1)) >= floor;
  const change = (next: () => void) => {
    next();
    onChanged?.();
  };
  return (
    <>
      <div style={S.formLbl}>{label}</div>
      <div style={S.scopeRow} role="tablist" aria-label={label}>
        {SCOPES.map((sc) => (
          <button
            key={sc}
            role="tab"
            aria-selected={gran === sc}
            className={"scopeBtn" + (gran === sc ? " isActive" : "")}
            onClick={() => change(() => setGran(sc))}
          >
            {sc}
          </button>
        ))}
      </div>
      <div style={S.pagePickRow}>
        <button
          className="miniBtn"
          disabled={!canPrev}
          aria-label={`Previous ${gran}`}
          onClick={() => change(() => setAnchor(shiftAnchor(gran, anchor, -1)))}
        >
          ‹ <span className="navLong">previous</span>
          <span className="navShort">prev</span>
        </button>
        <button
          className={"pagePickName" + (choosing ? " isOpen" : "")}
          aria-expanded={choosing}
          aria-label={`${periodName(gran, anchor)} — choose a different ${gran}`}
          onClick={() => setChoosing((v) => !v)}
        >
          <span>{periodName(gran, anchor)}</span>
          <span style={S.pagePickNow}>
            {isNow ? SCOPE_NOW_WORD[gran] : `choose another ${gran}`}
          </span>
        </button>
        <button
          className="miniBtn"
          aria-label={`Next ${gran}`}
          onClick={() => change(() => setAnchor(shiftAnchor(gran, anchor, 1)))}
        >
          next ›
        </button>
      </div>
      {choosing && (
        // Remounted per granularity, so the panel always opens showing the
        // kind of page being chosen rather than wherever it was left
        <PeriodChooser
          key={gran}
          gran={gran}
          anchor={anchor}
          today={today}
          minAnchor={minAnchor}
          onPick={(a) => change(() => setAnchor(a))}
          onClose={() => setChoosing(false)}
        />
      )}
      {!isNow && !choosing && (
        <div style={S.pagePickBack}>
          <button
            className="miniBtn"
            aria-label={`Back to ${SCOPE_NOW_WORD[gran]}`}
            onClick={() => change(() => setAnchor(today))}
          >
            back to {SCOPE_NOW_WORD[gran]}
          </button>
        </div>
      )}
    </>
  );
}
