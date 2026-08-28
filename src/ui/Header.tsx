// App header: brand, the sync word, the reading badge, and the one button that
// goes somewhere (spec §4.5, §4.9, §11 Q20). Presentational — App decides which
// buttons apply and what each does.
//
// The order of this row is a decision rather than a layout. It is right-anchored,
// so only the last item has a fixed position, and until 27 August 2026 the last
// item was the sync badge: the two buttons that navigated somewhere slid about
// whenever a status changed wording, and `menu` travelled 87.9px across the
// states at 375px. So the button that goes somewhere now takes the corner and
// the badge that reports state sits to its left, growing leftwards into empty
// space as its label lengthens. `menu` and `back` never move by a pixel on any
// screen in any state, and the badge's right edge does not move either.
//
// There is no sync pill here any more. Sync speaks in three tiers instead
// (§11 Q20): nothing while it is working, one word in the left slot for what is
// true but has nothing to be done about it, and NotSyncingBanner on the journal
// for what needs an action. The route to the Sync screen is the Menu row and
// the banner; a pill that opened it was also, on the Sync screen itself, a
// button that looked live and did nothing.

import type { EntryFilter } from "../lib/filter";
import { readingActive, readingAria, readingBadge } from "../lib/reading";
import type { ReadingOrder } from "../lib/reading";
import { syncSlotWord } from "../lib/syncSlot";
import type { SyncStatus } from "../store/syncStatus";
import { S } from "./styles";

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
  /** drives the left slot only — the middle tier of §11 Q20's three */
  syncStatus: SyncStatus;
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
  syncStatus,
}: HeaderProps) {
  const slot = syncSlotWord(syncStatus);
  return (
    <header style={S.header}>
      <div style={S.brandRow}>
        <span style={S.headSide}>
          <span style={S.brand}>Journlet</span>
          {/* Always rendered, even empty. A live region that appears with its
              text already in it is not reliably announced, and this is the only
              place a screen reader learns that the device has gone offline now
              that the badge's aria-label is gone. Full ink rather than the
              muted grey the saving cue used: this is a state, not a caption,
              and the badge next to it already uses ink for the same reason.
              Never the danger colour — offline is not a fault (§11 Q20). */}
          <span style={S.statusSlot} role="status" aria-live="polite">
            {slot}
          </span>
        </span>
        <span style={S.headSide}>
          {/* The way in to the reading block, which is chrome and stays closed
              until asked for (remediation item 7, revised 4 August 2026 after
              the always-on row read as clutter on device).

              The label carries the state, because a page can be filtered or
              sorted with the block shut and what is set has to be readable
              without opening anything. Full ink and a heavier label rather than
              the muted default when either half is set: attention, not alarm,
              so never the danger colour. Weight rather than a thicker border,
              measured — at 600 the labels grow by 0.6px to 2.2px, where a 2px
              border would add 2px to the pill and is also what :focus-visible
              draws. lib/reading.ts owns the wording. */}
          {filter !== null && (
            <button
              className="miniBtn"
              style={
                readingActive(filter, order)
                  ? {
                      color: "var(--ink)",
                      borderColor: "var(--ink)",
                      fontWeight: 600,
                    }
                  : undefined
              }
              aria-expanded={filterOpen}
              // The values in full, which the visible label gives up
              aria-label={readingAria(filter, order)}
              onClick={onToggleFilter}
            >
              {readingBadge(filter, order)}
            </button>
          )}
          {/* The pinned corner. One of these two is present on every screen and
              in the same place on all of them, which is §4.8's "one fixed
              corner" applied to the header. Menu opens from home only; every
              sub-screen uses "back". */}
          {showBack && (
            <button className="miniBtn" onClick={onBack}>
              back
            </button>
          )}
          {showMenu && (
            <button className="miniBtn" onClick={onMenu}>
              menu
            </button>
          )}
        </span>
      </div>
    </header>
  );
}
