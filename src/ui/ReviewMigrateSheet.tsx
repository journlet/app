// Migration review overlay: opened from the "open tasks from past pages"
// banner. For each expired open task, offer to migrate it forward (original
// stays, marked ›) or strike it out. Presentational — App computes pastOpen
// from the journal, so the list shrinks live as decisions are made; the store
// mutators are imported directly as in the other sheets.

import { SCOPES, SCOPE_LABEL, pageLabel } from "../lib/dates";
import type { Scope } from "../lib/dates";
import type { Entry } from "../lib/types";
import { migrateEntry, strikeEntry } from "../store/journal";
import { S } from "./styles";

interface ReviewMigrateSheetProps {
  pastOpen: { pk: string; entry: Entry }[];
  nowKeys: Record<Scope, string>;
  onClose: () => void;
}

export default function ReviewMigrateSheet({
  pastOpen,
  nowKeys,
  onClose,
}: ReviewMigrateSheetProps) {
  return (
        <div style={S.sheetBackdrop} onClick={onClose}>
          <div
            style={{ ...S.sheet, maxHeight: "80vh", overflowY: "auto" }}
            role="dialog"
            aria-label="Migration review"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={S.sheetHandle} />
            <div style={S.sheetGroupLabel}>Migration review</div>
            {pastOpen.length === 0 ? (
              <>
                <div style={S.sheetEntry}>
                  All done — every past task has been dealt with.
                </div>
                <button
                  className="sheetBtn isQuiet"
                  onClick={onClose}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 4px 12px" }}>
                  Decide what each open task deserves: bring it forward, or
                  strike it out if it no longer matters. Originals stay on
                  their old page marked ›.
                </p>
                {pastOpen.map(({ pk, entry }) => (
                  <div key={entry.id} style={{ marginBottom: 14 }}>
                    <div style={S.sheetEntry}>
                      <span style={{ marginRight: 8 }}>•</span>
                      {entry.priority && <span className="prio">*</span>}
                      {entry.text}
                      <span
                        style={{ fontSize: 11.5, color: "var(--ink-soft)", marginLeft: 8 }}
                      >
                        from {pageLabel(pk)}
                      </span>
                    </div>
                    <div style={S.sheetRow}>
                      {SCOPES.map((t) => (
                        <button
                          key={t}
                          className="sheetBtn isCompact"
                          onClick={() => migrateEntry(entry.id, nowKeys[t])}
                        >
                          › {SCOPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                    <button
                      className="sheetBtn isDanger"
                      onClick={() => strikeEntry(entry.id)}
                    >
                      Strike out (no longer relevant)
                    </button>
                  </div>
                ))}
                <button
                  className="sheetBtn isQuiet"
                  onClick={onClose}
                >
                  Finish later
                </button>
              </>
            )}
          </div>
        </div>
  );
}
