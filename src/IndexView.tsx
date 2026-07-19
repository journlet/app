// Index (spec §4.2): auto-generated list of every period holding entries,
// grouped by scope. Tapping a page opens it on the spread. Collections will
// join this list when they arrive (build order step 4).

import type { CSSProperties } from "react";
import { SCOPES, keyScope, pageLabel } from "./lib/dates";
import type { Scope } from "./lib/dates";
import type { Entry } from "./lib/types";

const GROUP_LABEL: Record<Scope, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
  year: "Years",
};

interface Props {
  days: Record<string, Entry[]>;
  nowKeys: Record<Scope, string>;
  onOpen: (pk: string) => void;
}

export default function IndexView({ days, nowKeys, onOpen }: Props) {
  const groups: Record<Scope, string[]> = {
    day: [],
    week: [],
    month: [],
    year: [],
  };
  Object.keys(days).forEach((k) => {
    const sc = keyScope(k);
    if (sc && days[k].length > 0) groups[sc].push(k);
  });
  SCOPES.forEach((sc) => groups[sc].sort().reverse());

  const total = SCOPES.reduce((n, sc) => n + groups[sc].length, 0);

  return (
    <div>
      <div style={ST.head}>
        <h2 style={ST.title}>Index</h2>
        <span style={ST.sub}>every page with entries</span>
      </div>
      {total === 0 && (
        <div style={ST.empty}>
          Nothing here yet — pages appear in the index as you log entries.
        </div>
      )}
      {SCOPES.map((sc) =>
        groups[sc].length === 0 ? null : (
          <section key={sc} style={ST.group}>
            <div style={ST.groupLabel}>{GROUP_LABEL[sc]}</div>
            <ul style={ST.list}>
              {groups[sc].map((pk) => {
                const entries = days[pk];
                const open = entries.filter(
                  (e) => e.type === "task" && e.state === "open"
                ).length;
                const isCurrent = pk === nowKeys[sc];
                return (
                  <li key={pk}>
                    <button className="indexRow" onClick={() => onOpen(pk)}>
                      <span style={{ fontWeight: isCurrent ? 600 : 400 }}>
                        {pageLabel(pk)}
                        {isCurrent && (
                          <span style={ST.nowTag}> · current</span>
                        )}
                      </span>
                      <span style={ST.count}>
                        {entries.length} entr{entries.length === 1 ? "y" : "ies"}
                        {open > 0 ? ` · ${open} open` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
    </div>
  );
}

const INK_SOFT = "#6B7683";
const LINE = "#DCDAD1";

const ST: Record<string, CSSProperties> = {
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: 8,
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: 1.15,
  },
  sub: { fontSize: 11.5, color: INK_SOFT },
  empty: { color: INK_SOFT, fontSize: 13, fontStyle: "italic", padding: "10px 4px" },
  group: { marginBottom: 14 },
  groupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    margin: "8px 4px 4px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  nowTag: { fontSize: 11.5, color: INK_SOFT, fontWeight: 400 },
  count: { fontSize: 11.5, color: INK_SOFT, flexShrink: 0, marginLeft: 10 },
};
