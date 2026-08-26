// The order row (spec §4.9a): as logged / priority / by type.
//
// It sits under the filter row, inside the same disclosure, because they are
// the same kind of thing — how you are reading this page — and the header has
// no room for a second badge (§11 Q16: at 375px the corner has about a dozen
// pixels spare). Same segmented track as the filter and the capture form's
// scope row, so it reads as one control rather than a new kind of chrome.

import { ORDERS, ORDER_ARIA, ORDER_LABEL, ORDER_NOTE } from "../lib/order";
import type { EntryOrder } from "../lib/order";
import { S } from "./styles";

interface OrderRowProps {
  order: EntryOrder;
  onChange: (o: EntryOrder) => void;
}

export default function OrderRow({ order, onChange }: OrderRowProps) {
  return (
    <div style={S.filterWrap}>
      <div style={S.filterRow}>
        <span style={S.filterLbl}>order</span>
        <div style={S.filterTrack} role="group" aria-label="Order entries">
          {ORDERS.map((o) => (
            <button
              key={o}
              className={"filterBtn" + (order === o ? " isActive" : "")}
              aria-pressed={order === o}
              aria-label={ORDER_ARIA[o]}
              onClick={() => onChange(o)}
            >
              {ORDER_LABEL[o]}
            </button>
          ))}
        </div>
      </div>
      {/* Always shown, including for "as logged" — a line that only appears
          when something has changed is a line you learn to stop reading */}
      <div style={S.filterNote}>{ORDER_NOTE[order]}</div>
    </div>
  );
}
