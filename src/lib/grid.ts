// The journal's grid: dot pitch and text row height are the same value,
// so every line of text sits in a dot row like handwriting in a physical
// book. Change this one constant to retune the whole page rhythm.
// (index.css reads it as the --grid custom property, set on the app root.)
export const GRID = 33;

// Horizontal anchor for the dot background: a dot must sit under the
// bullet column's centre, which is 35px from the content column's left
// edge (20px page padding + 4px entry padding + half the 22px bullet).
// In background-position, 50% resolves to (paperWidth - GRID) / 2 and
// each dot is at the centre of its GRID-sized tile.
export const GRID_BG_POSITION = `calc(max(50% - ${280 - GRID / 2}px, 0px) + ${
  35 - GRID / 2
}px) ${-GRID / 2}px`;
