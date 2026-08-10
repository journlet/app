// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PeriodChooser from "../../src/ui/PeriodChooser";
import type { Scope } from "../../src/lib/dates";

afterEach(cleanup);

type Props = Parameters<typeof PeriodChooser>[0];

const setup = (overrides: Partial<Props> = {}) => {
  const props = {
    gran: "day" as Scope,
    anchor: "2026-08-05",
    today: "2026-08-05",
    ...overrides,
    onPick: vi.fn(),
    onClose: vi.fn(),
  };
  render(<PeriodChooser {...props} />);
  return props;
};

test("a day page is chosen from a month of days", () => {
  const props = setup();
  expect(screen.getByText("August 2026")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Thu, 20 Aug 2026" }));
  expect(props.onPick).toHaveBeenCalledWith("2026-08-20");
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test("a week page is chosen from whole weeks, not from a day standing in for one", () => {
  const props = setup({ gran: "week" as Scope });
  fireEvent.click(
    screen.getByRole("button", { name: "Week 34 · 17 Aug – 23 Aug" })
  );
  expect(props.onPick).toHaveBeenCalledWith("2026-08-17");
});

test("a month page is chosen from twelve months, a year page from a dozen years", () => {
  const month = setup({ gran: "month" as Scope });
  expect(screen.getByText("2026")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "November 2026" }));
  expect(month.onPick).toHaveBeenCalledWith("2026-11-01");
  cleanup();
  const year = setup({ gran: "year" as Scope });
  expect(screen.getByText("2016 – 2027")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2027" }));
  expect(year.onPick).toHaveBeenCalledWith("2027-01-01");
});

test("browsing is not choosing — stepping the panel picks nothing", () => {
  const props = setup();
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("September 2026")).toBeTruthy();
  expect(props.onPick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(screen.getByText("August 2026")).toBeTruthy();
});

test("the current page is named as such for a screen reader", () => {
  setup();
  expect(
    screen.getByRole("button", { name: "Wed, 5 Aug 2026, the current one" })
  ).toBeTruthy();
});

test("a floor disables the pages below it, and the step that would only show them", () => {
  setup({ minAnchor: "2026-08-05" });
  expect(
    (screen.getByRole("button", { name: "Mon, 3 Aug 2026" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Thu, 20 Aug 2026" }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
  // July holds nothing choosable, so the panel refuses to go and look
  expect(
    (screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

test("the month grid always shows six rows, so the panel does not jump about", () => {
  setup();
  // 42 cells plus the two steppers and the close button
  expect(screen.getAllByRole("button").filter((b) => b.className.includes("pickCell"))).toHaveLength(42);
});

test("closing without choosing is offered, and Escape does the same", () => {
  const props = setup();
  fireEvent.click(screen.getByRole("button", { name: "close without changing" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onPick).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledTimes(2);
});

test("from a page away from now, the current one is one tap away", () => {
  const props = setup({ gran: "month" as Scope, anchor: "2027-03-01" });
  fireEvent.click(screen.getByRole("button", { name: "Choose this month" }));
  expect(props.onPick).toHaveBeenCalledWith("2026-08-05");
});
