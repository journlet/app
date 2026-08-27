// How you are reading this page, in one place (spec §4.9, §4.9a).
//
// One disclosure, two rows: what is shown, and in what order. They arrived
// separately and belong together — §4.9 already called this block "how you are
// reading it", and §11 Q16 settled that the order control could not have a
// header badge of its own, because at 375px the corner has about a dozen
// pixels spare once menu, the filter badge and sync have had theirs.
//
// The block starts closed, and while it is shut it draws nothing: the header
// badge carries both halves of the state (lib/reading.ts, 27 August 2026).
// It used to leave a standing italic line naming the order, which was the
// filter note's styling in the filter note's slot and read as a row that had
// failed to close.

import FilterRow from "./FilterRow";
import OrderRow from "./OrderRow";
import type { EntryOrder } from "../lib/order";
import type { EntryFilter } from "../lib/filter";

interface ReadingBlockProps {
  open: boolean;
  filter: EntryFilter;
  onChangeFilter: (f: EntryFilter) => void;
  order: EntryOrder;
  onChangeOrder: (o: EntryOrder) => void;
  /** Pages whose rows are not this page's own entries (the Future log, whose
   *  rows are occurrences drawn from elsewhere) take the filter and no order:
   *  there is no page sequence there to re-read. */
  showOrder: boolean;
}

export default function ReadingBlock({
  open,
  filter,
  onChangeFilter,
  order,
  onChangeOrder,
  showOrder,
}: ReadingBlockProps) {
  // Shut, the block is out of the way entirely — the badge is doing the
  // talking, for the order as well as the filter.
  if (!open) return null;
  return (
    <>
      <FilterRow filter={filter} onChange={onChangeFilter} />
      {showOrder && <OrderRow order={order} onChange={onChangeOrder} />}
    </>
  );
}
