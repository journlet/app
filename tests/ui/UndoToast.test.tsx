// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UndoToast from "../../src/ui/UndoToast";

afterEach(cleanup);

// The label is handed in since 26 October 2026 (quick capture FR4.2), so the
// deletions' wording now lives with App, which passes these same two strings
test("labels an entry deletion and fires onUndo", () => {
  const onUndo = vi.fn();
  render(<UndoToast label="Entry deleted" onUndo={onUndo} />);
  expect(screen.getByText("Entry deleted")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledTimes(1);
});

test("labels a collection deletion", () => {
  render(<UndoToast label="Collection deleted" onUndo={vi.fn()} />);
  expect(screen.getByText("Collection deleted")).toBeTruthy();
});

test("shows a quick entry's message, announced politely to screen readers (FR4.2, FR4.6)", () => {
  render(<UndoToast label="Logged “buy milk” to Today" onUndo={vi.fn()} />);
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("Logged “buy milk” to Today");
  expect(status.getAttribute("aria-live")).toBe("polite");
});

test("its live region is in the page before the first message, and the message arrives in it (FR4.6, review R-04)", () => {
  const { rerender } = render(<UndoToast label={null} onUndo={vi.fn()} />);
  const region = screen.getByTestId("toast-region");
  expect(region.getAttribute("role")).toBe("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent).toBe("");
  rerender(<UndoToast label="Logged “buy milk” to Today" onUndo={vi.fn()} />);
  // the same node, now holding the words: a change a screen reader announces
  expect(screen.getByTestId("toast-region")).toBe(region);
  expect(region.textContent).toContain("Logged “buy milk” to Today");
});

test("a notice with nothing to undo has no Undo button (review R-02)", () => {
  render(<UndoToast label="Finish or cancel the task you started on Today first" />);
  expect(screen.getByText(/Finish or cancel/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
