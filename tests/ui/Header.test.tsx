// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Header from "../../src/ui/Header";
import type { SyncStatus } from "../../src/store/sync";

afterEach(cleanup);

// Header.tsx's SYNC_BADGE, restated here on purpose. Exporting it would let a
// change to the wording pass both sides of the test at once.
const SYNC_LABELS: Record<SyncStatus, string> = {
  disabled: "sync",
  starting: "sync · starting…",
  "signed-out": "sync · signed out",
  connecting: "sync · connecting…",
  "needs-key": "sync · key needed",
  synced: "sync · synced",
  pending: "sync · waiting",
  offline: "sync · offline",
};

const base = {
  showBack: false,
  showMenu: true,
  onBack: vi.fn(),
  onMenu: vi.fn(),
  filter: "all" as const,
  order: "logged" as const,
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

// The badge's wording (spec §4.5, shortened 26 August 2026). Same rule as the
// filter button above: the bare noun while there is nothing to say, the state
// named when there is. The width this buys is the point — at 375px the full
// wording of the longest status does not fit beside menu and a named filter.
test.each(["synced", "connecting", "starting", "disabled"] as SyncStatus[])(
  "a status that needs nothing shows the bare noun: %s",
  (status) => {
    render(<Header {...base} syncStatus={status} />);
    const btn = screen.getByRole("button", {
      name: SYNC_LABELS[status],
    }) as HTMLButtonElement;
    // said in full to a screen reader, short on screen
    expect(btn.textContent).toBe("sync");
    // muted like every other header button — nothing to say
    expect(btn.style.color).toBe("");
  }
);

test.each(["offline", "pending", "signed-out", "needs-key"] as SyncStatus[])(
  "a status that needs you is named on the button: %s",
  (status) => {
    render(<Header {...base} syncStatus={status} />);
    const btn = screen.getByRole("button", {
      name: SYNC_LABELS[status],
    }) as HTMLButtonElement;
    expect(btn.textContent).toBe(SYNC_LABELS[status]);
    expect(btn.style.color).toBe("var(--danger)");
  }
);

test("shortening never costs the accessible name", () => {
  const { rerender } = render(<Header {...base} syncStatus="connecting" />);
  expect(screen.getByRole("button", { name: "sync · connecting…" })).toBeTruthy();
  rerender(<Header {...base} syncStatus="starting" />);
  expect(screen.getByRole("button", { name: "sync · starting…" })).toBeTruthy();
});

// The reading badge (remediation item 7, revised 4 Aug 2026; took the order on
// 27 Aug 2026, §4.9a). The block is chrome and stays closed until asked for,
// which means the button has to carry the state: a page can be filtered or
// sorted with the control out of sight, and a journal quietly showing you less
// than it holds, or in an order you have forgotten choosing, is the thing this
// must not do.
test("the button reads 'reading' while the page is as the journal drew it", () => {
  render(<Header {...base} filter="all" order="logged" />);
  const btn = screen.getByRole("button", { name: "reading" }) as HTMLButtonElement;
  // muted like every other header button — nothing to say
  expect(btn.style.color).toBe("");
});

test("an applied filter is named on the button, in full ink", () => {
  render(<Header {...base} filter="open" />);
  const btn = screen.getByRole("button", {
    name: "reading · open only",
  }) as HTMLButtonElement;
  expect(btn.style.color).toBe("var(--ink)");
  expect(btn.style.borderColor).toBe("var(--ink)");
  // attention, not alarm — the danger colour belongs to sync
  expect(btn.style.color).not.toBe("var(--danger)");
});

test("tasks only is named too", () => {
  render(<Header {...base} filter="tasks" />);
  expect(screen.getByRole("button", { name: "reading · tasks only" })).toBeTruthy();
});

// The half this button gained: an order changes nothing about how much of the
// page is there, so without the badge a sorted page looks like an ordinary one.
test("an order alone lights the button and is named on it", () => {
  render(<Header {...base} filter="all" order="priority" />);
  const btn = screen.getByRole("button", {
    name: "reading · priority first",
  }) as HTMLButtonElement;
  expect(btn.style.color).toBe("var(--ink)");
});

test("both set, the button counts them — there is no room for both in words", () => {
  render(<Header {...base} filter="open" order="priority" />);
  const btn = screen.getByRole("button", {
    // said in full to a screen reader, counted on screen
    name: "reading · open only, priority first",
  }) as HTMLButtonElement;
  expect(btn.textContent).toBe("reading · 2 set");
  expect(btn.style.color).toBe("var(--ink)");
});

// The Future log takes no order (§4.9a), so the badge there must not report one
// the page is not applying.
test("where an order does not apply, the badge ignores it", () => {
  render(<Header {...base} filter="all" order={null} />);
  const btn = screen.getByRole("button", { name: "reading" }) as HTMLButtonElement;
  expect(btn.style.color).toBe("");
});

test("the button reports whether the block is open, and toggles it", () => {
  const onToggleFilter = vi.fn();
  const { rerender } = render(
    <Header {...base} filterOpen={false} onToggleFilter={onToggleFilter} />
  );
  const btn = screen.getByRole("button", { name: "reading" });
  expect(btn.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(btn);
  expect(onToggleFilter).toHaveBeenCalledTimes(1);
  rerender(<Header {...base} filterOpen={true} onToggleFilter={onToggleFilter} />);
  expect(
    screen.getByRole("button", { name: "reading" }).getAttribute("aria-expanded")
  ).toBe("true");
});

test("no reading button on pages it does not apply to", () => {
  render(<Header {...base} filter={null} />);
  expect(screen.queryByRole("button", { name: /^reading/ })).toBeNull();
});
