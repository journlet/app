import { useCallback, useEffect, useRef, useState } from "react";
import {
  SCOPES,
  SCOPE_LABEL,
  dkey,
  fmt,
  keyScope,
  keyToAnchor,
  pageLabel,
  periodKey,
  periodSub,
  shiftAnchor,
  toDate,
  todayKey,
} from "./lib/dates";
import IndexView from "./IndexView";
import CollectionView from "./CollectionView";
import SyncView from "./SyncView";
import MenuView from "./MenuView";
import { buildMarkdown } from "./lib/exportMd";
import { useInstallState, markCaptured } from "./lib/install";
import {
  applyTheme,
  loadTheme,
  onSystemThemeChange,
  saveTheme,
} from "./lib/theme";
import type { ThemePref } from "./lib/theme";
import { getSyncStatus, onSyncStatus } from "./store/sync";
import type { SyncStatus } from "./store/sync";
import { colPageKey } from "./lib/types";
import type { CollectionKind } from "./lib/types";
import {
  addCollection,
  addRecurrence,
  removeCollection,
  restoreCollection,
  setReminder,
  tagEntryRecurrence,
} from "./store/journal";
import type { RecurrenceUnit } from "./lib/types";
import { nextOccurrence } from "./store/recurrence";
import {
  notificationPermission,
  requestNotificationPermission,
} from "./store/reminders";
import type { CollectionSnapshot } from "./store/journal";
import type { Scope } from "./lib/dates";
import { GLYPH, STATE_GLYPH } from "./lib/types";
import type { Entry } from "./lib/types";
import { GRID } from "./lib/grid";
import { loadSticky, saveSticky } from "./lib/sticky";
import type { CaptureScope } from "./lib/sticky";
import {
  addEntry,
  cycleType,
  migrateEntry,
  removeEntry,
  restoreEntry,
  strikeEntry,
  toggleDone,
} from "./store/journal";
import { useJournal } from "./store/useJournal";
import { applyUpdate, getUpdateReady, onUpdateReady } from "./store/appUpdate";
import { S } from "./ui/styles";
import FutureLogView from "./ui/FutureLogView";
import CaptureForm from "./ui/CaptureForm";
import EntryActionsSheet from "./ui/EntryActionsSheet";
import RuleActionsSheet from "./ui/RuleActionsSheet";
import type { EditRepeat, ScheduledRow, SheetTarget } from "./ui/types";

interface DeletedToast {
  entry?: Entry;
  colSnap?: CollectionSnapshot;
}

type View = "spread" | "index" | "sync" | "menu" | "future" | { col: string };

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

// Future log fold state is a device preference, not journal content —
// kept local like sticky capture state, never synced
const FOLDS_KEY = "journlet-futurelog-folds";

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
  // Last entry logged while the capture form has been open (batch cue)
  const [justLogged, setJustLogged] = useState<string | null>(null);

  // App-icon shortcuts land on /?capture (Android manifest shortcut;
  // iOS reaches the same URL via a Siri Shortcut or a second home-screen
  // icon, as it lacks long-press shortcuts for PWAs) — open the entry
  // form directly, then tidy the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("capture")) return;
    setCaptureOpen(true);
    params.delete("capture");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "")
    );
  }, []);
  // Full-screen capture form (remediation item 4): the footer is a slim
  // launcher; both its targets open this form — one behaviour, no guessing
  const [captureOpen, setCaptureOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  // Sheet for a recurrence preview row — keyed on the rule, not an entry
  const [ruleSheet, setRuleSheet] = useState<{
    ruleId: string;
    dayKey: string;
  } | null>(null);
  const [editText, setEditText] = useState<string | null>(null);
  // Date chosen in the sheet's "Schedule to a future date" control
  const [schedDate, setSchedDate] = useState("");
  // Folded Future log month groups (device preference, see FOLDS_KEY)
  const [folds, setFolds] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLDS_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const toggleFold = (gk: string) =>
    setFolds((f) => {
      const next = { ...f, [gk]: !f[gk] };
      try {
        localStorage.setItem(FOLDS_KEY, JSON.stringify(next));
      } catch {
        /* fold state is best-effort */
      }
      return next;
    });
  const [editRemind, setEditRemind] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<EditRepeat | null>(null);
  const [toast, setToast] = useState<DeletedToast | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [themePref, setThemePref] = useState<ThemePref>(loadTheme);
  const changeTheme = useCallback((t: ThemePref) => {
    setThemePref(t);
    saveTheme(t);
    applyTheme(t);
  }, []);
  // While in "system" mode CSS re-themes on its own, but the theme-color meta
  // (browser/PWA chrome) needs a nudge when the OS scheme flips.
  useEffect(
    () => onSystemThemeChange(() => loadTheme() === "system" && applyTheme("system")),
    []
  );
  const [view, setViewRaw] = useState<View>("spread");
  // A small navigation stack so the header "back" returns to the screen you
  // came from (e.g. menu → index → back lands on the menu), not always the
  // journal. setView pushes the current view; goBack pops it.
  const viewRef = useRef<View>("spread");
  viewRef.current = view;
  const navHistory = useRef<View[]>([]);
  const setView = useCallback((next: View) => {
    navHistory.current.push(viewRef.current);
    setViewRaw(next);
  }, []);
  const goBack = useCallback(() => {
    setViewRaw(navHistory.current.pop() ?? "spread");
  }, []);
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

  // iOS keyboard-pinning is no longer needed: the full-screen capture form
  // (remediation item 4) owns the whole viewport and has no in-flow footer
  // input for the keyboard to shove around. interactive-widget=resizes-content
  // (index.html) handles the rest natively.

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

  // The entry input lives in the full-screen capture form and autofocuses
  // when the form opens (autoFocus attribute); nothing to focus at load.

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
  // ScheduledRow type lives in ./ui/types so FutureLogView shares it.
  const scheduledRows: ScheduledRow[] = [
    ...futureItems.map(
      ({ pk, entry }): ScheduledRow => ({
        kind: "entry",
        sort: keyToAnchor(pk),
        pk,
        entry,
      })
    ),
    ...(() => {
      // A rule's next occurrence may already exist as a real entry (the
      // entry made recurring sits on a future page, or an instance was
      // materialised) — skip the preview then, the real row covers it
      const covered = new Set(
        futureItems
          .filter((f) => f.entry.recurrenceId)
          .map((f) => `${f.entry.recurrenceId}:${f.pk}`)
      );
      return recurrences
        .filter((r) => !r.endedAt)
        .map((r) => {
          const occKey = nextOccurrence(r, periodKey(r.pageScope, today));
          // sort by the period's first day so week/month/year previews
          // interleave correctly with dated entries
          return {
            kind: "rule" as const,
            sort: keyToAnchor(occKey),
            dayKey: occKey,
            rule: r,
          };
        })
        .filter((row) => !covered.has(`${row.rule.id}:${row.dayKey}`));
    })(),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

  // Future log (spec §4.2; §11 Q9 resolved 21 July 2026): Carroll's Future
  // Log starts where the current month ends. Rows landing later this month
  // stay with the This Month section; everything beyond groups by month
  // (weeks file under their Monday's month), and year-scoped items sit in
  // a year bucket until they gain a date. Empty months are skipped — the
  // paper method pre-draws them only because paper must be allocated.
  const rowGroupKey = (r: ScheduledRow): string => {
    const pk = r.kind === "entry" ? r.pk : r.dayKey;
    if (keyScope(pk) === "year") return pk;
    // keyToAnchor turns any period key into a day inside it, so week/month
    // rule previews file under the right month (weeks under their Monday's)
    return keyToAnchor(pk).slice(0, 7);
  };
  const laterThisMonth = scheduledRows.filter(
    (r) => rowGroupKey(r) === nowKeys.month
  );
  const futureLogGroups: { gk: string; rows: ScheduledRow[] }[] = [];
  scheduledRows.forEach((r) => {
    const gk = rowGroupKey(r);
    if (gk === nowKeys.month) return;
    const g = futureLogGroups.find((x) => x.gk === gk);
    if (g) g.rows.push(r);
    else futureLogGroups.push({ gk, rows: [r] });
  });
  futureLogGroups.sort((a, b) => (a.gk < b.gk ? -1 : 1));
  const futureLogCount = futureLogGroups.reduce((n, g) => n + g.rows.length, 0);

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
    // First entry logged on this device unlocks the install nudge (see
    // lib/install): let people feel capture work once, then offer to install.
    markCaptured();
    setInput("");
    // The form stays open for a run of entries (decision of 22 July 2026,
    // restoring §4.1's batch-logging intent); a confirmation line shows
    // each entry landed. "Done" closes.
    setJustLogged(
      text.length > 40 ? text.slice(0, 39) + "…" : text
    );
    inputRef.current?.focus();
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

  const closeCapture = () => {
    setCaptureOpen(false);
    setJustLogged(null);
  };

  const closeSheet = () => {
    setSheet(null);
    setEditText(null);
    setEditRemind(null);
    setEditRepeat(null);
    setSchedDate("");
  };

  const cadenceLabel = (n: number, unit: RecurrenceUnit) =>
    `every ${n > 1 ? `${n} ` : ""}${unit}${n > 1 ? "s" : ""}`;

  const saveRepeat = () => {
    if (!sheet || !sheetEntry || !editRepeat) return;
    const scope = keyScope(sheet.pk);
    if (!scope) return; // no recurrence on collections (no timeline to walk)
    const n = Math.max(1, parseInt(editRepeat.n, 10) || 1);
    // Timed reminders only apply to day-scope recurrences
    const time =
      scope === "day" && /^\d{2}:\d{2}$/.test(editRepeat.time)
        ? editRepeat.time
        : undefined;
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

  // A newer build is precached and waiting. Show a plainly labelled banner so
  // the user can reload in place (no app restart) whenever it suits them.
  const [updateReady, setUpdateReady] = useState(getUpdateReady());
  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);

  // Install-to-home-screen nudge (spec §3, §12 step 9). The banner appears
  // after the first capture (see submitEntry); the menu keeps a permanent
  // "Install app" row as a fallback.
  const install = useInstallState();

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
          (e.state === "migrated" ? " isMigrated" : "") +
          (e.state === "scheduled" ? " isScheduled" : "")
        }
        onClick={() =>
          e.type === "task" ? toggleDone(e.id) : cycleType(e.id)
        }
        title={e.type === "task" ? "Tap to complete" : "Tap to change type"}
        aria-label={`${e.type}, ${e.state}`}
      >
        {e.state === "done" || e.state === "migrated" || e.state === "scheduled"
          ? STATE_GLYPH[e.state]
          : GLYPH[e.type]}
      </button>
      <span
        className={
          "etext" +
          (e.state === "done" ? " isDone" : "") +
          (e.state === "struck" ? " isStruck" : "") +
          (e.state === "migrated" ? " isMigrated" : "") +
          (e.state === "scheduled" ? " isScheduled" : "")
        }
      >
        {e.priority && <span className="prio">*</span>}
        {e.inspiration && <span className="insp">!</span>}
        {e.text}
        {e.remindAt && (
          <span
            // 13px line box: keeps the small meta text from stretching the
            // entry's 22px grid row via inline baseline alignment
            style={{
              fontSize: 11.5,
              lineHeight: "13px",
              color: "var(--ink-soft)",
              marginLeft: 8,
            }}
          >
            remind {fmtRemind(e.remindAt)}
          </span>
        )}
        {e.recurrenceId && (
          <span
            // 13px line box: keeps the small meta text from stretching the
            // entry's 22px grid row via inline baseline alignment
            style={{
              fontSize: 11.5,
              lineHeight: "13px",
              color: "var(--ink-soft)",
              marginLeft: 8,
            }}
          >
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

  // When-label for a scheduled row: inside a month group the heading
  // already names the month, so day rows shrink to weekday + day
  const whenLabel = (pk: string, grouped: boolean): string => {
    const sc = keyScope(pk);
    if (!grouped) return pageLabel(pk);
    if (sc === "day")
      return fmt(toDate(pk), { weekday: "short", day: "numeric" });
    if (sc === "month") return "whole month";
    if (sc === "year") return "during the year";
    return pageLabel(pk);
  };

  const renderScheduledRow = (row: ScheduledRow, grouped: boolean) =>
    row.kind === "entry" ? (
      <li key={row.entry.id} className="entry">
        <span className="bullet" aria-hidden="true">
          &lt;
        </span>
        <span className="etext">
          {row.entry.priority && <span className="prio">*</span>}
          {row.entry.text}
          <span
            // 13px line box: keeps the small meta text from stretching the
            // entry's 22px grid row via inline baseline alignment
            style={{
              fontSize: 11.5,
              lineHeight: "13px",
              color: "var(--ink-soft)",
              marginLeft: 8,
            }}
          >
            {whenLabel(row.pk, grouped)}
            {(() => {
              const rule =
                row.entry.recurrenceId &&
                recurrences.find(
                  (r) => r.id === row.entry.recurrenceId && !r.endedAt
                );
              return rule
                ? ` — repeats ${cadenceLabel(rule.everyN, rule.unit)}`
                : null;
            })()}
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
      // Rule previews are projections — the real entry is created when the
      // day arrives. Full ink, same as every other row (decision of 22 July
      // 2026): the "repeats …" note carries the distinction in words, and ⋯
      // opens the rule's own actions (skip this occurrence, stop repeating)
      <li key={`rule-${row.rule.id}`} className="entry">
        <span className="bullet" aria-hidden="true">
          &lt;
        </span>
        <span className="etext">
          {row.rule.priority && <span className="prio">*</span>}
          {row.rule.text}
          <span
            // 13px line box: keeps the small meta text from stretching the
            // entry's 22px grid row via inline baseline alignment
            style={{
              fontSize: 11.5,
              lineHeight: "13px",
              color: "var(--ink-soft)",
              marginLeft: 8,
            }}
          >
            {whenLabel(row.dayKey, grouped)} — repeats{" "}
            {cadenceLabel(row.rule.everyN, row.rule.unit)}
          </span>
        </span>
        <span className="actions">
          <button
            className="miniBtn moreBtn"
            onClick={() =>
              setRuleSheet({ ruleId: row.rule.id, dayKey: row.dayKey })
            }
            aria-label="Repeating entry actions"
            aria-haspopup="dialog"
          >
            ⋯
          </button>
        </span>
      </li>
    );

  return (
    <div style={{ ...S.page, ["--grid" as string]: `${GRID}px` }}>
      <header style={S.header}>
        <div style={S.brandRow}>
          <span style={S.brand}>Journlet</span>
          <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            {view !== "spread" && (
              <button className="miniBtn" onClick={goBack}>
                back
              </button>
            )}
            {/* Menu opens from home only; every sub-screen uses "back" */}
            {view === "spread" && (
              <button className="miniBtn" onClick={() => setView("menu")}>
                menu
              </button>
            )}
            {/* Transient cue while the local IndexedDB write is in
                flight; the sync badge is the persistent status */}
            {saveState === "saving" && (
              <span style={S.saveDot}>saving…</span>
            )}
            {/* Sync pinned to the far right — a persistent status present
                on every screen, so it lives in one consistent spot. On the
                sync screen it stays put as a status but doesn't re-navigate. */}
            <button
              className="miniBtn"
              style={
                SYNC_ATTENTION.includes(syncStatus)
                  ? { color: "var(--danger)", borderColor: "var(--danger-line)" }
                  : undefined
              }
              onClick={() => {
                if (view !== "sync") setView("sync");
              }}
            >
              {SYNC_BADGE[syncStatus]}
            </button>
          </span>
        </div>
      </header>

      <main style={S.paper}>
        <div style={S.paperInner}>
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
            futureCount={futureLogCount}
            onOpenCollection={(id) => setView({ col: id })}
            onOpenFutureLog={() => setView("future")}
            onNewCollection={() => setNewCol({ name: "", kind: "list" })}
          />
        )}
        {loaded && view === "sync" && (
          <SyncView />
        )}
        {loaded && view === "menu" && (
          <MenuView
            syncStatus={syncStatus}
            theme={themePref}
            onSetTheme={changeTheme}
            installMode={install.mode}
            canPromptInstall={install.canPrompt}
            onInstall={() => void install.promptInstall()}
            onOpenIndex={() => setView("index")}
            onOpenSync={() => setView("sync")}
            onExport={() => {
              const md = buildMarkdown(days, collections, habits);
              const blob = new Blob([md], { type: "text/markdown" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `journlet-export-${todayKey()}.md`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          />
        )}
        {loaded && activeCol && (
          <CollectionView
            collection={activeCol}
            entries={days[colPageKey(activeCol.id)] || []}
            habits={habits.filter((h) => h.collectionId === activeCol.id)}
            renderEntry={(e) => renderEntry(e, colPageKey(activeCol.id), null)}
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
            {/* 13px line box so the smaller text can't stretch the
                banner's 22px line and push content off the grid */}
            <span style={{ fontSize: 12.5, lineHeight: "13px" }}>
              Review and migrate ›
            </span>
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
            // Browsing a future week/month/year: also list everything
            // scheduled *within* the period (on finer-grained pages or as
            // recurrence previews) — the page's own entries alone would
            // contradict the Future log
            const withinRows =
              sc !== "day" && isFuture
                ? scheduledRows.filter((r) => {
                    const rpk = r.kind === "entry" ? r.pk : r.dayKey;
                    if (rpk === pk) return false;
                    const anchor = keyToAnchor(rpk);
                    return periodKey(sc, anchor) === pk;
                  })
                : [];
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
                        ? "future"
                        : "past"}
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
                {sc === "month" && isCurrent && laterThisMonth.length > 0 && (
                  <>
                    <div style={S.subGroupLabel}>Later this month</div>
                    <ul style={S.list}>
                      {laterThisMonth.map((row) =>
                        renderScheduledRow(row, true)
                      )}
                    </ul>
                  </>
                )}
                {withinRows.length > 0 && (
                  <>
                    <div style={S.subGroupLabel}>
                      Scheduled in {pageLabel(pk)}
                    </div>
                    <ul style={S.list}>
                      {withinRows.map((row) =>
                        renderScheduledRow(row, sc !== "year")
                      )}
                    </ul>
                  </>
                )}
              </section>
            );
          })}
        {/* Future log lives on its own page, like the front of a physical
            journal (spec §4.2, revised 21 July 2026) — the spread keeps only
            a one-line summary link so the "now" page stays uncluttered */}
        {loaded && view === "spread" && futureLogCount > 0 && (
          <button
            className="indexRow"
            style={S.futureLogLink}
            onClick={() => setView("future")}
          >
            <span style={{ fontWeight: 600 }}>Future log</span>
            <span
              style={{ fontSize: 11.5, lineHeight: "13px", color: "var(--ink-soft)" }}
            >
              {futureLogCount} item{futureLogCount === 1 ? "" : "s"} · from
              next month on ›
            </span>
          </button>
        )}
        {loaded && view === "future" && (
          <FutureLogView
            count={futureLogCount}
            groups={futureLogGroups}
            folds={folds}
            onToggleFold={toggleFold}
            renderRow={renderScheduledRow}
          />
        )}
        </div>
      </main>

      {activeCol?.kind !== "habits" && view !== "sync" && view !== "menu" && (
      <footer style={S.captureWrap}>
        <div style={S.launcher}>
          <button
            className="launcherField"
            onClick={() => setCaptureOpen(true)}
            aria-label="Log an entry — opens the entry form"
          >
            <span style={S.captureGlyph}>{GLYPH[captureType]}</span>
            <span style={S.launcherHint}>
              {activeCol ? `Log into ${activeCol.name}…` : "Log an entry…"}
            </span>
            <span style={S.launcherPrefs}>
              {(activeCol
                ? [captureType]
                : [
                    captureScope === "date" ? "date…" : captureScope,
                    captureType,
                  ]
              )
                .concat(capturePriority ? ["*"] : [])
                .concat(captureInspiration ? ["!"] : [])
                .join(" · ")}
            </span>
          </button>
          <button
            className="launcherGo"
            onClick={() => setCaptureOpen(true)}
            aria-label="Log — opens the entry form"
          >
            <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>
              +
            </span>
            Log
          </button>
        </div>
        <div style={S.legend}>
          tap a task's bullet to complete it · ⋯ for entry actions
        </div>
      </footer>
      )}

      {ruleSheet &&
        (() => {
          const rule = recurrences.find((r) => r.id === ruleSheet.ruleId);
          if (!rule) return null;
          return (
            <RuleActionsSheet
              rule={rule}
              dayKey={ruleSheet.dayKey}
              onClose={() => setRuleSheet(null)}
              cadenceLabel={cadenceLabel}
            />
          );
        })()}

      {captureOpen && (
        <CaptureForm
          inputRef={inputRef}
          input={input}
          setInput={setInput}
          submitEntry={submitEntry}
          closeCapture={closeCapture}
          justLogged={justLogged}
          activeCol={activeCol}
          today={today}
          captureScope={captureScope}
          setCaptureScope={setCaptureScope}
          captureType={captureType}
          setCaptureType={setCaptureType}
          capturePriority={capturePriority}
          setCapturePriority={setCapturePriority}
          captureInspiration={captureInspiration}
          setCaptureInspiration={setCaptureInspiration}
          customDate={customDate}
          setCustomDate={setCustomDate}
          customGran={customGran}
          setCustomGran={setCustomGran}
        />
      )}

      {toast && (
        <div style={S.toast} role="status">
          <span>{toast.colSnap ? "Collection deleted" : "Entry deleted"}</span>
          <button className="toastBtn" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      {updateReady && (
        <div style={S.updateBar} role="status">
          <span>New version ready</span>
          <button className="toastBtn" onClick={() => void applyUpdate()}>
            Reload
          </button>
        </div>
      )}

      {install.showBanner && (
        // Docked above the capture bar. Stacks above the update snackbar when
        // both are showing so they never overlap.
        <div
          style={{ ...S.installBar, bottom: updateReady ? 214 : 150 }}
          role="status"
        >
          {install.mode === "prompt" ? (
            <>
              <span style={S.installText}>Install Journlet for instant access</span>
              <div style={S.installActions}>
                <button
                  className="toastBtn"
                  onClick={() => void install.promptInstall()}
                >
                  Install
                </button>
                <button
                  className="toastBtn"
                  style={S.installDismiss}
                  aria-label="Dismiss install prompt"
                  onClick={install.dismissBanner}
                >
                  Not now
                </button>
              </div>
            </>
          ) : install.mode === "ios-safari" ? (
            <>
              <span style={S.installText}>
                Add Journlet to your Home Screen: tap Share, then “Add to Home
                Screen”.
              </span>
              <button
                className="toastBtn"
                style={S.installDismiss}
                aria-label="Dismiss install prompt"
                onClick={install.dismissBanner}
              >
                Got it
              </button>
            </>
          ) : (
            // ios-other: no Add to Home Screen here; steer to Safari.
            <>
              <span style={S.installText}>
                To install, open journlet.com in Safari, then Share → “Add to
                Home Screen”.
              </span>
              <button
                className="toastBtn"
                style={S.installDismiss}
                aria-label="Dismiss install prompt"
                onClick={install.dismissBanner}
              >
                Got it
              </button>
            </>
          )}
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
                      ? { border: "1.5px solid var(--ink)", fontWeight: 600 }
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
                <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 4px 12px" }}>
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
                        style={{ fontSize: 11.5, color: "var(--ink-soft)", marginLeft: 8 }}
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
        <EntryActionsSheet
          sheet={sheet}
          sheetEntry={sheetEntry}
          sheetHistory={sheetHistory}
          sheetNestTarget={sheetNestTarget}
          sheetMigrates={sheetMigrates}
          recurrences={recurrences}
          today={today}
          nowKeys={nowKeys}
          editRepeat={editRepeat}
          setEditRepeat={setEditRepeat}
          editRemind={editRemind}
          setEditRemind={setEditRemind}
          editText={editText}
          setEditText={setEditText}
          schedDate={schedDate}
          setSchedDate={setSchedDate}
          closeSheet={closeSheet}
          saveRepeat={saveRepeat}
          saveReminder={saveReminder}
          cadenceLabel={cadenceLabel}
          deleteWithUndo={deleteWithUndo}
          fmtRemind={fmtRemind}
          toLocalInput={toLocalInput}
          trunc={trunc}
        />
      )}
    </div>
  );
}
