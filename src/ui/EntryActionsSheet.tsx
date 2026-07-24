// Entry-actions sheet: the bottom-sheet dialog opened from an entry's ⋯ menu.
// Four modes (edit repeat rule, edit reminder, actions list, edit text) driven
// by App-owned draft state. Presentational — App owns the state and the
// save/close/delete closures; pure store and date helpers are imported here so
// the JSX matches the inline version this was extracted from verbatim.

import type { Dispatch, SetStateAction } from "react";
import {
  SCOPES,
  SCOPE_LABEL,
  keyScope,
  pageLabel,
  periodKey,
  shiftAnchor,
} from "../lib/dates";
import type { Scope } from "../lib/dates";
import { GLYPH } from "../lib/types";
import type { Entry, Recurrence, RecurrenceUnit } from "../lib/types";
import {
  endRecurrence,
  migrateEntry,
  moveTo,
  setParent,
  setDetails,
  setReminder,
  setText,
  toggleDone,
  toggleStruck,
} from "../store/journal";
import { nextOccurrence } from "../store/recurrence";
import { notificationPermission } from "../store/reminders";
import { S } from "./styles";
import type { EditRepeat, SheetTarget } from "./types";

interface EntryActionsSheetProps {
  sheet: SheetTarget;
  sheetEntry: Entry;
  sheetHistory: string[];
  sheetNestTarget: Entry | null;
  sheetMigrates: boolean;
  recurrences: Recurrence[];
  today: string;
  nowKeys: Record<Scope, string>;
  editRepeat: EditRepeat | null;
  setEditRepeat: Dispatch<SetStateAction<EditRepeat | null>>;
  editRemind: string | null;
  setEditRemind: Dispatch<SetStateAction<string | null>>;
  editText: string | null;
  setEditText: Dispatch<SetStateAction<string | null>>;
  editDetails: string | null;
  setEditDetails: Dispatch<SetStateAction<string | null>>;
  schedDate: string;
  setSchedDate: Dispatch<SetStateAction<string>>;
  closeSheet: () => void;
  saveRepeat: () => void;
  saveReminder: () => Promise<void>;
  cadenceLabel: (n: number, unit: RecurrenceUnit) => string;
  deleteWithUndo: (id: string) => void;
  fmtRemind: (ts: number) => string;
  toLocalInput: (ts: number) => string;
  trunc: (s: string, n: number) => string;
}

export default function EntryActionsSheet({
  sheet,
  sheetEntry,
  sheetHistory,
  sheetNestTarget,
  sheetMigrates,
  recurrences,
  today,
  nowKeys,
  editRepeat,
  setEditRepeat,
  editRemind,
  setEditRemind,
  editText,
  setEditText,
  editDetails,
  setEditDetails,
  schedDate,
  setSchedDate,
  closeSheet,
  saveRepeat,
  saveReminder,
  cadenceLabel,
  deleteWithUndo,
  fmtRemind,
  toLocalInput,
  trunc,
}: EntryActionsSheetProps) {
  return (
        <div style={S.sheetBackdrop} onClick={closeSheet}>
          <div
            style={S.sheet}
            role="dialog"
            aria-label="Entry actions"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={S.sheetHandle} />
            {editRepeat !== null ? (
              <>
                <div style={S.sheetGroupLabel}>Repeat this entry</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>every</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={editRepeat.n}
                    onChange={(ev) =>
                      setEditRepeat({ ...editRepeat, n: ev.target.value })
                    }
                    style={{ ...S.sheetInput, width: 72, marginBottom: 0 }}
                    aria-label="Repeat interval"
                  />
                  <div style={{ display: "flex", gap: 4, flex: 1 }}>
                    {keyScope(sheet.pk) === "day" ? (
                      (["day", "week", "month", "year"] as RecurrenceUnit[]).map(
                        (u) => (
                          <button
                            key={u}
                            className={
                              "scopeBtn" +
                              (editRepeat.unit === u ? " isActive" : "")
                            }
                            style={{
                              background:
                                editRepeat.unit === u ? "var(--surface)" : "none",
                            }}
                            onClick={() =>
                              setEditRepeat({ ...editRepeat, unit: u })
                            }
                          >
                            {u}s
                          </button>
                        )
                      )
                    ) : (
                      // Non-day pages recur in their own unit — fixed, not chosen
                      <span style={{ fontSize: 14, alignSelf: "center" }}>
                        {editRepeat.unit}
                        {Math.max(1, parseInt(editRepeat.n, 10) || 1) > 1
                          ? "s"
                          : ""}{" "}
                        (on each {editRepeat.unit} page)
                      </span>
                    )}
                  </div>
                </div>
                {keyScope(sheet.pk) === "day" && (
                  <>
                    <div style={S.sheetGroupLabel}>
                      Reminder time on each occurrence (optional)
                    </div>
                    <input
                      type="time"
                      value={editRepeat.time}
                      onChange={(ev) =>
                        setEditRepeat({ ...editRepeat, time: ev.target.value })
                      }
                      style={{ ...S.sheetInput, maxWidth: 160 }}
                      aria-label="Reminder time for each occurrence"
                    />
                  </>
                )}
                <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 4px 10px" }}>
                  Starting from this entry's page, a fresh copy appears{" "}
                  {cadenceLabel(
                    Math.max(1, parseInt(editRepeat.n, 10) || 1),
                    editRepeat.unit
                  )}
                  . Completing one occurrence never touches the next.
                </p>
                <button className="sheetBtn" onClick={saveRepeat}>
                  Start repeating
                </button>
                <button
                  className="sheetBtn isQuiet"
                  onClick={() => setEditRepeat(null)}
                >
                  Back
                </button>
              </>
            ) : editRemind !== null ? (
              <>
                <div style={S.sheetGroupLabel}>Reminder</div>
                <input
                  type="datetime-local"
                  style={S.sheetInput}
                  value={editRemind}
                  onChange={(ev) => setEditRemind(ev.target.value)}
                  aria-label="Reminder date and time"
                />
                {notificationPermission() === "denied" && (
                  <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 4px 10px" }}>
                    Notifications are blocked in your browser settings, so
                    nothing will pop up — but anything due still appears in
                    the Due section at the top of the journal.
                  </p>
                )}
                <button
                  className="sheetBtn"
                  disabled={!editRemind}
                  onClick={() => void saveReminder()}
                >
                  Save reminder
                </button>
                {sheetEntry.remindAt && (
                  <button
                    className="sheetBtn isDanger"
                    onClick={() => {
                      setReminder(sheet.id, null);
                      closeSheet();
                    }}
                  >
                    Remove reminder
                  </button>
                )}
                <button
                  className="sheetBtn isQuiet"
                  onClick={() => setEditRemind(null)}
                >
                  Back
                </button>
              </>
            ) : editDetails !== null ? (
              <>
                <div style={S.sheetGroupLabel}>Details</div>
                <textarea
                  style={{ ...S.sheetInput, minHeight: 96, resize: "vertical" }}
                  value={editDetails}
                  autoFocus
                  placeholder="Notes, a link to read later…"
                  onChange={(ev) => setEditDetails(ev.target.value)}
                  aria-label="Entry details"
                />
                <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 4px 10px" }}>
                  Links become tappable. Leave empty to remove.
                </p>
                <button
                  className="sheetBtn"
                  onClick={() => {
                    setDetails(sheet.id, editDetails);
                    closeSheet();
                  }}
                >
                  Save details
                </button>
                <button
                  className="sheetBtn isQuiet"
                  onClick={() => setEditDetails(null)}
                >
                  Back
                </button>
              </>
            ) : editText === null ? (
              <>
                <div style={S.sheetEntry}>
                  <span style={{ marginRight: 8 }}>{GLYPH[sheetEntry.type]}</span>
                  {sheetEntry.text}
                  {sheetHistory.length > 0 && (
                    <div
                      style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}
                    >
                      migration history:{" "}
                      {sheetHistory
                        .map(
                          (pk) =>
                            pageLabel(pk) +
                            (pk === sheetEntry.pageKey ? " (this page)" : "")
                        )
                        .join(" › ")}
                    </div>
                  )}
                </div>
                <button
                  className="sheetBtn"
                  onClick={() => setEditText(sheetEntry.text)}
                >
                  Edit text
                </button>
                <button
                  className="sheetBtn"
                  onClick={() => setEditDetails(sheetEntry.details ?? "")}
                >
                  {sheetEntry.details ? "Edit details" : "Add details"}
                </button>
                <button
                  className="sheetBtn"
                  onClick={() =>
                    setEditRemind(
                      toLocalInput(sheetEntry.remindAt ?? Date.now() + 3600_000)
                    )
                  }
                >
                  {sheetEntry.remindAt
                    ? `Change reminder (${fmtRemind(sheetEntry.remindAt)})`
                    : "Set reminder"}
                </button>
                {sheetEntry.type === "task" && (
                  <button
                    className="sheetBtn"
                    onClick={() => {
                      toggleDone(sheet.id);
                      closeSheet();
                    }}
                  >
                    {sheetEntry.state === "done" ? "Reopen task" : "Mark complete"}
                  </button>
                )}
                {sheetNestTarget && (
                  <button
                    className="sheetBtn"
                    onClick={() => {
                      setParent(sheet.id, sheetNestTarget.id);
                      closeSheet();
                    }}
                  >
                    Nest under "{trunc(sheetNestTarget.text, 34)}"
                  </button>
                )}
                {sheetEntry.parentId && (
                  <button
                    className="sheetBtn"
                    onClick={() => {
                      setParent(sheet.id, null);
                      closeSheet();
                    }}
                  >
                    Move to top level
                  </button>
                )}
                {keyScope(sheet.pk) &&
                  !sheetEntry.recurrenceId && (
                    <button
                      className="sheetBtn"
                      onClick={() => {
                        const sc = keyScope(sheet.pk);
                        setEditRepeat({
                          n: "1",
                          // Non-day pages lock the cadence to their own scope
                          unit: sc && sc !== "day" ? sc : "week",
                          time: sheetEntry.remindAt
                            ? new Date(sheetEntry.remindAt)
                                .toTimeString()
                                .slice(0, 5)
                            : "",
                        });
                      }}
                    >
                      Repeat this entry…
                    </button>
                  )}
                {sheetEntry.recurrenceId &&
                  (() => {
                    const rule = recurrences.find(
                      (r) => r.id === sheetEntry.recurrenceId && !r.endedAt
                    );
                    return rule ? (
                      <>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--ink-soft)",
                            padding: "2px 0 4px",
                          }}
                        >
                          repeats {cadenceLabel(rule.everyN, rule.unit)} — next:{" "}
                          {pageLabel(
                            nextOccurrence(rule, periodKey(rule.pageScope, today))
                          )}
                        </div>
                        <button
                          className="sheetBtn"
                          onClick={() => {
                            endRecurrence(rule.id);
                            closeSheet();
                          }}
                        >
                          Stop repeating ({cadenceLabel(rule.everyN, rule.unit)})
                        </button>
                      </>
                    ) : null;
                  })()}
                {sheetMigrates ? (
                  <>
                    <div style={S.sheetGroupLabel}>
                      Migrate to (original stays here, marked ›)
                    </div>
                    <div style={S.sheetRow}>
                      {SCOPES.map((t) => (
                        <button
                          key={t}
                          className="sheetBtn isCompact"
                          onClick={() => {
                            migrateEntry(sheet.id, nowKeys[t]);
                            closeSheet();
                          }}
                        >
                          › {SCOPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </>
                ) : keyScope(sheet.pk) !== null ? (
                  <>
                    <div style={S.sheetGroupLabel}>Move to</div>
                    <div style={S.sheetRow}>
                      {SCOPES.filter((t) => t !== sheet.scope).map((t) => (
                        <button
                          key={t}
                          className="sheetBtn isCompact"
                          onClick={() => {
                            moveTo(sheet.id, nowKeys[t]);
                            closeSheet();
                          }}
                        >
                          {SCOPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {sheetEntry.type === "task" &&
                  sheetEntry.state === "open" &&
                  keyScope(sheet.pk) !== null && (
                    <>
                      <div style={S.sheetGroupLabel}>
                        Schedule to a future date (original stays here, marked
                        ‹)
                      </div>
                      <div style={S.sheetRow}>
                        <input
                          type="date"
                          value={schedDate}
                          min={shiftAnchor("day", today, 1)}
                          onChange={(ev) => setSchedDate(ev.target.value)}
                          style={S.dateInput}
                          aria-label="Schedule to date"
                        />
                        <button
                          className="sheetBtn isCompact"
                          disabled={!schedDate || schedDate <= today}
                          onClick={() => {
                            migrateEntry(sheet.id, schedDate);
                            closeSheet();
                          }}
                        >
                          ‹ Schedule
                        </button>
                      </div>
                    </>
                  )}
                <button
                  className="sheetBtn"
                  onClick={() => {
                    toggleStruck(sheet.id);
                    closeSheet();
                  }}
                >
                  {sheetEntry.state === "struck"
                    ? "Restore entry"
                    : "Strike out (no longer relevant)"}
                </button>
                <button
                  className="sheetBtn isDanger"
                  onClick={() => {
                    deleteWithUndo(sheet.id);
                    closeSheet();
                  }}
                >
                  Delete entry
                </button>
                <button className="sheetBtn isQuiet" onClick={closeSheet}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <div style={S.sheetGroupLabel}>Edit entry</div>
                <input
                  style={S.sheetInput}
                  value={editText}
                  autoFocus
                  onChange={(ev) => setEditText(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" && editText.trim()) {
                      setText(sheet.id, editText.trim());
                      closeSheet();
                    }
                  }}
                  aria-label="Entry text"
                />
                <button
                  className="sheetBtn"
                  disabled={!editText.trim()}
                  onClick={() => {
                    setText(sheet.id, editText.trim());
                    closeSheet();
                  }}
                >
                  Save changes
                </button>
                <button
                  className="sheetBtn isQuiet"
                  onClick={() => setEditText(null)}
                >
                  Back
                </button>
              </>
            )}
          </div>
        </div>
  );
}
