// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReviewMigrateSheet from "../../src/ui/ReviewMigrateSheet";
import type { Entry } from "../../src/lib/types";
import type { Scope } from "../../src/lib/dates";

vi.mock("../../src/store/journal", () => ({
  migrateEntry: vi.fn(),
  strikeEntry: vi.fn(),
}));

import { migrateEntry, strikeEntry } from "../../src/store/journal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const nowKeys: Record<Scope, string> = {
  day: "2026-07-24",
  week: "2026-W30",
  month: "2026-07",
  year: "2026",
};

const pastTask = (id: string, pk: string): { pk: string; entry: Entry } => ({
  pk,
  entry: {
    id,
    type: "task",
    text: `task ${id}`,
    priority: false,
    state: "open",
    pageKey: pk,
    createdAt: 0,
  },
});

test("empty state congratulates and offers Close", () => {
  const onClose = vi.fn();
  render(
    <ReviewMigrateSheet pastOpen={[]} nowKeys={nowKeys} onClose={onClose} />
  );
  expect(screen.getByText(/every past task has been dealt with/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("lists each past task with its source page", () => {
  render(
    <ReviewMigrateSheet
      pastOpen={[pastTask("a", "2026-07-20"), pastTask("b", "2026-06-01")]}
      nowKeys={nowKeys}
      onClose={vi.fn()}
    />
  );
  expect(screen.getByText("task a")).toBeTruthy();
  expect(screen.getByText("task b")).toBeTruthy();
});

test("migrating a task calls migrateEntry with the chosen period key", () => {
  render(
    <ReviewMigrateSheet
      pastOpen={[pastTask("a", "2026-07-20")]}
      nowKeys={nowKeys}
      onClose={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "› This week" }));
  expect(migrateEntry).toHaveBeenCalledWith("a", "2026-W30");
});

test("striking out a task calls strikeEntry", () => {
  render(
    <ReviewMigrateSheet
      pastOpen={[pastTask("a", "2026-07-20")]}
      nowKeys={nowKeys}
      onClose={vi.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Strike out/ })
  );
  expect(strikeEntry).toHaveBeenCalledWith("a");
});
