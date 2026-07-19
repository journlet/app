import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  SCOPES,
  SCOPE_LABEL,
  keyScope,
  pageLabel,
  periodKey,
  scopeSub,
  todayKey,
} from "./lib/dates";
import type { Scope } from "./lib/dates";
import { GLYPH, STATE_GLYPH } from "./lib/types";
import type { Entry } from "./lib/types";
import { loadSticky, saveSticky } from "./lib/sticky";
import type { CaptureScope } from "./lib/sticky";
import {
  addEntry,
  cycleType,
  migrateEntry,
  moveTo,
  removeEntry,
  restoreEntry,
  setText,
  strikeEntry,
  toggleDone,
  toggleStruck,
} from "./store/journal";
import { useJournal } from "./store/useJournal";

interface SheetTarget {
  scope: Scope | null;
  pk: string;
  id: string;
}

interface DeletedToast {
  entry: Entry;
}

export default function App() {
  const { loaded, saveState, days } = useJournal();

  const sticky = useRef(loadSticky());
  const [captureScope, _setCaptureScope] = useState<CaptureScope>(
    sticky.current.scope
  );
  const [captureType, _setCaptureType] = useState(sticky.current.type);
  const [capturePriority, _setCapturePriority] = useState(
    sticky.current.priority
  );
  const [input, setInput] = useState("");
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [editText, setEditText] = useState<string | null>(null);
  const [toast, setToast] = useState<DeletedToast | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [customDate, setCustomDate] = useState(todayKey());
  const [customGran, setCustomGran] = useState<Scope>("day");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const persistSticky = () => saveSticky(sticky.current);

  const setCaptureScope = (v: CaptureScope) => {
    sticky.current.scope = v;
    persistSticky();
    _setCaptureScope(v);
  };
  const setCaptureType = (fn: (t: Entry["type"]) => Entry["type"]) =>
    _setCaptureType((prev) => {
      const next = fn(prev);
      sticky.current.type = next;
      persistSticky();
      return next;
    });
  const setCapturePriority = (fn: (v: boolean) => boolean) =>
    _setCapturePriority((prev) => {
      const next = fn(prev);
      sticky.current.priority = next;
      persistSticky();
      return next;
    });

  // open, type, done — capture box focused as soon as the journal is ready
  useEffect(() => {
    if (loaded) inputRef.current?.focus();
  }, [loaded]);

  const nowKeys = {} as Record<Scope, string>;
  SCOPES.forEach((sc) => (nowKeys[sc] = periodKey(sc, todayKey())));

  // Open tasks living on expired pages, awaiting a migration decision
  const pastOpen: { pk: string; entry: Entry }[] = [];
  Object.keys(days).forEach((k) => {
    const sc = keyScope(k);
    if (!sc) return;
    if (k >= nowKeys[sc]) return;
    (days[k] || []).forEach((e) => {
      if (e.type === "task" && e.state === "open") pastOpen.push({ pk: k, entry: e });
    });
  });

  // Entries scheduled onto future pages
  const futureItems: { pk: string; scope: Scope; entry: Entry }[] = [];
  Object.keys(days)
    .sort()
    .forEach((k) => {
      const sc = keyScope(k);
      if (!sc) return;
      if (k <= nowKeys[sc]) return;
      (days[k] || []).forEach((e) => futureItems.push({ pk: k, scope: sc, entry: e }));
    });

  const submitEntry = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const pk =
      captureScope === "date"
        ? periodKey(customGran, customDate)
        : nowKeys[captureScope];
    addEntry(pk, captureType, text, capturePriority);
    setInput("");
    inputRef.current?.focus();
    // sticky state intentionally retained (spec §4.1)
  }, [input, captureScope, captureType, capturePriority, customDate, customGran, nowKeys]);

  const deleteWithUndo = (id: string) => {
    const snapshot = removeEntry(id);
    if (!snapshot) return;
    setToast({ entry: snapshot });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const undoDelete = () => {
    if (!toast) return;
    restoreEntry(toast.entry);
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  };

  const closeSheet = () => {
    setSheet(null);
    setEditText(null);
  };

  const sheetEntry: Entry | null = sheet
    ? (days[sheet.pk] || []).find((x) => x.id === sheet.id) ?? null
    : null;

  const renderEntry = (e: Entry, pk: string, sc: Scope | null) => (
    <li key={e.id} className="entry">
      <button
        className={
          "bullet" +
          (e.state === "done" ? " isDone" : "") +
          (e.state === "migrated" ? " isMigrated" : "")
        }
        onClick={() =>
          e.type === "task" ? toggleDone(e.id) : cycleType(e.id)
        }
        title={e.type === "task" ? "Tap to complete" : "Tap to change type"}
        aria-label={`${e.type}, ${e.state}`}
      >
        {e.state === "done"
          ? STATE_GLYPH.done
          : e.state === "migrated"
            ? ">"
            : GLYPH[e.type]}
      </button>
      <span
        className={
          "etext" +
          (e.state === "done" ? " isDone" : "") +
          (e.state === "struck" ? " isStruck" : "") +
          (e.state === "migrated" ? " isMigrated" : "")
        }
      >
        {e.priority && <span className="prio">*</span>}
        {e.text}
      </span>
      <span className="actions">
        <button
          className="miniBtn moreBtn"
          onClick={() => setSheet({ scope: sc, pk, id: e.id })}
          aria-label="Entry actions"
          aria-haspopup="dialog"
        >
          ⋯
        </button>
      </span>
    </li>
  );

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={S.brandRow}>
          <span style={S.brand}>Journlet</span>
          <span style={S.saveDot}>
            {saveState === "saving" ? "saving…" : "saved"}
          </span>
        </div>
      </header>

      <main style={S.paper}>
        {!loaded && <div style={S.empty}>opening journal…</div>}
        {loaded && pastOpen.length > 0 && (
          <button className="reviewBanner" onClick={() => setReviewing(true)}>
            <span style={{ fontWeight: 600 }}>
              {pastOpen.length} open task{pastOpen.length === 1 ? "" : "s"} from
              past pages
            </span>
            <span style={{ fontSize: 12.5 }}>Review and migrate ›</span>
          </button>
        )}
        {loaded &&
          SCOPES.map((sc) => {
            const pk = nowKeys[sc];
            const entries = days[pk] || [];
            return (
              <section key={sc} style={S.section}>
                <div style={S.sectionHead}>
                  <h2 style={S.sectionTitle}>{SCOPE_LABEL[sc]}</h2>
                  <span style={S.sectionSub}>{scopeSub(sc)}</span>
                </div>
                {entries.length === 0 && (
                  <div style={S.sectionEmpty}>nothing logged</div>
                )}
                <ul style={S.list}>
                  {entries.map((e) => renderEntry(e, pk, sc))}
                </ul>
              </section>
            );
          })}
        {loaded && futureItems.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <h2 style={S.sectionTitle}>Scheduled ahead</h2>
              <span style={S.sectionSub}>
                appears on its page when the time comes
              </span>
            </div>
            <ul style={S.list}>
              {futureItems.map(({ pk, entry: e }) => (
                <li key={e.id} className="entry">
                  <span className="bullet" aria-hidden="true">
                    &lt;
                  </span>
                  <span className="etext">
                    {e.priority && <span className="prio">*</span>}
                    {e.text}
                    <span
                      style={{ fontSize: 11.5, color: "#6B7683", marginLeft: 8 }}
                    >
                      {pageLabel(pk)}
                    </span>
                  </span>
                  <span className="actions">
                    <button
                      className="miniBtn moreBtn"
                      onClick={() =>
                        setSheet({ scope: keyScope(pk), pk, id: e.id })
                      }
                      aria-label="Entry actions"
                      aria-haspopup="dialog"
                    >
                      ⋯
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer style={S.captureWrap}>
        <div style={S.scopeRow} role="tablist" aria-label="Log into">
          {([...SCOPES, "date"] as CaptureScope[]).map((sc) => (
            <button
              key={sc}
              role="tab"
              aria-selected={captureScope === sc}
              className={"scopeBtn" + (captureScope === sc ? " isActive" : "")}
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
          <div style={S.dateControls}>
            <input
              type="date"
              value={customDate}
              min={todayKey()}
              onChange={(ev) => ev.target.value && setCustomDate(ev.target.value)}
              style={S.dateInput}
              aria-label="Schedule date"
            />
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              {SCOPES.map((g) => (
                <button
                  key={g}
                  className={"scopeBtn" + (customGran === g ? " isActive" : "")}
                  onClick={() => setCustomGran(g)}
                  style={{ background: customGran === g ? "#FFFFFF" : "none" }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={S.captureBar}>
          <button
            className="typeBtn"
            onClick={() => {
              setCaptureType((t) =>
                t === "task" ? "event" : t === "event" ? "note" : "task"
              );
              inputRef.current?.focus();
            }}
            title="Change entry type"
            aria-label={`Entry type: ${captureType}. Tap to change.`}
          >
            <span style={S.captureGlyph}>{GLYPH[captureType]}</span>
            <span className="typeLabel">{captureType}</span>
          </button>
          <button
            className={"prioBtn" + (capturePriority ? " isOn" : "")}
            onClick={() => {
              setCapturePriority((v) => !v);
              inputRef.current?.focus();
            }}
            title="Toggle priority"
            aria-pressed={capturePriority}
            aria-label="Priority"
          >
            *
          </button>
          <input
            ref={inputRef}
            style={S.captureInput}
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Enter" && submitEntry()}
            placeholder={
              captureScope === "date"
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
        <div style={S.legend}>
          tap a task's bullet to complete it · ⋯ for entry actions
        </div>
      </footer>

      {toast && (
        <div style={S.toast} role="status">
          <span>Entry deleted</span>
          <button className="toastBtn" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      {reviewing && (
        <div style={S.sheetBackdrop} onClick={() => setReviewing(false)}>
          <div
            style={{ ...S.sheet, maxHeight: "80vh", overflowY: "auto" }}
            role="dialog"
            aria-label="Migration review"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={S.sheetHandle} />
            <div style={S.sheetGroupLabel}>Migration review</div>
            {pastOpen.length === 0 ? (
              <>
                <div style={S.sheetEntry}>
                  All done — every past task has been dealt with.
                </div>
                <button
                  className="sheetBtn isQuiet"
                  onClick={() => setReviewing(false)}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#6B7683", margin: "0 4px 12px" }}>
                  Decide what each open task deserves: bring it forward, or
                  strike it out if it no longer matters. Originals stay on
                  their old page marked ›.
                </p>
                {pastOpen.map(({ pk, entry }) => (
                  <div key={entry.id} style={{ marginBottom: 14 }}>
                    <div style={S.sheetEntry}>
                      <span style={{ marginRight: 8 }}>•</span>
                      {entry.priority && <span className="prio">*</span>}
                      {entry.text}
                      <span
                        style={{ fontSize: 11.5, color: "#6B7683", marginLeft: 8 }}
                      >
                        from {pageLabel(pk)}
                      </span>
                    </div>
                    <div style={S.sheetRow}>
                      {SCOPES.map((t) => (
                        <button
                          key={t}
                          className="sheetBtn isCompact"
                          onClick={() => migrateEntry(entry.id, nowKeys[t])}
                        >
                          › {SCOPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                    <button
                      className="sheetBtn isDanger"
                      onClick={() => strikeEntry(entry.id)}
                    >
                      Strike out (no longer relevant)
                    </button>
                  </div>
                ))}
                <button
                  className="sheetBtn isQuiet"
                  onClick={() => setReviewing(false)}
                >
                  Finish later
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {sheet && sheetEntry && (
        <div style={S.sheetBackdrop} onClick={closeSheet}>
          <div
            style={S.sheet}
            role="dialog"
            aria-label="Entry actions"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={S.sheetHandle} />
            {editText === null ? (
              <>
                <div style={S.sheetEntry}>
                  <span style={{ marginRight: 8 }}>{GLYPH[sheetEntry.type]}</span>
                  {sheetEntry.text}
                </div>
                <button
                  className="sheetBtn"
                  onClick={() => setEditText(sheetEntry.text)}
                >
                  Edit text
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
      )}
    </div>
  );
}

// ---------- inline styles (ported verbatim from prototype v17) ----------

const INK = "#26323E";
const INK_SOFT = "#6B7683";
const PAPER = "#F5F4EF";
const LINE = "#DCDAD1";

const S: Record<string, CSSProperties> = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    background: PAPER,
    color: INK,
    fontFamily: "'Public Sans', system-ui, sans-serif",
  },
  header: {
    padding: "18px 20px 6px",
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
    maxWidth: 560,
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
    padding: "8px 20px 16px",
    backgroundImage: `radial-gradient(${LINE} 1px, transparent 1px)`,
    backgroundSize: "22px 22px",
    overflowY: "auto",
  },
  section: { marginBottom: 18 },
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: 1.15,
  },
  sectionSub: { fontSize: 11.5, color: INK_SOFT },
  sectionEmpty: {
    color: INK_SOFT,
    fontSize: 12.5,
    fontStyle: "italic",
    padding: "6px 4px 2px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  empty: { color: INK_SOFT, fontSize: 14, padding: "26px 4px", fontStyle: "italic" },
  captureWrap: {
    position: "sticky",
    bottom: 0,
    background: PAPER,
    borderTop: `1px solid ${LINE}`,
    padding: "8px 20px calc(12px + env(safe-area-inset-bottom))",
  },
  scopeRow: {
    maxWidth: 560,
    margin: "0 auto 8px",
    display: "flex",
    gap: 4,
    background: "#ECEAE2",
    borderRadius: 9,
    padding: 3,
  },
  captureBar: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#FFFFFF",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    padding: "10px 12px",
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
    background: "#FFFFFF",
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
  sheetInput: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 16,
    padding: "10px 12px",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    background: "#FFFFFF",
    color: INK,
    fontFamily: "inherit",
    marginBottom: 10,
  },
};
