// Search (spec §10: search runs locally, never on the server). One field, and
// results grouped by the page they live on — the page number is how you find
// anything in the paper method, so a result's job is to tell you which page to
// turn to and then take you there.
//
// Every state is listed, completed and migrated included: the entry you have
// lost is as often a finished one, and hiding it would be the app editing your
// record. States read by weight and contrast exactly as they do on the page —
// the glyphs are never substituted (spec §4.1).

import type { CSSProperties } from "react";
import { GLYPH, STATE_GLYPH } from "../lib/types";
import type { Entry } from "../lib/types";
import { GRID } from "../lib/grid";
import { MAX_HITS, detailsSnippet, highlight } from "../lib/search";
import type { EntryHit, SearchResults } from "../lib/search";

interface Props {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResults;
  /** open the page this entry lives on and mark the entry there */
  onOpenEntry: (pageKey: string, entryId: string) => void;
  onOpenCollection: (id: string) => void;
}

// The glyph an entry shows: its state's, or its type's. Same rule as the
// journal page — see App.renderEntry.
const glyphFor = (e: Entry): string =>
  e.state === "done" || e.state === "migrated" || e.state === "scheduled"
    ? STATE_GLYPH[e.state]
    : GLYPH[e.type];

// State modifier shared by the glyph and the text, so both dim, italicise or
// strike together exactly as they do on the journal page (index.css)
// Said out loud in the row's label. The glyphs carry this visually and an
// aria-label replaces everything inside the row, so without this a completed
// entry would be announced exactly like an open one.
const STATE_WORD: Record<Entry["state"], string> = {
  open: "",
  done: "completed",
  struck: "struck out",
  migrated: "migrated",
  scheduled: "scheduled",
};

const TYPE_WORD: Record<Entry["type"], string> = {
  task: "task",
  event: "event",
  note: "note",
};

const stateClass = (e: Entry): string =>
  e.state === "done"
    ? " isDone"
    : e.state === "struck"
      ? " isStruck"
      : e.state === "migrated"
        ? " isMigrated"
        : e.state === "scheduled"
          ? " isScheduled"
          : "";

const Marked = ({ text, tokens }: { text: string; tokens: string[] }) => (
  <>
    {highlight(text, tokens).map((seg, i) =>
      seg.hit ? (
        <mark key={i} className="searchMark">
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      )
    )}
  </>
);

export default function SearchView({
  query,
  setQuery,
  results,
  onOpenEntry,
  onOpenCollection,
}: Props) {
  const { tokens, groups, pageHits, entryCount, totalCount, truncated } =
    results;
  const searching = query.trim().length > 0;
  const nothing = searching && entryCount === 0 && pageHits.length === 0;

  const renderHit = (hit: EntryHit, pageKey: string, pageLabel: string) => {
    const e = hit.entry;
    const inDetails = hit.fields.includes("details") && !!e.details;
    // An entry can match only through the page it is threaded to, in which
    // case nothing in the row is highlighted — say why it is here
    const viaThread = hit.fields.length === 1 && hit.fields[0] === "thread";
    const label =
      `Open ${TYPE_WORD[e.type]}` +
      (STATE_WORD[e.state] ? `, ${STATE_WORD[e.state]},` : ",") +
      (e.priority ? " priority," : "") +
      ` “${e.text}” on ${pageLabel}` +
      (inDetails ? ", matched in its details" : "") +
      (viaThread ? ", matched on a page it is threaded to" : "");
    return (
      <li key={e.id}>
        <button
          className={"entry searchHit" + (e.parentId ? " isSub" : "")}
          type="button"
          onClick={() => onOpenEntry(pageKey, e.id)}
          aria-label={label}
        >
          {/* Notation, unchanged: • task, ○ event, — note, × done, > migrated,
              < scheduled. Weight and contrast carry the state (index.css). */}
          <span className={"bullet" + stateClass(e)} aria-hidden="true">
            {glyphFor(e)}
          </span>
          <span className={"etext" + stateClass(e)}>
            {e.priority && (
              <span className="prio">
                <i>*</i>
              </span>
            )}
            {e.inspiration && <span className="insp">!</span>}
            <Marked text={e.text} tokens={tokens} />
            {inDetails && (
              <span style={ST.detailLine}>
                in details:{" "}
                <Marked
                  text={detailsSnippet(e.details as string, tokens)}
                  tokens={tokens}
                />
              </span>
            )}
            {viaThread && (
              <span style={ST.detailLine}>
                matched on a page this is threaded to
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div>
      <div style={ST.head}>
        <h2 style={ST.title}>Search</h2>
        <span style={ST.sub}>this device only — nothing is sent anywhere</span>
      </div>

      <div style={ST.fieldRow}>
        <label htmlFor="journal-search" style={ST.srOnly}>
          Search your journal
        </label>
        <input
          id="journal-search"
          type="search"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="Search every entry…"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={ST.field}
        />
        {searching && (
          <button
            className="miniBtn"
            type="button"
            onClick={() => setQuery("")}
            style={ST.clearBtn}
          >
            clear
          </button>
        )}
      </div>

      {!searching && (
        <div style={ST.empty}>
          Type to search every entry in this journal — tasks, events and notes,
          including completed, struck and migrated ones, plus entry details and
          collection names. Your journal is encrypted, so searching happens here
          on your device and never on the server.
        </div>
      )}

      {/* Results change as you type, so the tally is announced rather than
          only shown. One region covers both the count and the empty case. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {nothing && (
          <div style={ST.empty}>
            Nothing found for “{query.trim()}”. Every word has to appear
            somewhere in an entry, so try fewer words.
          </div>
        )}

        {searching && !nothing && (
          <div style={ST.countLine}>
            {entryCount} {entryCount === 1 ? "entry" : "entries"} on{" "}
            {groups.length} {groups.length === 1 ? "page" : "pages"}
            {pageHits.length > 0 &&
              ` · ${pageHits.length} matching ${pageHits.length === 1 ? "name" : "names"}`}
            {/* Never under-state the journal: say how many matched in all,
                not just how many are listed */}
            {truncated && ` · newest ${MAX_HITS} of ${totalCount} shown`}
          </div>
        )}
      </div>

      {pageHits.length > 0 && (
        <section style={ST.group}>
          <div style={ST.groupLabel}>Collections</div>
          <ul style={ST.list}>
            {pageHits.map((p) => (
              <li key={`${p.kind}-${p.collectionId}-${p.name}`}>
                <button
                  className="indexRow"
                  type="button"
                  onClick={() => onOpenCollection(p.collectionId)}
                  // Spelled out rather than left to the marked-up name: the
                  // highlight splits the text into runs, and a habit opens
                  // its tracker rather than a page of its own
                  aria-label={
                    p.kind === "habit"
                      ? `Open ${p.parentName ?? "the tracker"}, which has the habit ${p.name}`
                      : `Open ${p.name}`
                  }
                >
                  <span>
                    <Marked text={p.name} tokens={tokens} />
                    <span className="typeTag">
                      {p.kind === "habit" ? "habit" : "collection"}
                    </span>
                  </span>
                  {p.kind === "habit" && (
                    <span style={ST.count}>on {p.parentName ?? "a tracker"}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.pageKey} style={ST.group}>
          <div style={ST.groupHead}>
            <span style={ST.headLabel}>{g.label}</span>
            <span style={ST.count}>
              {g.hits.length} {g.hits.length === 1 ? "match" : "matches"}
            </span>
          </div>
          <ul style={ST.list}>
            {g.hits.map((hit) => renderHit(hit, g.pageKey, g.label))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const INK = "var(--ink)";
const INK_SOFT = "var(--ink-soft)";
const LINE = "var(--line)";

const ST: Record<string, CSSProperties> = {
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
  fieldRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: GRID,
  },
  // Same treatment as the capture bar: this is the other place you type.
  field: {
    flex: 1,
    minWidth: 0,
    boxSizing: "border-box",
    fontSize: 16,
    padding: "10px 12px",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    background: "var(--surface)",
    color: INK,
    fontFamily: "inherit",
  },
  clearBtn: { flexShrink: 0 },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    border: 0,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
  countLine: {
    fontSize: 11.5,
    lineHeight: `${GRID}px`,
    color: INK_SOFT,
    margin: "0 4px",
  },
  group: { marginBottom: GRID },
  // one GRID label + 2px pad + 1px rule - 3px margin = one row, matching
  // the future log's group heads
  groupHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 2,
    margin: "0 4px -3px",
  },
  // inside groupHead the row already carries the 4px inset
  headLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    lineHeight: `${GRID}px`,
  },
  groupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    lineHeight: `${GRID}px`,
    margin: "0 4px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  count: {
    fontSize: 11.5,
    lineHeight: "13px",
    color: INK_SOFT,
    flexShrink: 0,
    marginLeft: 10,
  },
  // 13px line box on its own line: a details snippet must not stretch the
  // entry's GRID row, so it wraps as a block beneath the text
  detailLine: {
    display: "block",
    fontSize: 11.5,
    lineHeight: "16px",
    color: INK_SOFT,
    paddingBottom: 3,
  },
  empty: {
    color: INK_SOFT,
    fontSize: 13,
    lineHeight: "20px",
    fontStyle: "italic",
    padding: "0 4px",
  },
};
