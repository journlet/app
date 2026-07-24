// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UndoToast from "../../src/ui/UndoToast";

afterEach(cleanup);

test("labels an entry deletion and fires onUndo", () => {
  const onUndo = vi.fn();
  render(<UndoToast isCollection={false} onUndo={onUndo} />);
  expect(screen.getByText("Entry deleted")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledTimes(1);
});

test("labels a collection deletion", () => {
  render(<UndoToast isCollection={true} onUndo={vi.fn()} />);
  expect(screen.getByText("Collection deleted")).toBeTruthy();
});
