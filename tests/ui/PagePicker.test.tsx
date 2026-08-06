// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PagePicker from "../../src/ui/PagePicker";
import type { Scope } from "../../src/lib/dates";

afterEach(cleanup);

type Props = Parameters<typeof PagePicker>[0];

const setup = (overrides: Partial<Props> = {}) => {
  const props = {
    label: "Log into",
    gran: "day" as Scope,
    anchor: "2026-07-24",
    today: "2026-07-24",
    ...overrides,
    setGran: vi.fn(),
    setAnchor: vi.fn(),
    onChanged: vi.fn(),
  };
  render(<PagePicker {...props} />);
  return props;
};

test("the four kinds of page are named, and the chosen one is marked", () => {
  setup({ gran: "month" as Scope });
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
    "day",
    "week",
    "month",
    "year",
  ]);
  expect(screen.getByRole("tab", { name: "month" }).getAttribute("aria-selected")).toBe("true");
});

test("the current period is said in words, not left to a highlight", () => {
  setup({ gran: "week" as Scope });
  expect(screen.getByText("this week")).toBeTruthy();
  cleanup();
  setup({ gran: "week" as Scope, anchor: "2026-09-02" });
  expect(screen.queryByText("this week")).toBeNull();
});

test("each granularity names its page in full", () => {
  setup({ gran: "week" as Scope, anchor: "2026-08-12" });
  // a week number alone would not say which days it covers
  expect(screen.getByText("Week 33 · 10 Aug – 16 Aug")).toBeTruthy();
  cleanup();
  setup({ gran: "year" as Scope, anchor: "2026-08-12" });
  expect(screen.getByText("2026")).toBeTruthy();
});

test("stepping moves by the chosen unit, not by a day", () => {
  const month = setup({ gran: "month" as Scope, anchor: "2026-07-24" });
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(month.setAnchor).toHaveBeenCalledWith("2026-08-01");
  cleanup();
  const week = setup({ gran: "week" as Scope, anchor: "2026-07-24" });
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  expect(week.setAnchor).toHaveBeenCalledWith("2026-07-17");
});

test("a floor refuses the step back rather than hiding it", () => {
  setup({ minAnchor: "2026-07-24" });
  expect(
    (screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  cleanup();
  // no floor: the picker reaches backwards, which is what a correction needs
  setup();
  expect(
    (screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
});

test("the floor is the whole period, so a month floor keeps that month reachable", () => {
  setup({ gran: "month" as Scope, anchor: "2026-07-24", minAnchor: "2026-07-24" });
  // stepping back would leave July, which the floor forbids
  expect(
    (screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

test("the chooser stays hidden until the page name is tapped", () => {
  setup({ gran: "month" as Scope });
  expect(screen.queryByRole("group", { name: "Choose a month page" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "July 2026 — choose a different month" })
  );
  expect(screen.getByRole("group", { name: "Choose a month page" })).toBeTruthy();
});

test("choosing from the panel sets the anchor and shuts it again", () => {
  const props = setup({ gran: "month" as Scope });
  fireEvent.click(
    screen.getByRole("button", { name: "July 2026 — choose a different month" })
  );
  fireEvent.click(screen.getByRole("button", { name: "November 2026" }));
  expect(props.setAnchor).toHaveBeenCalledWith("2026-11-01");
  expect(screen.queryByRole("group", { name: "Choose a month page" })).toBeNull();
});

test("the panel offers the kind of page being chosen, not a day standing in for it", () => {
  setup({ gran: "week" as Scope });
  fireEvent.click(
    screen.getByRole("button", { name: /choose a different week/ })
  );
  // whole weeks, and no native date field anywhere — Safari has no week picker
  expect(
    screen.getByRole("button", { name: "Week 31 · 27 Jul – 2 Aug" })
  ).toBeTruthy();
  expect(document.querySelector('input[type="date"]')).toBeNull();
});

test("a page away from now offers a labelled way back, and only then", () => {
  const props = setup({ anchor: "2026-08-12" });
  expect(screen.getByText("choose another day")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to today" }));
  expect(props.setAnchor).toHaveBeenCalledWith("2026-07-24");
  cleanup();
  setup();
  expect(screen.queryByRole("button", { name: "Back to today" })).toBeNull();
});

test("every change reports back, so the caller can restore focus", () => {
  const props = setup();
  fireEvent.click(screen.getByRole("tab", { name: "year" }));
  fireEvent.click(screen.getByRole("button", { name: "Next day" }));
  expect(props.onChanged).toHaveBeenCalledTimes(2);
});
