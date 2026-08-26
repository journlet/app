import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  SCOPES,
  dkey,
  fmt,
  keyScope,
  endLabel,
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
import FeedbackView from "./ui/FeedbackView";
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
  getSyncSnapshot,
  hasSyncedOnce,
  isConfigured,
  signOutAndWipe,
  subscribeSync,
  retryConnect,
} from "./store/sync";
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
  setRecurrenceEnd,
  tagEntryRecurrence,
} from "./store/journal";
import {
  cadenceLabel,
  endClause,
  repeatCaption,
  ruleSentence,
} from "./store/recurrence";
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
import { loadOrder, saveOrder } from "./lib/order";
import type { EntryOrder } from "./lib/order";
import { loadSticky, saveSticky } from "./lib/sticky";
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
import ReadingBlock from "./ui/ReadingBlock";
import FutureLogView from "./ui/FutureLogView";
import CaptureForm from "./ui/CaptureForm";
import EntryActionsSheet from "./ui/EntryActionsSheet";
import { shouldOpenRow, type TapPoint } from "./lib/rowTap";
import RuleActionsSheet from "./ui/RuleActionsSheet";
import NewCollectionDialog from "./ui/NewCollectionDialog";
import ReviewMigrateSheet from "./ui/ReviewMigrateSheet";
import EarlierOccurrencesSheet from "./ui/EarlierOccurrencesSheet";
import UndoToast from "./ui/UndoToast";
import SpreadView from "./ui/SpreadView";
import SearchView from "./ui/SearchView";
import { EMPTY_RESULTS, searchJournal } from "./lib/search";
import Header from "./ui/Header";
import CaptureLauncher from "./ui/CaptureLauncher";
import OnboardingView from "./ui/OnboardingView";
import SignedOutView from "./ui/SignedOutView";
import RecoveryCodeView from "./ui/RecoveryCodeView";
import UnlockView from "./ui/UnlockView";
import CannotLoadView from "./ui/CannotLoadView";
import StartingView from "./ui/StartingView";
import NotSyncingBanner, { notSyncingReason } from "./ui/NotSyncingBanner";
import {
  cannotLoadYet,
  isSettling,
  isStarting,
  needsJournalKey,
  needsOnboarding,
  needsRecoveryCode,
  needsSignInChoice,
} from "./lib/onboarding";
import { acknowledgeRecovery, recoveryPending } from "./lib/recoveryAck";
import { buildSpreadData } from "./ui/spreadData";
import { buildMigrationHistory } from "./ui/migrationHistory";
import type {
  EditEnds,
  EditRepeat,
  ScheduledRow,
  SheetTarget,
} from "./ui/types";

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
  | "feedback"
  | { col: string };

// Fold state is a device preference, not journal content — kept local like
// sticky capture state, never synced. Keys are namespaced: a Future log month
// is its own page key, the spread's repeating group is `later:<month>`.
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
  const [captureScope, _setCaptureScope] = useState<Scope>(
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
    setCaptureAnchor(todayKey());
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
  // "N earlier still open" on a repeating entry (spec §11 Q15). Keyed on the
  // entry id rather than the list, so the list stays derived and shrinks as
  // decisions are taken inside the sheet.
  const [earlierSheet, setEarlierSheet] = useState<string | null>(null);
  const [editText, setEditText] = useState<string | null>(null);
  // Draft details text while the sheet's "details" sub-form is open (null = closed)
  // Entry whose details are open in the full-screen view (null = closed).
  const [detailsEntry, setDetailsEntry] = useState<Entry | null>(null);
  // Date chosen in the sheet's "Schedule to a future date" control
  const [schedDate, setSchedDate] = useState("");
  // Where the sheet's "Move to" picker is pointing. Set when the sheet opens
  // to the entry's own page, so the picker starts by showing where the entry
  // actually is; a move is a correction rather than a migration, so it has no
  // floor and may reach back into the past.
  const [moveAnchor, setMoveAnchor] = useState(todayKey());
  const [moveGran, setMoveGran] = useState<Scope>("day");
  // Folded groups: Future log months and the spread's repeating group
  // (device preference, see FOLDS_KEY)
  const [folds, setFolds] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLDS_KEY) || "{}");
    } catch {
      return {};
    }
  });
  // `defaultFolded` carries the group's own default, because they differ: a
  // Future log month starts open, "Later this month"'s repeats start folded
  // (spec §11 Q19). Without it the first tap on a folded-by-default group
  // flips `undefined` to `true` and nothing appears to happen.
  const toggleFold = (gk: string, defaultFolded = false) =>
    setFolds((f) => {
      const next = { ...f, [gk]: !(f[gk] ?? defaultFolded) };
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
  // Draft for the "when it ends" step (spec §11 Q17). Held here beside the other
  // sheet drafts rather than in the view, because the row that opens it is one
  // of sixteen and the view is unmounted every time the sheet closes.
  const [editEnds, setEditEnds] = useState<EditEnds | null>(null);
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
  // Reading order (spec §4.9a, §11 Q16). A device preference exactly like the
  // filter above: it rearranges what is drawn and writes nothing, so one
  // device reading "priority" doesn't change what another shows, and no entry
  // is touched. Sub-bullets are unaffected — they follow their parent.
  const [order, setOrderState] = useState<EntryOrder>(loadOrder);
  const changeOrder = useCallback((o: EntryOrder) => {
    setOrderState(o);
    saveOrder(o);
  }, []);
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
  // Where the pointer went down on an entry row, so the row's click can tell
  // a tap from a scroll that happened to end on it. One ref for every row:
  // there is only ever one pointer sequence in flight.
  const rowDown = useRef<TapPoint | null>(null);
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
  // The day inside the page capture is logging into (see ui/PagePicker). The
  // kind of page is sticky; which one is not — it resets to today whenever the
  // form opens, so a session left open overnight can't quietly log into a page
  // that has since gone past.
  const [captureAnchor, setCaptureAnchor] = useState(todayKey());
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

  const setCaptureScope = (v: Scope) => {
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

  /**
   * Put the capture form's choices back to a plain entry for today (added 14
   * August 2026): day scope on today's page, task, no signifiers. Sticky state
   * (spec §4.1) earns its keep on a run of similar entries, but it also lets
   * the form's starting point drift from what most entries are — a lit
   * "* priority" left over from three days ago is a choice nobody made this
   * time. One labelled action clears the lot rather than four taps of undoing.
   *
   * Choices only: the typed text and details are left alone, so a reset never
   * eats words mid-thought. Sticky storage is written once, not once per field.
   */
  const resetCapture = () => {
    sticky.current = {
      ...sticky.current,
      scope: "day",
      type: "task",
      priority: false,
      inspiration: false,
    };
    persistSticky();
    _setCaptureScope("day");
    _setCaptureType("task");
    _setCapturePriority(false);
    _setCaptureInspiration(false);
    // todayRef, not today: this must be the current day even if the form has
    // been open across midnight, which is the case the reset exists for
    setCaptureAnchor(todayRef.current);
    inputRef.current?.focus();
  };

  // The entry input lives in the full-screen capture form and autofocuses
  // when the form opens (autoFocus attribute); nothing to focus at load.

  // Derived view-model (nowKeys, past/future/due lists, future-log grouping).
  // Pure — see ./ui/spreadData.
  //
  // Memoised because it walks every page four times and App re-renders far
  // more often than the journal changes: every keystroke in capture, details,
  // an inline edit, the thread and nest filters and the search box, and every
  // 30 seconds on setTick. `days` and `recurrences` are useState values in
  // useJournal, replaced only when the document changes, so the identity check
  // here holds across all of those renders (Finding 18).
  const {
    nowKeys,
    pastOpen,
    scheduledRows,
    laterThisMonth,
    futureLogGroups,
    futureLogCount,
    dueItems,
    earlierOpen,
    endedRules,
  } = useMemo(
    () => buildSpreadData(days, recurrences, today),
    [days, recurrences, today]
  );

  // Occurrences of the same rule still open on pages before this entry's own
  // (spec §11 Q15). Page keys within one rule share a scope, so the compare
  // is a plain string compare.
  const earlierOpenFor = (e: Entry): { pk: string; entry: Entry }[] =>
    e.recurrenceId
      ? (earlierOpen[e.recurrenceId] ?? []).filter((o) => o.pk < e.pageKey)
      : [];

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
        : periodKey(captureScope, captureAnchor));
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
  }, [input, captureDetails, capturePinnedPk, captureParentUsable, activeCol, captureScope, captureType, capturePriority, captureInspiration, captureAnchor]);

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

  /**
   * Open the capture form. The page it logs into starts at the current period
   * every time: the kind of page is sticky (spec §4.1), but which one is not —
   * a form opened days after the last one should not still be pointing at that
   * day's page, and nothing about a stale date would be visible until after the
   * entry had landed.
   */
  const openCapture = () => {
    setCaptureAnchor(todayKey());
    setCaptureOpen(true);
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
    openCapture();
  };

  // Open the entry-actions sheet, aiming its "Move to" picker at the page the
  // entry is on. Starting there rather than on today means the picker opens
  // stating where the entry actually is, and the move button stays inert until
  // that changes — a sheet can be opened from a row on another page, so
  // "today" would be a claim about the wrong page.
  const openSheet = (target: SheetTarget) => {
    setMoveGran(keyScope(target.pk) ?? "day");
    setMoveAnchor(keyToAnchor(target.pk));
    setSheet(target);
  };

  const closeSheet = () => {
    setSheet(null);
    setEditText(null);
    setEditRemind(null);
    setEditRepeat(null);
    setEditEnds(null);
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

  /**
   * Write the end the step was left on (spec §11 Q17).
   *
   * The two forms are stored as they were given rather than one being converted
   * into the other, and "never" clears both. Nothing already on a page is
   * touched: an end only stops the materialiser going further, which is why
   * this needs no pass over the entries.
   */
  const saveEnds = () => {
    if (!sheet || !sheetEntry || !editEnds) return;
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
    if (!sheet || !sheetEntry || !editRepeat) return;
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

  // One subscription for status and error together. useState with a scalar was
  // what hid Finding 2: an error carries no status change, so React bailed out
  // on the same value and CannotLoadView kept its previous message.
  const sync = useSyncExternalStore(subscribeSync, getSyncSnapshot);
  const syncStatus = sync.status;
  // Why the banner shows, rather than only whether. A refusal and a sign-out
  // both mean entries are reaching nothing, and they need different words.
  const stalled = notSyncingReason(syncStatus, sync.error);

  // Nothing decided yet: the journal is still opening, or Supabase has not said
  // who is signed in. First, because every gate below reads false while it holds
  // — including the one that offers to erase the journal, which is what a valid
  // session used to be shown while the account check ran (19 August 2026).
  const starting = isStarting({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
  });

  // Fresh install with sync configured: sign in before there is a journal at
  // all (decision 3, spec device-identity-design.md). A signed-out device that
  // already holds content gets the screen below instead — see lib/onboarding.
  const onboarding = needsOnboarding({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    hasLocalContent,
  });

  // Signed out with a journal already here: sign in, or erase this copy (decision
  // 3, applied to a lapsed session on 13 August 2026 — see ui/SignedOutView for
  // which part of §6.1b gave way and what it costs). No way past it, on purpose:
  // a journal must not be readable on a device with nobody signed in.
  const choosing = needsSignInChoice({
    configured: isConfigured(),
    status: syncStatus,
    loaded,
    hasLocalContent,
  });

  // Signed in but unable to open the journal: ask for the key rather than
  // rendering an empty spread, which reads as a journal that has lost its
  // contents (see lib/onboarding).
  const removed = sync.removed;
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

  // Whether the journal itself is what is on screen, rather than one of the six
  // screens that can stand in front of it.
  //
  // One name instead of the same five negations repeated at fourteen call sites,
  // which is how it was written until the sixth gate arrived: any site that missed
  // a flag would render the journal behind the screen meant to replace it, and the
  // two that matter most are the capture launcher and the capture form, where the
  // consequence is an entry written into a journal nobody is looking at.
  const journalOnScreen =
    !starting &&
    !onboarding &&
    !choosing &&
    !unlocking &&
    !showRecovery &&
    !stuck &&
    !settling;
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

  // Migration history: walk the migratedFrom chain both ways (spec §4.3).
  //
  // Memoised for the same reason as buildSpreadData above: it flattens every
  // page and builds two Maps, and it ran on every keystroke. Gated on the
  // sheet being open as well, so a journal with no sheet on screen does no
  // walk at all — the same shape as searchResults below (Finding 18).
  const sheetHistory: string[] = useMemo(
    () => buildMigrationHistory(days, sheetEntry),
    [days, sheetEntry]
  );

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
      // Everything right of the bullet opens the entry's actions. The more
      // button stays where it was, visible and labelled: this is a larger
      // target over a plainly labelled control, not a gesture you have to
      // know about. The bullet keeps its own click and stops it, so the two
      // never fight, and the 10px gap between them belongs to the row — an
      // ambiguous tap opens a sheet you dismiss rather than completing a
      // task you did not mean to complete.
      onPointerDown={(ev) => {
        rowDown.current = { x: ev.clientX, y: ev.clientY };
      }}
      onClick={(ev) => {
        const sel = window.getSelection();
        const open = shouldOpenRow(
          rowDown.current,
          { x: ev.clientX, y: ev.clientY },
          !!sel && !sel.isCollapsed
        );
        rowDown.current = null;
        if (open) openSheet({ scope: sc, pk, id: e.id });
      }}
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
        onClick={(ev) => {
          // The one place on the row where a tap writes to the journal, so
          // it must not also reach the row handler above
          ev.stopPropagation();
          if (e.type === "task") toggleDone(e.id);
          else cycleType(e.id);
        }}
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
            {/* "repeats" alone until the rule has an end, then "repeats until
                30 Sept", and "repeats, last one" on the final occurrence. The
                cadence stays out of it: this page has never carried it, and the
                longer form wrapped on most rows at 375px (spec §11 Q17). */}
            {repeatCaption(
              recurrences.find((r) => r.id === e.recurrenceId),
              e.pageKey,
              today
            )}
          </span>
        )}
        {/* Earlier occurrences of this rule that were never finished (spec
            §11 Q15). They sit on their own past pages, which the spread does
            not show, so without this the pile is silent. Same 11.5px/13px
            construction as the meta above and as "threaded to", so the row
            stays one grid line; it wraps to a second line box on a narrow
            screen, which is a full grid row and keeps the dots aligned. */}
        {earlierOpenFor(e).length > 0 && (
          <button
            className="detailsToggle"
            onClick={(ev) => {
              ev.stopPropagation();
              setEarlierSheet(e.id);
            }}
            aria-label={`${earlierOpenFor(e).length} earlier occurrences still open — open the list`}
          >
            {earlierOpenFor(e).length} earlier still open
          </button>
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
          onClick={(ev) => {
            ev.stopPropagation();
            openSheet({ scope: sc, pk, id: e.id });
          }}
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
                ? ` — repeats ${cadenceLabel(
                    rule.everyN,
                    rule.unit
                  )}${endClause(rule, row.pk)}`
                : null;
            })()}
          </span>
        </span>
        <span className="actions">
          <button
            className="miniBtn moreBtn"
            onClick={() =>
              openSheet({
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
            {endClause(row.rule, row.dayKey)}
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
          journalOnScreen &&
          view !== "spread"
        }
        showMenu={
          journalOnScreen &&
          view === "spread"
        }
        onBack={goBack}
        onMenu={() => setView("menu")}
        filter={
          journalOnScreen &&
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
        {journalOnScreen && stalled && hasLocalContent && view !== "sync" && (
          <NotSyncingBanner reason={stalled} onOpenSync={() => setView("sync")} />
        )}
        {/* Covers the whole screen, so it continues the pre-JS splash in
            index.html rather than appearing beneath a header. What it replaced
            was a bare "opening journal…" line with the empty journal already
            drawn around it. */}
        {starting && (
          <StartingView loaded={loaded} checkingAccount={syncStatus === "starting"} />
        )}
        {onboarding && (
          <OnboardingView>
            <SyncView />
          </OnboardingView>
        )}
        {/* Signed out with a journal already here. Placed beside the other gates
            rather than inside one of them, and mutually exclusive with all five by
            construction: this needs signed-out with content, onboarding needs
            signed-out without it, and the other four need a session. The predicate
            test pins that, since a state with no screen renders an empty journal
            and a state with two renders both. */}
        {choosing && (
          <SignedOutView
            onErase={async () => {
              await signOutAndWipe();
              window.location.reload();
            }}
          >
            <SyncView />
          </SignedOutView>
        )}
        {!starting && !onboarding && !unlocking && settling && (
          <div style={S.empty}>opening your journal…</div>
        )}
        {!starting && !onboarding && !unlocking && !settling && stuck && (
          <CannotLoadView
            error={sync.error}
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
            removed={removed}
            onSignOut={() => void signOutAndWipe()}
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
        {journalOnScreen && loaded &&
          (view === "future" ||
            (activeCol !== null && activeCol.kind === "list")) && (
          <ReadingBlock
            open={filterOpen}
            filter={filter}
            onChangeFilter={changeFilter}
            order={order}
            onChangeOrder={changeOrder}
            /* The Future log's rows are occurrences drawn from other pages,
               not this page's own entries, so there is no page sequence to
               re-read and no order row is offered (spec §4.9a). */
            showOrder={view !== "future"}
          />
        )}
        {journalOnScreen && loaded && view === "index" && (
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
        {journalOnScreen && loaded && view === "search" && (
          <SearchView
            query={query}
            setQuery={setQuery}
            results={searchResults}
            onOpenEntry={openFoundEntry}
            onOpenCollection={(id) => setView({ col: id })}
          />
        )}
        {journalOnScreen && loaded && view === "sync" && (
          <SyncView />
        )}
        {/* Reached from the Menu, so it needs a journal on screen like the rest.
            The case this cannot serve is somebody stuck before that point, on the
            unlock or sign-in screen, which is why the site carries the address too
            (spec §13.1). */}
        {journalOnScreen && loaded && view === "feedback" && (
          <FeedbackView
            syncStatus={syncStatus}
            syncError={sync.error}
            installed={install.mode === "hidden"}
          />
        )}
        {journalOnScreen && loaded && view === "menu" && (
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
            onOpenFeedback={() => setView("feedback")}
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
                snapshotFilename(new Date())
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
        {journalOnScreen && loaded && activeCol && (
          <CollectionView
            collection={activeCol}
            entries={days[colPageKey(activeCol.id)] || []}
            habits={habits.filter((h) => h.collectionId === activeCol.id)}
            renderEntry={(e) => renderEntry(e, colPageKey(activeCol.id), null)}
            filter={filter}
            order={order}
            threadedHere={renderThreadedHere(colPageKey(activeCol.id))}
            onDelete={() => {
              const snap = removeCollection(activeCol.id);
              setView("index");
              if (snap) showToast({ colSnap: snap });
            }}
          />
        )}
        {journalOnScreen && loaded && view === "spread" && (
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
            folds={folds}
            onToggleFold={toggleFold}
            filter={filter}
            order={order}
            filterRow={
              <ReadingBlock
                open={filterOpen}
                filter={filter}
                onChangeFilter={changeFilter}
                order={order}
                onChangeOrder={changeOrder}
                showOrder
              />
            }
            onReview={() => setReviewing(true)}
            onOpenFutureLog={() => setView("future")}
          />
        )}
        {journalOnScreen && loaded && view === "future" && (
          <FutureLogView
            count={futureLogCount}
            finished={endedRules.map(({ rule, last }) => ({
              id: rule.id,
              text: rule.text,
              last: endLabel(last),
            }))}
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
      {journalOnScreen &&
        view !== "sync" &&
        view !== "menu" &&
        // Writing feedback is not writing in the journal, and the launcher would
        // sit over the message box with the keyboard already up.
        view !== "feedback" &&
        // Search is a screen for finding, not writing: the bar would sit over
        // the results and the keyboard has the room instead. It is also the
        // one page where a Find button would point at itself.
        view !== "search" && (
        <CaptureLauncher
          onOpen={openCapture}
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
              today={today}
              onClose={() => setRuleSheet(null)}
            />
          );
        })()}

      {/* Also gated: /?capture opens this form on launch without touching the
          launcher, so an app-icon shortcut would otherwise walk straight past
          onboarding into an entry form. */}
      {journalOnScreen && captureOpen && (
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
          captureAnchor={captureAnchor}
          setCaptureAnchor={setCaptureAnchor}
          resetCapture={resetCapture}
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

      {earlierSheet &&
        (() => {
          const owner = Object.values(days)
            .flat()
            .find((e) => e.id === earlierSheet);
          if (!owner) return null;
          const rule = recurrences.find((r) => r.id === owner.recurrenceId);
          return (
            <EarlierOccurrencesSheet
              entry={owner}
              occurrences={earlierOpenFor(owner)}
              cadence={rule ? ruleSentence(rule, today) : "repeats"}
              onClose={() => setEarlierSheet(null)}
            />
          );
        })()}

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
          editEnds={editEnds}
          setEditEnds={setEditEnds}
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
          moveAnchor={moveAnchor}
          setMoveAnchor={setMoveAnchor}
          moveGran={moveGran}
          setMoveGran={setMoveGran}
          closeSheet={closeSheet}
          saveRepeat={saveRepeat}
          saveEnds={saveEnds}
          saveReminder={saveReminder}
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
