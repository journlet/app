// Reading order (spec §4.9a, §11 Q16). The companion to lib/filter.ts, and
// deliberately the same shape: a device preference that changes how one page
// reads and nothing else.
//
// A filter subtracts; an order rearranges. Neither rewrites an entry, changes
// a state or touches the notation — a completed task is still × wherever it
// lands, and nothing is stored on the journal. The vocabulary lives here; the
// rearranging itself is in store/pageOrder.ts, which is the one place page
// order is decided and already owns the parent/child tree this has to respect.

import type { Entry } from "./types";

export type EntryOrder = "logged" | "priority" | "type";

export const ORDERS: EntryOrder[] = ["logged", "priority", "type"];

/** Button wording. Spelled out, like the filter's — no glyph, nothing to work out. */
export const ORDER_LABEL: Record<EntryOrder, string> = {
  logged: "as logged",
  priority: "priority",
  type: "by type",
};

/** Shorter still, for the narrow track — the same device the filter row uses. */
export const ORDER_SHORT: Record<EntryOrder, string> = {
  logged: "logged",
  priority: "priority",
  type: "type",
};

/** What the order is doing, said under the row while it is open. */
export const ORDER_NOTE: Record<EntryOrder, string> = {
  logged: "in the order you logged them",
  priority: "priority marks first, then as logged",
  type: "tasks, then events, then notes",
};

/**
 * What the header badge says about a non-default order, with the short form
 * the narrow screen uses — the same long/short pair the filter's own wording
 * keeps (spec §4.9a, revised 27 August 2026).
 *
 * This replaced a standing caption on the page. The caption was there because
 * an order is not a subtraction: a sorted page looks like an ordinary page in
 * an order the journal never put it in, so it had to say so somewhere. It said
 * so in 11.5px italic soft ink on a 33px line, which is the filter note's
 * styling in the filter note's slot, and it read as a control that had failed
 * to close rather than as a statement about the page. The badge carries it
 * instead, where it sits beside the filter's state and cannot be mistaken for
 * a leftover row. Empty for "logged": that is the page as written.
 */
export const ORDER_BADGE: Record<EntryOrder, string> = {
  logged: "",
  priority: "priority first",
  type: "type order",
};

/** The same, shortened below 480px (see lib/reading.ts for the measurements). */
export const ORDER_BADGE_SHORT: Record<EntryOrder, string> = {
  logged: "",
  priority: "priority",
  type: "type",
};

export const ORDER_ARIA: Record<EntryOrder, string> = {
  logged: "Show entries in the order they were logged",
  priority: "Show entries with priority marks first",
  type: "Show entries by type: tasks, then events, then notes",
};

/** Tasks, then events, then notes — §4.1's own reading order for the glyphs. */
const TYPE_RANK: Record<Entry["type"], number> = { task: 0, event: 1, note: 2 };

/**
 * How two top-level entries compare under this order.
 *
 * `createdAt` is always the last word, so every order is stable and every
 * device agrees: a sort that ties has to fall back to the one key the journal
 * actually stores, or two devices could draw the same page differently with
 * nothing wrong on either (spec §4.1's resolver rule, applied to reading).
 */
export const compareTop =
  (order: EntryOrder) =>
  (a: Entry, b: Entry): number => {
    if (order === "priority") {
      const byPriority = Number(Boolean(b.priority)) - Number(Boolean(a.priority));
      if (byPriority !== 0) return byPriority;
    }
    if (order === "type") {
      const byType = TYPE_RANK[a.type] - TYPE_RANK[b.type];
      if (byType !== 0) return byType;
    }
    return a.createdAt - b.createdAt;
  };

const KEY = "journlet-order-v1";

export const loadOrder = (): EntryOrder => {
  try {
    const raw = localStorage.getItem(KEY) as EntryOrder | null;
    return raw && ORDERS.includes(raw) ? raw : "logged";
  } catch {
    return "logged";
  }
};

export const saveOrder = (o: EntryOrder): void => {
  try {
    localStorage.setItem(KEY, o);
  } catch {
    // A device that cannot remember how it reads still reads.
  }
};
