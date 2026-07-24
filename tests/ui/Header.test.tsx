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
