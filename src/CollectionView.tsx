// Collection pages (spec §4.4): list collections use the same rapid-logging
// entry model as the journal; habit trackers are a grid of habits × days
// with tap-to-fill. Interactions validated in collections prototype v1.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { dkey } from "./lib/dates";
import { GRID } from "./lib/grid";
import type { Collection, Entry, Habit } from "./lib/types";
import { addHabit, toggleHabitMark } from "./store/journal";

const DAY_COLS = 14;

interface DayCol {
  iso: string;
  dow: string;
  dom: number;
}

const lastDays = (n: number): DayCol[] => {
  const out: DayCol[] = [];
  const t = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t);
    d.setDate(t.getDate() - i);
    out.push({
      iso: dkey(d),
      dow: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()],
      dom: d.getDate(),
    });
  }
  return out;
};

const streak = (h: Habit): number => {
  let s = 0;
  const t = new Date();
  for (let i = 0; i < 366; i++) {
    const d = new Date(t);
    d.setDate(t.getDate() - i);
    if (h.marks[dkey(d)]) s++;
    else if (i === 0) continue; // today not yet filled doesn't break a streak
    else break;
  }
  return s;
};

interface Props {
  collection: Collection;
  entries: Entry[];
  habits: Habit[];
  renderEntry: (e: Entry) => ReactNode;
  onDelete: () => void;
}

export default function CollectionView({
  collection,
  entries,
  habits,
  renderEntry,
  onDelete,
}: Props) {
  const [habitName, setHabitName] = useState<string | null>(null);

  const submitHabit = () => {
    const name = (habitName ?? "").trim();
    if (!name) return;
    addHabit(collection.id, name);
    setHabitName(null);
  };

  const days = lastDays(DAY_COLS);
  const today = dkey(new Date());

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={ST.head}>
        <h2 style={ST.title}>{collection.name}</h2>
        <span style={ST.sub}>
          {collection.kind === "habits" ? "habit tracker" : "collection"}
        </span>
        <span style={ST.nav}>
          <button className="miniBtn" onClick={onDelete}>
            delete collection
          </button>
        </span>
      </div>

      {collection.kind === "list" && (
        <>
          {entries.length === 0 && (
            <div style={ST.empty}>nothing logged</div>
          )}
          <ul style={ST.list}>{entries.map((e) => renderEntry(e))}</ul>
        </>
      )}

      {collection.kind === "habits" && (
        <>
          {habits.length === 0 && (
            <div style={ST.empty}>no habits yet — add one below</div>
          )}
          {habits.length > 0 && (
            <div className="habitWrap">
              <table className="habits">
                <thead>
                  <tr>
                    <th />
                    {days.map((d) => (
                      <th key={d.iso} className={d.iso === today ? "today" : ""}>
                        {d.dow}
                        <br />
                        {d.dom}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {habits.map((h) => {
                    const s = streak(h);
                    return (
                      <tr key={h.id}>
                        <td className="name">{h.name}</td>
                        {days.map((d) => (
                          <td key={d.iso} className="cell">
                            <button
                              className={
                                "cellBtn" +
                                (h.marks[d.iso] ? " isFilled" : "") +
                                (d.iso === today ? " isToday" : "")
                              }
                              onClick={() => toggleHabitMark(h.id, d.iso)}
                              aria-label={`${h.name} on ${d.iso}${
                                h.marks[d.iso] ? ", done" : ", not done"
                              }`}
                            />
                          </td>
                        ))}
                        <td className="streak">
                          {s > 0 ? `${s} day${s === 1 ? "" : "s"}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {habits.length > 0 && (
            <div style={ST.legend}>
              tap a circle to fill it · dashed ring = today · count = current
              streak
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {habitName === null ? (
              <button className="miniBtn" onClick={() => setHabitName("")}>
                add habit
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={ST.habitInput}
                  value={habitName}
                  autoFocus
                  placeholder="Habit name…"
                  onChange={(ev) => setHabitName(ev.target.value)}
                  onKeyDown={(ev) => ev.key === "Enter" && submitHabit()}
                  aria-label="Habit name"
                />
                <button
                  className="addBtn"
                  onClick={submitHabit}
                  disabled={!(habitName ?? "").trim()}
                >
                  Add habit
                </button>
                <button
                  className="miniBtn"
                  onClick={() => setHabitName(null)}
                >
                  cancel
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const INK_SOFT = "#6B7683";
const LINE = "#DCDAD1";
const INK = "#26323E";

const ST: Record<string, CSSProperties> = {
  // GRID rhythm — matches the dot pitch of the paper background
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: GRID - 5,
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: `${GRID}px`,
  },
  sub: { fontSize: 11.5, color: INK_SOFT, lineHeight: "13px" },
  nav: { marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 },
  empty: {
    color: INK_SOFT,
    fontSize: 12.5,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  legend: {
    fontSize: 11,
    color: INK_SOFT,
    letterSpacing: "0.03em",
    marginTop: 4,
  },
  habitInput: {
    flex: 1,
    fontSize: 16,
    padding: "8px 12px",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    background: "#FFFFFF",
    color: INK,
    fontFamily: "inherit",
    minWidth: 0,
  },
};
