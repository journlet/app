// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EntryActionsSheet from "../../src/ui/EntryActionsSheet";
import type { Entry, Recurrence } from "../../src/lib/types";
import type { Scope } from "../../src/lib/dates";

// The sheet calls store mutators directly (they are module-level, stateless
// wrappers over the CRDT doc), so we mock those modules and assert the calls.
vi.mock("../../src/store/journal", () => ({
  // The four saves that used to be App's live in the view now (behaviour-neutral
  // refactor), so the write each one makes is what a test can see. addRecurrence
  // returns a rule because saveRepeat tags the entry with its id.
  addRecurrence: vi.fn(() => ({ id: "r1" })),
  tagEntryRecurrence: vi.fn(),
  setRecurrenceEnd: vi.fn(),
  endRecurrence: vi.fn(),
  migrateEntry: vi.fn(),
  moveTo: vi.fn(),
  setEntryType: vi.fn(),
  setParent: vi.fn(),
  setReminder: vi.fn(),
  setSignifier: vi.fn(),
  setText: vi.fn(),
  toggleDone: vi.fn(),
  toggleStruck: vi.fn(),
  toggleThread: vi.fn(),
}));
// The end helpers (lastOccurrence, isSpent, ruleSentence, occurrencesThrough)
// are pure walks over a rule and are exercised for real here: mocking them
// would leave the rows they caption asserting nothing (spec §11 Q17).
vi.mock("../../src/store/recurrence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/recurrence")>()),
  nextOccurrence: vi.fn(() => "2026-08-01"),
}));
vi.mock("../../src/store/reminders", () => ({
  notificationPermission: vi.fn(() => "granted"),
  requestNotificationPermission: vi.fn(() => Promise.resolve("granted")),
}));

import {
  addRecurrence,
  migrateEntry,
  moveTo,
  setEntryType,
  setParent,
  setRecurrenceEnd,
  setReminder,
  setSignifier,
  setText,
  tagEntryRecurrence,
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
    onAddSubBullet: vi.fn(),
    sheetMigrates: false,
    recurrences: [],
    collections: [
      { id: "c1", kind: "list" as const, name: "Reading list", createdAt: 0 },
      { id: "c2", kind: "habits" as const, name: "Habits", createdAt: 0 },
    ],
    today: "2026-07-24",
    nowKeys,
    onEditDetails: vi.fn(),
    closeSheet: vi.fn(),
    deleteWithUndo: vi.fn(),
    ...overrides,
  };
  render(<EntryActionsSheet {...props} />);
  return props;
};

/** Migrate, move and schedule each have their own step now (6 August 2026), so
 *  a test that exercises one opens it first — as the user has to. Every other
 *  step joined them here once the drafts moved into the component: a step used
 *  to be entered by handing it its draft as a prop, and is now entered the only
 *  way a person can, by tapping the row that opens it. */
const openStep = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const openMove = () => openStep("Move to another page…");
const openMigrate = () => openStep("Migrate…");
const openSchedule = () => openStep("Schedule for later…");
const openText = () => openStep("Edit text");
const openRemind = () => openStep(/^(Set|Change) reminder…$/);
const openRepeat = () => openStep("Repeat this entry…");
const openEnds = () => openStep(/^(Set|Change) when it ends…$/);
const openThread = () => openStep(/^Thread to (a|another) page…$/);
const openNest = () => openStep(/^Nest under (another|a different) entry…$/);

/** Type into a labelled field, which is how a filter is narrowed now that it is
 *  the component's own state rather than a prop handed in already narrowed. */
const typeInto = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

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
    setup();
    openText();
    // the draft starts as what the entry says, so a small correction does not
    // begin by retyping the whole line
    expect((screen.getByLabelText("Entry text") as HTMLInputElement).value).toBe(
      "write report"
    );
  });

  test("Move to offers the four kinds of page, as one picker shared with capture", () => {
    setup();
    openMove();
    expect(screen.getByRole("tablist", { name: "Move to" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "week" }));
    // choosing a kind of page moves the picker onto that page, which the move
    // it offers then names
    expect(
      screen.getByRole("tab", { name: "week" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Move to Week 30" })).toBeTruthy();
    // the old row of four current-period buttons is gone, so "this week" is
    // reached by choosing a page rather than by a button that means only "now"
    expect(screen.queryByRole("button", { name: "This week" })).toBeNull();
  });

  test("the picker starts on the entry's own page, and moving there is refused", () => {
    // The picker seeds itself from the page the sheet was opened on, so this
    // needs nothing set up: the entry is on 24 Jul and so is the picker.
    const props = setup();
    openMove();
    expect(screen.getByText(/page this entry is already on/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Move" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(moveTo).not.toHaveBeenCalled();
    expect(props.closeSheet).not.toHaveBeenCalled();
  });

  test("a chosen past page is reachable — a move is a correction, not a migration", () => {
    const props = setup();
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
    // and stepping back off the entry's own page is how it is chosen
    for (let i = 0; i < 4; i++)
      fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to Mon 20 Jul" }));
    expect(moveTo).toHaveBeenCalledWith("e1", "2026-07-20");
    expect(migrateEntry).not.toHaveBeenCalled();
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("the chosen kind of page decides which page a date means", () => {
    setup();
    openMove();
    fireEvent.click(screen.getByRole("tab", { name: "month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("September 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move to Sept 2026" }));
    expect(moveTo).toHaveBeenCalledWith("e1", "2026-09");
  });

  test("a sub-bullet is told it will be promoted, since its parent stays put", () => {
    setup({ sheetEntry: { ...openTask, parentId: "p1" } });
    openMove();
    // any page but the one it is on: the promotion is what a real move costs
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText(/stops being a sub-bullet/)).toBeTruthy();
  });

  test("threading is one line in the actions list, whatever the collection count", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      kind: "list" as const,
      name: `Collection ${i}`,
      createdAt: i,
    }));
    setup({ collections: many });
    // no per-collection buttons in the actions list — just the one opener
    expect(screen.queryByRole("button", { name: "Collection 3" })).toBeNull();
    openThread();
    // the pages are chosen inside the step it opens, never on the list itself
    expect(
      screen.getByRole("button", { name: "Thread to Collection 3" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete entry" })).toBeNull();
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
    setup();
    openThread();
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
    const props = setup();
    openThread();
    fireEvent.click(
      screen.getByRole("button", { name: "Thread to Reading list" })
    );
    expect(toggleThread).toHaveBeenCalledWith("e1", "col:c1");
    expect(moveTo).not.toHaveBeenCalled();
    expect(migrateEntry).not.toHaveBeenCalled();
    // the step closes and the actions list is back (Delete only ever appears
    // there), while the view itself stays open
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeTruthy();
    expect(props.closeSheet).not.toHaveBeenCalled();
  });

  test("a page already referenced is shown as such, not as a second way to remove it", () => {
    setup({ sheetEntry: { ...openTask, threads: ["col:c1"] } });
    openThread();
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
    setup({ collections: many });
    openThread();
    expect(screen.getByLabelText("Find a page")).toBeTruthy();
    typeInto("Find a page", "collection 1");
    expect(
      screen.getByRole("button", { name: "Thread to Collection 1" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Thread to Collection 2" })
    ).toBeNull();
    cleanup();

    setup({ collections: [] });
    openThread();
    expect(screen.queryByLabelText("Find a page")).toBeNull();
  });

  test("says so plainly when nothing matches", () => {
    // Twelve collections only so that the filter is on screen to type into: it
    // earns its place past a glance, and the empty state is what is under test.
    setup({
      collections: Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        kind: "list" as const,
        name: `Collection ${i}`,
        createdAt: i,
      })),
    });
    openThread();
    typeInto("Find a page", "zzz");
    expect(screen.getByText("no page matches")).toBeTruthy();
  });

  test("Back returns to the actions list without changing anything", () => {
    const props = setup();
    openThread();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeTruthy();
    expect(toggleThread).not.toHaveBeenCalled();
    expect(props.closeSheet).not.toHaveBeenCalled();
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
  });
  // the two are told apart at the top level by their captions, not left to be
  // inferred from two mini-forms sitting one above the other
  expect(screen.getByText(/carries it forward to a current page/)).toBeTruthy();
  expect(
    screen.getByText(/corrects the page it was logged on/)
  ).toBeTruthy();
  openMove();
  // the picker opens on the entry's own page, so the week it belonged on is a
  // week of steps away: a move has no floor
  for (let i = 0; i < 7; i++)
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
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
    const props = setup();
    openSchedule();
    expect(screen.getByText(/a copy appears on the date you pick/)).toBeTruthy();
    typeInto("Schedule to date", "2026-08-01");
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
    //
    // Raised from 16 on 26 August 2026, when Signifiers and Type were added
    // (spec §4.1a). The bound is on the shape, not the number: two rows is
    // what those actions cost as rows, and it is the whole of what they cost —
    // both keep their controls inside a step, so this worst case is still
    // fixed and still one screen. Anything that would raise it again by
    // unfolding in place is the thing this guard is for.
    expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(18);
  });

  test("a completed task is offered no schedule step", () => {
    setup({ sheetEntry: { ...openTask, state: "done" } });
    expect(
      screen.queryByRole("button", { name: "Schedule for later…" })
    ).toBeNull();
  });
});

test("edit-text mode saves the trimmed text", () => {
  const props = setup();
  openText();
  typeInto("Entry text", "  new text  ");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(setText).toHaveBeenCalledWith("e1", "new text");
  expect(props.closeSheet).toHaveBeenCalledTimes(1);
});

test("reminder mode writes the time the field was left on", () => {
  // The save lives in the view now, so the write is what can be seen. The
  // timestamp is built the way the view builds it, by hand: a timezone-less
  // string must never be handed to new Date(), which Safari reads as UTC.
  const props = setup();
  openRemind();
  typeInto("Reminder date and time", "2026-07-24T10:00");
  fireEvent.click(screen.getByRole("button", { name: "Save reminder" }));
  expect(setReminder).toHaveBeenCalledWith(
    "e1",
    new Date(2026, 6, 24, 10, 0).getTime()
  );
  expect(props.closeSheet).toHaveBeenCalledTimes(1);
});

test("repeat mode starts the rule and tags the entry with it", () => {
  const props = setup();
  openRepeat();
  fireEvent.click(screen.getByRole("button", { name: "Start repeating" }));
  // the step's own defaults: weekly from this entry, no end, and on a day page
  // the cadence is chosen rather than locked
  expect(addRecurrence).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "write report",
      everyN: 1,
      unit: "week",
      pageScope: "day",
      anchor: "2026-07-24",
      endsOn: undefined,
      endsAfter: undefined,
    })
  );
  expect(tagEntryRecurrence).toHaveBeenCalledWith("e1", "r1");
  expect(props.closeSheet).toHaveBeenCalledTimes(1);
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
  /** The picker's filter only appears once the list is past a glance, so a test
   *  that types into it needs a page with more than eight candidates. The
   *  padding is scenery: what is under test is the matching, not the count. */
  const padding = (n: number): Entry[] =>
    Array.from({ length: n }, (_, i) => other(`p${i}`, `padding ${i}`));

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
    setup({ sheetNestTargets: [other("e2", "plan the week")] });
    openNest();
    expect(
      screen.getByRole("button", { name: "Nest under plan the week" })
    ).toBeTruthy();
    expect(setParent).not.toHaveBeenCalled();
  });

  test("with no other entry on the page there is nothing to nest under", () => {
    setup({ sheetNestTargets: [] });
    expect(screen.queryByRole("button", { name: /Nest under/ })).toBeNull();
  });

  test("the picker lists every candidate parent, not just the one above", () => {
    setup({
      sheetNestTargets: [
        other("e2", "plan the week"),
        other("e3", "call the bank"),
        other("e4", "book the dentist"),
      ],
    });
    openNest();
    expect(
      screen.getByRole("button", { name: "Nest under plan the week" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Nest under book the dentist" })
    ).toBeTruthy();
  });

  test("choosing a parent nests it, and the picker closes only when it took", () => {
    vi.mocked(setParent).mockReturnValue(true);
    setup({ sheetNestTargets: [other("e2", "plan the week")] });
    openNest();
    fireEvent.click(
      screen.getByRole("button", { name: "Nest under plan the week" })
    );
    expect(setParent).toHaveBeenCalledWith("e1", "e2");
    // closed only because the store took the change: the refusal below is the
    // other half of this, and there the picker stays put
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeTruthy();
  });

  test("a refused nest is stated, not swallowed", () => {
    // The store refuses when the page changed under the picker
    vi.mocked(setParent).mockReturnValue(false);
    setup({ sheetNestTargets: [other("e2", "plan the week")] });
    openNest();
    fireEvent.click(
      screen.getByRole("button", { name: "Nest under plan the week" })
    );
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("no longer take sub-bullets");
    // and the picker is still there to pick again, so the tap is never a
    // silent no-op
    expect(
      screen.getByRole("button", { name: "Nest under plan the week" })
    ).toBeTruthy();
  });

  test("the picker names the page, which may not be the one on screen", () => {
    setup({ sheetNestTargets: [other("e2", "plan the week")] });
    openNest();
    // the entry lives on 24 Jul 2026, so the heading must say so
    expect(screen.getByText(/24 Jul/)).toBeTruthy();
  });

  test("a candidate's real state is shown and named, not disguised as open", () => {
    setup({
      sheetNestTargets: [{ ...other("e2", "done thing"), state: "done" }],
    });
    openNest();
    // × not •, spelled out in the row, and in the accessible name too, so the
    // purist glyph is never the only thing carrying the meaning
    expect(
      screen.getByRole("button", { name: /Nest under done thing, done/ })
    ).toBeTruthy();
    expect(screen.getByText("×")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
  });

  test("the picker matches text ignoring accents, as search does", () => {
    setup({ sheetNestTargets: [other("e2", "café run"), ...padding(8)] });
    openNest();
    typeInto("Find an entry", "cafe");
    expect(
      screen.getByRole("button", { name: /Nest under café run/ })
    ).toBeTruthy();
  });

  test("the filter stays put once typed in, even though the list has shortened", () => {
    // Otherwise a filter could be hidden while it went on narrowing the list,
    // and a list could be narrowed by a filter the user can no longer see
    setup({ sheetNestTargets: [other("e3", "call the bank"), ...padding(8)] });
    openNest();
    typeInto("Find an entry", "bank");
    expect(screen.getByLabelText("Find an entry")).toBeTruthy();
    // one row left, well short of the eight that put the filter on screen
    expect(screen.getAllByRole("button", { name: /^Nest under/ }).length).toBe(1);
  });

  test("the picker filters by entry text once the list is long", () => {
    setup({
      sheetNestTargets: [
        other("e2", "plan the week"),
        other("e3", "call the bank"),
        ...padding(7),
      ],
    });
    openNest();
    typeInto("Find an entry", "bank");
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

// An end on the repeat (spec §11 Q17). The row sits above Stop repeating, and
// carries the whole sentence, so the row below it only has to say when the next
// one is.
describe("when the repeat ends", () => {
  const repeating: Entry = { ...openTask, recurrenceId: "r1" };
  const daily = (over: Partial<Recurrence> = {}): Recurrence => ({
    id: "r1",
    text: "Antibiotics",
    type: "task",
    priority: false,
    everyN: 1,
    unit: "day",
    pageScope: "day",
    anchor: "2026-07-20",
    materialisedThrough: "2026-07-24",
    createdAt: 0,
    ...over,
  });

  test("a repeat with no end offers to set one", () => {
    setup({ sheetEntry: repeating, recurrences: [daily()] });
    expect(
      screen.getByRole("button", { name: /Set when it ends…/ })
    ).toBeTruthy();
    expect(screen.getByText("repeats every day")).toBeTruthy();
  });

  test("a repeat with an end offers to change it, and names the last one", () => {
    setup({
      sheetEntry: repeating,
      recurrences: [daily({ endsOn: "2026-07-31" })],
    });
    expect(
      screen.getByRole("button", { name: /Change when it ends…/ })
    ).toBeTruthy();
    expect(
      screen.getByText("repeats every day, last one 31 Jul")
    ).toBeTruthy();
  });

  test("a count is said as a count, with how many have come round", () => {
    setup({ sheetEntry: repeating, recurrences: [daily({ endsAfter: 10 })] });
    expect(
      screen.getByText(
        "repeats every day, stops after 10 (5 have come round), last one 29 Jul"
      )
    ).toBeTruthy();
  });

  test("the step opens with the end in both forms, so switching moves nothing", () => {
    setup({ sheetEntry: repeating, recurrences: [daily({ endsAfter: 10 })] });
    openEnds();
    // the count as the rule states it …
    expect(
      (screen.getByLabelText("How many in total") as HTMLInputElement).value
    ).toBe("10");
    // … and the same end as a date: the tenth occurrence of a daily rule
    // anchored 20 July, so switching forms does not quietly move the end
    fireEvent.click(screen.getByRole("button", { name: "On a date" }));
    expect(
      (screen.getByLabelText("Last day it may fall on") as HTMLInputElement)
        .value
    ).toBe("2026-07-29");
  });

  test("the step writes the end it was left on", () => {
    setup({ sheetEntry: repeating, recurrences: [daily()] });
    openEnds();
    expect(screen.getByRole("group", { name: "When it ends" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "On a date" }));
    fireEvent.change(screen.getByLabelText("Last day it may fall on"), {
      target: { value: "2026-07-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save when it ends" }));
    // stored as the form it was given in, and nothing already on a page is
    // touched: an end only stops the materialiser going further
    expect(setRecurrenceEnd).toHaveBeenCalledWith("r1", { on: "2026-07-31" });
  });

  test("a spent repeat offers nothing, and says why rather than going quiet", () => {
    setup({
      sheetEntry: repeating,
      recurrences: [daily({ endsOn: "2026-07-22" })],
    });
    expect(screen.queryByRole("button", { name: /when it ends/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Stop repeating/ })).toBeNull();
    expect(screen.getByText(/Nothing more will be made/)).toBeTruthy();
  });

  test("the Repeat step can set an end at the same moment", () => {
    setup();
    openRepeat();
    expect(screen.getByRole("group", { name: "When it ends" })).toBeTruthy();
    expect(screen.getByText(/No end/)).toBeTruthy();
  });
});

// Changing what an entry says (spec §4.1a, 26 August 2026). The two steps
// deliberately behave differently, and the difference is the thing under test:
// a signifier writes on tap because it loses nothing, a type change waits for
// a save because it can drop a ×.
describe("Signifiers step", () => {
  test("the row says what is lit now, before it is opened", () => {
    setup({ sheetEntry: { ...openTask, priority: true, inspiration: true } });
    const row = screen.getByRole("button", { name: "Signifiers…" });
    expect(row.textContent).toContain("* priority, ! inspiration");
  });

  test("nothing lit says so rather than saying nothing", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Signifiers…" }).textContent
    ).toContain("none");
  });

  test("lighting a priority writes on tap, with no save step", () => {
    const props = setup();
    openStep("Signifiers…");
    fireEvent.click(screen.getByRole("button", { name: /priority/ }));
    expect(setSignifier).toHaveBeenCalledWith("e1", "priority", true);
    // the step stays open and the view stays put: the change is done
    expect(props.closeSheet).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  test("tapping a lit chip clears it", () => {
    setup({ sheetEntry: { ...openTask, priority: true } });
    openStep("Signifiers…");
    const chip = screen.getByRole("button", { name: /priority/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(setSignifier).toHaveBeenCalledWith("e1", "priority", false);
  });

  test("an occurrence of a repeat says only this one changes", () => {
    setup({
      sheetEntry: { ...openTask, recurrenceId: "r1" },
      recurrences: [
        {
          id: "r1",
          text: "write report",
          type: "task",
          priority: false,
          everyN: 1,
          unit: "week",
          pageScope: "week",
          anchor: "2026-07-24",
          materialisedThrough: "2026-07-24",
          createdAt: 0,
        } as Recurrence,
      ],
    });
    openStep("Signifiers…");
    expect(screen.getByText(/This occurrence changes on its own/)).toBeTruthy();
  });
});

describe("Type step", () => {
  test("the row names the type it would change", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Type…" }).textContent
    ).toContain("currently • task");
  });

  test("a type is chosen, then saved — and only then does it write", () => {
    const props = setup();
    openStep("Type…");
    expect(
      (screen.getByRole("button", { name: "No change to save" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /note/ }));
    expect(setEntryType).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(setEntryType).toHaveBeenCalledWith("e1", "note");
    expect(props.closeSheet).toHaveBeenCalledTimes(1);
  });

  test("a completed task is told the × goes, before the save", () => {
    setup({ sheetEntry: { ...openTask, state: "done" } });
    openStep("Type…");
    expect(screen.queryByText(/there is no such thing as a completed/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /note/ }));
    expect(screen.getByText(/no such thing as a completed note/)).toBeTruthy();
  });

  test("an open task is told nothing, because nothing is lost", () => {
    setup();
    openStep("Type…");
    fireEvent.click(screen.getByRole("button", { name: /note/ }));
    expect(screen.queryByText(/no such thing as a completed/)).toBeNull();
  });

  test("refused on a migrated entry, in place and with the reason on the row", () => {
    setup({ sheetEntry: { ...openTask, state: "migrated" } });
    const row = screen.getByRole("button", { name: "Type…" }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.textContent).toContain("not while this is migrated");
    fireEvent.click(row);
    expect(screen.queryByRole("button", { name: /No change to save/ })).toBeNull();
  });

  test("a scheduled entry is refused the same way, and can still change signifiers", () => {
    setup({ sheetEntry: { ...openTask, state: "scheduled" } });
    expect(
      (screen.getByRole("button", { name: "Type…" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Signifiers…" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });
});
