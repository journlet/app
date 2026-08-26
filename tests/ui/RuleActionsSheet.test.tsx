// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RuleActionsSheet from "../../src/ui/RuleActionsSheet";
import type { Recurrence } from "../../src/lib/types";

vi.mock("../../src/store/journal", () => ({
  endRecurrence: vi.fn(),
  setRecurrenceEnd: vi.fn(),
}));
// Only the mutator is mocked: the sentence and the end resolution are pure
// walks over the rule, and this sheet's whole job is to show them (§11 Q17).
vi.mock("../../src/store/recurrence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/recurrence")>()),
  skipOccurrence: vi.fn(),
}));

import { endRecurrence, setRecurrenceEnd } from "../../src/store/journal";
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

const setup = (r: Recurrence = rule) => {
  const onClose = vi.fn();
  render(
    <RuleActionsSheet
      rule={r}
      dayKey="2026-07-25"
      today="2026-07-24"
      onClose={onClose}
    />
  );
  return { onClose };
};

test("shows the rule text and cadence", () => {
  setup();
  expect(screen.getByText("Standup")).toBeTruthy();
  expect(screen.getByText(/repeats every day/)).toBeTruthy();
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

// An end on the rule (spec §11 Q17). The sheet gained one step of its own for
// this: the control replaces the action list rather than unfolding under it.
describe("when it ends", () => {
  test("a rule with no end offers to set one, and says so in words", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Set when it ends…" })
    ).toBeTruthy();
    expect(screen.getByText(/repeats every day — next:/)).toBeTruthy();
  });

  test("a rule with an end offers to change it and names the last one", () => {
    setup({ ...rule, endsOn: "2026-07-31" });
    expect(
      screen.getByRole("button", { name: "Change when it ends…" })
    ).toBeTruthy();
    expect(screen.getByText(/last one 31 Jul/)).toBeTruthy();
  });

  test("the step replaces the actions rather than unfolding beneath them", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Set when it ends…" }));
    expect(screen.getByRole("group", { name: "When it ends" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Skip this occurrence/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Stop repeating/ })).toBeNull();
  });

  test("a date is saved as a date and the sheet closes", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Set when it ends…" }));
    fireEvent.click(screen.getByRole("button", { name: "On a date" }));
    fireEvent.change(screen.getByLabelText(/Last day it may fall on/), {
      target: { value: "2026-08-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save when it ends" }));
    expect(setRecurrenceEnd).toHaveBeenCalledWith("r1", { on: "2026-08-05" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a count is saved as a count, not as the date it implies", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Set when it ends…" }));
    fireEvent.click(screen.getByRole("button", { name: "After a number" }));
    fireEvent.change(screen.getByLabelText(/How many in total/), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save when it ends" }));
    expect(setRecurrenceEnd).toHaveBeenCalledWith("r1", { after: 12 });
  });

  test("never clears the end rather than writing one", () => {
    setup({ ...rule, endsAfter: 9 });
    fireEvent.click(screen.getByRole("button", { name: "Change when it ends…" }));
    fireEvent.click(screen.getByRole("button", { name: "Never" }));
    fireEvent.click(screen.getByRole("button", { name: "Save: no end" }));
    expect(setRecurrenceEnd).toHaveBeenCalledWith("r1", null);
  });

  test("Back returns to the actions without saving", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Set when it ends…" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Stop repeating/ })).toBeTruthy();
    expect(setRecurrenceEnd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a count below what has come round refuses, in words", () => {
    // The rule started 20 July and today is the 24th: five have come round.
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Set when it ends…" }));
    fireEvent.click(screen.getByRole("button", { name: "After a number" }));
    fireEvent.change(screen.getByLabelText(/How many in total/), {
      target: { value: "2" },
    });
    expect(screen.getByText(/5 have already come round/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save when it ends" })
    ).toHaveProperty("disabled", true);
  });
});
