// Inline styles for the journal shell, ported verbatim from prototype v17.
// Extracted from App.tsx so views split out of App can share them.

import type { CSSProperties } from "react";
import { GRID, GRID_BG_POSITION } from "../lib/grid";

const INK = "var(--ink)";
const INK_SOFT = "var(--ink-soft)";
const PAPER = "var(--paper)";
const LINE = "var(--line)";

// `satisfies` rather than a `Record<string, CSSProperties>` annotation. With the
// annotation, S.sheetGropuLabel compiled cleanly and yielded undefined at
// runtime: an unstyled element, no error, across sixty-odd keys. This still
// checks every value is a valid CSSProperties, and now a typo is a build
// failure. Zero behaviour change; every existing usage already resolves.
export const S = {
  page: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: PAPER,
    color: INK,
    fontFamily: "'Public Sans', system-ui, sans-serif",
  },
  header: {
    padding: "calc(12px + env(safe-area-inset-top)) 20px 6px",
    maxWidth: 560,
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
  },
  brandRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  brand: {
    fontFamily: "'Fraunces', serif",
    fontSize: 14,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  saveDot: { fontSize: 11, color: INK_SOFT },
  paper: {
    flex: 1,
    width: "100%",
    boxSizing: "border-box",
    backgroundImage: `radial-gradient(${LINE} 1px, transparent 1px)`,
    backgroundSize: `${GRID}px ${GRID}px`,
    // Anchored so a dot column runs under the bullets and dot rows sit
    // on the text line boundaries — see src/lib/grid.ts for the maths.
    backgroundPosition: GRID_BG_POSITION,
    // dots scroll with the entries, like marks on a physical page
    backgroundAttachment: "local",
    overflowY: "auto",
  },
  // Grid rhythm: GRID px dot pitch. paperInner's top padding is one full
  // row, and every block below is sized to a multiple of GRID so text
  // lines land in the dot rows all the way down the page.
  paperInner: {
    maxWidth: 560,
    margin: "0 auto",
    boxSizing: "border-box",
    padding: `${GRID}px 20px`,
  },
  // Filter row (remediation item 7). Track is exactly one GRID row (3px pad
  // + 27px button + 3px pad) and the note is a 13px line box, so the block is
  // fixed at two dot rows: the sections below never shift when the filter
  // changes, and a note that wraps to a second line on a narrow screen eats
  // the slack instead of pushing the whole page off the grid. Caught on a
  // 375px render, where "hiding completed, struck out, migrated and
  // scheduled" wrapped and every entry below it lost its dot row.
  filterWrap: { height: GRID * 2, boxSizing: "border-box" },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  filterLbl: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    flexShrink: 0,
  },
  filterTrack: {
    flex: 1,
    display: "flex",
    gap: 4,
    background: "var(--track)",
    borderRadius: 9,
    padding: 3,
    minWidth: 0,
  },
  filterNote: {
    fontSize: 11.5,
    lineHeight: "13px",
    color: INK_SOFT,
    fontStyle: "italic",
    padding: "0 4px",
  },
  // What the page says about its own order while the reading block is shut
  // (spec §4.9a). One GRID line box, so the dot rhythm below is untouched;
  // italic and muted like the filter's note, because it is the same kind of
  // remark about how you are reading rather than part of the journal.
  orderStanding: {
    color: INK_SOFT,
    fontSize: 11.5,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
  // A section or page emptied out by the filter — says how many are hidden,
  // so nothing ever just vanishes
  filterHidden: {
    color: INK_SOFT,
    fontSize: 12.5,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
  section: { marginBottom: GRID },
  // head = one GRID title line + 4px pad + 1px rule + margin = 2 rows.
  // Small companions get short line boxes (13px) so baseline alignment
  // can't stretch the title's flex line and knock everything off grid.
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    rowGap: 0,
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: GRID - 5,
  },
  sectionTitle: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: `${GRID}px`,
  },
  sectionSub: { fontSize: 11.5, color: INK_SOFT, lineHeight: "13px" },
  sectionNav: {
    marginLeft: "auto",
    display: "flex",
    gap: 4,
    flexShrink: 0,
  },
  sectionEmpty: {
    color: INK_SOFT,
    fontSize: 12.5,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
  subGroupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    lineHeight: `${GRID}px`,
    margin: "0 4px",
  },
  // margin + 10px pad + 1px rule + one GRID line = 2 rows
  futureLogLink: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    lineHeight: `${GRID}px`,
    marginTop: GRID - 11,
    paddingTop: 10,
    borderTop: "1px solid var(--line)",
  },
  // one GRID label + 2px pad + 1px rule - 3px margin = one row
  flGroupHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    borderBottom: "1px solid var(--line)",
    paddingBottom: 2,
    marginBottom: -3,
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  onboardLede: {
    fontSize: 15,
    lineHeight: 1.65,
    color: INK,
    margin: "0 0 12px",
    maxWidth: 480,
  },
  onboardNote: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: INK_SOFT,
    margin: "0 0 16px",
    maxWidth: 480,
  },
  empty: {
    color: INK_SOFT,
    fontSize: 14,
    lineHeight: `${GRID}px`,
    padding: `${GRID}px 4px`,
    fontStyle: "italic",
  },
  captureWrap: {
    position: "relative",
    zIndex: 30,
    background: PAPER,
    borderTop: `1px solid ${LINE}`,
    padding: "8px 20px calc(12px + env(safe-area-inset-bottom))",
  },
  scopeRow: {
    maxWidth: 560,
    margin: "0 auto 8px",
    display: "flex",
    gap: 4,
    background: "var(--track)",
    borderRadius: 9,
    padding: 3,
  },
  captureBar: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--surface)",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    padding: "10px 12px",
  },
  launcher: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    alignItems: "stretch",
    background: "var(--surface)",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    overflow: "hidden",
  },
  // Find standing on its own, where the page takes no entries (habit
  // trackers). Same left edge and same footer as the full bar, so the control
  // does not move between pages.
  launcherAlone: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
  },
  launcherHint: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
  },
  launcherPrefs: {
    fontSize: 11,
    color: INK_SOFT,
    flexShrink: 0,
    letterSpacing: "0.02em",
  },
  captureForm: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: PAPER,
    display: "flex",
    flexDirection: "column",
    paddingTop: "calc(12px + env(safe-area-inset-top))",
    paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
  },
  captureFormHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    maxWidth: 560,
    width: "100%",
    margin: "0 auto",
    padding: "0 20px 6px",
    boxSizing: "border-box",
  },
  captureFormTitle: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
  },
  captureFormBody: {
    flex: 1,
    overflowY: "auto",
    maxWidth: 560,
    width: "100%",
    margin: "0 auto",
    padding: "0 20px 16px",
    boxSizing: "border-box",
  },
  formLbl: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    margin: "16px 0 6px",
  },
  formNote: {
    fontSize: 12.5,
    color: INK_SOFT,
    fontStyle: "italic",
    marginTop: 10,
  },
  // Something changed under the capture form and the entry will now land
  // somewhere other than the form first said
  captureWarn: {
    fontSize: 13,
    color: INK,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
  },
  // The type and state of an entry, spelled out beside its glyph so a picker
  // row or a context row never depends on the symbol alone (no-guessing rule)
  stateWord: {
    fontSize: 11.5,
    color: INK_SOFT,
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  // The parent shown above the input during a sub-bullet capture (spec §4.1).
  // Read-only context, so it is a bordered row rather than a button — nothing
  // here is tappable except the plainly labelled escape beneath it.
  subParentRow: {
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    fontSize: 15,
    padding: "10px 12px",
    marginBottom: 8,
    border: `1px solid ${LINE}`,
    borderRadius: 10,
    color: INK,
    wordBreak: "break-word",
  },
  captureGlyph: {
    fontSize: 18,
    width: 16,
    textAlign: "center",
    color: INK,
    flexShrink: 0,
  },
  captureInput: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: 16,
    background: "transparent",
    color: INK,
    fontFamily: "inherit",
    minWidth: 0,
  },
  legend: {
    maxWidth: 560,
    margin: "8px auto 0",
    fontSize: 11,
    color: INK_SOFT,
    letterSpacing: "0.03em",
  },
  // PagePicker: the chosen page, between its two step buttons
  pagePickRow: {
    maxWidth: 560,
    margin: "0 auto 8px",
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  // "today" / "this week" — said in words rather than left to a highlight
  pagePickNow: { fontSize: 11, color: INK_SOFT },
  // the row holding "back to today", which only exists off the current period
  pagePickBack: {
    maxWidth: 560,
    margin: "0 auto 8px",
    display: "flex",
    justifyContent: "center",
  },
  // PeriodChooser: the panel behind the page name
  chooser: {
    maxWidth: 560,
    margin: "0 auto 8px",
    border: `1px solid ${LINE}`,
    borderRadius: 10,
    background: "var(--surface)",
    padding: 8,
  },
  chooserHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  chooserTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
    fontWeight: 600,
    color: INK,
  },
  chooserWeekdays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 2,
    fontSize: 10,
    color: INK_SOFT,
    textAlign: "center",
    marginBottom: 2,
  },
  chooserGrid: { display: "grid", gap: 2 },
  chooserCellSub: { fontSize: 10.5, color: INK_SOFT },
  chooserFoot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  dateControls: {
    maxWidth: 560,
    margin: "0 auto 8px",
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  dateInput: {
    fontSize: 14,
    padding: "7px 10px",
    border: `1px solid ${LINE}`,
    borderRadius: 8,
    background: "var(--surface)",
    color: INK,
    fontFamily: "inherit",
  },
  toast: {
    position: "fixed",
    left: "50%",
    bottom: 96,
    transform: "translateX(-50%)",
    background: INK,
    color: PAPER,
    borderRadius: 10,
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    gap: 14,
    fontSize: 14,
    boxShadow: "0 4px 14px rgba(38,50,62,.3)",
    zIndex: 40,
  },
  // Install nudge. Same snackbar family as the capture bar, but the iOS variants
  // carry a sentence of instructions, so it wraps rather than staying one line.
  installBar: {
    position: "fixed",
    left: 12,
    right: 12,
    margin: "0 auto",
    maxWidth: 536,
    boxSizing: "border-box",
    background: INK,
    color: PAPER,
    borderRadius: 12,
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    fontSize: 15,
    fontWeight: 600,
    boxShadow: "0 6px 20px rgba(38,50,62,.32)",
    zIndex: 41,
  },
  installText: {
    lineHeight: 1.35,
  },
  installActions: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexShrink: 0,
  },
  installDismiss: {
    color: PAPER,
    opacity: 0.72,
    fontWeight: 600,
    flexShrink: 0,
  },
  sheetBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(38,50,62,.35)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50,
  },
  sheet: {
    background: PAPER,
    borderRadius: "16px 16px 0 0",
    width: "100%",
    maxWidth: 560,
    padding: "8px 16px calc(22px + env(safe-area-inset-bottom))",
    boxSizing: "border-box",
    boxShadow: "0 -6px 24px rgba(38,50,62,.25)",
    // A sheet taller than the screen used to run off the bottom with nothing to
    // scroll — the entry actions did exactly that on a phone before they moved
    // to their own full-screen view (6 August 2026). Capped here rather than at
    // each call site so no sheet added later can reintroduce it.
    maxHeight: "85vh",
    overflowY: "auto",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: LINE,
    margin: "6px auto 10px",
  },
  sheetEntry: {
    fontSize: 15,
    padding: "4px 4px 12px",
    color: INK,
    borderBottom: `1px solid ${LINE}`,
    marginBottom: 10,
    wordBreak: "break-word",
  },
  sheetGroupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    margin: "10px 4px 6px",
  },
  sheetRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 },
  // Quiet explanation inside the sheet — why an action isn't on offer
  sheetNote: {
    fontSize: 12,
    color: INK_SOFT,
    padding: "0 4px 10px",
  },
  // "nothing matches" / "nothing available" inside a picker sub-view
  sheetEmpty: {
    fontSize: 13,
    fontStyle: "italic",
    color: INK_SOFT,
    padding: "4px 4px 10px",
  },
  // Something the user tried didn't take; carries more weight than a note
  sheetWarn: {
    fontSize: 13,
    color: INK,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
  },
  // A candidate parent in the "Nest under…" picker: glyph then text, left
  // aligned, so a column of them reads like the page it came from
  nestTargetBtn: {
    display: "flex",
    justifyContent: "flex-start",
    gap: 8,
    textAlign: "left",
  },
  // ── Full-screen entry view (the ⋯ actions, 6 August 2026) ──────────────
  // It was a bottom sheet with every action at one weight, three mini-forms
  // unfolding in place, and no height cap — so on a phone it ran off the
  // bottom of the screen with nothing to scroll. It is now the same surface as
  // the capture form (S.captureForm / captureFormHead / captureFormBody), with
  // the actions in named groups and every multi-step action behind its own
  // step. Rows that open a step end in "…"; rows that act immediately do not.
  // No chevrons: › and ‹ are notation here (migrated, scheduled) and must not
  // also mean "goes somewhere".

  // The entry restated at the head of the view, and again inside a sub-view, so
  // a multi-step action never loses track of what it is acting on
  entryCtx: {
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    fontSize: 15,
    color: INK,
    padding: "0 4px 10px",
    borderBottom: `1px solid ${LINE}`,
    wordBreak: "break-word",
  },
  entryCtxState: {
    fontSize: 11.5,
    color: INK_SOFT,
    flexShrink: 0,
    whiteSpace: "nowrap",
    marginLeft: "auto",
  },
  entryCtxHistory: {
    fontSize: 11.5,
    color: INK_SOFT,
    padding: "8px 4px 0",
    lineHeight: 1.4,
  },
  // A row's second line: what the action will do, or the state it changes.
  // Replaces the floating group labels that used to sit above single buttons.
  rowCaption: {
    display: "block",
    fontSize: 11.5,
    lineHeight: 1.4,
    color: INK_SOFT,
    marginTop: 3,
  },
  // The destructive group, set apart at the foot of the view so it is never
  // reached by scanning past the actions above it
  removeGroup: {
    marginTop: 22,
    paddingTop: 14,
    borderTop: `1px solid ${LINE}`,
  },
  // Prose inside a sub-view — what this step does before anything is tapped
  // The answer to what was just chosen, in the "when it ends" control. Bordered
  // on one side rather than boxed: it is the consequence of the field above it,
  // not a separate thing to read (spec §11 Q17).
  endsResolved: {
    border: `1px solid ${LINE}`,
    borderLeft: `3px solid ${INK}`,
    borderRadius: 8,
    background: "var(--surface)",
    padding: "10px 12px",
    fontSize: 13.5,
    lineHeight: 1.5,
    margin: "4px 0 2px",
  },
  endsWhy: {
    display: "block",
    color: INK_SOFT,
    fontSize: 12,
    marginTop: 4,
  },
  // "Repeat finished: …" on the Future log (spec §11 Q17). One --grid line box
  // so the page keeps its rhythm, and quiet: it is a fact about something that
  // has stopped, sitting above the things that have not.
  finishedNote: {
    fontSize: 12.5,
    lineHeight: `${GRID}px`,
    color: INK_SOFT,
    margin: 0,
    padding: "0 4px",
  },
  finishedWhen: { fontSize: 11.5 },
  subLede: {
    fontSize: 13,
    lineHeight: 1.55,
    color: INK_SOFT,
    margin: "12px 4px 12px",
  },
  sheetInput: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 16,
    padding: "10px 12px",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    background: "var(--surface)",
    color: INK,
    fontFamily: "inherit",
    marginBottom: 10,
  },
} as const satisfies Record<string, CSSProperties>;
