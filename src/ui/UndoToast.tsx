// Transient "deleted — Undo" toast shown after an entry or collection is
// removed. Presentational: App owns the toast state and the undo action (and
// its auto-dismiss timer); this just renders the label and Undo button.

import { S } from "./styles";

interface UndoToastProps {
  isCollection: boolean;
  onUndo: () => void;
}

export default function UndoToast({ isCollection, onUndo }: UndoToastProps) {
  return (
    <div style={S.toast} role="status">
      <span>{isCollection ? "Collection deleted" : "Entry deleted"}</span>
      <button className="toastBtn" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
