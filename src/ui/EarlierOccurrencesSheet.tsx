// Earlier occurrences of a repeating entry that are still open (spec §11 Q15).
// Opened from the "N earlier still open" caption on an occurrence, and shaped
// like the migration review sheet: each one is named by its own page and gets
// its own decision, because on paper each occurrence is a separate line with a
// separate fate.
//
// Migrate is deliberately not offered here. A repeating task never needs
// carrying forward — the rule has already put today's copy in front of you —
// so the honest answers are that it was done late, or that it no longer
// matters. Migrate remains available on the entry's own ⋯ actions for anyone
// who means it; store/recurrence.ts no longer eats the copy when they do.
//
// Presentational: App computes the list from the journal, so it shrinks live
// as decisions are made, and empties into a plain statement rather than
// vanishing on its own.

import { pageLabel } from "../lib/dates";
import type { Entry } from "../lib/types";
import { strikeEntry, toggleDone } from "../store/journal";
import { S } from "./styles";

interface EarlierOccurrencesSheetProps {
  /** The entry the caption was tapped on — restated at the head of the sheet */
  entry: Entry;
  /** Open occurrences of the same rule on earlier pages, oldest first */
  occurrences: { pk: string; entry: Entry }[];
  cadence: string;
  onClose: () => void;
}

export default function EarlierOccurrencesSheet({
  entry,
  occurrences,
  cadence,
  onClose,
}: EarlierOccurrencesSheetProps) {
  return (
    <div style={S.sheetBackdrop} onClick={onClose}>
      <div
        style={S.sheet}
        role="dialog"
        aria-label="Earlier occurrences still open"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={S.sheetHandle} />
        <div style={S.entryCtx}>
          <span>•</span>
          <span>{entry.text}</span>
          <span style={S.entryCtxState}>{cadence}</span>
        </div>
        <div style={S.sheetGroupLabel}>Earlier occurrences still open</div>
        {occurrences.length === 0 ? (
          <>
            <div style={S.sheetEntry}>
              All dealt with — nothing earlier is still open.
            </div>
            <button className="sheetBtn isQuiet" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <div style={S.sheetNote}>
              Each one stays on its own page and keeps its own notation.
              This entry is already on this page, so nothing here needs
              bringing forward.
            </div>
            {occurrences.map(({ pk, entry: occ }) => (
              <div key={occ.id} style={{ marginBottom: 14 }}>
                <div style={S.sheetEntry}>
                  <span style={{ marginRight: 8 }}>•</span>
                  {occ.priority && (
                    <span className="prio">
                      <i>*</i>
                    </span>
                  )}
                  {occ.text}
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-soft)",
                      marginLeft: 8,
                    }}
                  >
                    on {pageLabel(pk)}
                  </span>
                </div>
                <div style={S.sheetRow}>
                  <button
                    className="sheetBtn isCompact"
                    onClick={() => toggleDone(occ.id)}
                  >
                    × Mark complete
                  </button>
                </div>
                <button
                  className="sheetBtn isDanger"
                  onClick={() => strikeEntry(occ.id)}
                >
                  Strike out (no longer relevant)
                </button>
              </div>
            ))}
            <button className="sheetBtn isQuiet" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
