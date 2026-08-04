import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SCOPES,
  dkey,
  fmt,
  keyScope,
  keyToAnchor,
  pageLabel,
  periodKey,
  toDate,
  todayKey,
} from "./lib/dates";
import IndexView from "./IndexView";
import CollectionView from "./CollectionView";
import SyncView from "./SyncView";
import MenuView from "./MenuView";
import { download } from "./lib/download";
import { buildMarkdown } from "./lib/exportMd";
import {
  restoreSnapshot,
  snapshotBytes,
  snapshotFilename,
} from "./lib/snapshot";
import { useInstallState, markCaptured } from "./lib/install";
import {
  applyTheme,
  loadTheme,
  onSystemThemeChange,
  saveTheme,
} from "./lib/theme";
import type { ThemePref } from "./lib/theme";
import {
  countUpdates,
  getJournalKeyCode,
  getSyncError,
  getSyncStatus,
  hasSyncedOnce,
  isConfigured,
  askToBeAddedBack,
  signOutAndWipe,
  getLinkCode,
  getLinkStage,
  wasRemoved,
  onSyncStatus,
  retryConnect,
} from "./store/sync";
import type { SyncStatus } from "./store/sync";
import { logVolumeMetrics } from "./store/metrics";
import { colPageKey } from "./lib/types";
import type { CollectionKind } from "./lib/types";
import {
  colIdFromKey,
  isColPageKey,
  pageRefLabel,
  threadedHere,
} from "./lib/threads";
import {
  addCollection,
  addRecurrence,
  removeCollection,
  restoreCollection,
  setParent,
  setReminder,
  tagEntryRecurrence,
} from "./store/journal";
import type { RecurrenceUnit } from "./lib/types";
import {
  notificationPermission,
  requestNotificationPermission,
} from "./store/reminders";
import type { CollectionSnapshot } from "./store/journal";
import type { Scope } from "./lib/dates";
import { GLYPH, STATE_GLYPH } from "./lib/types";
import type { Entry } from "./lib/types";
import { GRID } from "./lib/grid";
import DetailsForm from "./ui/DetailsForm";
import {
  loadFilter,
  loadFilterOpen,
  saveFilter,
  saveFilterOpen,
} from "./lib/filter";
import type { EntryFilter } from "./lib/filter";
import { loadSticky, saveSticky } from "./lib/sticky";
import type { CaptureScope } from "./lib/sticky";
import {
  addEntry,
  cycleType,
  removeEntry,
  restoreEntry,
  toggleDone,
} from "./store/journal";
import { useJournal } from "./store/useJournal";
import { applyUpdate, getUpdateReady, onUpdateReady } from "./store/appUpdate";
import { S } from "./ui/styles";
import FilterRow from "./ui/FilterRow";
import FutureLogView from "./ui/FutureLogView";
import CaptureForm from "./ui/CaptureForm";
import EntryActionsSheet from "./ui/EntryActionsSheet";
import RuleActionsSheet from "./ui/RuleActionsSheet";
import NewCollectionDialog from "./ui/NewCollectionDialog";
import ReviewMigrateSheet from "./ui/ReviewMigrateSheet";
import UndoToast from "./ui/UndoToast";
import SpreadView from "./ui/SpreadView";
import SearchView from "./ui/SearchView";
import { EMPTY_RESULTS, searchJournal } from "./lib/search";
import Header from "./ui/Header";
import CaptureLauncher from "./ui/CaptureLauncher";
import OnboardingView from "./ui/OnboardingView";
import RecoveryCodeView from "./ui/RecoveryCodeView";
import UnlockView from "./ui/UnlockView";
import LinkPrompts from "./ui/LinkPrompts";
import CannotLoadView from "./ui/CannotLoadView";
import NotSyncingBanner, { isNotSyncing } from "./ui/NotSyncingBanner";
import {
  cannotLoadYet,
  isSettling,
  needsJournalKey,
  needsOnboarding,
  needsRecoveryCode,
} from "./lib/onboarding";
import { acknowledgeRecovery, recoveryPending } from "./lib/recoveryAck";
import { buildSpreadData } from "./ui/spreadData";
import type { EditRepeat, ScheduledRow, SheetTarget } from "./ui/types";

interface DeletedToast {
  entry?: Entry;
  colSnap?: CollectionSnapshot;
}

type View =
  | "spread"
  | "index"
  | "sync"
  | "menu"
  | "future"
  | "search"
  | { col: string };

// Future log fold state is a device preference, not journal content —
// kept local like sticky capture state, never synced
const FOLDS_KEY = "journlet-futurelog-folds";

// Honour the OS "reduce motion" setting for scripted scrolling, as the CSS
// already does for its transitions
const scrollBehaviour = (): ScrollBehavior =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

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
  // Optional details for the entry being captured; per-entry, so not sticky —
  // cleared after each log alongside the text (spec §9)
  const [captureDetails, setCaptureDetails] = useState("");
  // Parent for the entry being captured, when capture was opened from an
  // entry's "Add a sub-bullet" action (spec §4.1). Holds the parent's id and
  // page so the child lands beside it; stays set for a run of sub-bullets,
  // and is cleared when the form closes. Null = ordinary top-level capture.
  const [captureParent, setCaptureParent] = useState<{
    id: string;
    pk: string;
  } | null>(null);
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
  // Draft details text while the sheet's "details" sub-form is open (null = closed)
  // Entry whose details are open in the full-screen view (null = closed).
  const [detailsEntry, setDetailsEntry] = useState<Entry | null>(null);
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
  // Thread-to-a-page sub-view of the ⋯ sheet: null = closed, otherwise the
  // current filter text (spec §4.4). A sub-view rather than inline buttons so
  // the sheet's length doesn't grow with the number of collections.
  const [threadFilter, setThreadFilter] = useState<string | null>(null);
  // "Nest under…" sub-view of the ⋯ sheet: null = closed, otherwise the
  // current filter text. Every top-level entry on the page is a candidate
  // parent, so like the thread picker this is a sub-view rather than a row of
  // buttons — the sheet's length can't grow with the size of the page.
  const [nestFilter, setNestFilter] = useState<string | null>(null);
  // Set when a nest was refused because the page changed under the picker
  // (another device deleted or moved something). Shown rather than swallowed —
  // an action that appears to do nothing is the app lying about what happened.
  const [nestRefused, setNestRefused] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<EditRepeat | null>(null);
  const [toast, setToast] = useState<DeletedToast | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // Entry visibility filter (remediation item 7). A device preference like
  // theme and sticky capture, not journal content — never synced, so one
  // device reading "open only" doesn't change what another shows.
  const [filter, setFilterState] = useState<EntryFilter>(loadFilter);
  const changeFilter = useCallback((f: EntryFilter) => {
    setFilterState(f);
    saveFilter(f);
  }, []);
  // The row is chrome, so it starts closed behind the header badge and only a
  // row you opened yourself stays open across launches. Closing it never
  // changes what is filtered — the badge keeps saying which filter is on, so
  // a filtered page is still explained with the control out of sight.
  const [filterOpen, setFilterOpen] = useState<boolean>(loadFilterOpen);
  const toggleFilterRow = useCallback(() => {
    setFilterOpen((o) => {
      saveFilterOpen(!o);
      return !o;
    });
  }, []);
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
  // Search (spec §10). The query is view state, not journal content — it is
  // deliberately not kept when you leave the screen, so search never becomes
  // a filter you forgot you left on.
  const [query, setQuery] = useState("");
  // The entry a search result sent you to, marked on the page for a few
  // seconds so you can see which line it meant among the ones around it.
  const [foundEntry, setFoundEntry] = useState<string | null>(null);
  const foundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The id last scrolled to, so a re-render doesn't yank the page back
  const scrolledTo = useRef<string | null>(null);
  // Drop the mark whenever you navigate: it answers "which line did I mean",
  // and once you have left that page the question is gone. Without this it
  // would still be waiting on the page days later if you came back inside
  // the timeout.
  const clearFound = useCallback(() => {
    if (foundTimer.current) clearTimeout(foundTimer.current);
    foundTimer.current = null;
    scrolledTo.current = null;
    setFoundEntry(null);
  }, []);
  useEffect(() => clearFound, [clearFound]);

  const [view, setViewRaw] = useState<View>("spread");
  // A small navigation stack so the header "back" returns to the screen you
  // came from (e.g. menu → index → back lands on the menu), not always the
  // journal. setView pushes the current view; goBack pops it.
  const viewRef = useRef<View>("spread");
  viewRef.current = view;
  const navHistory = useRef<View[]>([]);
  const setView = useCallback(
    (next: View) => {
      clearFound();
      navHistory.current.push(viewRef.current);
      setViewRaw(next);
    },
    [clearFound]
  );
  const goBack = useCallback(() => {
    clearFound();
    setViewRaw(navHistory.current.pop() ?? "spread");
  }, [clearFound]);

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

  // Derived view-model (nowKeys, past/future/due lists, future-log grouping).
  // Pure — see ./ui/spreadData.
  const {
    nowKeys,
    pastOpen,
    scheduledRows,
    laterThisMonth,
    futureLogGroups,
    futureLogCount,
    dueItems,
  } = buildSpreadData(days, recurrences, today);

  // Collection currently open, if any
  const activeCol =
    typeof view === "object"
      ? collections.find((c) => c.id === view.col) ?? null
      : null;

  // Pages the filter applies to: the spread, the future log, and a list
  // collection. A habit tracker holds no entries, and Index, Find, Menu and
  // Sync are not the journal — the header badge stays off all of those rather
  // than offering a control that would do nothing.
  const filterApplies =
    view === "spread" ||
    view === "future" ||
    (activeCol !== null && activeCol.kind === "list");

  // Whether this device holds any journal content. Gates the "not syncing"
  // banner (remediation item 11) so a brand-new empty install stays quiet,
  // but any device with entries at risk of loss is warned.
  const hasLocalContent =
    collections.length > 0 ||
    habits.length > 0 ||
    Object.values(days).some((arr) => arr.length > 0);

  // Sub-bullet capture context (spec §4.1). Declared above submitEntry, which
  // lists it as a dependency — a dependency array is evaluated the moment the
  // callback is created, so anything in it must already exist by this line.
  //
  // The parent is resolved fresh each render so a change elsewhere is
  // reflected. Three ways it can stop being usable, and the form has to say
  // which — logging the entry somewhere it wasn't promised is exactly what the
  // no-guessing rule forbids.
  const captureParentEntry: Entry | null = captureParent
    ? (days[captureParent.pk] || []).find((x) => x.id === captureParent.id) ??
      null
    : null;
  // A pinned collection page can be deleted outright, taking the page with it.
  // The pin must then be dropped, or the entry would land on a page that no
  // longer exists — reachable from no spread, no index, no export.
  const capturePageGone = Boolean(
    captureParent &&
      isColPageKey(captureParent.pk) &&
      !collections.some((c) => c.id === colIdFromKey(captureParent.pk))
  );
  const captureLost: string | null = !captureParent
    ? null
    : capturePageGone
      ? "The collection you were logging into has been deleted."
      : !captureParentEntry
        ? "The entry you were nesting under has gone."
        : captureParentEntry.parentId
          ? "The entry you were nesting under is now a sub-bullet itself, so it can't take sub-bullets."
          : null;
  // Only a top-level entry can take sub-bullets, so the form must stop claiming
  // to nest the moment its parent becomes one itself
  const captureParentUsable: Entry | null = captureLost
    ? null
    : captureParentEntry;
  // The page a pinned capture lands on, or null once the pin is dropped
  const capturePinnedPk = capturePageGone ? null : captureParent?.pk ?? null;

  const submitEntry = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    // A sub-bullet belongs beside its parent, so the pinned page wins over the
    // scope buttons — which the form hides for exactly as long as it is pinned.
    // The pin is dropped if its page is deleted, so this can't name a dead page.
    const pk =
      capturePinnedPk ??
      (activeCol
        ? colPageKey(activeCol.id)
        : captureScope === "date"
          ? periodKey(customGran, customDate)
          : nowKeys[captureScope]);
    addEntry(
      pk,
      captureType,
      text,
      capturePriority,
      captureInspiration,
      captureDetails,
      captureParentUsable?.id
    );
    // First entry logged on this device unlocks the install nudge (see
    // lib/install): let people feel capture work once, then offer to install.
    markCaptured();
    setInput("");
    setCaptureDetails("");
    // The form stays open for a run of entries (decision of 22 July 2026,
    // restoring §4.1's batch-logging intent); a confirmation line shows
    // each entry landed. "Done" closes.
    setJustLogged(
      text.length > 40 ? text.slice(0, 39) + "…" : text
    );
    inputRef.current?.focus();
  }, [input, captureDetails, capturePinnedPk, captureParentUsable, activeCol, captureScope, captureType, capturePriority, captureInspiration, customDate, customGran, nowKeys]);

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
    setCaptureDetails("");
    setCaptureParent(null);
  };

  /**
   * Nest the sheet's entry under the chosen parent. Closes the picker when it
   * worked; when the store refuses — only possible if the page changed while
   * the picker was open — the picker stays put and says so, so the tap is never
   * a silent no-op.
   */
  const nestUnder = (parentId: string) => {
    if (!sheet) return;
    if (setParent(sheet.id, parentId)) {
      setNestRefused(null);
      setNestFilter(null);
    } else {
      setNestRefused(
        "That entry can no longer take sub-bullets — the page changed. Pick another."
      );
    }
  };

  /** Open capture with the entry pre-set as parent, for a run of sub-bullets */
  const openSubBulletCapture = (parentId: string, pk: string) => {
    setCaptureParent({ id: parentId, pk });
    setInput("");
    setCaptureDetails("");
    setJustLogged(null);
    closeSheet();
    setCaptureOpen(true);
  };

  const closeSheet = () => {
    setSheet(null);
    setEditText(null);
    setEditRemind(null);
    setEditRepeat(null);
    setThreadFilter(null);
    setNestFilter(null);
    setNestRefused(null);
    setSchedDate("");
  };

  // Open the full-screen details view for an entry (from its row or the ⋯
  // sheet); closing the sheet first keeps a single dialog on screen.
  const openDetails = (entry: Entry) => {
    closeSheet();
    setDetailsEntry(entry);
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

  // Fresh install with sync configured: sign in before there is a journal at
  // all (decision 3, spec device-identity-design.md). Deliberately not applied
  // to a signed-out device that already holds content — see lib/onboarding.
  const onboarding = needsOnboarding({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    hasLocalContent,
  });

  // Signed in but unable to open the journal: ask for the key rather than
  // rendering an empty spread, which reads as a journal that has lost its
  // contents (see lib/onboarding).
  const [removed, setRemoved] = useState(wasRemoved());
  const [asking, setAsking] = useState(false);
  const unlocking = needsJournalKey({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    hasLocalContent,
    // The one case allowed to hide a journal that exists, because hiding it is
    // the point: access was taken away deliberately from another device.
    removed,
  });

  // Signed in, holding nothing, and has never managed to fetch the journal.
  // Rendering an empty journal here reads as data loss (reported 29 Jul), so it
  // says what is happening and offers a retry instead.
  const [syncedOnce, setSyncedOnce] = useState(hasSyncedOnce());
  const [retrying, setRetrying] = useState(false);
  useEffect(() => setSyncedOnce(hasSyncedOnce()), [syncStatus]);
  const gateInput = {
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    hasLocalContent,
    syncedOnce,
  };
  // Still working out which screen applies. Without this the journal rendered
  // empty for the second or so before the answer arrived.
  const settling = isSettling(gateInput);
  const stuck = cannotLoadYet({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    hasLocalContent,
    syncedOnce,
  });

  // The code this device is displaying while it waits to be approved. Read off
  // the same status notifications, since the engine publishes the request as part
  // of arriving at needs-key.
  const [linkCode, setLinkCode] = useState(getLinkCode());
  const [linkStage, setLinkStage] = useState(getLinkStage());
  useEffect(
    () =>
      onSyncStatus(() => {
        setLinkCode(getLinkCode());
        setLinkStage(getLinkStage());
        setRemoved(wasRemoved());
      }),
    []
  );

  // Second stage of first run: the recovery code, shown once before the journal
  // on the device that created it (decision 4). Re-read on every status change
  // so it clears as soon as it is acknowledged.
  const [recoveryPend, setRecoveryPend] = useState(recoveryPending());
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  // The flag is written by the sync engine when it creates the journal, which
  // happens well after this component mounts, so reading it once at mount would
  // miss the only case it exists for: signing in on a fresh install.
  useEffect(() => setRecoveryPend(recoveryPending()), [syncStatus]);
  const showRecovery = needsRecoveryCode({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    pending: recoveryPend,
  });
  useEffect(() => {
    if (!showRecovery || recoveryCode) return;
    // If the code cannot be read there is nothing useful to show, so let the
    // journal through rather than blocking on a screen with a gap in it. It
    // stays readable later under Sync.
    const giveUp = () => {
      acknowledgeRecovery();
      setRecoveryPend(false);
    };
    // Null as well as a rejection. A device with no usable keeper key has no code
    // to show, and leaving recoveryCode null would re-run this effect forever
    // behind a screen with a gap in it. It should not happen — only the device
    // that created the journal is marked, and that device has a working key — but
    // an infinite loop is not the way to find that out.
    getJournalKeyCode().then((code) => (code ? setRecoveryCode(code) : giveUp()), giveUp);
  }, [showRecovery, recoveryCode]);

  // Volume-size instrumentation (remediation item 15): log the encoded doc
  // size and the update-log row count once the journal has opened, and again
  // when it reaches "synced". Non-user-facing; feeds the future close nudge.
  useEffect(() => {
    if (!loaded) return;
    void countUpdates().then((rows) => logVolumeMetrics(rows ?? undefined));
  }, [loaded, syncStatus]);

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

  // Nesting context (spec §4.1). A child is drawn under its parent wherever
  // the parent sits, so any top-level entry on the page can be the parent —
  // not just the one immediately above. Nesting is one level deep, so an entry
  // that already has children of its own can't itself become a child.
  const sheetPageList = sheet ? days[sheet.pk] || [] : [];
  const sheetHasChildren = sheetEntry
    ? sheetPageList.some((x) => x.parentId === sheetEntry.id)
    : false;
  // Candidate parents. `days` is already resolved by store/pageOrder, so an
  // entry drawn at top level is offered as a parent and the store will accept
  // it — the two can't disagree.
  const sheetNestTargets: Entry[] =
    !sheet || !sheetEntry || sheetHasChildren
      ? []
      : sheetPageList.filter(
          (x) =>
            !x.parentId && x.id !== sheet.id && x.id !== sheetEntry.parentId
        );
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

  // Open any page by its key — a collection or a period page. Used by the
  // threading affordances (spec §4.4), where the reference is a page number
  // and following it has to land you on that page whichever kind it is.
  const openPage = (pk: string) => {
    if (isColPageKey(pk)) {
      const id = colIdFromKey(pk);
      if (collections.some((c) => c.id === id)) setView({ col: id });
      return;
    }
    const sc = keyScope(pk);
    if (!sc) return;
    setAnchors((a) => ({ ...a, [sc]: keyToAnchor(pk) }));
    setView("spread");
  };

  // Every entry is already in memory here, so search is a filter rather than
  // an index — see lib/search. Gated on the view as well as the query: every
  // edit, habit mark and sync update replaces `days`, and without the gate a
  // stale query would rescan the whole journal on each one for the rest of
  // the session, from screens with no search on them.
  const searchResults = useMemo(
    () =>
      view === "search"
        ? searchJournal(query, days, collections, habits)
        : EMPTY_RESULTS,
    [view, query, days, collections, habits]
  );

  // Follow a search result to the page it lives on. The entry is never moved
  // or copied: you are taken to where it was written, exactly as turning to a
  // page number would, and it is marked there for a few seconds.
  // Search always opens empty. The last query is not a place you left off —
  // it belongs to the entry you were hunting, and that hunt is over.
  const openSearch = useCallback(() => {
    setQuery("");
    setView("search");
  }, [setView]);

  const openFoundEntry = (pk: string, id: string) => {
    // openPage navigates, which clears any previous mark — so set this one
    // afterwards
    openPage(pk);
    setFoundEntry(id);
    foundTimer.current = setTimeout(() => setFoundEntry(null), 4000);
  };

  const renderEntry = (e: Entry, pk: string, sc: Scope | null) => (
    <li
      key={e.id}
      className={
        "entry" +
        (e.parentId ? " isSub" : "") +
        (foundEntry === e.id ? " isFound" : "")
      }
      ref={(el) => {
        // Bring a searched-for entry into view once, when the page it lives
        // on renders. Guarded so later re-renders leave your scroll alone.
        if (!el || foundEntry !== e.id || scrolledTo.current === e.id) return;
        scrolledTo.current = e.id;
        el.scrollIntoView({ block: "center", behavior: scrollBehaviour() });
        // The yellow mark is no use to a screen reader, and following a
        // result would otherwise drop focus onto <body> — leaving a keyboard
        // user scrolled somewhere they have to tab back to from the top.
        el.focus({ preventScroll: true });
      }}
      // Focusable only as a landing spot, never in the tab order
      tabIndex={foundEntry === e.id ? -1 : undefined}
    >
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
        {e.priority && <span className="prio"><i>*</i></span>}
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
        {e.details && (
          <button
            className="detailsToggle"
            onClick={(ev) => {
              ev.stopPropagation();
              openDetails(e);
            }}
            aria-label="Open details"
          >
            ▸ details
          </button>
        )}
        {/* Page references (spec §4.4): the margin page number. Plain words,
            on the entry's own line box so the row stays one dot-grid line,
            and never a notation glyph — the entry's • ○ — × is untouched. */}
        {e.threads?.map((t) => (
          <button
            key={t}
            className="detailsToggle"
            onClick={(ev) => {
              ev.stopPropagation();
              openPage(t);
            }}
            aria-label={`Open ${pageRefLabel(t, collections)}`}
          >
            threaded to {pageRefLabel(t, collections)}
          </button>
        ))}
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

  // The reciprocal page number (spec §4.4): entries elsewhere that reference
  // this page. Derived from their own threads field, never stored twice, and
  // read-only here — an entry is edited on the page it lives on. Muted ink so
  // the page's own entries stay the page.
  const renderThreadedHere = (pk: string) => {
    const rows = threadedHere(pk, days);
    if (rows.length === 0) return null;
    return (
      <>
        <div style={S.subGroupLabel}>Threaded here from other pages</div>
        <ul style={S.list}>
          {rows.map((e) => (
            <li key={`th-${e.id}`} className="entry">
              <span className="bullet isMigrated" aria-hidden="true">
                {e.state === "done" ||
                e.state === "migrated" ||
                e.state === "scheduled"
                  ? STATE_GLYPH[e.state]
                  : GLYPH[e.type]}
              </span>
              <span
                className={
                  "etext" + (e.state === "struck" ? " isStruck" : "")
                }
                style={{ color: "var(--ink-soft)" }}
              >
                {e.priority && <span className="prio"><i>*</i></span>}
                {e.text}
                <button
                  className="detailsToggle"
                  onClick={() => openPage(e.pageKey)}
                  aria-label={`Open ${pageRefLabel(e.pageKey, collections)}`}
                >
                  on {pageRefLabel(e.pageKey, collections)}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  };

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
          {row.entry.priority && <span className="prio"><i>*</i></span>}
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
          {row.rule.priority && <span className="prio"><i>*</i></span>}
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
      <Header
        showBack={
          !onboarding &&
          !unlocking &&
          !showRecovery &&
          !stuck &&
          !settling &&
          view !== "spread"
        }
        showMenu={
          !onboarding &&
          !unlocking &&
          !showRecovery &&
          !stuck &&
          !settling &&
          view === "spread"
        }
        onBack={goBack}
        onMenu={() => setView("menu")}
        filter={
          !onboarding &&
          !unlocking &&
          !showRecovery &&
          !stuck &&
          !settling &&
          loaded &&
          filterApplies
            ? filter
            : null
        }
        filterOpen={filterOpen}
        onToggleFilter={toggleFilterRow}
        saving={saveState === "saving"}
        syncStatus={syncStatus}
        onSyncClick={() => {
          if (view !== "sync") setView("sync");
        }}
      />

      <main style={S.paper}>
        <div style={S.paperInner}>
        {updateReady && (
          <button className="reviewBanner" onClick={() => void applyUpdate()}>
            <span style={{ fontWeight: 600 }}>New version available</span>
            <span style={{ fontSize: 12.5, lineHeight: "13px" }}>Reload ›</span>
          </button>
        )}
        {/* Which states warn is decided in NotSyncingBanner, where a Record
            over SyncStatus makes a new state fail the build until someone
            chooses. This is also the deliberate answer to journalling for
            weeks into a device that is not syncing: capture keeps working
            (§6.1b), so the state has to be impossible to miss instead. */}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && isNotSyncing(syncStatus) && hasLocalContent && view !== "sync" && (
          <NotSyncingBanner onSignIn={() => setView("sync")} />
        )}
        {/* A device asking to be added, shown wherever the journal is. Above the
            not-syncing banner would be wrong — that banner explains why the
            journal in front of you is stale, which is the more urgent thing —
            and inside a particular view would mean the prompt disappears when
            you change view while a device sits waiting. */}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && (
          <LinkPrompts />
        )}
        {!loaded && <div style={S.empty}>opening journal…</div>}
        {onboarding && (
          <OnboardingView>
            <SyncView />
          </OnboardingView>
        )}
        {!onboarding && !unlocking && settling && (
          <div style={S.empty}>opening your journal…</div>
        )}
        {!onboarding && !unlocking && !settling && stuck && (
          <CannotLoadView
            error={getSyncError()}
            offline={syncStatus === "offline"}
            busy={retrying}
            onRetry={() => {
              setRetrying(true);
              void retryConnect().finally(() => setRetrying(false));
            }}
          />
        )}
        {!onboarding && unlocking && (
          <UnlockView
            linkCode={linkCode}
            linkStage={linkStage}
            removed={removed}
            asking={asking}
            onSignOut={() => void signOutAndWipe()}
            onAskAgain={() => {
              setAsking(true);
              void askToBeAddedBack().finally(() => setAsking(false));
            }}
          >
            <SyncView />
          </UnlockView>
        )}
        {!onboarding && !unlocking && showRecovery && recoveryCode && (
          <RecoveryCodeView
            code={recoveryCode}
            onContinue={() => {
              acknowledgeRecovery();
              setRecoveryPend(false);
            }}
          />
        )}
        {/* One filter row on whichever page lists entries — the spread, a list
            collection, the future log. A habit tracker holds no entries, and
            the Index, Search, Menu and Sync pages are not the journal, so the
            control stays off those rather than sitting there doing nothing.
            It is never far from the entries it is filtering, so a filtered
            page cannot be read without the filter in sight.

            Ordering, corrected 4 August 2026 after seeing it on device: the
            row went in above everything, which put it between the not-syncing
            banner and the review banner and left the alerts reading as two
            separate groups either side of a control. Alerts belong together
            at the top, then how you are reading the page, then the page — so
            the spread takes the row as a prop and places it after its own
            review banner, while the other two pages, which carry no banner,
            take it here. */}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded &&
          filterOpen &&
          (view === "future" ||
            (activeCol !== null && activeCol.kind === "list")) && (
          <FilterRow filter={filter} onChange={changeFilter} />
        )}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && view === "index" && (
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
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && view === "search" && (
          <SearchView
            query={query}
            setQuery={setQuery}
            results={searchResults}
            onOpenEntry={openFoundEntry}
            onOpenCollection={(id) => setView({ col: id })}
          />
        )}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && view === "sync" && (
          <SyncView />
        )}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && view === "menu" && (
          <MenuView
            syncStatus={syncStatus}
            theme={themePref}
            onSetTheme={changeTheme}
            installMode={install.mode}
            canPromptInstall={install.canPrompt}
            onInstall={() => void install.promptInstall()}
            onOpenIndex={() => setView("index")}
            onOpenSearch={openSearch}
            onOpenSync={() => setView("sync")}
            onExport={() => {
              const md = buildMarkdown(days, collections, habits);
              download(
                new Blob([md], { type: "text/markdown" }),
                `journlet-export-${todayKey()}.md`
              );
            }}
            onBackup={() => {
              download(
                // Copied into a fresh array because Yjs may hand back a view over
                // a larger buffer, and Blob would then write the whole thing.
                new Blob([new Uint8Array(snapshotBytes())], {
                  type: "application/octet-stream",
                }),
                snapshotFilename(todayKey())
              );
            }}
            onRestore={async (file) => {
              try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const { before, after } = restoreSnapshot(bytes);
                const added = after - before;
                if (added === 0)
                  return "That backup held nothing this journal was missing.";
                return `Restored ${added} ${
                  added === 1 ? "entry" : "entries"
                } from that backup.`;
              } catch (e) {
                // Shown rather than swallowed: the person chose a file and is
                // owed an answer about that file. NotASnapshotError already reads
                // as a sentence; anything else is unexpected and says so.
                return e instanceof Error
                  ? e.message
                  : "That file could not be read.";
              }
            }}
          />
        )}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && activeCol && (
          <CollectionView
            collection={activeCol}
            entries={days[colPageKey(activeCol.id)] || []}
            habits={habits.filter((h) => h.collectionId === activeCol.id)}
            renderEntry={(e) => renderEntry(e, colPageKey(activeCol.id), null)}
            filter={filter}
            threadedHere={renderThreadedHere(colPageKey(activeCol.id))}
            onDelete={() => {
              const snap = removeCollection(activeCol.id);
              setView("index");
              if (snap) showToast({ colSnap: snap });
            }}
          />
        )}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && view === "spread" && (
          <SpreadView
            renderEntry={renderEntry}
            renderScheduledRow={renderScheduledRow}
            renderThreadedHere={renderThreadedHere}
            pastOpen={pastOpen}
            dueItems={dueItems}
            days={days}
            anchors={anchors}
            setAnchors={setAnchors}
            nowKeys={nowKeys}
            scheduledRows={scheduledRows}
            laterThisMonth={laterThisMonth}
            futureLogCount={futureLogCount}
            filter={filter}
            filterRow={
              filterOpen ? (
                <FilterRow filter={filter} onChange={changeFilter} />
              ) : null
            }
            onReview={() => setReviewing(true)}
            onOpenFutureLog={() => setView("future")}
          />
        )}
        {!onboarding && !unlocking && !showRecovery && !stuck && !settling && loaded && view === "future" && (
          <FutureLogView
            count={futureLogCount}
            groups={futureLogGroups}
            folds={folds}
            onToggleFold={toggleFold}
            filter={filter}
            renderRow={renderScheduledRow}
          />
        )}
        </div>
      </main>

      {/* No capture during onboarding: the launcher sits outside <main>, so
          without this an entry could be written into a journal that has no
          account behind it yet, which is the very thing sign-in-first removes. */}
      {!onboarding &&
        !unlocking &&
        !showRecovery &&
        !stuck &&
        !settling &&
        view !== "sync" &&
        view !== "menu" &&
        // Search is a screen for finding, not writing: the bar would sit over
        // the results and the keyboard has the room instead. It is also the
        // one page where a Find button would point at itself.
        view !== "search" && (
        <CaptureLauncher
          onOpen={() => setCaptureOpen(true)}
          onFind={openSearch}
          // A habit tracker holds no entries, so it shows Find alone rather
          // than an entry field that would have nowhere to write to
          canLog={activeCol?.kind !== "habits"}
          activeCol={activeCol}
          captureType={captureType}
          captureScope={captureScope}
          capturePriority={capturePriority}
          captureInspiration={captureInspiration}
        />
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

      {/* Also gated: /?capture opens this form on launch without touching the
          launcher, so an app-icon shortcut would otherwise walk straight past
          onboarding into an entry form. */}
      {!onboarding && !unlocking && !showRecovery && !stuck && !settling && captureOpen && (
        <CaptureForm
          inputRef={inputRef}
          input={input}
          setInput={setInput}
          captureDetails={captureDetails}
          setCaptureDetails={setCaptureDetails}
          captureParent={captureParentUsable}
          captureLost={captureLost}
          captureParentPageLabel={
            capturePinnedPk ? pageRefLabel(capturePinnedPk, collections) : null
          }
          clearCaptureParent={() => setCaptureParent(null)}
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
        <UndoToast isCollection={!!toast.colSnap} onUndo={undoDelete} />
      )}

      {install.showBanner && (
        // Docked above the capture bar.
        <div
          style={{ ...S.installBar, bottom: 150 }}
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
        <NewCollectionDialog
          value={newCol}
          onChange={setNewCol}
          onClose={() => setNewCol(null)}
          onCreate={(kind, name) => {
            const c = addCollection(kind, name);
            setNewCol(null);
            setView({ col: c.id });
          }}
        />
      )}

      {reviewing && (
        <ReviewMigrateSheet
          pastOpen={pastOpen}
          nowKeys={nowKeys}
          onClose={() => setReviewing(false)}
        />
      )}

      {sheet && sheetEntry && (
        <EntryActionsSheet
          sheet={sheet}
          sheetEntry={sheetEntry}
          sheetHistory={sheetHistory}
          sheetNestTargets={sheetNestTargets}
          sheetHasChildren={sheetHasChildren}
          nestFilter={nestFilter}
          setNestFilter={setNestFilter}
          nestRefused={nestRefused}
          onOpenNestPicker={() => {
            // A refusal belongs to the attempt that caused it, never to the
            // next one — otherwise the picker opens already complaining
            setNestRefused(null);
            setNestFilter("");
          }}
          onNestUnder={nestUnder}
          onAddSubBullet={() => openSubBulletCapture(sheet.id, sheet.pk)}
          sheetMigrates={sheetMigrates}
          recurrences={recurrences}
          collections={collections}
          today={today}
          nowKeys={nowKeys}
          editRepeat={editRepeat}
          setEditRepeat={setEditRepeat}
          threadFilter={threadFilter}
          setThreadFilter={setThreadFilter}
          editRemind={editRemind}
          setEditRemind={setEditRemind}
          editText={editText}
          setEditText={setEditText}
          onEditDetails={() => openDetails(sheetEntry)}
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

      {detailsEntry && (
        <DetailsForm
          entry={detailsEntry}
          onClose={() => setDetailsEntry(null)}
        />
      )}
    </div>
  );
}
