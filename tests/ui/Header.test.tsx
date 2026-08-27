// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Header from "../../src/ui/Header";
import type { SyncStatus } from "../../src/store/sync";

afterEach(cleanup);

const base = {
  showBack: false,
  showMenu: true,
  onBack: vi.fn(),
  onMenu: vi.fn(),
  filter: "all" as const,
  order: "logged" as const,
  filterOpen: false,
  onToggleFilter: vi.fn(),
  syncStatus: "synced" as SyncStatus,
};

test("shows the menu button on the home view and fires onMenu", () => {
  const onMenu = vi.fn();
  render(<Header {...base} showMenu showBack={false} onMenu={onMenu} />);
  expect(screen.queryByRole("button", { name: "back" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  expect(onMenu).toHaveBeenCalledTimes(1);
});

test("shows the back button on sub-views and fires onBack", () => {
  const onBack = vi.fn();
  render(<Header {...base} showBack showMenu={false} onBack={onBack} />);
  fireEvent.click(screen.getByRole("button", { name: "back" }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("search does not live in the header — it is on the capture bar", () => {
  render(<Header {...base} />);
  expect(screen.queryByRole("button", { name: "search" })).toBeNull();
  expect(screen.queryByRole("button", { name: /find/i })).toBeNull();
});

// The pinned corner (spec §11 Q20). The button that goes somewhere is the last
// item in the row, so it holds still while the badge beside it changes wording.
// This is the test that would have caught the old order, where `menu` travelled
// 87.9px across the states at 375px because the sync badge was last.
test("the button that navigates is last in the row, after the badge", () => {
  render(<Header {...base} filter="open" order="priority" />);
  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  expect(buttons).toEqual(["filtered, sorted", "menu"]);
});

test("and on a sub-page it is alone in the corner", () => {
  render(<Header {...base} showBack showMenu={false} filter={null} />);
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["back"]);
});

// Sync's three tiers (spec §4.5 revised, §11 Q20). There is no pill: this
// header shows the middle tier only, and it is not a button, because there is
// nothing to do about the states it names.
test("no sync button anywhere in the header", () => {
  render(<Header {...base} syncStatus="offline" />);
  expect(screen.queryByRole("button", { name: /sync/ })).toBeNull();
});

test("offline is said in words, in the left slot", () => {
  render(<Header {...base} syncStatus="offline" />);
  const slot = screen.getByRole("status");
  expect(slot.textContent).toBe("offline");
  // a state, so full ink — but never the danger colour, since offline is not a
  // fault in an offline-first journal
  expect(slot.style.color).toBe("var(--ink)");
  expect(slot.style.color).not.toBe("var(--danger)");
});

test.each(["synced", "pending", "connecting", "starting", "disabled"] as SyncStatus[])(
  "a state with nothing to say leaves the slot empty: %s",
  (status) => {
    render(<Header {...base} syncStatus={status} />);
    expect(screen.getByRole("status").textContent).toBe("");
  }
);

// The states that need an action belong to NotSyncingBanner, which offers the
// action. Saying it here as well would be the same fact twice in two registers.
test.each(["signed-out", "needs-key"] as SyncStatus[])(
  "a state that needs you is not answered up here: %s",
  (status) => {
    render(<Header {...base} syncStatus={status} />);
    expect(screen.getByRole("status").textContent).toBe("");
  }
);

// The live region is rendered even while empty. One that appears with its text
// already in it is not reliably announced, and this slot is now the only place
// a screen reader learns that the device has gone offline.
test("the live region exists before it has anything to announce", () => {
  const { rerender } = render(<Header {...base} syncStatus="synced" />);
  const slot = screen.getByRole("status");
  expect(slot.getAttribute("aria-live")).toBe("polite");
  rerender(<Header {...base} syncStatus="offline" />);
  expect(screen.getByRole("status")).toBe(slot);
  expect(slot.textContent).toBe("offline");
});

// There was a "saving…" cue here until 27 August 2026. It reported nothing:
// a 400ms timer started by any Yjs update, including updates arriving from
// another device (spec §11 Q20).
test("no saving cue", () => {
  render(<Header {...base} />);
  expect(screen.queryByText(/saving/i)).toBeNull();
});

// The reading badge (remediation item 7, revised 4 August 2026; took the order
// on 27 August 2026, §4.9a; became `filter` and named the kind the same day,
// §11 Q20). The block is chrome and stays closed, so the button has to carry
// the state: a journal quietly showing you less than it holds, or in an order
// you have forgotten choosing, is the thing this must not do.
test("the button reads 'filter' while the page is as the journal drew it", () => {
  render(<Header {...base} filter="all" order="logged" />);
  const btn = screen.getByRole("button", { name: "filter" }) as HTMLButtonElement;
  expect(btn.textContent).toBe("filter");
  // muted like every other header button — nothing to say
  expect(btn.style.color).toBe("");
  expect(btn.style.fontWeight).toBe("");
});

test("something hidden reads 'filtered', in full ink and heavier", () => {
  render(<Header {...base} filter="open" />);
  const btn = screen.getByRole("button", {
    name: "filtered · open only",
  }) as HTMLButtonElement;
  expect(btn.textContent).toBe("filtered");
  expect(btn.style.color).toBe("var(--ink)");
  expect(btn.style.borderColor).toBe("var(--ink)");
  expect(btn.style.fontWeight).toBe("600");
  // attention, not alarm — the danger colour belongs to the banner
  expect(btn.style.color).not.toBe("var(--danger)");
});

// The cost of §11 Q20, asserted rather than left implicit: on the button these
// two are the same word, and they are very different pages. The accessible
// name is where they part.
test("tasks only and open only read the same on the button, and differ in the name", () => {
  const { rerender } = render(<Header {...base} filter="tasks" />);
  expect(screen.getByRole("button", { name: "filtered · tasks only" }).textContent)
    .toBe("filtered");
  rerender(<Header {...base} filter="open" />);
  expect(screen.getByRole("button", { name: "filtered · open only" }).textContent)
    .toBe("filtered");
});

// The half this button gained: an order changes nothing about how much of the
// page is there, so without the badge a sorted page looks like an ordinary one.
// It reads "sorted" rather than "filtered", because nothing is hidden.
test("an order alone lights the button and reads 'sorted'", () => {
  render(<Header {...base} filter="all" order="priority" />);
  const btn = screen.getByRole("button", {
    name: "sorted · priority first",
  }) as HTMLButtonElement;
  expect(btn.textContent).toBe("sorted");
  expect(btn.style.color).toBe("var(--ink)");
});

test("both set, both are named — the count is gone", () => {
  render(<Header {...base} filter="open" order="priority" />);
  const btn = screen.getByRole("button", {
    name: "filtered, sorted · open only, priority first",
  }) as HTMLButtonElement;
  expect(btn.textContent).toBe("filtered, sorted");
  expect(btn.textContent).not.toContain("2 set");
  expect(btn.style.color).toBe("var(--ink)");
});

// The Future log takes no order (§4.9a), so the badge there must not report one
// the page is not applying.
test("where an order does not apply, the badge ignores it", () => {
  render(<Header {...base} filter="all" order={null} />);
  const btn = screen.getByRole("button", { name: "filter" }) as HTMLButtonElement;
  expect(btn.style.color).toBe("");
});

test("the button reports whether the block is open, and toggles it", () => {
  const onToggleFilter = vi.fn();
  const { rerender } = render(
    <Header {...base} filterOpen={false} onToggleFilter={onToggleFilter} />
  );
  const btn = screen.getByRole("button", { name: "filter" });
  expect(btn.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(btn);
  expect(onToggleFilter).toHaveBeenCalledTimes(1);
  rerender(<Header {...base} filterOpen={true} onToggleFilter={onToggleFilter} />);
  expect(
    screen.getByRole("button", { name: "filter" }).getAttribute("aria-expanded")
  ).toBe("true");
});

test("no reading button on pages it does not apply to", () => {
  render(<Header {...base} filter={null} />);
  expect(screen.queryByRole("button", { name: /^filter/ })).toBeNull();
});
