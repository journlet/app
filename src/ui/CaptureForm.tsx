// Full-screen entry capture form (remediation item 4). Presentational: App
// owns all capture state (sticky scope/type/signifiers, the draft input) and
// passes it in, so behaviour is identical to the inline version this replaced.

import type { RefObject } from "react";
import { SCOPES, SCOPE_LABEL } from "../lib/dates";
import type { Scope } from "../lib/dates";
import { GLYPH } from "../lib/types";
import type { Collection, EntryType } from "../lib/types";
import type { CaptureScope } from "../lib/sticky";
import { S } from "./styles";

interface CaptureFormProps {
  inputRef: RefObject<HTMLInputElement | null>;
  input: string;
  setInput: (value: string) => void;
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
  return (
        <div style={S.captureForm} role="dialog" aria-label="New entry">
          <div style={S.captureFormHead}>
            <h2 style={S.captureFormTitle}>New entry</h2>
            <button
              className="sheetBtn isCompact"
              style={{ flex: "none", margin: 0 }}
              onClick={closeCapture}
            >
              {justLogged ? "Done" : "Cancel"}
            </button>
          </div>
          <div style={S.captureFormBody}>
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
                  activeCol
                    ? `Log into ${activeCol.name}…`
                    : captureScope === "date"
                      ? "Log for the chosen date…"
                      : `Log for ${SCOPE_LABEL[captureScope].toLowerCase()}…`
                }
                aria-label="New entry"
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
            {activeCol ? (
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
          </div>
        </div>
  );
}
