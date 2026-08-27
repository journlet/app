// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FutureLogView from "../../src/ui/FutureLogView";
import type { ScheduledRow } from "../../src/ui/types";

afterEach(cleanup);

// The entry arm alone. Annotated as the whole union, this helper's own result
// had no readable `entry`, so the fixtures below reached through a property the
// type says may not be there, and the discriminant stopped earning its keep.
type EntryRow = Extract<ScheduledRow, { kind: "entry" }>;

const entryRow = (id: string, pk: string): EntryRow => ({
  kind: "entry",
  sort: pk,
  pk,
  entry: {
    id,
    type: "task",
    text: `entry ${id}`,
    priority: false,
    state: "open",
    pageKey: pk,
    createdAt: 0,
  },
});

const groups = [
  { gk: "2026-08", rows: [entryRow("a", "2026-08-03"), entryRow("b", "2026-08-10")] },
  { gk: "2026-09", rows: [entryRow("c", "2026-09-01")] },
];

// renderRow is App's closure in production; here a spy standing in for it, so
// we can assert the view delegates row rendering rather than duplicating it.
const spyRenderRow = () =>
  vi.fn((row: ScheduledRow, _grouped: boolean) => (
    <li key={row.kind === "entry" ? row.entry.id : row.dayKey}>row</li>
  ));

test("shows the empty state when nothing is scheduled ahead", () => {
  render(
    <FutureLogView
      count={0}
      finished={[]}
      groups={[]}
      folds={{}}
      onToggleFold={vi.fn()}
      filter="all"
      renderRow={vi.fn()}
    />
  );
  expect(screen.getByText(/Nothing scheduled ahead/i)).toBeTruthy();
});

describe("with groups", () => {
  test("renders a heading and item count per group and delegates every row", () => {
    const renderRow = spyRenderRow();
    render(
      <FutureLogView
        count={3}
        finished={[]}
        groups={groups}
        folds={{}}
        onToggleFold={vi.fn()}
        filter="all"
        renderRow={renderRow}
      />
    );
    // month headings come from pageLabel(gk)
    expect(screen.getByText("Aug 2026")).toBeTruthy();
    expect(screen.getByText("Sept 2026")).toBeTruthy();
    // counts + fold affordance ("hide" when expanded)
    expect(screen.getByText(/2 items · hide/)).toBeTruthy();
    expect(screen.getByText(/1 item · hide/)).toBeTruthy();
    // one call per row, all marked grouped=true
    expect(renderRow).toHaveBeenCalledTimes(3);
    expect(renderRow.mock.calls.every(([, grouped]) => grouped === true)).toBe(
      true
    );
  });

  test("a folded group hides its rows and offers to show them", () => {
    const renderRow = spyRenderRow();
    render(
      <FutureLogView
        count={3}
        finished={[]}
        groups={groups}
        folds={{ "2026-08": true }}
        onToggleFold={vi.fn()}
        filter="all"
        renderRow={renderRow}
      />
    );
    expect(screen.getByText(/2 items · show/)).toBeTruthy();
    // only the still-open September group's single row is rendered
    expect(renderRow).toHaveBeenCalledTimes(1);
  });

  test("clicking a group's fold button calls onToggleFold with its key", () => {
    const onToggleFold = vi.fn();
    render(
      <FutureLogView
        count={3}
        finished={[]}
        groups={groups}
        folds={{}}
        onToggleFold={onToggleFold}
        filter="all"
        renderRow={spyRenderRow()}
      />
    );
    fireEvent.click(screen.getByText(/2 items · hide/));
    expect(onToggleFold).toHaveBeenCalledWith("2026-08");
  });
});

// The filter (remediation item 7) reaches the future log too: a page that
// lists entries has to answer to the row sitting above it.
describe("with the filter on", () => {
  const mixed = [
    {
      gk: "2026-08",
      rows: [
        entryRow("a", "2026-08-03"),
        {
          ...entryRow("n", "2026-08-04"),
          entry: { ...entryRow("n", "2026-08-04").entry, type: "note" as const },
        },
      ],
    },
  ];

  test("'tasks only' drops the note row and keeps the task", () => {
    const renderRow = spyRenderRow();
    render(
      <FutureLogView
        count={2}
        finished={[]}
        groups={mixed}
        folds={{}}
        onToggleFold={vi.fn()}
        filter="tasks"
        renderRow={renderRow}
      />
    );
    expect(renderRow).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 item · hide/)).toBeTruthy();
  });

  test("a group emptied by the filter is dropped, and the page says how many are hidden", () => {
    const renderRow = spyRenderRow();
    render(
      <FutureLogView
        count={2}
        finished={[]}
        groups={[{ gk: "2026-08", rows: mixed[0].rows.slice(1) }]}
        folds={{}}
        onToggleFold={vi.fn()}
        filter="tasks"
        renderRow={renderRow}
      />
    );
    expect(renderRow).not.toHaveBeenCalled();
    // no empty heading left behind
    expect(screen.queryByText("Aug 2026")).toBeNull();
    // and the count is honest rather than "nothing scheduled ahead"
    expect(screen.getByText(/Nothing matching/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing scheduled ahead/i)).toBeNull();
  });
});

// A repeat that reaches its end stops appearing here, and its "last one"
// caption is on a page you have finished with, so this is where it says so
// (spec §11 Q17, after a day's use).
test("names repeats that have just finished, above what is still coming", () => {
  render(
    <FutureLogView
      count={0}
      finished={[
        { id: "r1", text: "Send out governance agenda", last: "26 Aug" },
      ]}
      groups={[]}
      folds={{}}
      onToggleFold={vi.fn()}
      filter="all"
      renderRow={vi.fn()}
    />
  );
  expect(screen.getByText(/Repeat finished:/)).toBeTruthy();
  expect(screen.getByText(/Send out governance agenda/)).toBeTruthy();
  expect(screen.getByText(/last one 26 Aug/)).toBeTruthy();
  // and the page still says what it says when nothing is scheduled
  expect(screen.getByText(/Nothing scheduled ahead/)).toBeTruthy();
});

test("several finished repeats are listed together, plurally", () => {
  render(
    <FutureLogView
      count={0}
      finished={[
        { id: "r1", text: "Send out governance agenda", last: "26 Aug" },
        { id: "r2", text: "Antibiotics", last: "16 Aug" },
      ]}
      groups={[]}
      folds={{}}
      onToggleFold={vi.fn()}
      filter="all"
      renderRow={vi.fn()}
    />
  );
  expect(screen.getByText(/Repeats finished:/)).toBeTruthy();
  expect(screen.getByText(/Antibiotics/)).toBeTruthy();
});

test("says nothing at all when no repeat has finished", () => {
  render(
    <FutureLogView
      count={0}
      finished={[]}
      groups={[]}
      folds={{}}
      onToggleFold={vi.fn()}
      filter="all"
      renderRow={vi.fn()}
    />
  );
  expect(screen.queryByText(/finished/i)).toBeNull();
});
