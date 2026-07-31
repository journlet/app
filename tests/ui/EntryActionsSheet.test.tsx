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
  toggleDone: vi.fn(),
  toggleStruck: vi.fn(),
  toggleThread: vi.fn(),
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
  setParent,
  setText,
  toggleDone,
  toggleStruck,
  toggleThread,
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
    sheetNestTargets: [] as Entry[],
    sheetHasChildren: false,
    nestFilter: null,
    setNestFilter: vi.fn(),
    nestRefused: null,
    onOpenNestPicker: vi.fn(),
    onNestUnder: vi.fn(),
    onAddSubBullet: vi.fn(),
    sheetMigrates: false,
    recurrences: [],
    collections: [
      { id: "c1", kind: "list" as const, name: "Reading list", createdAt: 0 },
      { id: "c2", kind: "habits" as const, name: "Habits", createdAt: 0 },
    ],
    today: "2026-07-24",
    nowKeys,
    editRepeat: null,
    setEditRepeat: vi.fn(),
    editRemind: null,
    setEditRemind: vi.fn(),
    threadFilter: null,
    setThreadFilter: vi.fn(),
    editText: null,
    setEditText: vi.fn(),
    onEditDetails: vi.fn(),
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

  test("threading is one line in the actions list, whatever the collection count", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      kind: "list" as const,
      name: `Collection ${i}`,
      createdAt: i,
    }));
    const props = setup({ collections: many });
    // no per-collection buttons in the actions list — just the one opener
    expect(screen.queryByRole("button", { name: "Collection 3" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Thread to a page/ })
    );
    expect(props.setThreadFilter).toHaveBeenCalledWith("");
  });

  test("current references are listed and removable in the actions list", () => {
    setup({ sheetEntry: { ...openTask, threads: ["col:c1"] } });
    expect(screen.getByText("Reading list")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove reference to Reading list" })
    );
    expect(toggleThread).toHaveBeenCalledWith("e1", "col:c1");
    // opener wording shifts once the entry already points somewhere
    expect(
      screen.getByRole("button", { name: "Thread to another page…" })
    ).toBeTruthy();
  });
});

describe("thread picker sub-view", () => {
  test("lists list collections and the current period pages, not the entry's own page", () => {
    setup({ threadFilter: "" });
    expect(
      screen.getByRole("button", { name: "Thread to Reading list" })
    ).toBeTruthy();
    // a habit tracker is a page like any other, so it can be threaded to
    expect(
      screen.getByRole("button", { name: "Thread to Habits" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Thread to This week" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Thread to Today" })).toBeNull();
  });

  test("choosing a page references it and returns to the actions list", () => {
    const props = setup({ threadFilter: "" });
    fireEvent.click(
      screen.getByRole("button", { name: "Thread to Reading list" })
    );
    expect(toggleThread).toHaveBeenCalledWith("e1", "col:c1");
    expect(moveTo).not.toHaveBeenCalled();
    expect(migrateEntry).not.toHaveBeenCalled();
    expect(props.setThreadFilter).toHaveBeenCalledWith(null);
    expect(props.closeSheet).not.toHaveBeenCalled();
  });

  test("a page already referenced is shown as such, not as a second way to remove it", () => {
    setup({
      threadFilter: "",
      sheetEntry: { ...openTask, threads: ["col:c1"] },
    });
    expect(
      screen.queryByRole("button", { name: "Thread to Reading list" })
    ).toBeNull();
    expect(screen.getByText("already threaded")).toBeTruthy();
  });

  test("the filter appears only past a glance, and narrows the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      kind: "list" as const,
      name: `Collection ${i}`,
      createdAt: i,
    }));
    setup({ threadFilter: "", collections: many });
    expect(screen.getByLabelText("Find a page")).toBeTruthy();
    cleanup();

    setup({ threadFilter: "collection 1" , collections: many });
    expect(
      screen.getByRole("button", { name: "Thread to Collection 1" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Thread to Collection 2" })
    ).toBeNull();
    cleanup();

    setup({ threadFilter: "", collections: [] });
    expect(screen.queryByLabelText("Find a page")).toBeNull();
  });

  test("says so plainly when nothing matches", () => {
    setup({ threadFilter: "zzz" });
    expect(screen.getByText("no page matches")).toBeTruthy();
  });

  test("Back returns to the actions list without changing anything", () => {
    const props = setup({ threadFilter: "" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(props.setThreadFilter).toHaveBeenCalledWith(null);
    expect(toggleThread).not.toHaveBeenCalled();
  });
});

describe("actions mode, continued", () => {
  test("Add details opens the full-screen details view when none set", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    expect(props.onEditDetails).toHaveBeenCalledTimes(1);
  });

  test("Edit details label shows when the entry already has details", () => {
    const props = setup({
      sheetEntry: { ...openTask, details: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(props.onEditDetails).toHaveBeenCalledTimes(1);
  });
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

// Nesting, one level deep (spec §4.1). Any top-level entry on the page can be
// the parent, so the actions list offers a picker sub-view rather than naming
// the single entry above.
describe("nesting", () => {
  const other = (id: string, text: string): Entry => ({
    ...openTask,
    id,
    text,
  });

  test("a top-level entry offers to gain sub-bullets", () => {
    const props = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a sub-bullet under this entry" })
    );
    expect(props.onAddSubBullet).toHaveBeenCalledTimes(1);
  });

  test("a sub-bullet cannot gain sub-bullets of its own", () => {
    setup({ sheetEntry: { ...openTask, parentId: "p1" } });
    expect(
      screen.queryByRole("button", {
        name: "Add a sub-bullet under this entry",
      })
    ).toBeNull();
  });

  test("the nest action opens the picker rather than nesting blindly", () => {
    const props = setup({ sheetNestTargets: [other("e2", "plan the week")] });
    fireEvent.click(
      screen.getByRole("button", { name: "Nest under another entry…" })
    );
    expect(props.onOpenNestPicker).toHaveBeenCalledTimes(1);
    expect(setParent).not.toHaveBeenCalled();
  });

  test("with no other entry on the page there is nothing to nest under", () => {
    setup({ sheetNestTargets: [] });
    expect(screen.queryByRole("button", { name: /Nest under/ })).toBeNull();
  });

  test("the picker lists every candidate parent, not just the one above", () => {
    setup({
      nestFilter: "",
      sheetNestTargets: [
        other("e2", "plan the week"),
        other("e3", "call the bank"),
        other("e4", "book the dentist"),
      ],
    });
    expect(
      screen.getByRole("button", { name: "Nest under plan the week" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Nest under book the dentist" })
    ).toBeTruthy();
  });

  test("choosing a parent asks App to nest, which reports any refusal", () => {
    const props = setup({
      nestFilter: "",
      sheetNestTargets: [other("e2", "plan the week")],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Nest under plan the week" })
    );
    expect(props.onNestUnder).toHaveBeenCalledWith("e2");
    // the sheet must not close the picker itself — App does, only on success
    expect(props.setNestFilter).not.toHaveBeenCalledWith(null);
  });

  test("a refused nest is stated, not swallowed", () => {
    setup({
      nestFilter: "",
      nestRefused: "That entry can no longer take sub-bullets.",
      sheetNestTargets: [other("e2", "plan the week")],
    });
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("no longer take sub-bullets");
  });

  test("the picker names the page, which may not be the one on screen", () => {
    setup({ nestFilter: "", sheetNestTargets: [other("e2", "plan the week")] });
    // the entry lives on 24 Jul 2026, so the heading must say so
    expect(screen.getByText(/24 Jul/)).toBeTruthy();
  });

  test("a candidate's real state is shown and named, not disguised as open", () => {
    setup({
      nestFilter: "",
      sheetNestTargets: [{ ...other("e2", "done thing"), state: "done" }],
    });
    // × not •, spelled out in the row, and in the accessible name too, so the
    // purist glyph is never the only thing carrying the meaning
    expect(
      screen.getByRole("button", { name: /Nest under done thing, done/ })
    ).toBeTruthy();
    expect(screen.getByText("×")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
  });

  test("the picker matches text ignoring accents, as search does", () => {
    setup({ nestFilter: "cafe", sheetNestTargets: [other("e2", "café run")] });
    expect(
      screen.getByRole("button", { name: /Nest under café run/ })
    ).toBeTruthy();
  });

  test("the filter stays put once typed in, even if the list shortens", () => {
    // Otherwise a sync could hide the filter while it kept narrowing the list
    setup({ nestFilter: "bank", sheetNestTargets: [other("e3", "call the bank")] });
    expect(screen.getByLabelText("Find an entry")).toBeTruthy();
  });

  test("the picker filters by entry text once the list is long", () => {
    setup({
      nestFilter: "bank",
      sheetNestTargets: [
        other("e2", "plan the week"),
        other("e3", "call the bank"),
      ],
    });
    expect(
      screen.getByRole("button", { name: "Nest under call the bank" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Nest under plan the week" })
    ).toBeNull();
  });

  test("a sub-bullet can be promoted back to top level", () => {
    const props = setup({ sheetEntry: { ...openTask, parentId: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Move to top level" }));
    expect(setParent).toHaveBeenCalledWith("e1", null);
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("an entry with sub-bullets is told why it cannot be nested", () => {
    setup({ sheetHasChildren: true, sheetNestTargets: [] });
    expect(screen.getByText(/has sub-bullets of its own/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Nest under/ })).toBeNull();
  });
});
