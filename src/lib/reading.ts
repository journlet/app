// What the header badge says about how this page is being read (spec §4.9,
// §4.9a, §11 Q20; added 27 August 2026, rewritten the same day).
//
// The reading block is one disclosure with two rows, filter and order, so the
// button that opens it speaks for both: full ink and a heavier label when
// either is set, and the state on the button, because the block is chrome and
// stays closed. A page can be filtered or sorted with the control out of
// sight, and a journal quietly showing you less than it holds, or in an order
// you have forgotten choosing, is the thing this must not do.
//
// It names the kind of change rather than its value. `filtered` alone could not
// cover an order, since nothing is hidden then, so the order carries its own
// word instead of borrowing one that would be false. What this trades away is
// stated rather than solved: a glance cannot tell `tasks only` from `open only`,
// and those are different pages, since one keeps your notes and events and the
// other removes them. One tap says which, and the accessible name says it
// without the tap.
//
// The button was called `reading` for one day, when it had to speak for both
// halves and there was no room to name them: at 375px, with the sync badge in
// the row, `reading · open only, priority first` overran by 33px, so it counted
// instead and said `reading · 2 set`. §11 Q20 removed the sync badge, which
// removed both the count and the reason the noun could not be the plain word
// people reach for.

import { FILTER_LABEL } from "./filter";
import type { EntryFilter } from "./filter";
import { ORDER_BADGE } from "./order";
import type { EntryOrder } from "./order";

/**
 * The order is null on pages it does not apply to — the Future log, whose rows
 * are occurrences drawn from other pages, so there is no page sequence there
 * to re-read (§4.9a). The badge there speaks for the filter alone, and can
 * never say `sorted`.
 */
export type ReadingOrder = EntryOrder | null;

/** Is anything changing how this page reads? Drives the badge's ink. */
export const readingActive = (f: EntryFilter, o: ReadingOrder): boolean =>
  f !== "all" || (o !== null && o !== "logged");

const isFiltered = (f: EntryFilter): boolean => f !== "all";
const isSorted = (o: ReadingOrder): boolean => o !== null && o !== "logged";

/**
 * The badge itself: the bare noun while the page is as the journal drew it,
 * then the kind of change. Four states, and every one of them fits at 375px
 * with room to spare, so there is no shortened form to keep in step.
 */
export const readingBadge = (f: EntryFilter, o: ReadingOrder): string => {
  const kinds = [
    isFiltered(f) ? "filtered" : "",
    isSorted(o) ? "sorted" : "",
  ].filter(Boolean);
  return kinds.length ? kinds.join(", ") : "filter";
};

/**
 * Accessible name: the badge, then the values in full. A screen reader has no
 * width problem, so the thing the visible label gives up is given back here.
 *
 * This makes the asymmetry deliberate rather than accidental: a screen reader
 * learns more from this button than a sighted reader does. The alternative was
 * to say less to both, which would be an odd way to spend the space.
 */
export const readingAria = (f: EntryFilter, o: ReadingOrder): string => {
  const values = [
    isFiltered(f) ? FILTER_LABEL[f] : "",
    isSorted(o) ? ORDER_BADGE[o as EntryOrder] : "",
  ].filter(Boolean);
  const badge = readingBadge(f, o);
  return values.length ? `${badge} · ${values.join(", ")}` : badge;
};
