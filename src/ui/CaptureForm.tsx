// Full-screen entry capture form (remediation item 4). Presentational: App
// owns all capture state (sticky scope/type/signifiers, the draft input) and
// passes it in, so behaviour is identical to the inline version this replaced.

import type { RefObject } from "react";
import { SCOPE_NOW_WORD, periodKey, periodName } from "../lib/dates";
import type { Scope } from "../lib/dates";
import { GLYPH, STATE_GLYPH, STATE_WORD } from "../lib/types";
import type { Collection, Entry, EntryType } from "../lib/types";
import PagePicker from "./PagePicker";
import { S } from "./styles";

interface CaptureFormProps {
  inputRef: RefObject<HTMLInputElement | null>;
  input: string;
  setInput: (value: string) => void;
  captureDetails: string;
  setCaptureDetails: (value: string) => void;
  /** parent this entry will nest under, when capture was opened from an
   *  entry's "Add a sub-bullet" action (spec §4.1). Null = ordinary capture. */
  captureParent: Entry | null;
  /** why the parent can no longer take sub-bullets, if it can't — it has gone,
   *  or it has become a sub-bullet itself, or its collection was deleted. The
   *  entry then lands at top level and the form says which of those happened. */
  captureLost: string | null;
  /** the page this capture is pinned to, named because it may not be the page
   *  on screen: the ⋯ sheet opens from scheduled rows on other pages too.
   *  Non-null for the whole of a sub-bullet capture, including after the parent
   *  has gone — the page choice must stay hidden for as long as it is ignored. */
  captureParentPageLabel: string | null;
  clearCaptureParent: () => void;
  submitEntry: () => void;
  closeCapture: () => void;
  justLogged: string | null;
  activeCol: Collection | null;
  today: string;
  /** which kind of page capture logs into — sticky (spec §4.1) */
  captureScope: Scope;
  setCaptureScope: (scope: Scope) => void;
  /** a day inside the page being logged into; not sticky, resets to today */
  captureAnchor: string;
  setCaptureAnchor: (anchor: string) => void;
  captureType: EntryType;
  setCaptureType: (fn: (t: EntryType) => EntryType) => void;
  capturePriority: boolean;
  setCapturePriority: (fn: (v: boolean) => boolean) => void;
  captureInspiration: boolean;
  setCaptureInspiration: (fn: (v: boolean) => boolean) => void;
  /** put the choices back to today / task / no signifiers, leaving the typed
   *  text and details alone (see App's resetCapture) */
  resetCapture: () => void;
}

export default function CaptureForm({
  inputRef,
  input,
  setInput,
  captureDetails,
  setCaptureDetails,
  captureParent,
  captureLost,
  captureParentPageLabel,
  clearCaptureParent,
  submitEntry,
  closeCapture,
  justLogged,
  activeCol,
  today,
  captureScope,
  setCaptureScope,
  captureAnchor,
  setCaptureAnchor,
  captureType,
  setCaptureType,
  capturePriority,
  setCapturePriority,
  captureInspiration,
  setCaptureInspiration,
  resetCapture,
}: CaptureFormProps) {
  // The capture is pinned to one page for as long as App holds a parent for it.
  // Gate the page choice on the pin, not on the parent entry: if the parent has
  // gone the page is still fixed, and showing scope buttons that are then
  // ignored would be the app claiming a choice the entry can't honour.
  const pinnedToPage = captureParentPageLabel !== null;
  // Whether the page choice is this form's to make at all: pinned sub-bullets
  // and collection capture have no picker, so reset must not claim to move the
  // entry to today — it would be naming a choice the form doesn't own.
  const pageIsChosenHere = !pinnedToPage && !activeCol;
  const pageIsToday =
    captureScope === "day" &&
    periodKey("day", captureAnchor) === periodKey("day", today);
  // Only offer the reset when it would change something. A button that does
  // nothing when tapped is the same broken promise as an unlabelled one.
  const canReset =
    (pageIsChosenHere && !pageIsToday) ||
    captureType !== "task" ||
    capturePriority ||
    captureInspiration;
  return (
        <div style={S.captureForm} role="dialog" aria-label="New entry">
          <div style={S.captureFormHead}>
            <h2 style={S.captureFormTitle}>
              {captureParent ? "New sub-bullet" : "New entry"}
            </h2>
            <button
              className="sheetBtn isCompact"
              style={{ flex: "none", margin: 0 }}
              onClick={closeCapture}
            >
              {justLogged ? "Done" : "Cancel"}
            </button>
          </div>
          <div style={S.captureFormBody}>
            {/* Sub-bullet context (spec §4.1). Shown before the input so the
                parent is known before typing, and always with a plainly
                labelled way out — nothing about where this lands is implied. */}
            {captureParent && (
              <>
                <div style={S.formLbl}>
                  Nesting under
                  {captureParentPageLabel ? `, on ${captureParentPageLabel}` : ""}
                </div>
                <div style={S.subParentRow}>
                  {/* Purist glyph, but never the only signal: the state is
                      spelled out beside it, and the glyph is hidden from
                      screen readers which would otherwise read it raw */}
                  <span style={{ color: "var(--ink-soft)" }} aria-hidden="true">
                    {captureParent.state === "done" ||
                    captureParent.state === "migrated" ||
                    captureParent.state === "scheduled"
                      ? STATE_GLYPH[captureParent.state]
                      : GLYPH[captureParent.type]}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      textDecoration:
                        captureParent.state === "struck"
                          ? "line-through"
                          : undefined,
                    }}
                  >
                    {captureParent.text}
                  </span>
                  <span style={S.stateWord}>
                    {captureParent.state === "open"
                      ? captureParent.type
                      : `${captureParent.type}, ${STATE_WORD[captureParent.state]}`}
                  </span>
                </div>
                <button
                  className="sheetBtn isCompact"
                  style={{ margin: "0 0 4px" }}
                  onClick={clearCaptureParent}
                >
                  Log at top level instead
                </button>
              </>
            )}
            {/* The parent stopped being usable mid-capture. Say what changed
                and where the entry will now land, rather than quietly reverting
                to the sticky scope and putting it on a page nobody asked for. */}
            {captureLost && (
              <div style={S.captureWarn} role="status">
                {captureLost} This will be logged at top level
                {captureParentPageLabel
                  ? ` on ${captureParentPageLabel}`
                  : " on the page you choose below"}
                .
                {captureParentPageLabel && (
                  <button
                    className="sheetBtn isCompact"
                    style={{ margin: "8px 0 0" }}
                    onClick={clearCaptureParent}
                  >
                    Choose a page instead
                  </button>
                )}
              </div>
            )}
            <div style={S.formLbl}>Entry</div>
            <div style={S.captureBar}>
              <span style={S.captureGlyph}>{GLYPH[captureType]}</span>
              <input
                ref={inputRef}
                autoFocus
                style={S.captureInput}
                value={input}
                onChange={(ev) => setInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") submitEntry();
                  if (ev.key === "Escape") closeCapture();
                }}
                placeholder={
                  captureParent
                    ? "Log a sub-bullet…"
                    : pinnedToPage
                      ? `Log for ${captureParentPageLabel}…`
                      : activeCol
                      ? `Log into ${activeCol.name}…`
                      : `Log for ${
                          periodKey(captureScope, captureAnchor) ===
                          periodKey(captureScope, today)
                            ? SCOPE_NOW_WORD[captureScope]
                            : periodName(captureScope, captureAnchor)
                        }…`
                }
                aria-label={captureParent ? "New sub-bullet" : "New entry"}
                enterKeyHint="done"
                autoComplete="off"
              />
              <button
                className="addBtn"
                onClick={submitEntry}
                disabled={!input.trim()}
              >
                Log
              </button>
            </div>
            {justLogged && (
              <div style={S.formNote} role="status">
                Logged “{justLogged}” — keep typing for another, or Done
              </div>
            )}
            {pinnedToPage ? (
              // A sub-bullet belongs beside its parent, so there is no page to
              // choose. Said plainly, and naming the page, rather than shown
              // disabled or left to be inferred.
              <div style={S.formNote}>
                {captureParent
                  ? `Sub-bullets sit on the same page as their parent, so this lands on ${captureParentPageLabel}`
                  : `This lands on ${captureParentPageLabel}, the page you started from`}
              </div>
            ) : activeCol ? (
              <div style={S.formNote}>
                Logging into the “{activeCol.name}” collection
              </div>
            ) : (
              // One page chooser, shared with the entry sheet's "Move to" —
              // kind of page, then which one. The current period is where it
              // starts, so logging for today needs no choice at all.
              <PagePicker
                label="Log into"
                gran={captureScope}
                setGran={setCaptureScope}
                anchor={captureAnchor}
                setAnchor={setCaptureAnchor}
                today={today}
                // Capture writes forward, never back: an entry that belongs on
                // a page already past is a correction, and corrections are the
                // sheet's "Move to" — where the same picker has no floor.
                minAnchor={today}
                onChanged={() => inputRef.current?.focus()}
              />
            )}
            <div style={S.formLbl}>Type</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["task", "event", "note"] as const).map((t) => (
                <button
                  key={t}
                  className={"capChoice" + (captureType === t ? " isOn" : "")}
                  aria-pressed={captureType === t}
                  onClick={() => {
                    setCaptureType(() => t);
                    inputRef.current?.focus();
                  }}
                >
                  <span style={{ fontSize: 15 }}>{GLYPH[t]}</span>
                  {t}
                </button>
              ))}
            </div>
            <div style={S.formLbl}>Signifiers</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className={"capChoice" + (capturePriority ? " isLit" : "")}
                aria-pressed={capturePriority}
                onClick={() => {
                  setCapturePriority((v) => !v);
                  inputRef.current?.focus();
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>*</span>
                priority
              </button>
              <button
                className={"capChoice" + (captureInspiration ? " isLit" : "")}
                aria-pressed={captureInspiration}
                onClick={() => {
                  setCaptureInspiration((v) => !v);
                  inputRef.current?.focus();
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>!</span>
                inspiration
              </button>
            </div>
            {/* Clear the sticky choices in one labelled action (14 August
                2026). Sits below the three sections it resets, and names the
                state it goes to rather than saying only "Reset" — the entry
                text and details are deliberately untouched, so the label has
                to be exact about what moves. Shown only when something would
                actually change; the page part is dropped from the label when
                this form has no page choice to make. */}
            {canReset && (
              <button
                className="sheetBtn isCompact isQuiet"
                style={{ flex: "none", width: "100%", margin: "10px 0 0" }}
                onClick={resetCapture}
              >
                {pageIsChosenHere
                  ? "Reset to today, task, no signifiers"
                  : "Reset to task, no signifiers"}
              </button>
            )}
            {/* Optional per-entry details (spec §9). Full-screen form has room,
                so it's offered at capture too — kept last and out of the type-
                and-Log fast path so thoughtless capture (spec §4.1) still holds.
                Not sticky: cleared with the text after each log. */}
            <div style={S.formLbl}>Details (optional)</div>
            <textarea
              style={{
                ...S.sheetInput,
                minHeight: 60,
                resize: "vertical",
                marginBottom: 0,
              }}
              value={captureDetails}
              onChange={(ev) => setCaptureDetails(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Escape") closeCapture();
              }}
              placeholder="Notes, or a link to read later…"
              aria-label="Entry details (optional)"
            />
          </div>
        </div>
  );
}
