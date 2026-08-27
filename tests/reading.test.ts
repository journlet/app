// The reading badge's wording (src/lib/reading.ts, spec §4.9a revised
// 27 August 2026). One badge for the whole block: it names one thing, counts
// two, and goes to full ink whenever either half is set.

import { describe, expect, test } from "vitest";
import {
  readingActive,
  readingAria,
  readingBadge,
} from "../src/lib/reading";

describe("readingActive", () => {
  test("nothing set is not active — the page is as the journal drew it", () => {
    expect(readingActive("all", "logged")).toBe(false);
    expect(readingActive("all", null)).toBe(false);
  });

  test("either half on its own is enough", () => {
    expect(readingActive("open", "logged")).toBe(true);
    expect(readingActive("all", "priority")).toBe(true);
  });

  test("an order on a page that has none does not count", () => {
    // the Future log: its rows come from other pages, so there is no sequence
    expect(readingActive("all", null)).toBe(false);
  });
});

describe("readingBadge", () => {
  test("the bare noun while there is nothing to say", () => {
    expect(readingBadge("all", "logged")).toBe("reading");
  });

  test("one thing set is named", () => {
    expect(readingBadge("open", "logged")).toBe("reading · open only");
    expect(readingBadge("tasks", "logged")).toBe("reading · tasks only");
    expect(readingBadge("all", "priority")).toBe("reading · priority first");
    expect(readingBadge("all", "type")).toBe("reading · type order");
  });

  test("shortened below 480px, the same way the filter's wording already was", () => {
    expect(readingBadge("open", "logged", true)).toBe("reading · open");
    expect(readingBadge("all", "priority", true)).toBe("reading · priority");
  });

  test("both set, it counts them — 375px has no room for both in words", () => {
    expect(readingBadge("open", "priority")).toBe("reading · 2 set");
    expect(readingBadge("tasks", "type")).toBe("reading · 2 set");
    // and the count does not change with the width
    expect(readingBadge("open", "priority", true)).toBe("reading · 2 set");
  });

  test("an order the page does not apply is never counted", () => {
    expect(readingBadge("open", null)).toBe("reading · open only");
    expect(readingBadge("all", null)).toBe("reading");
  });
});

describe("readingAria", () => {
  test("a screen reader hears both halves, in full, never the count", () => {
    expect(readingAria("open", "priority")).toBe(
      "reading · open only, priority first"
    );
  });

  test("and the bare noun when nothing is set", () => {
    expect(readingAria("all", "logged")).toBe("reading");
  });
});
