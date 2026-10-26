// @vitest-environment jsdom
//
// The quick task line (26 October 2026, quick capture option A).
//
// QuickLine is presentational: App owns whether it is open and what it holds.
// So each test drives it through a small host that keeps that state the way
// App does, and asserts what the component asks of App through its callbacks.
// The store is never reached from here — App's own tests cover the save.

import { afterEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import QuickLine from "../../src/ui/QuickLine";

afterEach(cleanup);

/** App's share of the line: open or not, and its text. */
const Host = ({
  onLog = vi.fn(),
  onCancel = vi.fn(),
  onMore = vi.fn(),
}: {
  onLog?: (text: string) => void;
  onCancel?: () => void;
  onMore?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const shut = () => {
    setOpen(false);
    setText("");
  };
  return (
    <QuickLine
      sectionKey="day"
      pageLabel="Today"
      open={open}
      text={text}
      onOpen={() => setOpen(true)}
      onChangeText={setText}
      onLog={() => {
        onLog(text);
        shut();
      }}
      onCancel={() => {
        onCancel();
        shut();
      }}
      onMore={onMore}
    />
  );
};

const tapArea = () => screen.getByTestId("quick-tap-day");
const input = () => screen.getByTestId("quick-input") as HTMLInputElement;
const lineIsOpen = () => input().closest("[hidden]") === null;

/** A finger press and release on the tap area, `move` px apart. */
const tap = (move = 0) => {
  fireEvent.pointerDown(tapArea(), { clientX: 40, clientY: 40, pointerType: "touch" });
  fireEvent.pointerUp(tapArea(), {
    clientX: 40,
    clientY: 40 + move,
    pointerType: "touch",
  });
  fireEvent.click(tapArea());
};

const openWith = (text: string) => {
  tap();
  fireEvent.change(input(), { target: { value: text } });
};

describe("opening", () => {
  test("a tap opens the line with the cursor in it, inside the tap's own pointerup (FR1.7)", () => {
    render(<Host />);
    expect(lineIsOpen()).toBe(false);
    // Recorded at the very end of the pointerup's dispatch, after React's own
    // handler: if focus has not moved by then, a phone would not raise the
    // keyboard for it
    let focusedDuringPointerUp: Element | null = null;
    const record = () => (focusedDuringPointerUp = document.activeElement);
    document.addEventListener("pointerup", record);
    try {
      tap();
    } finally {
      document.removeEventListener("pointerup", record);
    }
    expect(focusedDuringPointerUp).toBe(input());
    expect(lineIsOpen()).toBe(true);
  });

  test("a scroll that starts on the tap area does not open it (FR1.4)", () => {
    render(<Host />);
    tap(40);
    expect(lineIsOpen()).toBe(false);
    expect(document.activeElement).not.toBe(input());
  });
});

describe("the open line", () => {
  test("keeps the bullet column and lines its text up with the entries' (FR2.1, FR2.2)", () => {
    render(<Host />);
    tap();
    const row = input().parentElement!;
    const bullet = row.firstElementChild as HTMLElement;
    expect(bullet.className).toBe("bullet");
    expect(bullet.textContent).toBe("•");
    expect(bullet.getAttribute("aria-hidden")).toBe("true");
    // a button, as the entries' bullets are, so the "•" is drawn in the same
    // font and sits on the same column; never a stop in the tab order
    expect(bullet.tagName).toBe("BUTTON");
    expect(bullet.tabIndex).toBe(-1);
    // Pulled left by its own 8px padding and 1px border, so the typed text
    // starts where an entry's text does; and it takes the rest of the row
    expect(input().style.marginLeft).toBe("-9px");
    expect(input().style.flex).toMatch(/^1/);
    expect(screen.getByRole("textbox", { name: "New task, Today" })).toBe(input());
  });

  test("has Cancel, then more, then Log, beneath the text box (FR2.3)", () => {
    render(<Host />);
    tap();
    // the line: the text box's row, and the button row under it
    const line = input().parentElement!.parentElement!;
    const names = within(line)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Cancel", "more", "Log"]);
    // and the row comes after the text box in the page
    expect(input().compareDocumentPosition(screen.getByTestId("quick-cancel")) & 4).toBeTruthy();
  });
});

describe("closing", () => {
  test("Log saves what was typed, closes the line and gives focus back (FR3.1, NFR5)", () => {
    const onLog = vi.fn();
    render(<Host onLog={onLog} />);
    openWith("buy milk");
    fireEvent.click(screen.getByTestId("quick-log"));
    expect(onLog).toHaveBeenCalledWith("buy milk");
    expect(lineIsOpen()).toBe(false);
    expect(document.activeElement).toBe(tapArea());
  });

  test("Enter saves too (FR3.1)", () => {
    const onLog = vi.fn();
    render(<Host onLog={onLog} />);
    openWith("call the vet");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onLog).toHaveBeenCalledWith("call the vet");
    expect(lineIsOpen()).toBe(false);
  });

  test("Cancel and Escape close the line and discard its text (FR3.3)", () => {
    const onLog = vi.fn();
    const onCancel = vi.fn();
    render(<Host onLog={onLog} onCancel={onCancel} />);
    openWith("never mind");
    fireEvent.click(screen.getByTestId("quick-cancel"));
    expect(lineIsOpen()).toBe(false);
    expect(document.activeElement).toBe(tapArea());

    openWith("not this either");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(lineIsOpen()).toBe(false);

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onLog).not.toHaveBeenCalled();
    tap();
    expect(input().value).toBe("");
  });

  test("Log with nothing but spaces saves nothing and still closes (FR3.2)", () => {
    const onLog = vi.fn();
    const onCancel = vi.fn();
    render(<Host onLog={onLog} onCancel={onCancel} />);
    openWith("   ");
    fireEvent.click(screen.getByTestId("quick-log"));
    expect(onLog).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(lineIsOpen()).toBe(false);
  });
});
