// Whether a click that landed on an entry row was a tap meant for that row.
//
// The row is a tap target as well as a line of text (spec §4: an entry is
// 22px of dot grid, and the ⋯ button is 28px wide — both well under a
// comfortable thumb). Making the whole row open the actions sheet gives back
// the ~80% of the line that did nothing, but it puts the sheet in the way of
// two things people legitimately do to a line of text: scroll past it, and
// select it to copy. Both end with a click event on the row.
//
// Kept out of App.tsx so the rule is testable on its own: the JSX around it
// only reads pointer coordinates and the selection, which jsdom will not
// produce from a synthetic click.

export type TapPoint = { x: number; y: number };

// How far the pointer may travel between press and release and still count as
// a tap rather than a drag. 10px is under a fingertip's natural wobble and
// well inside the smallest scroll a thumb makes on purpose.
export const TAP_SLOP = 10;

export function shouldOpenRow(
  from: TapPoint | null,
  to: TapPoint,
  hasSelection: boolean
): boolean {
  // Ending a drag-select on the row means "I want these words", not "open
  // this entry". A selection made anywhere earlier has already been collapsed
  // by this click's own pointerdown, so what is left here belongs to the drag
  // that just finished.
  if (hasSelection) return false;
  // No press recorded: a click synthesised by assistive technology or by a
  // test, which is a deliberate activation and has no travel to measure.
  if (!from) return true;
  return Math.hypot(to.x - from.x, to.y - from.y) <= TAP_SLOP;
}
