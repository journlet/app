// Full-screen details view/editor for a single entry (spec §9). Opened from
// the entry's "details" affordance or the ⋯ sheet, it mirrors the full-screen
// capture form so reading a saved link (tappable) and editing share one roomy
// surface — and nothing is printed into the dot-grid spread. Self-contained:
// it owns its read/edit state and writes straight to the store.

import { useState } from "react";
import { GLYPH } from "../lib/types";
import type { Entry } from "../lib/types";
import { splitLinks } from "../lib/linkify";
import { setDetails } from "../store/journal";
import { S } from "./styles";

interface DetailsFormProps {
  entry: Entry;
  onClose: () => void;
}

export default function DetailsForm({ entry, onClose }: DetailsFormProps) {
  const [value, setValue] = useState(entry.details ?? "");
  // Start in edit mode when there's nothing to read yet
  const [editing, setEditing] = useState(!entry.details);
  const [draft, setDraft] = useState(entry.details ?? "");

  const save = () => {
    const trimmed = draft.trim();
    setDetails(entry.id, trimmed);
    setValue(trimmed);
    if (!trimmed) {
      onClose(); // emptied — nothing left to read
      return;
    }
    setEditing(false);
  };

  return (
    <div style={S.captureForm} role="dialog" aria-label="Entry details">
      <div style={S.captureFormHead}>
        <h2 style={S.captureFormTitle}>Details</h2>
        <button
          className="sheetBtn isCompact"
          style={{ flex: "none", margin: 0 }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
      <div style={S.captureFormBody}>
        <div style={S.formLbl}>Entry</div>
        <div style={{ fontSize: 15.5, marginBottom: 4, wordBreak: "break-word" }}>
          <span style={{ marginRight: 8 }}>{GLYPH[entry.type]}</span>
          {entry.text}
        </div>
        {editing ? (
          <>
            <div style={S.formLbl}>Details</div>
            <textarea
              autoFocus
              style={{ ...S.sheetInput, minHeight: 160, resize: "vertical" }}
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Escape") onClose();
              }}
              placeholder="Notes, or a link to read later…"
              aria-label="Entry details"
            />
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 4px 12px" }}>
              Links become tappable. Leave empty to remove.
            </p>
            <button className="sheetBtn" onClick={save}>
              Save details
            </button>
            {value !== "" && (
              <button
                className="sheetBtn isQuiet"
                onClick={() => {
                  setDraft(value);
                  setEditing(false);
                }}
              >
                Back
              </button>
            )}
          </>
        ) : (
          <>
            <div style={S.formLbl}>Details</div>
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                marginBottom: 12,
              }}
            >
              {splitLinks(value).map((seg, i) =>
                seg.kind === "url" ? (
                  <a
                    key={i}
                    href={seg.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--ink)" }}
                  >
                    {seg.value}
                  </a>
                ) : (
                  <span key={i}>{seg.value}</span>
                )
              )}
            </div>
            <button
              className="sheetBtn"
              onClick={() => {
                setDraft(value);
                setEditing(true);
              }}
            >
              Edit details
            </button>
          </>
        )}
      </div>
    </div>
  );
}
