// @vitest-environment jsdom
//
// Reading order (src/lib/order.ts and store/pageOrder.ts's applyOrder,
// spec §4.9a, §11 Q16). jsdom for the localStorage half; the rest is pure.
import { afterEach, describe, expect, test } from "vitest";
import {
  ORDERS,
  ORDER_LABEL,
  ORDER_NOTE,
  ORDER_STANDING,
  compareTop,
  loadOrder,
  saveOrder,
} from "../src/lib/order";
import { applyOrder } from "../src/store/pageOrder";
import type { Entry } from "../src/lib/types";

const e = (
  id: string,
  over: Partial<Entry> = {},
  at = Number(id.replace(/\D/g, "")) || 0
): Entry => ({
  id,
  type: "task",
  text: id,
  priority: false,
  state: "open",
  pageKey: "2026-08-25",
  createdAt: at,
  ...over,
});

const ids = (list: Entry[]) => list.map((x) => x.id).join(",");

describe("the vocabulary", () => {
  test("every order is labelled, noted and has a standing line decided", () => {
    for (const o of ORDERS) {
      expect(ORDER_LABEL[o]).toBeTruthy();
      expect(ORDER_NOTE[o]).toBeTruthy();
      expect(typeof ORDER_STANDING[o]).toBe("string");
    }
  });

  test("as logged says nothing on the page — it is the page as written", () => {
    expect(ORDER_STANDING.logged).toBe("");
    expect(ORDER_STANDING.priority).toBeTruthy();
    expect(ORDER_STANDING.type).toBeTruthy();
  });
});

describe("the comparator", () => {
  test("as logged is creation order", () => {
    const page = [e("3"), e("1"), e("2")];
    expect(ids([...page].sort(compareTop("logged")))).toBe("1,2,3");
  });

  test("priority lifts the marked entries and leaves the rest alone", () => {
    const page = [e("1"), e("2", { priority: true }), e("3"), e("4", { priority: true })];
    expect(ids([...page].sort(compareTop("priority")))).toBe("2,4,1,3");
  });

  test("type is tasks, then events, then notes", () => {
    const page = [e("1", { type: "note" }), e("2", { type: "event" }), e("3")];
    expect(ids([...page].sort(compareTop("type")))).toBe("3,2,1");
  });

  test("createdAt is always the last word, so a tie cannot differ by device", () => {
    const page = [e("2", { priority: true }), e("1", { priority: true })];
    expect(ids([...page].sort(compareTop("priority")))).toBe("1,2");
    expect(ids([...page].sort(compareTop("type")))).toBe("1,2");
  });
});

describe("reading a page in an order", () => {
  test("as logged is the page untouched, and the same array", () => {
    const page = [e("2"), e("1")];
    expect(applyOrder(page, "logged")).toBe(page);
  });

  test("a sub-bullet stays under its parent wherever the parent lands", () => {
    const page = [
      e("1"),
      e("2", { parentId: "1" }),
      e("3", { priority: true }),
      e("4", { parentId: "3" }),
    ];
    expect(ids(applyOrder(page, "priority"))).toBe("3,4,1,2");
  });

  test("sub-bullets keep their own creation order under the parent", () => {
    const page = [e("1"), e("3", { parentId: "1" }), e("2", { parentId: "1" })];
    // they arrive in page order and are not re-sorted among themselves
    expect(ids(applyOrder(page, "priority"))).toBe("1,3,2");
  });

  test("a sub-bullet is judged on its parent, never lifted out of the branch", () => {
    // the child carries the priority mark; the branch must not break apart
    const page = [e("1"), e("2", { parentId: "1", priority: true }), e("3")];
    expect(ids(applyOrder(page, "priority"))).toBe("1,2,3");
  });

  test("an orphan is drawn at top level rather than dropped", () => {
    // the filter can leave a child whose parent is off the page; nothing may
    // vanish from a page for any reason
    const page = [e("1"), e("2", { parentId: "missing" })];
    expect(ids(applyOrder(page, "type"))).toBe("1,2");
  });

  test("nothing is ever lost or repeated, whatever the order", () => {
    const page = [
      e("1", { type: "note" }),
      e("2", { parentId: "1" }),
      e("3", { priority: true, type: "event" }),
      e("4"),
      e("5", { parentId: "4", type: "note" }),
    ];
    for (const o of ORDERS) {
      const out = applyOrder(page, o);
      expect(out).toHaveLength(page.length);
      expect(new Set(out.map((x) => x.id)).size).toBe(page.length);
    }
  });

  test("reading a page is never a write — the caller's array is untouched", () => {
    const page = [e("1"), e("2", { priority: true })];
    const before = ids(page);
    applyOrder(page, "priority");
    expect(ids(page)).toBe(before);
  });
});

describe("the preference", () => {
  afterEach(() => localStorage.clear());

  test("round-trips, and an unknown stored value reads as the page's own order", () => {
    saveOrder("priority");
    expect(loadOrder()).toBe("priority");
    localStorage.setItem("journlet-order-v1", "by-colour");
    expect(loadOrder()).toBe("logged");
    localStorage.removeItem("journlet-order-v1");
    expect(loadOrder()).toBe("logged");
  });
});
