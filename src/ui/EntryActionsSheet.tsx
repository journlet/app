// The ⋯ entry view: everything you can do to a single entry.
//
// It was a bottom sheet (hence the file name, kept so the diff stays small):
// thirteen buttons at one weight, three mini-forms unfolding in place, and no
// height cap, so on a phone it ran off the bottom with nothing to scroll and
// nothing to scan. Restructured 6 August 2026 into the same full-screen surface
// as the capture and details forms, with two rules that between them fix both
// complaints:
//
//   1. Every multi-step action is its own step. Repeat, reminder, thread and
//      nest already were; migrate, move and schedule now are too. So the top
//      level is a fixed list of plainly labelled rows whose length no longer
//      depends on which entry you opened.
//   2. The rows are in named groups — what the entry says, where it goes, and
//      removing it — with the state an action would change written underneath
//      the row itself rather than floating above it as a label.
//
// A row that opens a step ends in "…"; a row that acts immediately does not.
// Deliberately no chevron: › and ‹ are notation here (migrated, scheduled) and
// must not also mean "goes somewhere".
//
// Every draft this view collects, and every write it makes, live here.
//
// They used to live in App, which held eleven pieces of state nothing else on
// the page read, reset all of them in its closeSheet, and threaded them back
// down as forty-four props. Two of those props existed only so that App could
// seed them from `sheet.pk` before setting `sheet`, which is a sequencing
// requirement that disappears when the value is a useState initialiser in the
// view that reads it. This component is unmounted whenever no sheet is open,
// so the drafts reset by unmounting and there is nothing to clear.
//
// App keeps what App owns: which entry the sheet is aimed at, the derived
// context around it (nest targets, migration history, whether the page has
// expired), and the three closures that move focus somewhere else, since
// closing the sheet, opening the details view and opening capture with this
// entry as parent are all decisions about the page rather than about the entry.

import { useId, useState } from "react";
import {
  SCOPES,
  SCOPE_LABEL,
  defaultRemindAt,
  formatRemindAt,
  keyScope,
  keyToAnchor,
  pageLabel,
  periodKey,
  periodName,
  shiftAnchor,
} from "../lib/dates";
import type { Scope } from "../lib/dates";
import { normalise } from "../lib/search";
import { pageRefLabel, threadTargets } from "../lib/threads";
import { GLYPH, STATE_GLYPH, STATE_WORD } from "../lib/types";
import type {
  Collection,
  Entry,
  EntryType,
  Recurrence,
  RecurrenceUnit,
} from "../lib/types";
import {
  addRecurrence,
  endRecurrence,
  migrateEntry,
  moveTo,
  setEntryType,
  setParent,
  setRecurrenceEnd,
  setReminder,
  setSignifier,
  setText,
  toggleDone,
  toggleStruck,
  toggleThread,
  tagEntryRecurrence,
} from "../store/journal";
import {
  cadenceLabel,
  isSpent,
  lastOccurrence,
  nextOccurrence,
  ruleSentence,
} from "../store/recurrence";
import {
  notificationPermission,
  requestNotificationPermission,
} from "../store/reminders";
import EndsForm, {
  endsDraftFor,
  endsSaveLabel,
  resolveEnds,
} from "./EndsForm";
import PagePicker from "./PagePicker";
import { S } from "./styles";
import FullScreenSheet from "./FullScreenSheet";
import type { EditEnds, EditRepeat, SheetTarget } from "./types";

/** Which step is open. Five are named by the draft state that opens them; the
 *  other three carry no draft of their own beyond which one is showing, so they
 *  are held in `localStep` instead. */
type Step =
  | "text"
  | "sig"
  | "type"
  | "repeat"
  | "ends"
  | "remind"
  | "thread"
  | "nest"
  | "migrate"
  | "move"
  | "schedule"
  | null;

const STEP_TITLE: Record<Exclude<Step, null>, string> = {
  text: "Edit text",
  sig: "Signifiers",
  type: "Type",
  repeat: "Repeat",
  ends: "When it ends",
  remind: "Reminder",
  thread: "Thread to a page",
  nest: "Nest under",
  migrate: "Migrate",
  move: "Move to another page",
  schedule: "Schedule for later",
};

interface EntryActionsSheetProps {
  sheet: SheetTarget;
  sheetEntry: Entry;
  sheetHistory: string[];
  /** every entry on this page that could become this one's parent (spec §4.1) */
  sheetNestTargets: Entry[];
  /** this entry has sub-bullets of its own, so it can't become one */
  sheetHasChildren: boolean;
  /** open capture with this entry pre-set as the parent */
  onAddSubBullet: () => void;
  sheetMigrates: boolean;
  recurrences: Recurrence[];
  /** list collections, for the thread-to-a-page targets (spec §4.4) */
  collections: Collection[];
  today: string;
  nowKeys: Record<Scope, string>;
  /** open the full-screen details view for this entry */
  onEditDetails: () => void;
  closeSheet: () => void;
  deleteWithUndo: (id: string) => void;
}

export default function EntryActionsSheet({
  sheet,
  sheetEntry,
  sheetHistory,
  sheetNestTargets,
  sheetHasChildren,
  onAddSubBullet,
  sheetMigrates,
  recurrences,
  collections,
  today,
  nowKeys,
  onEditDetails,
  closeSheet,
  deleteWithUndo,
}: EntryActionsSheetProps) {
  // ---------- the drafts ----------
  //
  // One per multi-step action, `null` meaning its step is closed, which is what
  // `step` below reads to decide what is on screen. Each one is the reason its
  // step exists, so they are declared together rather than beside the code that
  // saves them.

  /** the text being edited, before it is written */
  const [editText, setEditText] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<EditRepeat | null>(null);
  /** draft for the "when it ends" step (spec §11 Q17) */
  const [editEnds, setEditEnds] = useState<EditEnds | null>(null);
  const [editRemind, setEditRemind] = useState<string | null>(null);
  // Thread-to-a-page: null = closed, otherwise the current filter text (spec
  // §4.4). A sub-view rather than inline buttons so the length doesn't grow with
  // the number of collections.
  const [threadFilter, setThreadFilter] = useState<string | null>(null);
  // "Nest under…": null = closed, otherwise the current filter text. Every
  // top-level entry on the page is a candidate parent, so like the thread picker
  // this is a sub-view rather than a row of buttons — the length can't grow with
  // the size of the page.
  const [nestFilter, setNestFilter] = useState<string | null>(null);
  // Set when a nest was refused because the page changed under the picker
  // (another device deleted or moved something). Shown rather than swallowed —
  // an action that appears to do nothing is the app lying about what happened.
  const [nestRefused, setNestRefused] = useState<string | null>(null);
  /** the date chosen in "Schedule to a future date" */
  const [schedDate, setSchedDate] = useState("");

  // "Move to": which day the picker is pointing at, and which kind of page that
  // day means. Both start on the page the entry is actually on, so the picker
  // opens showing where the entry is and the move button stays inert until that
  // changes; a sheet can be opened from a row on another page, so starting on
  // today would be a claim about the wrong page. A move is a correction rather
  // than a migration, so it has no floor and may reach back into the past.
  //
  // App used to set both of these before setting `sheet`, in that order, because
  // a prop has no other way to be seeded. Here they are just initialisers.
  const [moveAnchor, setMoveAnchor] = useState(() => keyToAnchor(sheet.pk));
  const [moveGran, setMoveGran] = useState<Scope>(
    () => keyScope(sheet.pk) ?? "day"
  );

  // ---------- writes ----------

  /**
   * Nest the sheet's entry under the chosen parent. Closes the picker when it
   * worked; when the store refuses — only possible if the page changed while
   * the picker was open — the picker stays put and says so, so the tap is never
   * a silent no-op.
   */
  const nestUnder = (parentId: string) => {
    if (setParent(sheet.id, parentId)) {
      setNestRefused(null);
      setNestFilter(null);
    } else {
      setNestRefused(
        "That entry can no longer take sub-bullets — the page changed. Pick another."
      );
    }
  };

  const openNestPicker = () => {
    // A refusal belongs to the attempt that caused it, never to the next one —
    // otherwise the picker opens already complaining
    setNestRefused(null);
    setNestFilter("");
  };

  /**
   * Write the end the step was left on (spec §11 Q17).
   *
   * The two forms are stored as they were given rather than one being converted
   * into the other, and "never" clears both. Nothing already on a page is
   * touched: an end only stops the materialiser going further, which is why
   * this needs no pass over the entries.
   */
  const saveEnds = () => {
    if (!editEnds) return;
    const rule = recurrences.find((r) => r.id === sheetEntry.recurrenceId);
    if (!rule) return;
    setRecurrenceEnd(
      rule.id,
      editEnds.mode === "date"
        ? { on: editEnds.date }
        : editEnds.mode === "count"
          ? { after: Math.max(1, parseInt(editEnds.count, 10) || 1) }
          : null
    );
    setEditEnds(null);
  };

  const saveRepeat = () => {
    if (!editRepeat) return;
    const scope = keyScope(sheet.pk);
    if (!scope) return; // no recurrence on collections (no timeline to walk)
    const n = Math.max(1, parseInt(editRepeat.n, 10) || 1);
    // Timed reminders only apply to day-scope recurrences
    const time =
      scope === "day" && /^\d{2}:\d{2}$/.test(editRepeat.time)
        ? editRepeat.time
        : undefined;
    // The end set in the same step, if any (spec §11 Q17). Stored as the form
    // it was given in: a count is not turned into the date it implies, since
    // "ten of these" and "nothing after September" are different statements.
    const ends = editRepeat.ends;
    const rule = addRecurrence({
      text: sheetEntry.text,
      type: sheetEntry.type,
      priority: sheetEntry.priority,
      inspiration: sheetEntry.inspiration,
      everyN: n,
      // On a week/month/year page the cadence is locked to that scope
      unit: scope === "day" ? editRepeat.unit : scope,
      pageScope: scope,
      anchor: keyToAnchor(sheet.pk),
      remindTime: time,
      // Start materialising from the current period, never before it: making
      // a past (or today's) entry recurring must not retroactively spawn
      // overdue occurrences on pages gone by (honest history, and it was
      // wrongly triggering the migration banner). Future-dated pages keep
      // their own anchor so occurrences still begin after them.
      materialisedThrough:
        sheet.pk > nowKeys[scope] ? sheet.pk : nowKeys[scope],
      endsOn: ends.mode === "date" ? ends.date : undefined,
      endsAfter:
        ends.mode === "count"
          ? Math.max(1, parseInt(ends.count, 10) || 1)
          : undefined,
    });
    tagEntryRecurrence(sheet.id, rule.id);
    if (time && !sheetEntry.remindAt) {
      const [hh, mm] = time.split(":").map(Number);
      const d = new Date(sheet.pk + "T00:00");
      const ts = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        hh,
        mm
      ).getTime();
      setReminder(sheet.id, ts);
    }
    closeSheet();
  };

  const saveReminder = async () => {
    if (!editRemind) return;
    // Parse the datetime-local value by hand: engines disagree on whether
    // timezone-less strings are local or UTC (Safari says UTC — an hour
    // out in BST), so never let new Date(string) guess.
    const m = editRemind.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return;
    const ts = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5])
    ).getTime();
    if (Number.isNaN(ts)) return;
    if (notificationPermission() === "default")
      await requestNotificationPermission();
    setReminder(sheet.id, ts);
    closeSheet();
  };

  // ---------- display helpers ----------

  const fmtRemind = (ts: number): string => formatRemindAt(ts, today);

  /** datetime-local wants "YYYY-MM-DDTHH:MM" in local time */
  const toLocalInput = (ts: number): string => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  };

  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  // The three steps that unfold with no draft behind them. Nothing else needs to
  // know they exist: closing the view unmounts it.
  const [localStep, setLocalStep] = useState<
    "sig" | "type" | "migrate" | "move" | "schedule" | null
  >(null);
  /** Which type the Type step has selected but not yet saved. The Signifiers
   *  step needs no draft at all, because it writes on tap. */
  const [typeDraft, setTypeDraft] = useState<EntryType | null>(null);
  // Prefix for the row-caption ids the rows point their aria-describedby at
  const rowIds = useId();

  const step: Step =
    editText !== null
      ? "text"
      : editRepeat !== null
        ? "repeat"
        : editRemind !== null
          ? "remind"
          : threadFilter !== null
            ? "thread"
            : nestFilter !== null
              ? "nest"
              : editEnds !== null
                ? "ends"
                : localStep;

  // One way back from every step, so the header button means the same thing
  // wherever you are: leave this step, or close the view if you are at the top.
  const back = () => {
    setEditText(null);
    setEditRepeat(null);
    setEditEnds(null);
    setEditRemind(null);
    setThreadFilter(null);
    setNestFilter(null);
    setLocalStep(null);
    setTypeDraft(null);
  };

  /** What is lit now, for the row caption: the state the step would change has
   *  to be legible before it is opened (the rule the reminder row follows). */
  const signifierWords = (e: Entry): string => {
    const lit: string[] = [];
    if (e.priority) lit.push("* priority");
    if (e.inspiration) lit.push("! inspiration");
    return lit.length > 0 ? lit.join(", ") : "none";
  };
  /** › and ‹ pair this row with a live copy on another page, so a type change
   *  here cannot be honestly applied — see setEntryType. The row is offered and
   *  refused in place, with the reason on it, rather than hidden. */
  const typeIsPinned =
    sheetEntry.state === "migrated" || sheetEntry.state === "scheduled";

  const onPeriodPage = keyScope(sheet.pk) !== null;
  const canSchedule =
    sheetEntry.type === "task" && sheetEntry.state === "open" && onPeriodPage;
  const rule = sheetEntry.recurrenceId
    ? recurrences.find((r) => r.id === sheetEntry.recurrenceId)
    : undefined;
  // A rule that has passed its planned end has nothing left to stop or to
  // change, so it offers no actions — but it is still what made this entry, and
  // the note below says so rather than leaving the row silent (spec §11 Q17).
  const activeRule = rule && !isSpent(rule, today) ? rule : undefined;
  const spentRule = rule && isSpent(rule, today) ? rule : undefined;

  const scope = keyScope(sheet.pk);
  /** The rule the Repeat step is about to make, so its Ends control can resolve
   *  a date or a count against a cadence that does not exist yet. */
  const repeatBase: Recurrence | null =
    editRepeat && scope
      ? {
          id: "draft",
          text: sheetEntry.text,
          type: sheetEntry.type,
          priority: sheetEntry.priority,
          inspiration: sheetEntry.inspiration,
          everyN: Math.max(1, parseInt(editRepeat.n, 10) || 1),
          unit: scope === "day" ? editRepeat.unit : scope,
          pageScope: scope,
          anchor: keyToAnchor(sheet.pk),
          materialisedThrough: sheet.pk,
          createdAt: 0,
        }
      : null;
  const endsBase: Recurrence | null = activeRule
    ? { ...activeRule, endsOn: undefined, endsAfter: undefined }
    : null;
  // One resolution per surface, so the box, the button's words and the save all
  // describe the same answer (spec §11 Q17).
  const endsRes =
    editEnds && endsBase ? resolveEnds(endsBase, editEnds, today) : null;
  const repeatRes =
    editRepeat && repeatBase
      ? resolveEnds(repeatBase, editRepeat.ends, today, true)
      : null;
  const endsError = endsRes?.error ?? repeatRes?.error ?? null;

  /** The entry itself, glyph and words both — never the symbol alone */
  const entryLine = (
    <div style={S.entryCtx}>
      <span aria-hidden="true">
        {sheetEntry.state === "done" ||
        sheetEntry.state === "migrated" ||
        sheetEntry.state === "scheduled"
          ? STATE_GLYPH[sheetEntry.state]
          : GLYPH[sheetEntry.type]}
      </span>
      <span
        style={{
          flex: 1,
          textDecoration:
            sheetEntry.state === "struck" ? "line-through" : undefined,
        }}
      >
        {/* The signifiers are drawn here as they are on the page, not just
            named in the state word: the Signifiers step writes on tap, and
            what it wrote has to be visible on the line above the chips. */}
        {sheetEntry.priority && (
          <span className="prio">
            <i>*</i>
          </span>
        )}
        {sheetEntry.inspiration && (
          <span className="prio">
            <i>!</i>
          </span>
        )}
        {sheetEntry.text}
      </span>
      <span style={S.entryCtxState}>
        {sheetEntry.state === "open"
          ? sheetEntry.type
          : `${sheetEntry.type}, ${STATE_WORD[sheetEntry.state]}`}
      </span>
    </div>
  );

  /** A row that opens a step or acts, with the state it changes underneath it.
   *  The caption is a description, not part of the name: without the explicit
   *  aria-label a screen reader would read the button as "Mark complete drawn
   *  as × on this page" — one run-on phrase where the action should come first
   *  and the consequence follow it. */
  const row = (
    label: string,
    onClick: () => void,
    caption?: string,
    extra?: { danger?: boolean; disabled?: boolean }
  ) => {
    const capId = caption
      ? `${rowIds}-${label.replace(/[^a-z]+/gi, "-").toLowerCase()}`
      : undefined;
    return (
      <button
        className={"sheetBtn" + (extra?.danger ? " isDanger" : "")}
        disabled={extra?.disabled}
        aria-label={label}
        aria-describedby={capId}
        onClick={onClick}
      >
        {label}
        {caption && (
          <span id={capId} style={S.rowCaption}>
            {caption}
          </span>
        )}
      </button>
    );
  };

  const moveTargetKey = periodKey(moveGran, moveAnchor);
  // Moving an entry to the page it is already on does nothing, so the button
  // says so and stays inert rather than closing as if it had worked.
  const moveIsNoop = moveTargetKey === sheetEntry.pageKey;

  return (
    <FullScreenSheet
      label="Entry actions"
      title={step ? STEP_TITLE[step] : "Entry"}
      actionLabel={step ? "Back" : "Close"}
      onAction={step ? back : closeSheet}
    >
      {/* Shown at the top of every step as well as the top level: a step can
          be several taps from the page, and which entry it is acting on must
          never have to be remembered */}
      {entryLine}
      {step === null && sheetHistory.length > 0 && (
        <div style={S.entryCtxHistory}>
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

      {step === "text" && editText !== null && (
        <>
          <div style={S.formLbl}>Entry text</div>
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
        </>
      )}

      {/* Signifiers (spec §4.1a). No draft and no save button: lighting or
          clearing * loses nothing and tapping again undoes it exactly, so
          the step writes straight through, the way the capture form these
          chips came from does. The entry line above updates with it. */}
      {step === "sig" && (
        <>
          <p style={S.subLede}>
            Signifiers sit in front of the text: <b>*</b> marks a priority,{" "}
            <b>!</b> marks an inspiration. Either, both or neither. The bullet
            is untouched — a signifier is a mark on an entry, not a kind of
            entry.
          </p>
          <div style={S.formLbl}>Signifiers</div>
          <div style={S.sheetRow}>
            <button
              className={"capChoice" + (sheetEntry.priority ? " isLit" : "")}
              aria-pressed={sheetEntry.priority}
              onClick={() =>
                setSignifier(sheet.id, "priority", !sheetEntry.priority)
              }
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>*</span>
              priority
            </button>
            <button
              className={
                "capChoice" + (sheetEntry.inspiration ? " isLit" : "")
              }
              aria-pressed={Boolean(sheetEntry.inspiration)}
              onClick={() =>
                setSignifier(
                  sheet.id,
                  "inspiration",
                  !sheetEntry.inspiration
                )
              }
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>!</span>
              inspiration
            </button>
          </div>
          <p style={S.sheetNote}>
            Saved as you tap. The line above is this entry as it now reads on
            the page.
          </p>
          {rule && (
            <p style={S.sheetNote}>
              This entry came from a repeat. This occurrence changes on its
              own — later ones come out of the rule as before.
            </p>
          )}
        </>
      )}

      {/* Type (spec §4.1a). This one keeps the save button: a completed task
          that stops being a task stops being complete, and tapping "task"
          again brings the bullet back but not the ×. So the consequence is
          said in words and read before the save, never found afterwards on
          the page. */}
      {step === "type" && (
        <>
          <p style={S.subLede}>
            Only the bullet changes. The text, the page, the signifiers and a
            strikethrough all stay as they are.
          </p>
          <div style={S.formLbl}>Type</div>
          <div style={S.sheetRow}>
            {(["task", "event", "note"] as const).map((t) => {
              const chosen = (typeDraft ?? sheetEntry.type) === t;
              return (
                <button
                  key={t}
                  className={"capChoice" + (chosen ? " isLit" : "")}
                  aria-pressed={chosen}
                  onClick={() => setTypeDraft(t)}
                >
                  <span style={{ fontSize: 15 }}>{GLYPH[t]}</span>
                  {t}
                </button>
              );
            })}
          </div>
          {sheetEntry.state === "done" &&
            typeDraft !== null &&
            typeDraft !== "task" && (
              <p style={S.sheetWarn} role="status">
                This task is complete. × means a completed task, and there is
                no such thing as a completed {typeDraft}, so the × goes and
                this becomes an open {GLYPH[typeDraft]} {typeDraft}.
              </p>
            )}
          <button
            className="sheetBtn"
            disabled={typeDraft === null || typeDraft === sheetEntry.type}
            onClick={() => {
              if (typeDraft) setEntryType(sheet.id, typeDraft);
              closeSheet();
            }}
          >
            {typeDraft === null || typeDraft === sheetEntry.type
              ? "No change to save"
              : "Save changes"}
          </button>
          {rule && (
            <p style={S.sheetNote}>
              This entry came from a repeat. This occurrence changes on its
              own — later ones come out of the rule as before.
            </p>
          )}
        </>
      )}

      {step === "repeat" && editRepeat !== null && (
        <>
          <div style={S.formLbl}>Repeat this entry</div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
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
                        "scopeBtn" + (editRepeat.unit === u ? " isActive" : "")
                      }
                      style={{
                        background:
                          editRepeat.unit === u ? "var(--surface)" : "none",
                      }}
                      onClick={() => setEditRepeat({ ...editRepeat, unit: u })}
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
              <div style={S.formLbl}>
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
          <p style={S.subLede}>
            Starting from this entry's page, a fresh copy appears{" "}
            {cadenceLabel(
              Math.max(1, parseInt(editRepeat.n, 10) || 1),
              editRepeat.unit
            )}
            . Completing one occurrence never touches the next.
          </p>
          {repeatBase && (
            <>
              <div style={S.formLbl}>Ends</div>
              <EndsForm
                base={repeatBase}
                value={editRepeat.ends}
                onChange={(ends) => setEditRepeat({ ...editRepeat, ends })}
                today={today}
                creating
                idPrefix="repeat"
              />
            </>
          )}
          <button
            className="sheetBtn"
            onClick={saveRepeat}
            disabled={endsError !== null}
          >
            Start repeating
          </button>
        </>
      )}

      {step === "ends" && editEnds !== null && (
        <>
          {endsBase ? (
            <>
              <div style={S.formLbl}>When this repeat ends</div>
              <EndsForm
                base={endsBase}
                value={editEnds}
                onChange={setEditEnds}
                today={today}
                idPrefix="ends"
              />
              <button
                className="sheetBtn"
                onClick={saveEnds}
                disabled={endsError !== null}
              >
                {endsRes && endsBase
                  ? endsSaveLabel(endsRes, endsBase)
                  : "Save when it ends"}
              </button>
            </>
          ) : (
            <p style={S.sheetNote}>
              That repeat is no longer here, so there is nothing to end.
            </p>
          )}
        </>
      )}

      {step === "remind" && editRemind !== null && (
        <>
          <div style={S.formLbl}>Remind me at</div>
          <input
            type="datetime-local"
            style={S.sheetInput}
            value={editRemind}
            onChange={(ev) => setEditRemind(ev.target.value)}
            aria-label="Reminder date and time"
          />
          {notificationPermission() === "denied" && (
            <p style={S.subLede}>
              Notifications are blocked in your browser settings, so nothing
              will pop up — but anything due still appears in the Due section
              at the top of the journal.
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
        </>
      )}

      {/* Migrate (spec §4.2). Its own step now: it was a row of four compact
          buttons under a label, which read as one control with four settings
          rather than four separate destinations. */}
      {step === "migrate" && (
        <>
          <p style={S.subLede}>
            The entry moves forward to the page you choose and a copy stays
            here marked › , so this page still shows that you carried it
            across. Choose where it goes.
          </p>
          {SCOPES.map((t) => (
            <div key={t}>
              {row(
                `Migrate to ${SCOPE_LABEL[t]}`,
                () => {
                  migrateEntry(sheet.id, nowKeys[t]);
                  closeSheet();
                },
                pageLabel(nowKeys[t])
              )}
            </div>
          ))}
        </>
      )}

      {/* Move (spec §4.2), through the same page picker the capture form uses.
          A move leaves nothing behind and writes no notation, so unlike a
          migration it is free to go backwards: the picker has no floor. */}
      {step === "move" && onPeriodPage && (
        <>
          <p style={S.subLede}>
            For putting an entry right when it was logged onto the wrong page.
            Nothing stays behind and no notation is written, so it can go
            backwards as well as forwards.
          </p>
          <PagePicker
            label="Move to"
            gran={moveGran}
            setGran={setMoveGran}
            anchor={moveAnchor}
            setAnchor={setMoveAnchor}
            today={today}
          />
          <div style={S.sheetNote}>
            {moveIsNoop
              ? "That is the page this entry is already on — choose another."
              : `The entry moves to ${periodName(
                  moveGran,
                  moveAnchor
                )}, leaving nothing behind on ${pageRefLabel(
                  sheetEntry.pageKey,
                  collections
                )}.` +
                (sheetEntry.parentId
                  ? " It stops being a sub-bullet, because its parent stays on this page."
                  : "")}
          </div>
          <button
            className="sheetBtn"
            disabled={moveIsNoop}
            onClick={() => {
              moveTo(sheet.id, moveTargetKey);
              closeSheet();
            }}
          >
            {moveIsNoop ? "Move" : `Move to ${pageLabel(moveTargetKey)}`}
          </button>
        </>
      )}

      {step === "schedule" && canSchedule && (
        <>
          <p style={S.subLede}>
            The task stays on this page marked ‹ and a copy appears on the date
            you pick, so nothing is lost from today's record.
          </p>
          <div style={S.formLbl}>Date</div>
          <input
            type="date"
            value={schedDate}
            min={shiftAnchor("day", today, 1)}
            onChange={(ev) => setSchedDate(ev.target.value)}
            style={{ ...S.dateInput, marginBottom: 10 }}
            aria-label="Schedule to date"
          />
          <button
            className="sheetBtn"
            disabled={!schedDate || schedDate <= today}
            onClick={() => {
              migrateEntry(sheet.id, schedDate);
              closeSheet();
            }}
          >
            {schedDate && schedDate > today
              ? `Schedule for ${pageLabel(schedDate)}`
              : "Schedule"}
          </button>
        </>
      )}

      {/* Thread-to-a-page picker (spec §4.4). Pages already referenced show as
          plain rows, not buttons: removal lives at the top level where the
          reference is listed, so there is exactly one place to undo it. */}
      {step === "thread" &&
        threadFilter !== null &&
        (() => {
          const targets = threadTargets(
            sheetEntry.pageKey,
            collections,
            nowKeys
          );
          const q = normalise(threadFilter.trim());
          const shown = q
            ? targets.filter((t) => normalise(t.label).includes(q))
            : targets;
          return (
            <>
              <p style={S.subLede}>
                A page reference, not a move: the entry stays on{" "}
                {pageRefLabel(sheetEntry.pageKey, collections)} and keeps its
                glyph, and the page you choose points back at it.
              </p>
              {/* A filter only earns its place once the list is past a
                  glance; below that it is one more thing to look at */}
              {(targets.length > 8 || q.length > 0) && (
                <input
                  style={S.sheetInput}
                  value={threadFilter}
                  autoFocus
                  placeholder="Find a page…"
                  onChange={(ev) => setThreadFilter(ev.target.value)}
                  aria-label="Find a page"
                />
              )}
              {shown.length === 0 && (
                <div style={S.sheetEmpty}>no page matches</div>
              )}
              {shown.map((t) => {
                const already = Boolean(
                  sheetEntry.threads?.includes(t.pageKey)
                );
                return already ? (
                  <div
                    key={t.pageKey}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "12px 14px",
                      marginBottom: 8,
                      fontSize: 15,
                      color: "var(--ink-soft)",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                    }}
                  >
                    <span>{t.label}</span>
                    <span style={{ fontSize: 12 }}>already threaded</span>
                  </div>
                ) : (
                  <button
                    key={t.pageKey}
                    className="sheetBtn"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                    aria-label={`Thread to ${t.label}`}
                    onClick={() => {
                      toggleThread(sheet.id, t.pageKey);
                      setThreadFilter(null);
                    }}
                  >
                    <span>{t.label}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      {t.hint ?? "collection"}
                    </span>
                  </button>
                );
              })}
            </>
          );
        })()}

      {/* "Nest under…" picker (spec §4.1). Any top-level entry on the page can
          be the parent, not only the one above: a sub-bullet is drawn directly
          beneath its parent wherever that parent sits. */}
      {step === "nest" &&
        nestFilter !== null &&
        (() => {
          const q = normalise(nestFilter.trim());
          const shown = q
            ? sheetNestTargets.filter((t) => normalise(t.text).includes(q))
            : sheetNestTargets;
          return (
            <>
              <p style={S.subLede}>
                This entry moves to sit beneath the one you choose, on{" "}
                {pageRefLabel(sheetEntry.pageKey, collections)}.
              </p>
              {/* A filter only earns its place once the list is past a
                  glance. It stays put once typed in, so a list can never be
                  narrowed by a filter the user can no longer see. */}
              {(sheetNestTargets.length > 8 || q.length > 0) && (
                <input
                  style={S.sheetInput}
                  value={nestFilter}
                  autoFocus
                  placeholder="Find an entry…"
                  onChange={(ev) => setNestFilter(ev.target.value)}
                  aria-label="Find an entry"
                />
              )}
              {nestRefused && (
                <div style={S.sheetWarn} role="status">
                  {nestRefused}
                </div>
              )}
              {shown.length === 0 && (
                <div style={S.sheetEmpty}>
                  {q.length > 0
                    ? "no entry matches"
                    : "nothing left to nest this under"}
                </div>
              )}
              {shown.map((t) => (
                <button
                  key={t.id}
                  className="sheetBtn"
                  style={S.nestTargetBtn}
                  // The state is named as well as drawn: a completed or
                  // migrated entry can still be a parent, but the user should
                  // not have to guess that from a glyph alone
                  aria-label={`Nest under ${t.text}${
                    t.state === "open" ? "" : `, ${t.state}`
                  }`}
                  onClick={() => nestUnder(t.id)}
                >
                  <span style={{ color: "var(--ink-soft)" }} aria-hidden="true">
                    {t.state === "done" ||
                    t.state === "migrated" ||
                    t.state === "scheduled"
                      ? STATE_GLYPH[t.state]
                      : GLYPH[t.type]}
                  </span>
                  <span
                    style={
                      t.state === "struck"
                        ? { textDecoration: "line-through" }
                        : undefined
                    }
                  >
                    {trunc(t.text, 44)}
                  </span>
                  {t.state !== "open" && (
                    <span style={{ ...S.stateWord, marginLeft: "auto" }}>
                      {STATE_WORD[t.state]}
                    </span>
                  )}
                </button>
              ))}
            </>
          );
        })()}

      {step === null && (
        <>
          {/* ── What the entry says ─────────────────────────────────────── */}
          {/* Ticking a task off is far and away the most-used action, so it
              sits first, nearest the top of the list. Captions are only on
              the rows where the effect on the page is not already in the
              label — notation written, a copy left behind, or a state the
              row would otherwise silently change. Captioning every row was
              its own kind of noise. */}
          <div style={S.formLbl}>This entry</div>
          {sheetEntry.type === "task" &&
            row(
              sheetEntry.state === "done" ? "Reopen task" : "Mark complete",
              () => {
                toggleDone(sheet.id);
                closeSheet();
              },
              sheetEntry.state === "done"
                ? "back to an open task, drawn as •"
                : "drawn as × on this page"
            )}
          {row("Edit text", () => setEditText(sheetEntry.text))}
          {/* Changing a signifier and changing the type, added 26 August
              2026 (spec §4.1a). Both were capture-only: a non-priority that
              becomes a priority had no way to say so, and a task's glyph tap
              completes it, so a task logged by mistake could not become a
              note at all. */}
          {row("Signifiers…", () => setLocalStep("sig"), signifierWords(sheetEntry))}
          {typeIsPinned
            ? row(
                "Type…",
                () => {},
                `not while this is ${STATE_WORD[sheetEntry.state]} — ${
                  STATE_GLYPH[
                    sheetEntry.state as "migrated" | "scheduled"
                  ]
                } belongs to a task, and the copy it carries is the live one`,
                { disabled: true }
              )
            : row(
                "Type…",
                () => {
                  setTypeDraft(sheetEntry.type);
                  setLocalStep("type");
                },
                `currently ${GLYPH[sheetEntry.type]} ${sheetEntry.type}`
              )}
          {row(
            sheetEntry.details ? "Edit details" : "Add details",
            onEditDetails,
            sheetEntry.details ? trunc(sheetEntry.details, 60) : undefined
          )}
          {row(
            sheetEntry.remindAt ? "Change reminder…" : "Set reminder…",
            () =>
              setEditRemind(
                toLocalInput(
                  sheetEntry.remindAt ?? defaultRemindAt(sheetEntry.pageKey)
                )
              ),
            sheetEntry.remindAt
              ? `currently ${fmtRemind(sheetEntry.remindAt)}`
              : undefined
          )}
          {onPeriodPage &&
            !sheetEntry.recurrenceId &&
            row("Repeat this entry…", () => {
              const sc = keyScope(sheet.pk);
              setEditRepeat({
                n: "1",
                // Non-day pages lock the cadence to their own scope
                unit: sc && sc !== "day" ? sc : "week",
                time: sheetEntry.remindAt
                  ? new Date(sheetEntry.remindAt).toTimeString().slice(0, 5)
                  : "",
                // No end unless one is asked for: a repeat with an end is the
                // exception, and the default must be today's behaviour
                // (spec §11 Q17).
                // A default the control can express and that means
                // something: twelve more of whatever cadence was just
                // chosen, counted from this entry, which is the first
                // (see endsDraftFor for the same reasoning on an existing
                // rule). Well clear of the count's floor, which is the
                // answer "this is the only one".
                ends: {
                  mode: "never",
                  date: shiftAnchor(
                    sc && sc !== "day" ? sc : "week",
                    today,
                    12
                  ),
                  count: "13",
                },
              });
            })}
          {activeRule &&
            row(
              lastOccurrence(activeRule)
                ? "Change when it ends…"
                : "Set when it ends…",
              () => setEditEnds(endsDraftFor(activeRule, today)),
              ruleSentence(activeRule, today)
            )}
          {activeRule &&
            row(
              `Stop repeating (${cadenceLabel(
                activeRule.everyN,
                activeRule.unit
              )})`,
              () => {
                endRecurrence(activeRule.id);
                closeSheet();
              },
              `next ${pageLabel(
                nextOccurrence(
                  activeRule,
                  periodKey(activeRule.pageScope, today)
                )
              )}`
            )}
          {spentRule && (
            <p style={S.sheetNote}>
              {`${ruleSentence(spentRule, today)}. Nothing more will be made.`}
            </p>
          )}

          {/* ── Where it goes ───────────────────────────────────────────── */}
          <div style={S.formLbl}>Where it goes</div>
          {sheetMigrates &&
            row("Migrate…", () => setLocalStep("migrate"), "carries it forward to a current page and leaves › here")}
          {canSchedule &&
            row(
              "Schedule for later…",
              () => setLocalStep("schedule"),
              "puts a copy on a future date and leaves ‹ here"
            )}
          {onPeriodPage &&
            row(
              "Move to another page…",
              () => setLocalStep("move"),
              "corrects the page it was logged on — nothing stays behind"
            )}
          {/* Nesting, one level deep (spec §4.1). A top-level entry can gain
              sub-bullets; a sub-bullet can be moved to a different parent or
              promoted. An entry that already has sub-bullets can't itself be
              nested — that would make a third level — and the view says so
              rather than hiding the action. */}
          {!sheetEntry.parentId &&
            row("Add a sub-bullet under this entry", onAddSubBullet)}
          {sheetNestTargets.length > 0 &&
            row(
              sheetEntry.parentId
                ? "Nest under a different entry…"
                : "Nest under another entry…",
              openNestPicker
            )}
          {sheetHasChildren && !sheetEntry.parentId && (
            <div style={S.sheetNote}>
              This entry has sub-bullets of its own, so it can't be nested
              under another. Move them out first.
            </div>
          )}
          {sheetEntry.parentId &&
            row("Move to top level", () => {
              setParent(sheet.id, null);
              closeSheet();
            })}
          {/* Threading (spec §4.4): a page reference, not a move. The entry
              stays put and keeps its glyph, so it is offered on every page —
              including collections, which can thread back to a period page. */}
          {threadTargets(sheetEntry.pageKey, collections, nowKeys).length >
            0 &&
            row(
              sheetEntry.threads?.length
                ? "Thread to another page…"
                : "Thread to a page…",
              () => setThreadFilter(""),
              "a reference — the entry stays where it is"
            )}
          {/* What this entry already points at, each removable where you can
              see it. Adding happens in the step above, so this list's length
              tracks the entry's own references rather than the number of
              collections (spec §4.4). */}
          {sheetEntry.threads && sheetEntry.threads.length > 0 && (
            <>
              <div style={S.formLbl}>Threaded to</div>
              {sheetEntry.threads.map((pk) => (
                <button
                  key={pk}
                  className="sheetBtn"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                  aria-label={`Remove reference to ${pageRefLabel(
                    pk,
                    collections
                  )}`}
                  onClick={() => toggleThread(sheet.id, pk)}
                >
                  <span>{pageRefLabel(pk, collections)}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    remove reference
                  </span>
                </button>
              ))}
            </>
          )}

          {/* ── Removing it ─────────────────────────────────────────────── */}
          <div style={S.removeGroup}>
            <div style={{ ...S.formLbl, marginTop: 0 }}>Remove</div>
            {row(
              sheetEntry.state === "struck"
                ? "Restore entry"
                : "Strike out (no longer relevant)",
              () => {
                toggleStruck(sheet.id);
                closeSheet();
              },
              sheetEntry.state === "struck"
                ? undefined
                : "stays on the page, struck through"
            )}
            {row(
              "Delete entry",
              () => {
                deleteWithUndo(sheet.id);
                closeSheet();
              },
              "gone from the journal — undo is offered briefly",
              { danger: true }
            )}
          </div>
        </>
      )}
    </FullScreenSheet>
  );
}
