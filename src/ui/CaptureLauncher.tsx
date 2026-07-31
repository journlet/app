// Footer capture launcher: a slim bar showing the current capture preferences
// that opens the full-screen CaptureForm. Presentational — App owns the sticky
// capture prefs and decides when the launcher shows (hidden on habit
// collections, the sync screen, the menu and search).
//
// The bar carries the two things you do with a journal: put something in, and
// find something again. Find sits at the far left and Log at the far right,
// both within a thumb's reach, with the entry field between them.

import { GLYPH } from "../lib/types";
import type { Collection, EntryType } from "../lib/types";
import type { CaptureScope } from "../lib/sticky";
import { S } from "./styles";

// Drawn rather than typed: the ⌕ character is missing from many system fonts
// and 🔍 is an emoji that ignores the theme. An SVG inherits the ink colour
// and stays crisp. It is paired with the word, never used alone — the icon is
// what you spot, the word is what removes any doubt.
const FindGlass = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0 }}
  >
    <circle cx="6.75" cy="6.75" r="4.5" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M10.2 10.2 L14 14"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

interface CaptureLauncherProps {
  onOpen: () => void;
  onFind: () => void;
  activeCol: Collection | null;
  captureType: EntryType;
  captureScope: CaptureScope;
  capturePriority: boolean;
  captureInspiration: boolean;
}

export default function CaptureLauncher({
  onOpen,
  onFind,
  activeCol,
  captureType,
  captureScope,
  capturePriority,
  captureInspiration,
}: CaptureLauncherProps) {
  return (
    <footer style={S.captureWrap}>
      <div style={S.launcher}>
        <button
          className="launcherFind"
          type="button"
          onClick={onFind}
          aria-label="Find an entry — opens search"
        >
          <FindGlass />
          Find
        </button>
        <button
          className="launcherField"
          onClick={onOpen}
          aria-label="Log an entry — opens the entry form"
        >
          <span style={S.captureGlyph}>{GLYPH[captureType]}</span>
          <span style={S.launcherHint}>
            {activeCol ? `Log into ${activeCol.name}…` : "Log an entry…"}
          </span>
          <span style={S.launcherPrefs}>
            {(activeCol
              ? [captureType]
              : [
                  captureScope === "date" ? "date…" : captureScope,
                  captureType,
                ]
            )
              .concat(capturePriority ? ["*"] : [])
              .concat(captureInspiration ? ["!"] : [])
              .join(" · ")}
          </span>
        </button>
        <button
          className="launcherGo"
          onClick={onOpen}
          aria-label="Log — opens the entry form"
        >
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>
            +
          </span>
          Log
        </button>
      </div>
      <div style={S.legend}>
        tap a task's bullet to complete it · ⋯ for entry actions
      </div>
    </footer>
  );
}
