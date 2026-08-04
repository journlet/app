// The filter row (remediation item 7): all / tasks only / open only, sitting
// above the journal on every page that lists entries — the spread, a
// collection, the future log. One control in one place, so a filtered page is
// never a page with an invisible setting behind it.
//
// Same segmented-track shape as the capture form's scope row, so the control
// reads as part of the same journal rather than a new kind of chrome.

import { FILTERS, FILTER_ARIA, FILTER_LABEL, FILTER_NOTE } from "../lib/filter";
import type { EntryFilter } from "../lib/filter";
import { S } from "./styles";

interface FilterRowProps {
  filter: EntryFilter;
  onChange: (f: EntryFilter) => void;
}

export default function FilterRow({ filter, onChange }: FilterRowProps) {
  return (
    <div style={S.filterWrap}>
      <div style={S.filterRow}>
        <span style={S.filterLbl}>show</span>
        <div style={S.filterTrack} role="group" aria-label="Filter entries">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={"filterBtn" + (filter === f ? " isActive" : "")}
              aria-pressed={filter === f}
              aria-label={FILTER_ARIA[f]}
              onClick={() => onChange(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      {/* Always shown, including for "all" — a line that only appears when
          something is missing is a line you learn to stop reading */}
      <div style={S.filterNote}>{FILTER_NOTE[filter]}</div>
    </div>
  );
}
