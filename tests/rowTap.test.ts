import { describe, expect, test } from "vitest";
import { shouldOpenRow, TAP_SLOP } from "../src/lib/rowTap";

describe("shouldOpenRow", () => {
  test("a still tap opens the row", () => {
    expect(shouldOpenRow({ x: 100, y: 200 }, { x: 100, y: 200 }, false)).toBe(
      true
    );
  });

  test("a tap that wobbles within the slop still opens the row", () => {
    expect(shouldOpenRow({ x: 100, y: 200 }, { x: 106, y: 207 }, false)).toBe(
      true
    );
  });

  test("a scroll drag that ends on the row does not open it", () => {
    expect(shouldOpenRow({ x: 100, y: 400 }, { x: 100, y: 200 }, false)).toBe(
      false
    );
  });

  test("travel is measured as distance, not per axis", () => {
    // 8px on each axis is inside the slop on either axis alone but 11.3px of
    // actual travel, which is a drag
    expect(shouldOpenRow({ x: 100, y: 200 }, { x: 108, y: 208 }, false)).toBe(
      false
    );
  });

  test("exactly the slop is still a tap", () => {
    expect(
      shouldOpenRow({ x: 100, y: 200 }, { x: 100 + TAP_SLOP, y: 200 }, false)
    ).toBe(true);
  });

  test("selecting text does not open the row", () => {
    expect(shouldOpenRow({ x: 100, y: 200 }, { x: 100, y: 200 }, true)).toBe(
      false
    );
  });

  test("a click with no press recorded opens the row", () => {
    // Assistive technology and tests both activate without a pointer sequence
    expect(shouldOpenRow(null, { x: 0, y: 0 }, false)).toBe(true);
  });
});
