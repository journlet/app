// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FutureLogView from "../../src/ui/FutureLogView";
import type { ScheduledRow } from "../../src/ui/types";

afterEach(cleanup);

const entryRow = (id: string, pk: string): ScheduledRow => ({
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
      groups={[]}
      folds={{}}
      onToggleFold={vi.fn()}
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
        groups={groups}
        folds={{}}
        onToggleFold={vi.fn()}
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
        groups={groups}
        folds={{ "2026-08": true }}
        onToggleFold={vi.fn()}
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
        groups={groups}
        folds={{}}
        onToggleFold={onToggleFold}
        renderRow={spyRenderRow()}
      />
    );
    fireEvent.click(screen.getByText(/2 items · hide/));
    expect(onToggleFold).toHaveBeenCalledWith("2026-08");
  });
});
