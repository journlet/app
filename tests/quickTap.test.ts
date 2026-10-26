import { describe, expect, test } from "vitest";
import {
  isTap,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
} from "../src/ui/quickTap";

// A press at a fixed spot and moment; each test moves the release from here
const press = { x: 100, y: 200, t: 1000 };

describe("isTap (quick capture FR1.4)", () => {
  test("a still, short press is a tap", () => {
    expect(isTap(press, { x: 100, y: 200, t: 1080 })).toBe(true);
  });

  test("a 9px move is still a tap", () => {
    expect(isTap(press, { x: 109, y: 200, t: 1080 })).toBe(true);
  });

  test("a 10px move is not a tap", () => {
    expect(TAP_MAX_MOVE_PX).toBe(10);
    expect(isTap(press, { x: 100, y: 210, t: 1080 })).toBe(false);
  });

  test("a 499ms press is a tap", () => {
    expect(isTap(press, { x: 100, y: 200, t: 1499 })).toBe(true);
  });

  test("a 500ms press is not a tap", () => {
    expect(TAP_MAX_MS).toBe(500);
    expect(isTap(press, { x: 100, y: 200, t: 1500 })).toBe(false);
  });

  test("a diagonal move is measured as distance, not per axis", () => {
    // 8px on each axis is inside the limit on either axis alone, but 11.3px
    // of actual travel — the start of a scroll
    expect(isTap(press, { x: 108, y: 208, t: 1080 })).toBe(false);
    // and 6px + 7px is 9.2px of travel, which is still a tap
    expect(isTap(press, { x: 106, y: 207, t: 1080 })).toBe(true);
  });
});
