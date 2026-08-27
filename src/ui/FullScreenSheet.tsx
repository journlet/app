// The full-screen sheet shell, extracted from the three views that open-coded
// it: the capture form, the entry actions and the details form.
//
// Why it is a component rather than a convention: the shell is three nested
// divs whose styles have to be paired correctly, and the head's single button
// carries the only way out of a view that covers the whole screen. A fourth
// full-screen view written by hand could drop the head, or style the body with
// captureFormHead, and still type-check, lint clean and pass a test that only
// checked its content renders. Reaching for this component means the way out
// and the scrolling body arrive together, or not at all.

import type { ReactNode } from "react";
import { S } from "./styles";

interface FullScreenSheetProps {
  /** Names the dialog for assistive technology. */
  label: string;
  /** Shown as the head's title. */
  title: ReactNode;
  /** The word on the head's only button: the way out of this view. */
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}

export default function FullScreenSheet({
  label,
  title,
  actionLabel,
  onAction,
  children,
}: FullScreenSheetProps) {
  return (
    <div style={S.captureForm} role="dialog" aria-label={label}>
      <div style={S.captureFormHead}>
        <h2 style={S.captureFormTitle}>{title}</h2>
        <button
          className="sheetBtn isCompact"
          style={{ flex: "none", margin: 0 }}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      </div>
      <div style={S.captureFormBody}>{children}</div>
    </div>
  );
}
