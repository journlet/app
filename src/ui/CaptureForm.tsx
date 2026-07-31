// Full-screen entry capture form (remediation item 4). Presentational: App
// owns all capture state (sticky scope/type/signifiers, the draft input) and
// passes it in, so behaviour is identical to the inline version this replaced.

import type { RefObject } from "react";
import { SCOPES, SCOPE_LABEL } from "../lib/dates";
import type { Scope } from "../lib/dates";
import { GLYPH, STATE_GLYPH, STATE_WORD } from "../lib/types";
import type { Collection, Entry, EntryType } from "../lib/types";
import type { CaptureScope } from "../lib/sticky";
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
  captureScope: CaptureScope;
  setCaptureScope: (scope: CaptureScope) => void;
  captureType: EntryType;
  setCaptureType: (fn: (t: EntryType) => EntryType) => void;
  capturePriority: boolean;
  setCapturePriority: (fn: (v: boolean) => boolean) => void;
  captureInspiration: boolean;
  setCaptureInspiration: (fn: (v: boolean) => boolean) => void;
  customDate: string;
  setCustomDate: (value: string) => void;
  customGran: Scope;
  setCustomGran: (scope: Scope) => void;
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
  captureType,
  setCaptureType,
  capturePriority,
  setCapturePriority,
  captureInspiration,
  setCaptureInspiration,
  customDate,
  setCustomDate,
  customGran,
  setCustomGran,
}: CaptureFormProps) {
  // The capture is pinned to one page for as long as App holds a parent for it.
  // Gate the page choice on the pin, not on the parent entry: if the parent has
  // gone the page is still fixed, and showing scope buttons that are then
  // ignored would be the app claiming a choice the entry can't honour.
  const pinnedToPage = captureParentPageLabel !== null;
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
                        : captureScope === "date"
                          ? "Log for the chosen date…"
                          : `Log for ${SCOPE_LABEL[captureScope].toLowerCase()}…`
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
              <>
                <div style={S.formLbl}>Log into</div>
                <div style={S.scopeRow} role="tablist" aria-label="Log into">
                  {([...SCOPES, "date"] as CaptureScope[]).map((sc) => (
                    <button
                      key={sc}
                      role="tab"
                      aria-selected={captureScope === sc}
                      className={
                        "scopeBtn" + (captureScope === sc ? " isActive" : "")
                      }
                      onClick={() => {
                        setCaptureScope(sc);
                        inputRef.current?.focus();
                      }}
                    >
                      {sc === "date" ? "date…" : sc}
                    </button>
                  ))}
                </div>
                {captureScope === "date" && (
                  <div style={{ ...S.dateControls, marginTop: 8 }}>
                    <input
                      type="date"
                      value={customDate}
                      min={today}
                      onChange={(ev) =>
                        ev.target.value && setCustomDate(ev.target.value)
                      }
                      style={S.dateInput}
                      aria-label="Schedule date"
                    />
                    <div style={{ display: "flex", gap: 4, flex: 1 }}>
                      {SCOPES.map((g) => (
                        <button
                          key={g}
                          className={
                            "scopeBtn" + (customGran === g ? " isActive" : "")
                          }
                          onClick={() => setCustomGran(g)}
                          style={{
                            background:
                              customGran === g ? "var(--surface)" : "none",
                          }}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
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
