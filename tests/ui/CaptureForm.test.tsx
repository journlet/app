// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import CaptureForm from "../../src/ui/CaptureForm";
import type { Collection, Entry } from "../../src/lib/types";

afterEach(cleanup);

// Build props with sensible defaults; each test overrides what it exercises.
const setup = (overrides: Partial<Parameters<typeof CaptureForm>[0]> = {}) => {
  const props = {
    inputRef: createRef<HTMLInputElement>(),
    input: "",
    setInput: vi.fn(),
    captureDetails: "",
    setCaptureDetails: vi.fn(),
    captureParent: null as Entry | null,
    captureLost: null as string | null,
    captureParentPageLabel: null as string | null,
    clearCaptureParent: vi.fn(),
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

// Capturing a sub-bullet (spec §4.1): the form is opened from an entry's
// "Add a sub-bullet" action with that entry pre-set as the parent.
describe("sub-bullet capture", () => {
  const parent: Entry = {
    id: "p1",
    type: "task",
    text: "plan the week",
    priority: false,
    state: "open",
    pageKey: "2026-07-24",
    createdAt: 0,
  };

  test("names the parent before the input, so it is known before typing", () => {
    setup({ captureParent: parent, captureParentPageLabel: "Fri 24 Jul" });
    expect(screen.getByText("New sub-bullet")).toBeTruthy();
    expect(screen.getByText(/Nesting under/)).toBeTruthy();
    expect(screen.getByText("plan the week")).toBeTruthy();
  });

  test("hides the page choice, says why, and names the page it lands on", () => {
    // The sheet opens from scheduled rows on other pages, so the page a
    // sub-bullet lands on may not be the page on screen — it must be named
    setup({ captureParent: parent, captureParentPageLabel: "Fri 24 Jul" });
    expect(screen.queryByRole("tablist", { name: "Log into" })).toBeNull();
    expect(
      screen.getByText(/same page as their parent, so this lands on Fri 24 Jul/)
    ).toBeTruthy();
  });

  test("a completed parent is shown as completed, not as an open bullet", () => {
    setup({
      captureParent: { ...parent, state: "done" },
      captureParentPageLabel: "Fri 24 Jul",
    });
    expect(screen.getByText("×")).toBeTruthy();
  });

  test("a lost parent is announced with the reason, page choice stays hidden", () => {
    // The page is still pinned, so offering scope buttons would be a lie
    setup({
      captureParent: null,
      captureLost: "The entry you were nesting under has gone.",
      captureParentPageLabel: "Fri 24 Jul",
    });
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("has gone");
    expect(note.textContent).toContain("top level");
    expect(note.textContent).toContain("Fri 24 Jul");
    expect(screen.queryByRole("tablist", { name: "Log into" })).toBeNull();
    expect(screen.getByText("New entry")).toBeTruthy();
  });

  test("a parent that became a sub-bullet itself is reported as such", () => {
    // Not "gone" — the reason has to match what actually happened
    setup({
      captureParent: null,
      captureLost:
        "The entry you were nesting under is now a sub-bullet itself, so it can't take sub-bullets.",
      captureParentPageLabel: "Fri 24 Jul",
    });
    expect(screen.getByRole("status").textContent).toContain(
      "now a sub-bullet itself"
    );
  });

  test("a lost parent offers a way back to choosing a page", () => {
    const props = setup({
      captureParent: null,
      captureLost: "The entry you were nesting under has gone.",
      captureParentPageLabel: "Fri 24 Jul",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose a page instead" })
    );
    expect(props.clearCaptureParent).toHaveBeenCalledTimes(1);
  });

  test("a deleted collection page drops the pin and restores the page choice", () => {
    // The pinned page no longer exists, so keeping it would strand the entry
    setup({
      captureParent: null,
      captureLost: "The collection you were logging into has been deleted.",
      captureParentPageLabel: null,
    });
    expect(screen.getByRole("status").textContent).toContain(
      "page you choose below"
    );
    expect(screen.getByRole("tablist", { name: "Log into" })).toBeTruthy();
  });

  test("offers a plainly labelled way back to ordinary capture", () => {
    const props = setup({ captureParent: parent, captureParentPageLabel: "Fri 24 Jul" });
    fireEvent.click(
      screen.getByRole("button", { name: "Log at top level instead" })
    );
    expect(props.clearCaptureParent).toHaveBeenCalledTimes(1);
  });

  test("type and signifiers still apply — a sub-bullet is a full entry", () => {
    const props = setup({ captureParent: parent, captureParentPageLabel: "Fri 24 Jul" });
    fireEvent.click(screen.getByRole("button", { name: /note/ }));
    expect(props.setCaptureType).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /priority/ }));
    expect(props.setCapturePriority).toHaveBeenCalled();
  });

  test("ordinary capture is unchanged: the page choice is still offered", () => {
    setup({ captureParent: null });
    expect(screen.getByRole("tablist", { name: "Log into" })).toBeTruthy();
    expect(screen.getByText("New entry")).toBeTruthy();
    expect(screen.queryByText(/Nesting under/)).toBeNull();
  });
});
