// @vitest-environment jsdom
// The sheet behind "N earlier still open" (spec §11 Q15). The absent action
// is as much a decision as the present ones, so it is asserted here: a
// repeating task is never migrated forward from this list, because the rule
// has already put the current occurrence on the current page.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EarlierOccurrencesSheet from "../../src/ui/EarlierOccurrencesSheet";
import type { Entry } from "../../src/lib/types";

vi.mock("../../src/store/journal", () => ({
  strikeEntry: vi.fn(),
  toggleDone: vi.fn(),
}));

import { strikeEntry, toggleDone } from "../../src/store/journal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const entry = (over: Partial<Entry> & { id: string; pageKey: string }): Entry => ({
  type: "task",
  text: "Take the bins out",
  priority: false,
  state: "open",
  createdAt: 0,
  recurrenceId: "r1",
  ...over,
});

const today = entry({ id: "e-today", pageKey: "2026-07-24" });
const occurrences = [
  { pk: "2026-07-22", entry: entry({ id: "e-wed", pageKey: "2026-07-22" }) },
  { pk: "2026-07-23", entry: entry({ id: "e-thu", pageKey: "2026-07-23" }) },
];

const setup = (list = occurrences) => {
  const onClose = vi.fn();
  render(
    <EarlierOccurrencesSheet
      entry={today}
      occurrences={list}
      cadence="repeats every day"
      onClose={onClose}
    />
  );
  return { onClose };
};

test("names each earlier occurrence by its own page", () => {
  setup();
  expect(screen.getByText(/Wed, 22 Jul|22 Jul/)).toBeTruthy();
  expect(screen.getByText(/Thu, 23 Jul|23 Jul/)).toBeTruthy();
});

test("offers completing and striking out, and never migrating", () => {
  setup();
  expect(screen.getAllByText("× Mark complete")).toHaveLength(2);
  expect(
    screen.getAllByText("Strike out (no longer relevant)")
  ).toHaveLength(2);
  expect(screen.queryByText(/bring forward|migrate/i)).toBeNull();
});

test("completing acts on that occurrence, not on the entry it was opened from", () => {
  setup();
  fireEvent.click(screen.getAllByText("× Mark complete")[0]);
  expect(toggleDone).toHaveBeenCalledWith("e-wed");
});

test("striking out acts on that occurrence", () => {
  setup();
  fireEvent.click(screen.getAllByText("Strike out (no longer relevant)")[1]);
  expect(strikeEntry).toHaveBeenCalledWith("e-thu");
});

test("an emptied list says so rather than disappearing", () => {
  setup([]);
  expect(screen.getByText(/All dealt with/)).toBeTruthy();
});
