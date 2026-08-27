// Index (spec §4.2): auto-generated list of every period holding entries,
// grouped by scope. Tapping a page opens it on the spread. Collections will
// join this list when they arrive (build order step 4).

import type { CSSProperties } from "react";
import { SCOPES, keyScope, pageLabel } from "./lib/dates";
import type { Scope } from "./lib/dates";
import { colPageKey } from "./lib/types";
import type { Collection, Entry, Habit } from "./lib/types";
import { GRID } from "./lib/grid";
import { S } from "./ui/styles";

const GROUP_LABEL: Record<Scope, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
  year: "Years",
};

interface Props {
  days: Record<string, Entry[]>;
  nowKeys: Record<Scope, string>;
  collections: Collection[];
  habits: Habit[];
  futureCount: number;
  onOpen: (pk: string) => void;
  onOpenCollection: (id: string) => void;
  onOpenFutureLog: () => void;
  onNewCollection: () => void;
}

export default function IndexView({
  days,
  nowKeys,
  collections,
  habits,
  futureCount,
  onOpen,
  onOpenCollection,
  onOpenFutureLog,
  onNewCollection,
}: Props) {
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
        <h2 style={S.sectionTitle}>Index</h2>
        <span style={S.sectionSub}>collections and every page with entries</span>
        <span style={S.sectionNav}>
          <button className="miniBtn" onClick={onNewCollection}>
            new collection
          </button>
        </span>
      </div>
      {/* Future log sits at the front of the book, as in a physical
          journal (spec §4.2, revised 21 July 2026) */}
      {futureCount > 0 && (
        <section style={S.section}>
          <ul style={S.list}>
            <li>
              <button className="indexRow" onClick={onOpenFutureLog}>
                <span style={{ fontWeight: 600 }}>Future log</span>
                <span style={S.count}>
                  {futureCount} item{futureCount === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          </ul>
        </section>
      )}
      <section style={S.section}>
        <div style={S.subGroupLabel}>Collections</div>
        {collections.length === 0 && (
          <div style={ST.empty}>
            No collections yet — a collection is a freeform named page, like a
            reading list or a habit tracker.
          </div>
        )}
        <ul style={S.list}>
          {collections.map((c) => {
            const colEntries = days[colPageKey(c.id)] || [];
            const open = colEntries.filter(
              (e) => e.type === "task" && e.state === "open"
            ).length;
            const habitCount = habits.filter(
              (h) => h.collectionId === c.id
            ).length;
            const meta =
              c.kind === "habits"
                ? `${habitCount} habit${habitCount === 1 ? "" : "s"}`
                : `${colEntries.length} entr${colEntries.length === 1 ? "y" : "ies"}` +
                  (open > 0 ? ` · ${open} open` : "");
            return (
              <li key={c.id}>
                <button
                  className="indexRow"
                  onClick={() => onOpenCollection(c.id)}
                >
                  <span>
                    {c.name}
                    <span className="typeTag">
                      {c.kind === "habits" ? "habit tracker" : "list"}
                    </span>
                  </span>
                  <span style={S.count}>{meta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {total === 0 && (
        <div style={ST.empty}>
          No pages yet — they appear in the index as you log entries.
        </div>
      )}
      {SCOPES.map((sc) =>
        groups[sc].length === 0 ? null : (
          <section key={sc} style={S.section}>
            <div style={S.subGroupLabel}>{GROUP_LABEL[sc]}</div>
            <ul style={S.list}>
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
                      <span style={S.count}>
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

const INK_SOFT = "var(--ink-soft)";
const LINE = "var(--line)";

// `as const satisfies` rather than a Record<string, CSSProperties> annotation.
// The annotation types the values and throws the keys away, so a mistyped key
// compiles and hands back undefined: an element with no styling and no error.
// This keeps the value checking and infers the key union, so a typo is a build
// failure (assessment Finding 15; ui/styles.ts:12 has the longer version).
const ST = {
  // GRID rhythm — matches the dot pitch of the paper background
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: GRID - 5,
  },
  empty: {
    color: INK_SOFT,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
  // 13px line boxes: small text must not stretch the 22px grid rows
  nowTag: {
    fontSize: 11.5,
    lineHeight: "13px",
    color: INK_SOFT,
    fontWeight: 400,
  },
} as const satisfies Record<string, CSSProperties>;
