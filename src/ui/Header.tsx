// App header: brand, contextual back/menu button, transient save cue, and the
// always-visible sync status button (spec §4.5). Presentational — App decides
// which buttons apply and what each does; the sync label/attention tables live
// here since this is their only use.

import type { EntryFilter } from "../lib/filter";
import { readingActive, readingAria, readingBadge } from "../lib/reading";
import type { ReadingOrder } from "../lib/reading";
import type { SyncStatus } from "../store/sync";
import { S } from "./styles";

// Always-visible sync state on the header button (spec §4.5); plain words,
// attention colour when something needs the user.
const SYNC_BADGE: Record<SyncStatus, string> = {
  disabled: "sync",
  starting: "sync · starting…",
  "signed-out": "sync · signed out",
  connecting: "sync · connecting…",
  "needs-key": "sync · key needed",
  synced: "sync · synced",
  pending: "sync · waiting",
  offline: "sync · offline",
};

// A list rather than a Record, so adding a status does not fail the build here
// the way a missing badge label does. Worth knowing when adding one.
const SYNC_ATTENTION: SyncStatus[] = [
  "signed-out",
  "needs-key",
  "pending",
  "offline",
];

/** Does this status want something from the reader? */
const needsYou = (s: SyncStatus): boolean => SYNC_ATTENTION.includes(s);

/**
 * What the badge shows (spec §4.5, shortened 26 August 2026).
 *
 * The bare noun while nothing needs you, the state named in full when
 * something does — the rule the filter badge already follows, where "filter"
 * alone means nothing is hidden and "filter · open only" means something is.
 * The accessible name carries the whole wording either way, exactly as it does
 * for the filter's shortened label.
 *
 * The reason is width, and it was measured rather than felt. This row is the
 * brand plus `menu`, the filter badge and this one, all of them .miniBtn pills
 * whose padding and border cost 14px before any text. At 375px, allowing 10px
 * of clear air after the brand: `sync · synced` is 84px and leaves 13px spare,
 * and `sync · connecting…` — the longest thing SYNC_BADGE can say, and a
 * status every launch passes through — does not fit at all, overrunning by
 * 14px. A bare `sync` is 38px and leaves 59px. Nothing else in the header
 * changes; §4.9's filter badge already shortens its own wording below 480px
 * for the same reason.
 *
 * What this trades away is the standing reassurance of the word "synced" while
 * everything is well. That is deliberate: a badge that says the same thing
 * every time you look at it is one you stop reading, and the Sync screen this
 * button opens says the whole of it. Reverting is this function.
 */
const syncLabel = (s: SyncStatus): string => (needsYou(s) ? SYNC_BADGE[s] : "sync");

// Search deliberately does not live here. It sits bottom-left on the capture
// bar (CaptureLauncher), within a thumb's reach and in one fixed place on
// every journal page; a second copy up here would be the same action in two
// spots, which is a thing to look for rather than a thing you know.
interface HeaderProps {
  showBack: boolean;
  showMenu: boolean;
  onBack: () => void;
  onMenu: () => void;
  /** null on pages the filter does not apply to (Index, Find, Menu, Sync,
   *  habit trackers), where the button would do nothing */
  filter: EntryFilter | null;
  /** the reading order, or null where an order does not apply (the Future log,
   *  §4.9a). The badge speaks for the whole reading block, so it needs both
   *  halves; the props keep the filter's names because the stored preference
   *  they came from is `journlet-filter-open` and renaming it would be a
   *  migration for nothing. */
  order: ReadingOrder;
  /** is the reading block showing beneath the banners? */
  filterOpen: boolean;
  onToggleFilter: () => void;
  saving: boolean;
  syncStatus: SyncStatus;
  onSyncClick: () => void;
}

export default function Header({
  showBack,
  showMenu,
  onBack,
  onMenu,
  filter,
  order,
  filterOpen,
  onToggleFilter,
  saving,
  syncStatus,
  onSyncClick,
}: HeaderProps) {
  return (
    <header style={S.header}>
      <div style={S.brandRow}>
        <span style={S.brand}>Journlet</span>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          {showBack && (
            <button className="miniBtn" onClick={onBack}>
              back
            </button>
          )}
          {/* Menu opens from home only; every sub-screen uses "back" */}
          {showMenu && (
            <button className="miniBtn" onClick={onMenu}>
              menu
            </button>
          )}
          {/* The way in to the reading block, which is chrome and stays closed
              until asked for (remediation item 7, revised 4 August 2026 after
              the always-on row read as clutter on device).

              The label carries the state, exactly as the sync badge does: a
              page can be filtered or sorted with the block shut, so what is
              set has to be readable without opening anything. Full ink rather
              than the muted default when either is — attention, not alarm, so
              not the danger colour the sync badge uses.

              Named "reading" rather than "filter" since 27 August 2026, when
              it took the order on as well (§4.9a): a button saying "filter"
              while reporting an order is the same small lie as a link saying
              "from next month on" over this month's items. lib/reading.ts owns
              the wording and the measurements behind it. */}
          {filter !== null && (
            <button
              className="miniBtn"
              style={
                readingActive(filter, order)
                  ? { color: "var(--ink)", borderColor: "var(--ink)" }
                  : undefined
              }
              aria-expanded={filterOpen}
              // Visible text shortens on narrow screens; the accessible name
              // carries the full wording either way
              aria-label={readingAria(filter, order)}
              onClick={onToggleFilter}
            >
              {(() => {
                const long = readingBadge(filter, order);
                const short = readingBadge(filter, order, true);
                // One string when the two agree, so the button's text is the
                // badge rather than both spellings of it
                return long === short ? (
                  long
                ) : (
                  <>
                    <span className="navLong">{long}</span>
                    <span className="navShort">{short}</span>
                  </>
                );
              })()}
            </button>
          )}
          {/* Transient cue while the local IndexedDB write is in
              flight; the sync badge is the persistent status */}
          {saving && <span style={S.saveDot}>saving…</span>}
          {/* Sync pinned to the far right — a persistent status present
              on every screen, so it lives in one consistent spot. On the
              sync screen it stays put as a status but doesn't re-navigate. */}
          <button
            className="miniBtn"
            style={
              needsYou(syncStatus)
                ? { color: "var(--danger)", borderColor: "var(--danger-line)" }
                : undefined
            }
            // Visible text is the bare noun while nothing needs you; the
            // accessible name always says which status it is
            aria-label={SYNC_BADGE[syncStatus]}
            onClick={onSyncClick}
          >
            {syncLabel(syncStatus)}
          </button>
        </span>
      </div>
    </header>
  );
}
