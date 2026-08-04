// @vitest-environment jsdom
//
// The filter row (remediation item 7).
//
// The wording is the feature. A filter that hides entries has to say, on the
// page, which entries it is hiding — otherwise the journal quietly stops being
// a complete record of the day and nothing on screen admits it.

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FilterRow from "../../src/ui/FilterRow";

afterEach(cleanup);

test("offers all three choices in plain words", () => {
  render(<FilterRow filter="all" onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Show all entries/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /tasks only/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /open only/i })).toBeTruthy();
  // no glyph stands in for a label anywhere in the row
  expect(screen.queryByText(/[•○×]/)).toBeNull();
});

test("marks the current choice as pressed, and only that one", () => {
  render(<FilterRow filter="open" onChange={vi.fn()} />);
  const pressed = screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true");
  expect(pressed).toHaveLength(1);
  expect(pressed[0].textContent).toBe("open only");
});

test("says what is being hidden, for each choice", () => {
  const { rerender } = render(<FilterRow filter="all" onChange={vi.fn()} />);
  expect(screen.getByText(/showing everything on the page/i)).toBeTruthy();
  rerender(<FilterRow filter="open" onChange={vi.fn()} />);
  expect(
    screen.getByText(/hiding completed, struck out, migrated and scheduled/i)
  ).toBeTruthy();
  rerender(<FilterRow filter="tasks" onChange={vi.fn()} />);
  expect(screen.getByText(/hiding notes and events/i)).toBeTruthy();
});

test("choosing a filter reports it once, with the chosen value", () => {
  const onChange = vi.fn();
  render(<FilterRow filter="all" onChange={onChange} />);
  fireEvent.click(screen.getByText("open only"));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("open");
});
