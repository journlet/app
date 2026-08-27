// The bottom-sheet shell, extracted from the four sheets that open-coded it.
//
// Why it is a component rather than a convention: the inner box's
// onClick={(ev) => ev.stopPropagation()} is load-bearing and invisible. The
// backdrop closes the sheet on any click, so without that line every tap
// inside the sheet bubbles out to the backdrop and the sheet shuts itself
// under the person's finger. A fifth sheet written by hand and missing it
// would type-check, lint clean, and pass a test that only checked the backdrop
// closes, because nothing about the omission looks like an omission. The drag
// handle is the same sort of silent convention: forget it and the sheet simply
// reads as a slab, with no test to say so. Both now live here, once.

import type { CSSProperties, ReactNode } from "react";
import { S } from "./styles";

interface BottomSheetProps {
  /** Names the dialog for assistive technology. */
  label: string;
  onClose: () => void;
  /** Merged over S.sheet, for the one sheet that wants a different height.
   *  Anything every sheet should share belongs in S.sheet instead, so no
   *  sheet can quietly drift away from the rest. */
  style?: CSSProperties;
  children: ReactNode;
}

export default function BottomSheet({
  label,
  onClose,
  style,
  children,
}: BottomSheetProps) {
  return (
    <div style={S.sheetBackdrop} onClick={onClose}>
      <div
        style={style ? { ...S.sheet, ...style } : S.sheet}
        role="dialog"
        aria-label={label}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={S.sheetHandle} />
        {children}
      </div>
    </div>
  );
}
