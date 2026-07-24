// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EntryActionsSheet from "../../src/ui/EntryActionsSheet";
import type { Entry } from "../../src/lib/types";
import type { Scope } from "../../src/lib/dates";

// The sheet calls store mutators directly (they are module-level, stateless
// wrappers over the CRDT doc), so we mock those modules and assert the calls.
vi.mock("../../src/store/journal", () => ({
  endRecurrence: vi.fn(),
  migrateEntry: vi.fn(),
  moveTo: vi.fn(),
  setParent: vi.fn(),
  setReminder: vi.fn(),
  setText: vi.fn(),
  setDetails: vi.fn(),
  toggleDone: vi.fn(),
  toggleStruck: vi.fn(),
}));
vi.mock("../../src/store/recurrence", () => ({
  nextOccurrence: vi.fn(() => "2026-08-01"),
}));
vi.mock("../../src/store/reminders", () => ({
  notificationPermission: vi.fn(() => "granted"),
}));

import {
  migrateEntry,
  moveTo,
  setDetails,
  setText,
  toggleDone,
  toggleStruck,
} from "../../src/store/journal";

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

const openTask: Entry = {
  id: "e1",
  type: "task",
  text: "write report",
  priority: false,
  state: "open",
  pageKey: "2026-07-24",
  createdAt: 0,
};

const setup = (
  overrides: Partial<Parameters<typeof EntryActionsSheet>[0]> = {}
) => {
  const props = {
    sheet: { scope: "day" as Scope | null, pk: "2026-07-24", id: "e1" },
    sheetEntry: openTask,
    sheetHistory: [] as string[],
    sheetNestTarget: null,
    sheetMigrates: false,
    recurrences: [],
    today: "2026-07-24",
    nowKeys,
    editRepeat: null,
    setEditRepeat: vi.fn(),
    editRemind: null,
    setEditRemind: vi.fn(),
    editText: null,
    setEditText: vi.fn(),
    editDetails: null,
    setEditDetails: vi.fn(),
    schedDate: "",
    setSchedDate: vi.fn(),
    closeSheet: vi.fn(),
    saveRepeat: vi.fn(),
    saveReminder: vi.fn().mockResolvedValue(undefined),
    cadenceLabel: (n: number, u: string) => `every ${n} ${u}`,
    deleteWithUndo: vi.fn(),
    fmtRemind: () => "10:00",
    toLocalInput: () => "2026-07-24T10:00",
    trunc: (s: string) => s,
    ...overrides,
  };
  render(<EntryActionsSheet {...props} />);
  return props;
};

describe("actions mode", () => {
  test("completing a task calls toggleDone and closes", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(toggleDone).toHaveBeenCalledWith("e1");
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("striking out calls toggleStruck and closes", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Strike out/ }));
    expect(toggleStruck).toHaveBeenCalledWith("e1");
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("deleting routes through deleteWithUndo (for the undo toast)", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(props.deleteWithUndo).toHaveBeenCalledWith("e1");
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("Edit text opens the edit sub-form with the current text", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    expect(props.setEditText).toHaveBeenCalledWith("write report");
  });

  test("Move to other scopes calls moveTo with the target period key", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(moveTo).toHaveBeenCalledWith("e1", "2026-W30");
  });

  test("Add details opens the details sub-form when none set", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    expect(props.setEditDetails).toHaveBeenCalledWith("");
  });

  test("Edit details seeds the sub-form with the current details", () => {
    const props = setup({
      sheetEntry: { ...openTask, details: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(props.setEditDetails).toHaveBeenCalledWith("https://example.com");
  });
});

test("details mode saves via setDetails and closes", () => {
  const props = setup({ editDetails: "read https://example.com" });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(setDetails).toHaveBeenCalledWith("e1", "read https://example.com");
  expect(props.closeSheet).toHaveBeenCalledTimes(1);
});

test("migration mode migrates instead of moving, keeping the original", () => {
  // An open task on an expired page: original stays, marked ›
  setup({
    sheet: { scope: "day", pk: "2020-01-01", id: "e1" },
    sheetMigrates: true,
  });
  expect(screen.getByText(/Migrate to \(original stays here/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "› Today" }));
  expect(migrateEntry).toHaveBeenCalledWith("e1", "2026-07-24");
});

test("edit-text mode saves the trimmed text", () => {
  const props = setup({ editText: "  new text  " });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(setText).toHaveBeenCalledWith("e1", "new text");
  expect(props.closeSheet).toHaveBeenCalledTimes(1);
});

test("reminder mode saves via the async saveReminder handler", () => {
  const props = setup({ editRemind: "2026-07-24T10:00" });
  fireEvent.click(screen.getByRole("button", { name: "Save reminder" }));
  expect(props.saveReminder).toHaveBeenCalledTimes(1);
});

test("repeat mode starts the rule via saveRepeat", () => {
  const props = setup({ editRepeat: { n: "1", unit: "week", time: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Start repeating" }));
  expect(props.saveRepeat).toHaveBeenCalledTimes(1);
});
