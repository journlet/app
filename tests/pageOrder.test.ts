import { describe, expect, test } from "vitest";
import {
  effectiveParents,
  groupByPage,
  orderPage,
} from "../src/store/pageOrder";
import type { Entry } from "../src/lib/types";

const e = (
  id: string,
  createdAt: number,
  parentId?: string,
  pageKey = "2026-07-24"
): Entry => ({
  id,
  type: "task",
  text: id,
  priority: false,
  state: "open",
  pageKey,
  createdAt,
  parentId,
});

const ids = (list: Entry[]) => list.map((x) => x.id);

describe("orderPage", () => {
  test("top-level entries keep creation order", () => {
    expect(ids(orderPage([e("c", 3), e("a", 1), e("b", 2)]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("a sub-bullet is drawn directly under its parent, not in time order", () => {
    // The point of the change: "d" was logged last but nests under "a", so it
    // moves up the page to sit beneath it. No stored order is needed.
    const out = orderPage([e("a", 1), e("b", 2), e("c", 3), e("d", 4, "a")]);
    expect(ids(out)).toEqual(["a", "d", "b", "c"]);
  });

  test("a parent can be any entry on the page, including one below", () => {
    // "a" nests under "c", which sits later in the page
    const out = orderPage([e("a", 1, "c"), e("b", 2), e("c", 3)]);
    expect(ids(out)).toEqual(["b", "c", "a"]);
  });

  test("several sub-bullets stay in creation order under their parent", () => {
    const out = orderPage([
      e("a", 1),
      e("x", 5, "a"),
      e("y", 2, "a"),
      e("b", 3),
    ]);
    expect(ids(out)).toEqual(["a", "y", "x", "b"]);
  });

  test("a child whose parent left the page is promoted, not hidden", () => {
    const out = orderPage([e("a", 1), e("orphan", 2, "gone")]);
    expect(ids(out)).toEqual(["a", "orphan"]);
    expect(out[1].parentId).toBeUndefined();
  });

  test("a merged grandchild re-attaches to the grandparent, keeping one level", () => {
    // Two devices offline: one nests b under a, the other nests c under b.
    const out = orderPage([e("a", 1), e("b", 2, "a"), e("c", 3, "b")]);
    expect(ids(out)).toEqual(["a", "b", "c"]);
    expect(out[1].parentId).toBe("a");
    expect(out[2].parentId).toBe("a"); // not "b" — that would be level three
  });

  test("a merged cycle promotes everything in it rather than hiding it", () => {
    // Two devices offline: one nests a under b, the other nests b under a.
    // A cycle has no top, so neither can be drawn as a child of the other.
    const out = orderPage([e("a", 1, "b"), e("b", 2, "a")]);
    expect(ids(out)).toEqual(["a", "b"]);
    expect(out.every((x) => x.parentId === undefined)).toBe(true);
  });

  test("a longer cycle is promoted whole", () => {
    const out = orderPage([e("a", 1, "b"), e("b", 2, "c"), e("c", 3, "a")]);
    expect(ids(out)).toEqual(["a", "b", "c"]);
    expect(out.every((x) => x.parentId === undefined)).toBe(true);
  });

  test("an entry hanging off a cycle attaches to it at top level", () => {
    const out = orderPage([e("a", 1, "b"), e("b", 2, "a"), e("d", 3, "a")]);
    expect(out.find((x) => x.id === "d")!.parentId).toBe("a");
    expect(out.find((x) => x.id === "a")!.parentId).toBeUndefined();
  });

  test("the repaired tree is identical whatever order the entries arrive in", () => {
    // Every device must resolve a merge the same way or the pages disagree.
    // Sibling order can still follow document order (Yjs converges on that);
    // what must not vary is who is nested under whom, even with tied stamps.
    const tree = (list: Entry[]) =>
      orderPage(list)
        .map((x) => `${x.id}:${x.parentId ?? "-"}`)
        .sort();
    expect(tree([e("b", 5, "a"), e("a", 5), e("c", 5, "b")])).toEqual(
      tree([e("c", 5, "b"), e("a", 5), e("b", 5, "a")])
    );
  });

  test("the same broken shape repairs the same way whatever the timestamps", () => {
    // Previously this depended on which entry happened to be older
    const shape = (list: Entry[]) =>
      orderPage(list).map((x) => `${x.id}:${x.parentId ?? "-"}`);
    expect(shape([e("x", 1, "y"), e("y", 2, "gone")])).toEqual(["y:-", "x:y"]);
    expect(shape([e("y", 1, "gone"), e("x", 2, "y")])).toEqual(["y:-", "x:y"]);
  });

  test("entries logged in the same millisecond keep the order they were logged", () => {
    // The sort is stable, so ties fall through to document order — which is
    // what the user typed, and what Yjs converges on across devices
    expect(ids(orderPage([e("first", 5), e("second", 5), e("third", 5)]))).toEqual(
      ["first", "second", "third"]
    );
  });

  test("an entry attaches to the nearest ancestor still on the page", () => {
    // y's own parent has gone, so y rises to top level — and x, which was
    // nested under y, stays nested under it rather than being promoted too
    const out = orderPage([e("x", 1, "y"), e("y", 2, "gone")]);
    expect(ids(out)).toEqual(["y", "x"]);
    expect(out[0].parentId).toBeUndefined();
    expect(out[1].parentId).toBe("y");
  });

  test("a deep chain flattens onto the one entry that is top level", () => {
    const out = orderPage([
      e("a", 1),
      e("b", 2, "a"),
      e("c", 3, "b"),
      e("d", 4, "c"),
    ]);
    expect(ids(out)).toEqual(["a", "b", "c", "d"]);
    expect(out.slice(1).every((x) => x.parentId === "a")).toBe(true);
  });

  test("no entry is ever drawn as the child of another child", () => {
    // The one-level rule, asserted on the output rather than the input
    const out = orderPage([
      e("a", 1),
      e("b", 2, "a"),
      e("c", 3, "b"),
      e("d", 4, "gone"),
      e("f", 5, "f"),
    ]);
    const parents = new Set(out.map((x) => x.parentId).filter(Boolean));
    for (const p of parents)
      expect(out.find((x) => x.id === p)!.parentId).toBeUndefined();
  });

  test("a duplicated id is drawn once, not twice", () => {
    // Two devices both undoing the same delete converge on two rows, one id
    const out = orderPage([e("a", 1), e("a", 1), e("c", 2, "a")]);
    expect(ids(out)).toEqual(["a", "c"]);
  });

  test("duplicate rows of one id resolve to a single, consistent answer", () => {
    // The two rows disagree about a's parent. Whichever wins, the result has
    // to be a tree the one-level rule holds for — a resolved for one purpose
    // and differently for another is how the store and the page fall out of
    // step, which is what makes the app refuse things it has just offered.
    const out = orderPage([
      e("a", 1),
      e("a", 1, "c"),
      e("b", 2, "a"),
      e("c", 3),
    ]);
    const byId = new Map(out.map((x) => [x.id, x]));
    for (const x of out)
      if (x.parentId) expect(byId.get(x.parentId)!.parentId).toBeUndefined();
    expect(new Set(ids(out)).size).toBe(out.length);
  });

  test("effectiveParents never returns a parent that is itself a child", () => {
    // The one-level rule stated directly on the resolver, over a nasty mix
    const page = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "c" },
      { id: "c", parentId: "a" },
      { id: "d", parentId: "b" },
      { id: "f", parentId: "missing" },
      { id: "g" },
      { id: "h", parentId: "g" },
      { id: "h", parentId: "f" },
    ];
    const eff = effectiveParents(page);
    for (const [, parent] of eff)
      if (parent !== undefined) expect(eff.get(parent)).toBeUndefined();
  });

  test("an entry claiming itself as parent is promoted", () => {
    const out = orderPage([e("a", 1, "a")]);
    expect(ids(out)).toEqual(["a"]);
    expect(out[0].parentId).toBeUndefined();
  });

  test("every entry is always rendered exactly once", () => {
    const out = orderPage([
      e("a", 1, "b"),
      e("b", 2, "c"),
      e("c", 3, "a"),
      e("d", 4, "missing"),
      e("f", 5),
    ]);
    expect(out).toHaveLength(5);
    expect(new Set(ids(out)).size).toBe(5);
  });
});

describe("groupByPage", () => {
  test("splits by page key and orders each page independently", () => {
    const days = groupByPage([
      e("a", 1),
      e("b", 2, "a"),
      e("m", 3, undefined, "2026-07"),
    ]);
    expect(ids(days["2026-07-24"])).toEqual(["a", "b"]);
    expect(ids(days["2026-07"])).toEqual(["m"]);
  });

  test("nesting does not reach across pages", () => {
    // A child on a different page from its parent is its own page's orphan
    const days = groupByPage([e("a", 1), e("b", 2, "a", "2026-07")]);
    expect(days["2026-07"][0].parentId).toBeUndefined();
  });
});
