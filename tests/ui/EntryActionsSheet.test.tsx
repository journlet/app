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
    moveAnchor: "2026-07-24",
    setMoveAnchor: vi.fn(),
    moveGran: "day" as Scope,
    setMoveGran: vi.fn(),
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

/** Migrate, move and schedule each have their own step now (6 August 2026), so
 *  a test that exercises one opens it first — as the user has to. */
const openStep = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const openMove = () => openStep("Move to another page…");
const openMigrate = () => openStep("Migrate…");
const openSchedule = () => openStep("Schedule for later…");

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

  test("Move to offers the four kinds of page, as one picker shared with capture", () => {
    const props = setup();
    openMove();
    expect(screen.getByRole("tablist", { name: "Move to" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "week" }));
    expect(props.setMoveGran).toHaveBeenCalledWith("week");
    // the old row of four current-period buttons is gone, so "this week" is
    // reached by choosing a page rather than by a button that means only "now"
    expect(screen.queryByRole("button", { name: "This week" })).toBeNull();
  });

  test("the picker starts on the entry's own page, and moving there is refused", () => {
    const props = setup({ moveAnchor: "2026-07-24", moveGran: "day" as Scope });
    openMove();
    expect(screen.getByText(/page this entry is already on/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Move" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(moveTo).not.toHaveBeenCalled();
    expect(props.closeSheet).not.toHaveBeenCalled();
  });

  test("a chosen past page is reachable — a move is a correction, not a migration", () => {
    const props = setup({ moveAnchor: "2026-07-20", moveGran: "day" as Scope });
    openMove();
    expect(
      (screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    // the chooser reaches back too: a mislogged entry often belongs on a page
    // already past
    fireEvent.click(screen.getByRole("button", { name: /choose a different day/ }));
    expect(
      (screen.getByRole("button", { name: "Wed, 1 Jul 2026" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "close without changing" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to Mon 20 Jul" }));
    expect(moveTo).toHaveBeenCalledWith("e1", "2026-07-20");
    expect(migrateEntry).not.toHaveBeenCalled();
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("the chosen kind of page decides which page a date means", () => {
    setup({ moveAnchor: "2026-09-15", moveGran: "month" as Scope });
    openMove();
    expect(screen.getByText("September 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move to Sept 2026" }));
    expect(moveTo).toHaveBeenCalledWith("e1", "2026-09");
  });

  test("a sub-bullet is told it will be promoted, since its parent stays put", () => {
    setup({
      sheetEntry: { ...openTask, parentId: "p1" },
      moveAnchor: "2026-08-01",
      moveGran: "day" as Scope,
    });
    openMove();
    expect(screen.getByText(/stops being a sub-bullet/)).toBeTruthy();
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
  openMigrate();
  // The step says what a migration does before anything is tapped, and each
  // destination is a row of its own rather than one control with four settings
  expect(screen.getByText(/a copy stays here marked/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Migrate to Today" }));
  expect(migrateEntry).toHaveBeenCalledWith("e1", "2026-07-24");
});

test("migration mode still offers a plain move, for an entry logged on the wrong page", () => {
  const props = setup({
    sheet: { scope: "day", pk: "2020-01-01", id: "e1" },
    sheetMigrates: true,
    moveAnchor: "2020-01-08",
    moveGran: "day" as Scope,
  });
  // the two are told apart at the top level by their captions, not left to be
  // inferred from two mini-forms sitting one above the other
  expect(screen.getByText(/carries it forward to a current page/)).toBeTruthy();
  expect(
    screen.getByText(/corrects the page it was logged on/)
  ).toBeTruthy();
  openMove();
  fireEvent.click(screen.getByRole("button", { name: "Move to Wed 8 Jan" }));
  expect(moveTo).toHaveBeenCalledWith("e1", "2020-01-08");
  expect(migrateEntry).not.toHaveBeenCalled();
  expect(props.closeSheet).toHaveBeenCalledTimes(1);
});

test("a collection page offers no move — pages are related by threading, not moving", () => {
  setup({ sheet: { scope: null, pk: "col:c1", id: "e1" } });
  expect(
    screen.queryByRole("button", { name: "Move to another page…" })
  ).toBeNull();
  expect(screen.queryByRole("tablist", { name: "Move to" })).toBeNull();
});

describe("the shape of the view (6 August 2026)", () => {
  // It was a bottom sheet with every action at one weight and no height cap, so
  // on a phone the list ran off the bottom with nothing to scroll. These hold
  // the two things that fixed it: named groups, and one step per action.
  test("the actions are in named groups, not one flat list", () => {
    setup();
    expect(screen.getByText("This entry")).toBeTruthy();
    expect(screen.getByText("Where it goes")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  test("no step unfolds in place — the top level is rows only", () => {
    setup({ sheet: { scope: "day", pk: "2020-01-01", id: "e1" }, sheetMigrates: true });
    // every multi-step action is behind a row, so none of their controls are on
    // screen until one is opened
    expect(screen.queryByRole("tablist", { name: "Move to" })).toBeNull();
    expect(screen.queryByLabelText("Schedule to date")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Migrate to Today" })
    ).toBeNull();
  });

  test("a caption describes a row without becoming part of its name", () => {
    setup();
    const btn = screen.getByRole("button", { name: "Mark complete" });
    // the consequence is available to a screen reader as a description, so the
    // action is still announced first and on its own
    expect(btn.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("drawn as × on this page")).toBeTruthy();
  });

  test("one Back leaves any step, and Close leaves the view", () => {
    const props = setup();
    openMove();
    expect(screen.getByRole("tablist", { name: "Move to" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("tablist", { name: "Move to" })).toBeNull();
    expect(props.closeSheet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("scheduling an open task is its own step, and names the date it will use", () => {
    const props = setup({ schedDate: "2026-08-01" });
    openSchedule();
    expect(screen.getByText(/a copy appears on the date you pick/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Schedule for Sat 1 Aug" })
    );
    expect(migrateEntry).toHaveBeenCalledWith("e1", "2026-08-01");
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("the top level is a bounded list however busy the journal is", () => {
    // The old sheet grew with the entry: three mini-forms unfolded in place and
    // the migrate row added four more buttons, which is how it came to overflow
    // a phone screen. With every step behind a row, the worst case is small and
    // fixed — this is the guard on that, not on the exact number.
    setup({
      sheet: { scope: "day", pk: "2020-01-01", id: "e1" },
      sheetMigrates: true,
      sheetEntry: {
        ...openTask,
        details: "a note",
        remindAt: 1,
        threads: ["col:c1", "col:c2"],
      },
      sheetNestTargets: [{ ...openTask, id: "e2", text: "another entry" }],
      collections: Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        kind: "list" as const,
        name: `Collection ${i}`,
        createdAt: 0,
      })),
    });
    // Close, plus the rows. Twelve collections add nothing: threading is one row
    // and the pages are chosen inside its step. The same entry in the old sheet
    // put well over twenty controls on screen, because the migrate row, the page
    // picker and the schedule field were all expanded at once.
    expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(16);
  });

  test("a completed task is offered no schedule step", () => {
    setup({ sheetEntry: { ...openTask, state: "done" } });
    expect(
      screen.queryByRole("button", { name: "Schedule for later…" })
    ).toBeNull();
  });
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
