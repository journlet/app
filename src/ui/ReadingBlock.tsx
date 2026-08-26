// How you are reading this page, in one place (spec §4.9, §4.9a).
//
// One disclosure, two rows: what is shown, and in what order. They arrived
// separately and belong together — §4.9 already called this block "how you are
// reading it", and §11 Q16 settled that the order control could not have a
// header badge of its own, because at 375px the corner has about a dozen
// pixels spare once menu, the filter badge and sync have had theirs.
//
// The block starts closed, so it has one more job than the rows do: while it
// is shut, a page in a non-default order still has to say so. The filter is
// covered by its header badge; the order is said here, in words, on the page.

import FilterRow from "./FilterRow";
import OrderRow from "./OrderRow";
import { ORDER_STANDING } from "../lib/order";
import type { EntryOrder } from "../lib/order";
import type { EntryFilter } from "../lib/filter";
import { S } from "./styles";

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
  if (!open) {
    const standing = showOrder ? ORDER_STANDING[order] : "";
    // Nothing to say: the page is as it was written, and the filter's own
    // badge is already saying whatever there is to say about what is hidden.
    if (!standing) return null;
    return <div style={S.orderStanding}>{standing}</div>;
  }
  return (
    <>
      <FilterRow filter={filter} onChange={onChangeFilter} />
      {showOrder && <OrderRow order={order} onChange={onChangeOrder} />}
    </>
  );
}
