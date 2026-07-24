// Footer capture launcher: a slim bar showing the current capture preferences
// that opens the full-screen CaptureForm. Presentational — App owns the sticky
// capture prefs and decides when the launcher shows (hidden on habit
// collections, the sync screen and the menu).

import { GLYPH } from "../lib/types";
import type { Collection, EntryType } from "../lib/types";
import type { CaptureScope } from "../lib/sticky";
import { S } from "./styles";

interface CaptureLauncherProps {
  onOpen: () => void;
  activeCol: Collection | null;
  captureType: EntryType;
  captureScope: CaptureScope;
  capturePriority: boolean;
  captureInspiration: boolean;
}

export default function CaptureLauncher({
  onOpen,
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
