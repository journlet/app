// New-collection dialog. Presentational: App owns the draft state and performs
// the actual create + navigation via onCreate, so this component never touches
// the store or the view stack.

import type { CollectionKind } from "../lib/types";
import { S } from "./styles";

interface NewCollectionDraft {
  name: string;
  kind: CollectionKind;
}

interface NewCollectionDialogProps {
  value: NewCollectionDraft;
  onChange: (draft: NewCollectionDraft) => void;
  onClose: () => void;
  onCreate: (kind: CollectionKind, name: string) => void;
}

export default function NewCollectionDialog({
  value,
  onChange,
  onClose,
  onCreate,
}: NewCollectionDialogProps) {
  const create = () => {
    if (value.name.trim()) onCreate(value.kind, value.name.trim());
  };
  return (
    <div style={S.sheetBackdrop} onClick={onClose}>
      <div
        style={S.sheet}
        role="dialog"
        aria-label="New collection"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={S.sheetHandle} />
        <div style={S.sheetGroupLabel}>New collection</div>
        <input
          style={S.sheetInput}
          value={value.name}
          autoFocus
          placeholder="Collection name…"
          onChange={(ev) => onChange({ ...value, name: ev.target.value })}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") create();
          }}
          aria-label="Collection name"
        />
        <div style={S.sheetGroupLabel}>Type</div>
        <div style={S.sheetRow}>
          {(["list", "habits"] as CollectionKind[]).map((k) => (
            <button
              key={k}
              className="sheetBtn isCompact"
              style={
                value.kind === k
                  ? { border: "1.5px solid var(--ink)", fontWeight: 600 }
                  : undefined
              }
              aria-pressed={value.kind === k}
              onClick={() => onChange({ ...value, kind: k })}
            >
              {k === "habits" ? "Habit tracker" : "List"}
            </button>
          ))}
        </div>
        <button
          className="sheetBtn"
          disabled={!value.name.trim()}
          onClick={create}
        >
          Create collection
        </button>
        <button className="sheetBtn isQuiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
