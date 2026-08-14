// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import CaptureForm from "../../src/ui/CaptureForm";
import type { Collection, Entry } from "../../src/lib/types";

afterEach(cleanup);

type Props = Parameters<typeof CaptureForm>[0];

/**
 * The callbacks every test wants as spies, kept out of the overridable set.
 *
 * Spreading `overrides` over these widened each one to "spy, or the real prop
 * signature", because the compiler cannot know a caller has not replaced the
 * spy with a plain function. That is why `props.setCaptureType.mock` did not
 * typecheck. A test that wants different behaviour should assert on the spy
 * rather than swap it out.
 */
const spies = () => ({
  setInput: vi.fn(),
  setCaptureDetails: vi.fn(),
  clearCaptureParent: vi.fn(),
  submitEntry: vi.fn(),
  closeCapture: vi.fn(),
  setCaptureScope: vi.fn(),
  setCaptureType: vi.fn(),
  setCapturePriority: vi.fn(),
  setCaptureInspiration: vi.fn(),
  setCaptureAnchor: vi.fn(),
  resetCapture: vi.fn(),
});

// Build props with sensible defaults; each test overrides what it exercises.
const setup = (
  overrides: Partial<Omit<Props, keyof ReturnType<typeof spies>>> = {}
) => {
  const props = {
    inputRef: createRef<HTMLInputElement>(),
    input: "",
    captureDetails: "",
    captureParent: null as Entry | null,
    captureLost: null as string | null,
    captureParentPageLabel: null as string | null,
    justLogged: null as string | null,
    activeCol: null as Collection | null,
    today: "2026-07-24",
    captureScope: "day" as const,
    captureType: "task" as const,
    capturePriority: false,
    captureInspiration: false,
    captureAnchor: "2026-07-24",
    ...overrides,
    ...spies(),
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

describe("page selection", () => {
  test("choosing a kind of page calls setCaptureScope", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("tab", { name: "week" }));
    expect(props.setCaptureScope).toHaveBeenCalledWith("week");
  });

  test("the chosen page is named, and the current one said in words", () => {
    setup();
    expect(screen.getByText("Fri, 24 Jul 2026")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();
  });

  test("the steppers are always there, and the chooser is not until asked for", () => {
    setup();
    expect(screen.getByRole("button", { name: "Next day" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Choose a/ })).toBeNull();
    // no native date field: the browser only picks days, and Safari picks
    // neither weeks nor months at all
    expect(document.querySelector('input[type="date"]')).toBeNull();
    // "date…" was a fifth tab; the tabs are now only the four kinds of page
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByRole("tab", { name: "date…" })).toBeNull();
  });

  test("capture cannot reach into the past, in the steppers or in the chooser", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /choose a different day/ }));
    expect(
      (screen.getByRole("button", { name: "Thu, 23 Jul 2026" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Mon, 27 Jul 2026" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  test("stepping forward moves the anchor by the chosen unit", () => {
    const props = setup({ captureScope: "month" as const });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(props.setCaptureAnchor).toHaveBeenCalledWith("2026-08-01");
  });

  test("a page away from now offers a plainly labelled way back", () => {
    const props = setup({ captureAnchor: "2026-08-12" });
    expect(screen.getByText("Wed, 12 Aug 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to today" }));
    expect(props.setCaptureAnchor).toHaveBeenCalledWith("2026-07-24");
  });

  test("the entry field says which page it is logging for", () => {
    setup({ captureScope: "week" as const, captureAnchor: "2026-08-12" });
    expect(
      screen.getByPlaceholderText("Log for Week 33 · 10 Aug – 16 Aug…")
    ).toBeTruthy();
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

// Resetting the sticky choices (14 August 2026). The reset covers the page,
// the type and the signifiers, and deliberately leaves the typed text alone.
describe("reset", () => {
  test("is not offered when the form is already at today, task, no signifiers", () => {
    // A button that would do nothing on tap is as bad as an unlabelled one
    setup();
    expect(screen.queryByRole("button", { name: /^Reset to/ })).toBeNull();
  });

  test("is offered, and named in full, once a signifier is lit", () => {
    const props = setup({ capturePriority: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to today, task, no signifiers" })
    );
    expect(props.resetCapture).toHaveBeenCalledTimes(1);
  });

  test("is offered when the type is not task", () => {
    setup({ captureType: "note" as const });
    expect(
      screen.getByRole("button", { name: "Reset to today, task, no signifiers" })
    ).toBeTruthy();
  });

  test("is offered when the page is not today", () => {
    setup({ captureAnchor: "2026-08-12" });
    expect(
      screen.getByRole("button", { name: "Reset to today, task, no signifiers" })
    ).toBeTruthy();
  });

  test("is offered when the page is a longer period than a day", () => {
    setup({ captureScope: "week" as const });
    expect(
      screen.getByRole("button", { name: "Reset to today, task, no signifiers" })
    ).toBeTruthy();
  });

  test("drops today from the label where the form owns no page choice", () => {
    // Collection capture has no picker, so promising a move to today would be
    // naming a choice this form cannot make
    const activeCol: Collection = {
      id: "c1",
      kind: "list",
      name: "Books",
      createdAt: 0,
    };
    setup({ activeCol, captureInspiration: true });
    expect(
      screen.getByRole("button", { name: "Reset to task, no signifiers" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Reset to today/ })
    ).toBeNull();
  });

  test("a pinned sub-bullet gets the same shortened label", () => {
    setup({
      captureParent: null,
      captureParentPageLabel: "Fri 24 Jul",
      captureType: "event" as const,
    });
    expect(
      screen.getByRole("button", { name: "Reset to task, no signifiers" })
    ).toBeTruthy();
  });

  test("a page away from today alone does not offer a reset in collection mode", () => {
    // The picker is hidden there, so the stale page is invisible and untouched
    const activeCol: Collection = {
      id: "c1",
      kind: "list",
      name: "Books",
      createdAt: 0,
    };
    setup({ activeCol, captureAnchor: "2026-08-12" });
    expect(screen.queryByRole("button", { name: /^Reset to/ })).toBeNull();
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
