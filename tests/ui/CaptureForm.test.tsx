// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import CaptureForm from "../../src/ui/CaptureForm";
import type { Collection } from "../../src/lib/types";

afterEach(cleanup);

// Build props with sensible defaults; each test overrides what it exercises.
const setup = (overrides: Partial<Parameters<typeof CaptureForm>[0]> = {}) => {
  const props = {
    inputRef: createRef<HTMLInputElement>(),
    input: "",
    setInput: vi.fn(),
    captureDetails: "",
    setCaptureDetails: vi.fn(),
    submitEntry: vi.fn(),
    closeCapture: vi.fn(),
    justLogged: null,
    activeCol: null as Collection | null,
    today: "2026-07-24",
    captureScope: "day" as const,
    setCaptureScope: vi.fn(),
    captureType: "task" as const,
    setCaptureType: vi.fn(),
    capturePriority: false,
    setCapturePriority: vi.fn(),
    captureInspiration: false,
    setCaptureInspiration: vi.fn(),
    customDate: "2026-07-24",
    setCustomDate: vi.fn(),
    customGran: "day" as const,
    setCustomGran: vi.fn(),
    ...overrides,
  };
  render(<CaptureForm {...props} />);
  return props;
};

test("Log button is disabled with an empty draft and enabled once typed", () => {
  setup({ input: "" });
  const logBtn = screen.getByRole("button", { name: "Log" }) as HTMLButtonElement;
  expect(logBtn.disabled).toBe(true);
  cleanup();
  setup({ input: "buy milk" });
  expect((screen.getByRole("button", { name: "Log" }) as HTMLButtonElement).disabled).toBe(false);
});

test("typing updates the draft via setInput", () => {
  const props = setup();
  fireEvent.change(screen.getByRole("textbox", { name: "New entry" }), {
    target: { value: "call dentist" },
  });
  expect(props.setInput).toHaveBeenCalledWith("call dentist");
});

test("Enter submits, Escape closes", () => {
  const props = setup({ input: "something" });
  const input = screen.getByRole("textbox", { name: "New entry" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(props.submitEntry).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(props.closeCapture).toHaveBeenCalledTimes(1);
});

test("clicking Log submits", () => {
  const props = setup({ input: "x" });
  fireEvent.click(screen.getByRole("button", { name: "Log" }));
  expect(props.submitEntry).toHaveBeenCalledTimes(1);
});

test("typing in details updates via setCaptureDetails", () => {
  const props = setup();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Entry details (optional)" }),
    { target: { value: "https://example.com" } }
  );
  expect(props.setCaptureDetails).toHaveBeenCalledWith("https://example.com");
});

test("close button reads Cancel with no draft logged, Done after logging", () => {
  setup({ justLogged: null });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  cleanup();
  setup({ justLogged: "bought milk" });
  expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  expect(screen.getByText(/Logged/)).toBeTruthy();
});

describe("scope selection", () => {
  test("choosing a scope calls setCaptureScope", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("tab", { name: "week" }));
    expect(props.setCaptureScope).toHaveBeenCalledWith("week");
  });

  test("date scope reveals the date + granularity controls", () => {
    setup({ captureScope: "date" });
    expect(screen.getByLabelText("Schedule date")).toBeTruthy();
    // granularity buttons present
    expect(screen.getByRole("button", { name: "month" })).toBeTruthy();
  });
});

describe("type and signifiers", () => {
  test("choosing a type calls setCaptureType with an updater to that type", () => {
    const props = setup({ captureType: "task" });
    fireEvent.click(screen.getByRole("button", { name: /event/ }));
    expect(props.setCaptureType).toHaveBeenCalledTimes(1);
    const updater = props.setCaptureType.mock.calls[0][0];
    expect(updater("task")).toBe("event");
  });

  test("priority and inspiration toggle via updater functions", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /priority/ }));
    expect(props.setCapturePriority.mock.calls[0][0](false)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /inspiration/ }));
    expect(props.setCaptureInspiration.mock.calls[0][0](false)).toBe(true);
  });
});

test("in collection mode the scope tabs are hidden and the collection is named", () => {
  const activeCol: Collection = {
    id: "c1",
    kind: "list",
    name: "Books",
    createdAt: 0,
  };
  setup({ activeCol });
  expect(screen.getByText(/Logging into the .*Books.* collection/)).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "week" })).toBeNull();
});
