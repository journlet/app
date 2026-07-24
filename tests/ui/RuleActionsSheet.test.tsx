// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RuleActionsSheet from "../../src/ui/RuleActionsSheet";
import type { Recurrence } from "../../src/lib/types";

vi.mock("../../src/store/journal", () => ({ endRecurrence: vi.fn() }));
vi.mock("../../src/store/recurrence", () => ({ skipOccurrence: vi.fn() }));

import { endRecurrence } from "../../src/store/journal";
import { skipOccurrence } from "../../src/store/recurrence";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rule: Recurrence = {
  id: "r1",
  text: "Standup",
  type: "task",
  priority: false,
  everyN: 1,
  unit: "day",
  pageScope: "day",
  anchor: "2026-07-20",
  materialisedThrough: "2026-07-24",
  createdAt: 0,
};

const setup = () => {
  const onClose = vi.fn();
  render(
    <RuleActionsSheet
      rule={rule}
      dayKey="2026-07-25"
      onClose={onClose}
      cadenceLabel={(n, u) => `every ${n} ${u}`}
    />
  );
  return { onClose };
};

test("shows the rule text and cadence", () => {
  setup();
  expect(screen.getByText("Standup")).toBeTruthy();
  expect(screen.getByText(/repeats every 1 day/)).toBeTruthy();
});

test("Skip this occurrence skips the shown day and closes", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Skip this occurrence/ }));
  expect(skipOccurrence).toHaveBeenCalledWith(rule, "2026-07-25");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Stop repeating ends the rule and closes", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Stop repeating/ }));
  expect(endRecurrence).toHaveBeenCalledWith("r1");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Close dismisses without mutating", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(skipOccurrence).not.toHaveBeenCalled();
  expect(endRecurrence).not.toHaveBeenCalled();
});
