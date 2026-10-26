// Whether a press on a section's quick-entry tap area was a tap meant to open
// the quick line, or the start of a scroll that happened to begin there
// (26 October 2026, quick capture FR1.4).
//
// The tap area is a full-width strip of empty page under each section's own
// entries, which is exactly where a thumb lands to scroll the journal. Opening
// the line raises the phone keyboard, so a scroll mistaken for a tap is not a
// harmless sheet you dismiss (as with lib/rowTap): it throws half the screen
// at you mid-scroll. Hence a stricter rule than the entry row's, with a time
// limit as well as a distance one — a slow press that barely moves is someone
// resting a thumb, not choosing a spot to write.
//
// Kept out of the component so the rule is testable on its own: jsdom gives a
// synthetic pointer event no real travel or duration to measure.

/** A pointer position and the moment it was there, in milliseconds. */
export type TapSample = { x: number; y: number; t: number };

// Travel from press to release must stay under this to count as a tap. Strictly
// under, unlike the entry row's slop, because the cost of a false open here is
// the keyboard (FR1.4).
export const TAP_MAX_MOVE_PX = 10;

// A press held this long or longer is not a tap (FR1.4).
export const TAP_MAX_MS = 500;

// The tap area's minimum height: one dot row of the journal's grid, which is
// also comfortably above the smallest target a fingertip hits reliably (FR1.5).
export const TAP_AREA_MIN_PX = 33;

export function isTap(start: TapSample, end: TapSample): boolean {
  // Distance, not each axis on its own: 8px across and 8px down is 11.3px of
  // real travel, which is a drag
  const moved = Math.hypot(end.x - start.x, end.y - start.y);
  return moved < TAP_MAX_MOVE_PX && end.t - start.t < TAP_MAX_MS;
}
