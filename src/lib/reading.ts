// What the header badge says about how this page is being read (spec §4.9,
// §4.9a; added 27 August 2026).
//
// The reading block is one disclosure with two rows, filter and order, so the
// button that opens it speaks for both: full ink when either is set, and the
// state named on the button, because the block is chrome and stays closed. A
// page can be filtered or sorted with the control out of sight, and a journal
// quietly showing you less than it holds, or in an order you have forgotten
// choosing, is the thing this must not do.
//
// It names one and counts two, and the reason is width, measured rather than
// felt. At 375px, with the brand, `menu` and the sync badge taking theirs,
// `reading · open only, priority` overruns the header row by 23px, and even
// the shortened `reading · open, priority` leaves 3.4px of air against the
// ~10px this row keeps (§4.5's own measurement). So with two things set the
// badge says how many, and the block one tap away says which. Every state
// clears 43px at 375px.
//
// This replaced the standing caption §4.9a first shipped, which said the order
// in words on the page and was read as a filter row that had failed to close.

import { FILTER_LABEL, FILTER_SHORT } from "./filter";
import type { EntryFilter } from "./filter";
import { ORDER_BADGE, ORDER_BADGE_SHORT } from "./order";
import type { EntryOrder } from "./order";

/**
 * The order is null on pages it does not apply to — the Future log, whose rows
 * are occurrences drawn from other pages, so there is no page sequence there
 * to re-read (§4.9a). The badge there speaks for the filter alone.
 */
export type ReadingOrder = EntryOrder | null;

/** Is anything changing how this page reads? Drives the badge's ink. */
export const readingActive = (f: EntryFilter, o: ReadingOrder): boolean =>
  f !== "all" || (o !== null && o !== "logged");

/** Whichever halves are set, in words, longest form unless `short`. */
const readingParts = (
  f: EntryFilter,
  o: ReadingOrder,
  short: boolean
): string[] =>
  [
    f !== "all" ? (short ? FILTER_SHORT[f] : FILTER_LABEL[f]) : "",
    o !== null && o !== "logged"
      ? short
        ? ORDER_BADGE_SHORT[o]
        : ORDER_BADGE[o]
      : "",
  ].filter(Boolean);

/**
 * The badge itself: the bare noun while the page is as the journal drew it,
 * the one thing named when one is set, the count when both are. Same rule as
 * the sync badge — nothing to say, say the noun.
 */
export const readingBadge = (
  f: EntryFilter,
  o: ReadingOrder,
  short = false
): string => {
  const set = readingParts(f, o, short);
  if (set.length === 0) return "reading";
  if (set.length === 1) return `reading · ${set[0]}`;
  return `reading · ${set.length} set`;
};

/** Accessible name: both halves, always in full. A screen reader has no
 *  width problem, so it never hears the count in place of the words. */
export const readingAria = (f: EntryFilter, o: ReadingOrder): string => {
  const set = readingParts(f, o, false);
  return set.length === 0 ? "reading" : `reading · ${set.join(", ")}`;
};
