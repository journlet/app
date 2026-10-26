// Transient message at the foot of the screen: "Entry deleted", "Collection
// deleted", or "Logged “…” to Today" after a quick entry, each with Undo; or
// a short notice with no Undo at all. Presentational: App owns the toast state
// and the undo action (and its auto-dismiss timer); this just renders the
// label and Undo button.
//
// The label is handed in rather than chosen here (26 October 2026, quick
// capture FR4.2): a third kind of message would otherwise mean a third flag.
// There is still one slot, so a newer message replaces an older one and only
// the newest Undo is ever offered (FR4.5).
//
// Always mounted, with or without a message (26 October 2026, review R-04).
// A live region that arrives already holding its text is not reliably
// announced: screen readers watch a region for changes, and a brand-new one
// has none. So the region stays in the page, empty and taking no space
// between messages, and only what is inside it comes and goes (FR4.6).

import { S } from "./styles";

interface UndoToastProps {
  /** the message, or null for none showing */
  label: string | null;
  /** leave out for a notice that has nothing to undo */
  onUndo?: () => void;
}

export default function UndoToast({ label, onUndo }: UndoToastProps) {
  return (
    // aria-live as well as the status role: some screen readers only announce
    // a status region's changes when it is explicitly polite
    <div role="status" aria-live="polite" data-testid="toast-region">
      {label !== null && (
        <div style={S.toast}>
          <span>{label}</span>
          {onUndo && (
            <button className="toastBtn" onClick={onUndo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
