// @vitest-environment jsdom
//
// How you are reading the page, in one disclosure (spec §4.9, §4.9a).
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReadingBlock from "../../src/ui/ReadingBlock";

afterEach(cleanup);

const base = {
  open: true,
  filter: "all" as const,
  onChangeFilter: vi.fn(),
  order: "logged" as const,
  onChangeOrder: vi.fn(),
  showOrder: true,
};

test("open, it carries both rows — what is shown and in what order", () => {
  render(<ReadingBlock {...base} />);
  expect(screen.getByRole("group", { name: "Filter entries" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Order entries" })).toBeTruthy();
});

test("every order button is spelled out, and none is a glyph", () => {
  render(<ReadingBlock {...base} />);
  const group = screen.getByRole("group", { name: "Order entries" });
  const labels = [...group.querySelectorAll("button")].map((b) => b.textContent ?? "");
  expect(labels).toEqual(["as logged", "priority", "by type"]);
  // the no-guessing rule: nothing here is one character long
  labels.forEach((l) => expect(l.trim().length).toBeGreaterThan(1));
});

test("changing the order reports it, and says what it is doing", () => {
  const onChangeOrder = vi.fn();
  const { rerender } = render(<ReadingBlock {...base} onChangeOrder={onChangeOrder} />);
  fireEvent.click(screen.getByRole("button", { name: /priority marks first/i }));
  expect(onChangeOrder).toHaveBeenCalledWith("priority");
  rerender(<ReadingBlock {...base} order="priority" onChangeOrder={onChangeOrder} />);
  expect(screen.getByText("priority marks first, then as logged")).toBeTruthy();
});

test("the note is there even for as logged, so it is never a line you stop reading", () => {
  render(<ReadingBlock {...base} order="logged" />);
  expect(screen.getByText("in the order you logged them")).toBeTruthy();
});

// Closed, the block draws nothing at all: the header badge carries both halves
// of the state (lib/reading.ts, 27 August 2026). The standing caption this
// replaced was the filter note's styling in the filter note's slot, and read as
// a row that had failed to close.
test.each(["logged", "priority", "type"] as const)(
  "closed, it leaves the page alone whatever the order: %s",
  (order) => {
    const { container } = render(
      <ReadingBlock {...base} open={false} order={order} />
    );
    expect(container.textContent).toBe("");
  }
);

// The Future log's rows are occurrences drawn from other pages, so there is
// no page sequence there to re-read.
test("a page with no sequence of its own gets the filter and no order row", () => {
  render(<ReadingBlock {...base} showOrder={false} />);
  expect(screen.getByRole("group", { name: "Filter entries" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Order entries" })).toBeNull();
});

test("and closed on such a page it is likewise silent", () => {
  const { container } = render(
    <ReadingBlock {...base} open={false} showOrder={false} order="priority" />
  );
  expect(container.textContent).toBe("");
});
