// The reading badge's wording (src/lib/reading.ts, spec §4.9, §4.9a, §11 Q20;
// rewritten 27 August 2026). The badge names the kind of change rather than its
// value, and the accessible name gives back the value the label gives up.

import { describe, expect, test } from "vitest";
import { readingActive, readingAria, readingBadge } from "../src/lib/reading";

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
    expect(readingBadge("all", "logged")).toBe("filter");
    expect(readingBadge("all", null)).toBe("filter");
  });

  test("something hidden reads 'filtered', whichever filter is doing it", () => {
    expect(readingBadge("open", "logged")).toBe("filtered");
    expect(readingBadge("tasks", "logged")).toBe("filtered");
  });

  // The cost of naming the kind rather than the value, written down where it
  // cannot be lost: these two show very different pages, since "open only"
  // keeps your notes and events and "tasks only" removes them, and the button
  // says the same thing about both. One tap, or the accessible name below,
  // says which (spec §11 Q20).
  test("tasks only and open only are deliberately indistinguishable here", () => {
    expect(readingBadge("tasks", "logged")).toBe(readingBadge("open", "logged"));
  });

  // An order hides nothing, so "filtered" would be false. It gets its own word
  // rather than borrowing one that would be a small lie.
  test("an order alone reads 'sorted', never 'filtered'", () => {
    expect(readingBadge("all", "priority")).toBe("sorted");
    expect(readingBadge("all", "type")).toBe("sorted");
  });

  test("both set, both are named — there is room for it now", () => {
    expect(readingBadge("open", "priority")).toBe("filtered, sorted");
    expect(readingBadge("tasks", "type")).toBe("filtered, sorted");
  });

  test("a page with no order of its own can never say 'sorted'", () => {
    expect(readingBadge("all", null)).toBe("filter");
    expect(readingBadge("open", null)).toBe("filtered");
  });
});

describe("readingAria", () => {
  test("the bare noun when nothing is set", () => {
    expect(readingAria("all", "logged")).toBe("filter");
    expect(readingAria("all", null)).toBe("filter");
  });

  // A screen reader has no width problem, so it hears which filter and which
  // order, not merely that there is one. This is the half of §11 Q20 that keeps
  // the shortened label honest.
  test("a screen reader hears the values in full", () => {
    expect(readingAria("open", "logged")).toBe("filtered · open only");
    expect(readingAria("tasks", "logged")).toBe("filtered · tasks only");
    expect(readingAria("all", "priority")).toBe("sorted · priority first");
    expect(readingAria("open", "priority")).toBe(
      "filtered, sorted · open only, priority first"
    );
  });

  test("what the eye cannot separate, the accessible name can", () => {
    expect(readingAria("tasks", "logged")).not.toBe(readingAria("open", "logged"));
  });

  test("and it never claims an order the page is not applying", () => {
    expect(readingAria("open", null)).toBe("filtered · open only");
  });
});
