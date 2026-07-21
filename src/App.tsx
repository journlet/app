import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  SCOPES,
  SCOPE_LABEL,
  dkey,
  keyScope,
  keyToAnchor,
  pageLabel,
  periodKey,
  periodSub,
  shiftAnchor,
  todayKey,
} from "./lib/dates";
import IndexView from "./IndexView";
import CollectionView from "./CollectionView";
import SyncView from "./SyncView";
import { getSyncStatus, onSyncStatus } from "./store/sync";
import type { SyncStatus } from "./store/sync";
import { colPageKey } from "./lib/types";
import type { CollectionKind } from "./lib/types";
import {
  addCollection,
  addRecurrence,
  endRecurrence,
  removeCollection,
  restoreCollection,
  setParent,
  setReminder,
  tagEntryRecurrence,
} from "./store/journal";
import type { Recurrence, RecurrenceUnit } from "./lib/types";
import { nextOccurrence } from "./store/recurrence";
import {
  notificationPermission,
  requestNotificationPermission,
} from "./store/reminders";
import type { CollectionSnapshot } from "./store/journal";
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
  entry?: Entry;
  colSnap?: CollectionSnapshot;
}

type View = "spread" | "index" | "sync" | { col: string };

// Always-visible sync state on the header button (spec §4.5); plain words,
// attention colour when something needs the user
const SYNC_BADGE: Record<SyncStatus, string> = {
  disabled: "sync",
  "signed-out": "sync · signed out",
  connecting: "sync · connecting…",
  "needs-key": "sync · key needed",
  synced: "sync · synced",
  pending: "sync · waiting",
  offline: "sync · offline",
};

const SYNC_ATTENTION: SyncStatus[] = [
  "signed-out",
  "needs-key",
  "pending",
  "offline",
];

export default function App() {
  const { loaded, saveState, days, collections, habits, recurrences } =
    useJournal();

  const sticky = useRef(loadSticky());
  const [captureScope, _setCaptureScope] = useState<CaptureScope>(
    sticky.current.scope
  );
  const [captureType, _setCaptureType] = useState(sticky.current.type);
  const [capturePriority, _setCapturePriority] = useState(
    sticky.current.priority
  );
  const [captureInspiration, _setCaptureInspiration] = useState(
    sticky.current.inspiration
  );
  const [input, setInput] = useState("");
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [editText, setEditText] = useState<string | null>(null);
  const [editRemind, setEditRemind] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<{
    n: string;
    unit: RecurrenceUnit;
    time: string;
  } | null>(null);
  const [toast, setToast] = useState<DeletedToast | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [view, setView] = useState<View>("spread");
  const [newCol, setNewCol] = useState<{ name: string; kind: CollectionKind } | null>(null);
  // The current day key, kept fresh across midnight and app resume; every
  // "what is today" decision in render must use this, not todayKey()
  const [today, setToday] = useState(todayKey());
  const todayRef = useRef(today);
  // Per-section browsing anchors; today unless the user steps away
  const [anchors, setAnchors] = useState<Record<Scope, string>>(() => ({
    day: todayKey(),
    week: todayKey(),
    month: todayKey(),
    year: todayKey(),
  }));
  const [customDate, setCustomDate] = useState(todayKey());
  const [customGran, setCustomGran] = useState<Scope>("day");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard handling (iOS): the keyboard shrinks the visual viewport but
  // not the layout viewport, and WebKit scrolls the page to reveal the
  // focused input — shoving the header and journal content up the screen.
  // Counter both: shrink the app frame to the visual viewport height so
  // the capture bar (still in normal flow at the bottom) rests on top of
  // the keyboard, and pin the layout viewport back to the top. Browsers
  // that honour interactive-widget=resizes-content (set in index.html)
  // do this natively and report nothing obscured, so the effect is inert.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.getElementById("root");
    if (!root) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const keyboardOpen = () =>
      window.innerHeight - vv.height - vv.offsetTop > 1;
    const align = () => {
      root.style.height = keyboardOpen() ? `${vv.height}px` : "";
      // WebKit pans the page to reveal the focused input even though the
      // input now sits above the keyboard; undo the pan wherever it landed
      if (
        keyboardOpen() &&
        (window.scrollY > 0 || vv.offsetTop > 0 || vv.pageTop > 0)
      ) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    };
    // The reveal-pan happens after iOS's own keyboard animation, later
    // than the resize event — re-check as things settle
    const nudge = () => {
      align();
      timers.push(setTimeout(align, 100));
      timers.push(setTimeout(align, 300));
      timers.push(setTimeout(align, 600));
    };
    vv.addEventListener("resize", nudge);
    vv.addEventListener("scroll", align);
    window.addEventListener("scroll", align);
    window.addEventListener("focusin", nudge);
    window.addEventListener("focusout", nudge);
    return () => {
      timers.forEach(clearTimeout);
      vv.removeEventListener("resize", nudge);
      vv.removeEventListener("scroll", align);
      window.removeEventListener("scroll", align);
      window.removeEventListener("focusin", nudge);
      window.removeEventListener("focusout", nudge);
    };
  }, []);

  // Day rollover: refresh `today` when the date changes — while the app
  // stays open (interval) and on resume from background (visibilitychange /
  // pageshow / focus), since iOS suspends timers in backgrounded PWAs.
  // Anchors still sitting on the page that was current follow along;
  // pages the user deliberately navigated to are left alone.
  useEffect(() => {
    const check = () => {
      const now = todayKey();
      const prev = todayRef.current;
      if (now === prev) return;
      todayRef.current = now;
      setToday(now);
      setAnchors((a) => {
        const next = { ...a };
        let changed = false;
        SCOPES.forEach((sc) => {
          if (periodKey(sc, a[sc]) === periodKey(sc, prev)) {
            next[sc] = now;
            changed = true;
          }
        });
        return changed ? next : a;
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    const timer = setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
      clearInterval(timer);
    };
  }, []);

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
  const setCaptureInspiration = (fn: (v: boolean) => boolean) =>
    _setCaptureInspiration((prev) => {
      const next = fn(prev);
      sticky.current.inspiration = next;
      persistSticky();
      return next;
    });

  // open, type, done — capture box focused as soon as the journal is ready
  useEffect(() => {
    if (loaded) inputRef.current?.focus();
  }, [loaded]);

  const nowKeys = {} as Record<Scope, string>;
  SCOPES.forEach((sc) => (nowKeys[sc] = periodKey(sc, today)));

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

  // Scheduled ahead also previews each active recurrence rule's next
  // occurrence. Display-only rows — the real entry is materialised when
  // its day arrives (remediation item 2a), so nothing is written here.
  type ScheduledRow =
    | { kind: "entry"; sort: string; pk: string; entry: Entry }
    | { kind: "rule"; sort: string; dayKey: string; rule: Recurrence };
  const scheduledRows: ScheduledRow[] = [
    ...futureItems.map(
      ({ pk, entry }): ScheduledRow => ({
        kind: "entry",
        sort: keyToAnchor(pk),
        pk,
        entry,
      })
    ),
    ...recurrences
      .filter((r) => !r.endedAt)
      .map((r): ScheduledRow => {
        const dayKey = nextOccurrence(r, today);
        return { kind: "rule", sort: dayKey, dayKey, rule: r };
      }),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

  // Collection currently open, if any
  const activeCol =
    typeof view === "object"
      ? collections.find((c) => c.id === view.col) ?? null
      : null;

  // Due view (spec §4.6): overdue and due-today reminders on open entries
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const dueItems: { pk: string; entry: Entry }[] = [];
  Object.keys(days).forEach((k) => {
    (days[k] || []).forEach((e) => {
      if (!e.remindAt || e.state !== "open") return;
      if (e.remindAt <= endOfToday.getTime()) dueItems.push({ pk: k, entry: e });
    });
  });
  dueItems.sort((a, b) => (a.entry.remindAt ?? 0) - (b.entry.remindAt ?? 0));

  const submitEntry = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const pk = activeCol
      ? colPageKey(activeCol.id)
      : captureScope === "date"
        ? periodKey(customGran, customDate)
        : nowKeys[captureScope];
    addEntry(pk, captureType, text, capturePriority, captureInspiration);
    setInput("");
    inputRef.current?.focus();
    // sticky state intentionally retained (spec §4.1)
  }, [input, activeCol, captureScope, captureType, capturePriority, captureInspiration, customDate, customGran, nowKeys]);

  const showToast = (t: DeletedToast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const deleteWithUndo = (id: string) => {
    const snapshot = removeEntry(id);
    if (!snapshot) return;
    showToast({ entry: snapshot });
  };

  const undoDelete = () => {
    if (!toast) return;
    if (toast.entry) restoreEntry(toast.entry);
    if (toast.colSnap) restoreCollection(toast.colSnap);
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  };

  const closeSheet = () => {
    setSheet(null);
    setEditText(null);
    setEditRemind(null);
    setEditRepeat(null);
  };

  const cadenceLabel = (n: number, unit: RecurrenceUnit) =>
    `every ${n > 1 ? `${n} ` : ""}${unit}${n > 1 ? "s" : ""}`;

  const saveRepeat = () => {
    if (!sheet || !sheetEntry || !editRepeat) return;
    const n = Math.max(1, parseInt(editRepeat.n, 10) || 1);
    const time = /^\d{2}:\d{2}$/.test(editRepeat.time)
      ? editRepeat.time
      : undefined;
    const rule = addRecurrence({
      text: sheetEntry.text,
      type: sheetEntry.type,
      priority: sheetEntry.priority,
      inspiration: sheetEntry.inspiration,
      everyN: n,
      unit: editRepeat.unit,
      anchor: sheet.pk,
      remindTime: time,
      materialisedThrough: sheet.pk,
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

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => onSyncStatus(setSyncStatus), []);

  // Re-render every 30s so due/overdue states stay current
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const fmtRemind = (ts: number): string => {
    const d = new Date(ts);
    const time = d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return dkey(d) === today
      ? time
      : `${d.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}, ${time}`;
  };

  // datetime-local wants "YYYY-MM-DDTHH:MM" in local time
  const toLocalInput = (ts: number): string => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  };

  const saveReminder = async () => {
    if (!sheet || !editRemind) return;
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

  const sheetEntry: Entry | null = sheet
    ? (days[sheet.pk] || []).find((x) => x.id === sheet.id) ?? null
    : null;

  // Nesting context: candidate parent above, and whether this entry has kids
  const sheetPageList = sheet ? days[sheet.pk] || [] : [];
  const sheetHasChildren = sheetEntry
    ? sheetPageList.some((x) => x.parentId === sheetEntry.id)
    : false;
  const sheetNestTarget = (() => {
    if (!sheet || !sheetEntry || sheetEntry.parentId || sheetHasChildren)
      return null;
    const idx = sheetPageList.findIndex((x) => x.id === sheet.id);
    for (let i = idx - 1; i >= 0; i--)
      if (!sheetPageList[i].parentId) return sheetPageList[i];
    return null;
  })();
  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  // Is the sheet's entry sitting on an expired page? Then moving it forward
  // must be a migration (original stays, marked ›) — never a silent move.
  const sheetOnPast = (() => {
    if (!sheet) return false;
    const sc = keyScope(sheet.pk);
    return sc ? sheet.pk < nowKeys[sc] : false;
  })();
  const sheetMigrates =
    sheetOnPast && sheetEntry?.type === "task" && sheetEntry?.state === "open";

  // Migration history: walk the migratedFrom chain both ways (spec §4.3)
  const sheetHistory: string[] = (() => {
    if (!sheetEntry) return [];
    const all = Object.values(days).flat();
    const byId = new Map(all.map((e) => [e.id, e]));
    const byFrom = new Map(
      all.filter((e) => e.migratedFrom).map((e) => [e.migratedFrom as string, e])
    );
    const chain: string[] = [sheetEntry.pageKey];
    let cur: Entry | undefined = sheetEntry;
    for (let i = 0; i < 20 && cur?.migratedFrom; i++) {
      cur = byId.get(cur.migratedFrom);
      if (!cur) break;
      chain.unshift(cur.pageKey);
    }
    cur = sheetEntry;
    for (let i = 0; i < 20; i++) {
      cur = byFrom.get(cur!.id);
      if (!cur) break;
      chain.push(cur.pageKey);
    }
    return chain.length > 1 ? chain : [];
  })();

  const renderEntry = (e: Entry, pk: string, sc: Scope | null) => (
    <li key={e.id} className={"entry" + (e.parentId ? " isSub" : "")}>
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
        {e.inspiration && <span className="insp">!</span>}
        {e.text}
        {e.remindAt && (
          <span style={{ fontSize: 11.5, color: "#6B7683", marginLeft: 8 }}>
            remind {fmtRemind(e.remindAt)}
          </span>
        )}
        {e.recurrenceId && (
          <span style={{ fontSize: 11.5, color: "#6B7683", marginLeft: 8 }}>
            repeats
          </span>
        )}
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
          <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <button
              className="miniBtn"
              onClick={() => setView(view === "spread" ? "index" : "spread")}
            >
              {view === "spread" ? "index" : "back to journal"}
            </button>
            {view !== "sync" && (
              <button
                className="miniBtn"
                style={
                  SYNC_ATTENTION.includes(syncStatus)
                    ? { color: "#A33", borderColor: "#E4C9C9" }
                    : undefined
                }
                onClick={() => setView("sync")}
              >
                {SYNC_BADGE[syncStatus]}
              </button>
            )}
            <span style={S.saveDot}>
              {saveState === "saving" ? "saving…" : "saved"}
            </span>
          </span>
        </div>
      </header>

      <main style={S.paper}>
        {!loaded && <div style={S.empty}>opening journal…</div>}
        {loaded && view === "index" && (
          <IndexView
            days={days}
            nowKeys={nowKeys}
            collections={collections}
            habits={habits}
            onOpen={(pk) => {
              const sc = keyScope(pk);
              if (!sc) return;
              setAnchors((a) => ({ ...a, [sc]: keyToAnchor(pk) }));
              setView("spread");
            }}
            onOpenCollection={(id) => setView({ col: id })}
            onNewCollection={() => setNewCol({ name: "", kind: "list" })}
          />
        )}
        {loaded && view === "sync" && (
          <SyncView onBack={() => setView("spread")} />
        )}
        {loaded && activeCol && (
          <CollectionView
            collection={activeCol}
            entries={days[colPageKey(activeCol.id)] || []}
            habits={habits.filter((h) => h.collectionId === activeCol.id)}
            renderEntry={(e) => renderEntry(e, colPageKey(activeCol.id), null)}
            onBackToIndex={() => setView("index")}
            onDelete={() => {
              const snap = removeCollection(activeCol.id);
              setView("index");
              if (snap) showToast({ colSnap: snap });
            }}
          />
        )}
        {loaded && view === "spread" && pastOpen.length > 0 && (
          <button className="reviewBanner" onClick={() => setReviewing(true)}>
            <span style={{ fontWeight: 600 }}>
              {pastOpen.length} open task{pastOpen.length === 1 ? "" : "s"} from
              past pages
            </span>
            <span style={{ fontSize: 12.5 }}>Review and migrate ›</span>
          </button>
        )}
        {loaded && view === "spread" && dueItems.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <h2 style={S.sectionTitle}>Due</h2>
              <span style={S.sectionSub}>reminders — overdue and today</span>
            </div>
            <ul style={S.list}>
              {dueItems.map(({ pk, entry }) =>
                renderEntry(entry, pk, keyScope(pk))
              )}
            </ul>
          </section>
        )}
        {loaded &&
          view === "spread" &&
          SCOPES.map((sc) => {
            const pk = periodKey(sc, anchors[sc]);
            const isCurrent = pk === nowKeys[sc];
            const isFuture = pk > nowKeys[sc];
            const entries = days[pk] || [];
            const step = (delta: number) =>
              setAnchors((a) => ({
                ...a,
                [sc]: shiftAnchor(sc, a[sc], delta),
              }));
            return (
              <section key={sc} style={S.section}>
                <div style={S.sectionHead}>
                  <h2 style={S.sectionTitle}>
                    {isCurrent ? SCOPE_LABEL[sc] : pageLabel(pk)}
                  </h2>
                  <span style={S.sectionSub}>
                    {isCurrent
                      ? periodSub(sc, anchors[sc])
                      : isFuture
                        ? "future page"
                        : "past page"}
                  </span>
                  <span style={S.sectionNav}>
                    <button
                      className="miniBtn"
                      onClick={() => step(-1)}
                      aria-label={`Previous ${sc}`}
                    >
                      ‹ <span className="navLong">previous</span>
                      <span className="navShort">prev</span>
                    </button>
                    {!isCurrent && (
                      <button
                        className="miniBtn"
                        onClick={() =>
                          setAnchors((a) => ({ ...a, [sc]: todayKey() }))
                        }
                        aria-label={`Back to current ${sc}`}
                      >
                        <span className="navLong">back to now</span>
                        <span className="navShort">now</span>
                      </button>
                    )}
                    <button
                      className="miniBtn"
                      onClick={() => step(1)}
                      aria-label={`Next ${sc}`}
                    >
                      next ›
                    </button>
                  </span>
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
        {loaded && view === "spread" && scheduledRows.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <h2 style={S.sectionTitle}>Scheduled ahead</h2>
              <span style={S.sectionSub}>
                appears on its page when the time comes
              </span>
            </div>
            <ul style={S.list}>
              {scheduledRows.map((row) =>
                row.kind === "entry" ? (
                  <li key={row.entry.id} className="entry">
                    <span className="bullet" aria-hidden="true">
                      &lt;
                    </span>
                    <span className="etext">
                      {row.entry.priority && <span className="prio">*</span>}
                      {row.entry.text}
                      <span
                        style={{
                          fontSize: 11.5,
                          color: "#6B7683",
                          marginLeft: 8,
                        }}
                      >
                        {pageLabel(row.pk)}
                      </span>
                    </span>
                    <span className="actions">
                      <button
                        className="miniBtn moreBtn"
                        onClick={() =>
                          setSheet({
                            scope: keyScope(row.pk),
                            pk: row.pk,
                            id: row.entry.id,
                          })
                        }
                        aria-label="Entry actions"
                        aria-haspopup="dialog"
                      >
                        ⋯
                      </button>
                    </span>
                  </li>
                ) : (
                  <li key={`rule-${row.rule.id}`} className="entry">
                    <span className="bullet" aria-hidden="true">
                      &lt;
                    </span>
                    <span className="etext">
                      {row.rule.priority && <span className="prio">*</span>}
                      {row.rule.text}
                      <span
                        style={{
                          fontSize: 11.5,
                          color: "#6B7683",
                          marginLeft: 8,
                        }}
                      >
                        {pageLabel(row.dayKey)} — repeats{" "}
                        {cadenceLabel(row.rule.everyN, row.rule.unit)}
                      </span>
                    </span>
                  </li>
                )
              )}
            </ul>
          </section>
        )}
      </main>

      {activeCol?.kind !== "habits" && view !== "sync" && (
      <footer style={S.captureWrap}>
        {!activeCol && (
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
        )}
        {!activeCol && captureScope === "date" && (
          <div style={S.dateControls}>
            <input
              type="date"
              value={customDate}
              min={today}
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
          <button
            className={"prioBtn" + (captureInspiration ? " isOn" : "")}
            onClick={() => {
              setCaptureInspiration((v) => !v);
              inputRef.current?.focus();
            }}
            title="Toggle inspiration"
            aria-pressed={captureInspiration}
            aria-label="Inspiration"
          >
            !
          </button>
          <input
            ref={inputRef}
            style={S.captureInput}
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Enter" && submitEntry()}
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
        <div style={S.legend}>
          tap a task's bullet to complete it · ⋯ for entry actions
        </div>
      </footer>
      )}

      {toast && (
        <div style={S.toast} role="status">
          <span>{toast.colSnap ? "Collection deleted" : "Entry deleted"}</span>
          <button className="toastBtn" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      {newCol && (
        <div style={S.sheetBackdrop} onClick={() => setNewCol(null)}>
          <div
            style={S.sheet}
            role="dialog"
            aria-label="New collection"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={S.sheetHandle} />
            <div style={S.sheetGroupLabel}>New collection</div>
            <input
              style={S.sheetInput}
              value={newCol.name}
              autoFocus
              placeholder="Collection name…"
              onChange={(ev) => setNewCol({ ...newCol, name: ev.target.value })}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && newCol.name.trim()) {
                  const c = addCollection(newCol.kind, newCol.name.trim());
                  setNewCol(null);
                  setView({ col: c.id });
                }
              }}
              aria-label="Collection name"
            />
            <div style={S.sheetGroupLabel}>Type</div>
            <div style={S.sheetRow}>
              {(["list", "habits"] as CollectionKind[]).map((k) => (
                <button
                  key={k}
                  className="sheetBtn isCompact"
                  style={
                    newCol.kind === k
                      ? { border: "1.5px solid #26323E", fontWeight: 600 }
                      : undefined
                  }
                  aria-pressed={newCol.kind === k}
                  onClick={() => setNewCol({ ...newCol, kind: k })}
                >
                  {k === "habits" ? "Habit tracker" : "List"}
                </button>
              ))}
            </div>
            <button
              className="sheetBtn"
              disabled={!newCol.name.trim()}
              onClick={() => {
                const c = addCollection(newCol.kind, newCol.name.trim());
                setNewCol(null);
                setView({ col: c.id });
              }}
            >
              Create collection
            </button>
            <button className="sheetBtn isQuiet" onClick={() => setNewCol(null)}>
              Cancel
            </button>
          </div>
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
                    {(["day", "week", "month", "year"] as RecurrenceUnit[]).map(
                      (u) => (
                        <button
                          key={u}
                          className={
                            "scopeBtn" + (editRepeat.unit === u ? " isActive" : "")
                          }
                          style={{
                            background:
                              editRepeat.unit === u ? "#FFFFFF" : "none",
                          }}
                          onClick={() =>
                            setEditRepeat({ ...editRepeat, unit: u })
                          }
                        >
                          {u}s
                        </button>
                      )
                    )}
                  </div>
                </div>
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
                <p style={{ fontSize: 12.5, color: "#6B7683", margin: "0 4px 10px" }}>
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
                  <p style={{ fontSize: 12.5, color: "#6B7683", margin: "0 4px 10px" }}>
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
            ) : editText === null ? (
              <>
                <div style={S.sheetEntry}>
                  <span style={{ marginRight: 8 }}>{GLYPH[sheetEntry.type]}</span>
                  {sheetEntry.text}
                  {sheetHistory.length > 0 && (
                    <div
                      style={{ fontSize: 11.5, color: "#6B7683", marginTop: 6 }}
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
                {keyScope(sheet.pk) === "day" &&
                  !sheetEntry.recurrenceId && (
                    <button
                      className="sheetBtn"
                      onClick={() =>
                        setEditRepeat({
                          n: "1",
                          unit: "week",
                          time: sheetEntry.remindAt
                            ? new Date(sheetEntry.remindAt)
                                .toTimeString()
                                .slice(0, 5)
                            : "",
                        })
                      }
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
                      <button
                        className="sheetBtn"
                        onClick={() => {
                          endRecurrence(rule.id);
                          closeSheet();
                        }}
                      >
                        Stop repeating ({cadenceLabel(rule.everyN, rule.unit)})
                      </button>
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
    flexWrap: "wrap",
    rowGap: 2,
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
    padding: "6px 4px 2px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  empty: { color: INK_SOFT, fontSize: 14, padding: "26px 4px", fontStyle: "italic" },
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
