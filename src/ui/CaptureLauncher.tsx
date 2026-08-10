// Footer capture launcher: a slim bar showing the current capture preferences
// that opens the full-screen CaptureForm. Presentational — App owns the sticky
// capture prefs and decides when the bar shows (hidden on the sync screen, the
// menu, and search itself).
//
// The bar carries the two things you do with a journal: put something in, and
// find something again. Find sits at the far left and Log at the far right,
// both within a thumb's reach, with the entry field between them.
//
// Find is here and nowhere else — one fixed place on every journal page beats
// the same action in two spots. A habit tracker takes no entries, so it gets
// the Find control on its own rather than losing the bar altogether (canLog).

import { GLYPH } from "../lib/types";
import type { Collection, EntryType } from "../lib/types";
import type { Scope } from "../lib/dates";
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
  /** false on a habit tracker, which holds no entries to log */
  canLog: boolean;
  activeCol: Collection | null;
  captureType: EntryType;
  captureScope: Scope;
  capturePriority: boolean;
  captureInspiration: boolean;
}

export default function CaptureLauncher({
  onOpen,
  onFind,
  canLog,
  activeCol,
  captureType,
  captureScope,
  capturePriority,
  captureInspiration,
}: CaptureLauncherProps) {
  const find = (
    <button
      className={"launcherFind" + (canLog ? "" : " isAlone")}
      type="button"
      onClick={onFind}
      aria-label="Find an entry — opens the find screen"
    >
      <FindGlass />
      Find
    </button>
  );

  // Nothing can be logged onto this page, so the entry field would be a
  // control that does not apply. Find keeps its corner regardless.
  if (!canLog)
    return (
      <footer style={S.captureWrap}>
        <div style={S.launcherAlone}>{find}</div>
      </footer>
    );

  return (
    <footer style={S.captureWrap}>
      <div style={S.launcher}>
        {find}
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
              ? [captureType as string]
              : [captureScope as string, captureType as string]
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
