// The journal page sits on its dots, and this is what says so.
//
// Dot pitch and text row height are the same value, so every line of the journal
// sits in a dot row like handwriting in a physical book (lib/grid.ts). The blocks
// that are not single lines earn their place by summing to a whole number of rows,
// and until now that arithmetic lived only in the comments above each one: the
// alignment was held by having been got right once and by somebody noticing if it
// broke. Nothing failed if a padding changed by 3px, which is exactly the amount
// that makes a page look subtly wrong without looking broken.
//
// So these tests are the comments, executed. They were written on 27 August 2026
// before consolidating the duplicated page-header styles out of seven files, so
// that "nothing affects the dot alignment" could be checked rather than promised.
// Every sum below is quoted from the comment it pins.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GRID, GRID_BG_POSITION } from "../src/lib/grid";
import { S } from "../src/ui/styles";

const css = readFileSync(join(import.meta.dirname, "..", "src", "index.css"), "utf8");

/** The px number out of a style value, whether it is a number or a "33px". */
const px = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.match(/^(-?[\d.]+)px$/);
    if (m) return Number(m[1]);
  }
  throw new Error(`not a px value: ${JSON.stringify(v)}`);
};

/** The vertical parts of a shorthand padding/margin: [top, bottom]. */
const vertical = (shorthand: string): [number, number] => {
  const parts = shorthand.trim().split(/\s+/);
  const top = px(parts[0]);
  const bottom = parts.length >= 3 ? px(parts[2]) : top;
  return [top, bottom];
};

describe("the grid constant", () => {
  test("is one value, and the dot background is square on it", () => {
    // Everything else here is relative to GRID, so this is the only literal.
    expect(GRID).toBe(33);
    expect(S.paper.backgroundSize).toBe(`${GRID}px ${GRID}px`);
    expect(S.paper.backgroundPosition).toBe(GRID_BG_POSITION);
  });

  test("puts a dot under the bullet column, not under the page edge", () => {
    // 20px page padding + 4px entry padding + half the 22px bullet = 35px from
    // the content column's left edge. The comment in lib/grid.ts derives it; this
    // fails if any of those three change without the anchor changing with them.
    expect(px(S.paperInner.padding!.split(" ")[1])).toBe(20);
    expect(GRID_BG_POSITION).toContain(`${35 - GRID / 2}px`);
    expect(GRID_BG_POSITION).toContain(`${-GRID / 2}px`);
  });

  test("starts the page on a full row", () => {
    // paperInner's top padding is one full row, so the first entry's line box
    // begins where a dot row begins rather than part-way through one.
    const [top] = vertical(S.paperInner.padding as string);
    expect(top).toBe(GRID);
  });
});

describe("blocks that are not a single line still sum to whole rows", () => {
  // Each of these quotes the comment above the key it pins. A block that comes
  // out at 64px instead of 66px pushes every entry below it 2px off the dots, and
  // then so is every page that renders it.

  test("sectionHead: one title line + 4px pad + 1px rule + margin = 2 rows", () => {
    const line = px(S.sectionTitle.lineHeight);
    const sum =
      line + px(S.sectionHead.paddingBottom) + 1 + px(S.sectionHead.marginBottom);
    expect(line).toBe(GRID);
    expect(sum).toBe(2 * GRID);
    expect(S.sectionHead.borderBottom).toBe("1px solid var(--line)");
  });

  test("futureLogLink: margin + 10px pad + 1px rule + one line = 2 rows", () => {
    const sum =
      px(S.futureLogLink.marginTop) +
      px(S.futureLogLink.paddingTop) +
      1 +
      px(S.futureLogLink.lineHeight);
    expect(sum).toBe(2 * GRID);
  });

  test("flGroupHead: one label + 2px pad + 1px rule - 3px margin = one row", () => {
    // The negative margin is deliberate and is the whole reason this one works.
    const sum =
      px(S.subGroupLabel.lineHeight) +
      px(S.flGroupHead.paddingBottom) +
      1 +
      px(S.flGroupHead.marginBottom);
    expect(sum).toBe(GRID);
  });

  test("filterWrap reserves exactly two rows whether it is open or shut", () => {
    // Reserved rather than measured, so unfolding the filter does not shift the
    // journal under it.
    expect(px(S.filterWrap.height)).toBe(2 * GRID);
  });

  test("the empty-page line occupies three rows", () => {
    const [top, bottom] = vertical(S.empty.padding as string);
    expect(top + px(S.empty.lineHeight) + bottom).toBe(3 * GRID);
  });

  test("a section's own margin is one row", () => {
    expect(px(S.section.marginBottom)).toBe(GRID);
  });
});

describe("every line box on the journal page is a row or a documented short box", () => {
  // Exactly two heights are allowed, and nothing in styles.ts currently uses a
  // third. A full GRID row is a line of the journal. 13px is the short box the
  // small companions use, and it exists for a reason worth keeping: baseline
  // alignment in a flex line takes the tallest box, so a sub or a meta span with a
  // full row would stretch the title's line and knock everything below it off the
  // dots. Adding a third value here should mean deciding it belongs, not making a
  // failure go away.
  const ALLOWED = [GRID, 13];

  test("no style in styles.ts invents a third line height", () => {
    const odd: string[] = [];
    for (const [key, value] of Object.entries(S)) {
      const lh = (value as { lineHeight?: unknown }).lineHeight;
      if (lh === undefined) continue;
      // Unitless line heights are not on the grid by definition and are used
      // deliberately on prose that is not journal content (onboarding, notes).
      if (typeof lh === "number") continue;
      const n = px(lh);
      if (!ALLOWED.includes(n)) odd.push(`${key}: ${String(lh)}`);
    }
    expect(odd).toEqual([]);
  });

  test("the entry row and its bullet take their height from --grid, not a copy of it", () => {
    // A hardcoded 33px here would keep working and then quietly stop tracking
    // GRID the moment somebody retuned the page rhythm, which is the one change
    // lib/grid.ts promises is safe to make.
    const bullet = css.match(/\.bullet\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bullet).toContain("line-height: var(--grid)");
    const etext = css.match(/\.etext\s*\{[^}]*\}/)?.[0] ?? "";
    expect(etext).toContain("line-height: var(--grid)");
    // A sub-bullet indents by exactly one dot column, so it lands on a dot.
    const isSub = css.match(/\.entry\.isSub\s*\{[^}]*\}/)?.[0] ?? "";
    expect(isSub).toContain("margin-left: var(--grid)");
  });

  test("no rule in index.css hardcodes the grid value", () => {
    // 33px anywhere in the stylesheet is either a coincidence or a copy of GRID,
    // and both are worth a look.
    const lines = css
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /\b33px\b/.test(l));
    expect(lines.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});
