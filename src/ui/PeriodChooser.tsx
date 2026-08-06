// The page chooser panel behind PagePicker's page name (spec §4.2). Hidden
// until asked for, and built in the app rather than borrowed from the browser.
//
// It replaced a native <input type="date"> (5 August 2026). Two reasons. The
// browser only has a day picker: choosing "September 2026" meant picking some
// arbitrary day in September and trusting the app to round it, which is a
// guess dressed as a choice. And the obvious fix — type="week" and
// type="month" — does not exist on Safari, on iOS or macOS, where it silently
// degrades to a free-text box. So the grid is drawn here, and it shows the
// thing actually being chosen: days for a day page, whole weeks for a week
// page, months for a month page, years for a year page.
//
// The panel browses independently of the choice: stepping to December does not
// choose December, it just looks there. Nothing is selected until a cell is
// tapped, and the cell you already have is marked as such.

import { useEffect, useState } from "react";
import {
  SCOPE_NOW_WORD,
  fmt,
  isoWeekKey,
  monthGrid,
  periodKey,
  periodName,
  periodSub,
  shiftAnchor,
  toDate,
  weeksOfMonth,
} from "../lib/dates";
import type { Scope } from "../lib/dates";
import { S } from "./styles";

interface PeriodChooserProps {
  gran: Scope;
  /** the day whose page is currently chosen */
  anchor: string;
  today: string;
  /** earliest page on offer, as a day key */
  minAnchor?: string;
  onPick: (anchor: string) => void;
  onClose: () => void;
}

interface Cell {
  anchor: string;
  label: string;
  /** second line, where the label alone would not identify the page */
  sub?: string;
  /** the full name, for the button's accessible label */
  name: string;
  /** a day outside the month being browsed, drawn quietly but still choosable */
  muted?: boolean;
  disabled: boolean;
}

// How many years a year grid shows at once, and therefore how far its
// stepper moves — a round dozen, the same cell count as the month grid
const YEAR_BLOCK = 12;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PeriodChooser({
  gran,
  anchor,
  today,
  minAnchor,
  onPick,
  onClose,
}: PeriodChooserProps) {
  // Where the panel is looking, which starts at the chosen page and then moves
  // on its own. Local because it dies with the panel and nothing outside can
  // act on it; the parent remounts this component when the granularity
  // changes, so the view always reopens on the page in hand.
  const [view, setView] = useState(anchor);

  // Escape closes, as it does for the forms this panel opens inside
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const floor = minAnchor ? periodKey(gran, minAnchor) : null;
  const blocked = (a: string) => floor !== null && periodKey(gran, a) < floor;

  const cellsFor = (v: string): Cell[] => {
    if (gran === "day")
      return monthGrid(v).map((d) => ({
        anchor: d,
        label: String(Number(d.slice(8))),
        name: periodName("day", d),
        muted: d.slice(0, 7) !== v.slice(0, 7),
        disabled: blocked(d),
      }));
    if (gran === "week")
      return weeksOfMonth(v).map((m) => ({
        anchor: m,
        label: `Week ${isoWeekKey(m).slice(6)}`,
        sub: periodSub("week", m),
        name: periodName("week", m),
        disabled: blocked(m),
      }));
    if (gran === "month")
      return Array.from({ length: 12 }, (_, i) => {
        const a = `${v.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`;
        return {
          anchor: a,
          label: fmt(toDate(a), { month: "short" }),
          name: periodName("month", a),
          disabled: blocked(a),
        };
      });
    const first = Math.floor(Number(v.slice(0, 4)) / YEAR_BLOCK) * YEAR_BLOCK;
    return Array.from({ length: YEAR_BLOCK }, (_, i) => {
      const a = `${first + i}-01-01`;
      return {
        anchor: a,
        label: String(first + i),
        name: String(first + i),
        disabled: blocked(a),
      };
    });
  };

  // What the header steps by: months while choosing days or weeks, years while
  // choosing months, a dozen years while choosing years
  const stepView = (delta: number) =>
    gran === "day" || gran === "week"
      ? shiftAnchor("month", view, delta)
      : shiftAnchor("year", view, gran === "month" ? delta : YEAR_BLOCK * delta);

  const heading =
    gran === "day" || gran === "week"
      ? periodSub("month", view)
      : gran === "month"
        ? view.slice(0, 4)
        : (() => {
            const first =
              Math.floor(Number(view.slice(0, 4)) / YEAR_BLOCK) * YEAR_BLOCK;
            return `${first} – ${first + YEAR_BLOCK - 1}`;
          })();

  const cells = cellsFor(view);
  // Stepping somewhere with nothing choosable on it is refused rather than
  // offered and then found empty. The corner-filling days of a neighbouring
  // month don't count: a month grid showing only its spillover is an empty
  // month wearing someone else's days.
  const canStep = (delta: number) =>
    cellsFor(stepView(delta)).some((c) => !c.disabled && !c.muted);

  const chosenKey = periodKey(gran, anchor);
  const nowKey = periodKey(gran, today);

  return (
    <div style={S.chooser} role="group" aria-label={`Choose a ${gran} page`}>
      <div style={S.chooserHead}>
        <button
          className="miniBtn"
          disabled={!canStep(-1)}
          aria-label={
            gran === "day" || gran === "week"
              ? "Previous month"
              : gran === "month"
                ? "Previous year"
                : `Previous ${YEAR_BLOCK} years`
          }
          onClick={() => setView(stepView(-1))}
        >
          ‹ earlier
        </button>
        <span style={S.chooserTitle}>{heading}</span>
        <button
          className="miniBtn"
          disabled={!canStep(1)}
          aria-label={
            gran === "day" || gran === "week"
              ? "Next month"
              : gran === "month"
                ? "Next year"
                : `Next ${YEAR_BLOCK} years`
          }
          onClick={() => setView(stepView(1))}
        >
          later ›
        </button>
      </div>
      {gran === "day" && (
        <div style={S.chooserWeekdays} aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d.slice(0, 1)}</span>
          ))}
        </div>
      )}
      <div
        style={{
          ...S.chooserGrid,
          gridTemplateColumns:
            gran === "day"
              ? "repeat(7, 1fr)"
              : gran === "week"
                ? "1fr"
                : "repeat(3, 1fr)",
        }}
      >
        {cells.map((c) => {
          const key = periodKey(gran, c.anchor);
          const isChosen = key === chosenKey;
          const isNow = key === nowKey;
          return (
            <button
              key={c.anchor}
              className={
                "pickCell" +
                // a week names its dates as well as its number, which reads as
                // one line rather than two stacked in a single-column list
                (gran === "week" ? " isWide" : "") +
                (isChosen ? " isOn" : "") +
                (isNow ? " isNow" : "") +
                (c.muted ? " isMuted" : "")
              }
              disabled={c.disabled}
              aria-pressed={isChosen}
              // The glanceable label is a number or a week count; the full
              // name goes here, so nothing has to be inferred from position
              aria-label={c.name + (isNow ? ", the current one" : "")}
              onClick={() => {
                onPick(c.anchor);
                onClose();
              }}
            >
              <span>{c.label}</span>
              {c.sub && <span style={S.chooserCellSub}>{c.sub}</span>}
            </button>
          );
        })}
      </div>
      <div style={S.chooserFoot}>
        {periodKey(gran, anchor) !== nowKey && (
          <button
            className="miniBtn"
            aria-label={`Choose ${SCOPE_NOW_WORD[gran]}`}
            onClick={() => {
              onPick(today);
              onClose();
            }}
          >
            choose {SCOPE_NOW_WORD[gran]}
          </button>
        )}
        <button
          className="miniBtn"
          style={{ marginLeft: "auto" }}
          onClick={onClose}
        >
          close without changing
        </button>
      </div>
    </div>
  );
}
