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
  filterOpen: false,
  onToggleFilter: vi.fn(),
  saving: false,
  syncStatus: "synced" as SyncStatus,
  onSyncClick: vi.fn(),
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

test("shows the saving cue only while saving", () => {
  const { rerender } = render(<Header {...base} saving={false} />);
  expect(screen.queryByText("saving…")).toBeNull();
  rerender(<Header {...base} saving={true} />);
  expect(screen.getByText("saving…")).toBeTruthy();
});

test("renders the sync badge label and fires onSyncClick", () => {
  const onSyncClick = vi.fn();
  render(<Header {...base} syncStatus="synced" onSyncClick={onSyncClick} />);
  const btn = screen.getByRole("button", { name: "sync · synced" });
  fireEvent.click(btn);
  expect(onSyncClick).toHaveBeenCalledTimes(1);
});

test("an attention status colours the sync button", () => {
  render(<Header {...base} syncStatus="offline" />);
  const btn = screen.getByRole("button", {
    name: "sync · offline",
  }) as HTMLButtonElement;
  expect(btn.style.color).toBe("var(--danger)");
});

// The filter badge (remediation item 7, revised 4 Aug 2026). The row is chrome
// and stays closed until asked for, which means the button has to carry the
// state: a page can be filtered with the control out of sight, and a journal
// quietly showing you less than it holds is the one thing this must not do.
test("the filter button reads 'filter' while everything is showing", () => {
  render(<Header {...base} filter="all" />);
  const btn = screen.getByRole("button", { name: "filter" }) as HTMLButtonElement;
  // muted like every other header button — nothing to say
  expect(btn.style.color).toBe("");
});

test("an applied filter is named on the button, in full ink", () => {
  render(<Header {...base} filter="open" />);
  const btn = screen.getByRole("button", {
    name: "filter · open only",
  }) as HTMLButtonElement;
  expect(btn.style.color).toBe("var(--ink)");
  expect(btn.style.borderColor).toBe("var(--ink)");
  // attention, not alarm — the danger colour belongs to sync
  expect(btn.style.color).not.toBe("var(--danger)");
});

test("tasks only is named too", () => {
  render(<Header {...base} filter="tasks" />);
  expect(screen.getByRole("button", { name: "filter · tasks only" })).toBeTruthy();
});

test("the button reports whether the row is open, and toggles it", () => {
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

test("no filter button on pages the filter does not apply to", () => {
  render(<Header {...base} filter={null} />);
  expect(screen.queryByRole("button", { name: /^filter/ })).toBeNull();
});
