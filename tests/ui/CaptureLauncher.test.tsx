// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CaptureLauncher from "../../src/ui/CaptureLauncher";
import type { Collection } from "../../src/lib/types";

afterEach(cleanup);

const base = {
  onOpen: vi.fn(),
  onFind: vi.fn(),
  canLog: true,
  activeCol: null as Collection | null,
  captureType: "task" as const,
  captureScope: "day" as const,
  capturePriority: false,
  captureInspiration: false,
};

test("shows the generic hint and the current prefs", () => {
  render(<CaptureLauncher {...base} captureScope="week" captureType="note" />);
  expect(screen.getByText("Log an entry…")).toBeTruthy();
  expect(screen.getByText("week · note")).toBeTruthy();
});

test("includes signifier marks when priority/inspiration are set", () => {
  render(
    <CaptureLauncher
      {...base}
      capturePriority
      captureInspiration
    />
  );
  expect(screen.getByText("day · task · * · !")).toBeTruthy();
});

test("in a collection it names the collection and shows only the type", () => {
  const activeCol: Collection = {
    id: "c1",
    kind: "list",
    name: "Books",
    createdAt: 0,
  };
  render(<CaptureLauncher {...base} activeCol={activeCol} />);
  expect(screen.getByText("Log into Books…")).toBeTruthy();
  expect(screen.getByText("task")).toBeTruthy();
});

test("both the field and the Log button open the form", () => {
  const onOpen = vi.fn();
  render(<CaptureLauncher {...base} onOpen={onOpen} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Log an entry — opens the entry form" })
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Log — opens the entry form" })
  );
  expect(onOpen).toHaveBeenCalledTimes(2);
});

test("Find sits on the bar and opens the find screen, without opening the entry form", () => {
  const onFind = vi.fn();
  const onOpen = vi.fn();
  render(<CaptureLauncher {...base} onFind={onFind} onOpen={onOpen} />);
  const find = screen.getByRole("button", {
    name: "Find an entry — opens the find screen",
  });
  // the icon is paired with the word, never left to carry the meaning alone
  expect(find.textContent).toBe("Find");
  fireEvent.click(find);
  expect(onFind).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
});

test("on a page that takes no entries, Find stands alone and the field goes", () => {
  const onFind = vi.fn();
  render(<CaptureLauncher {...base} canLog={false} onFind={onFind} />);
  expect(screen.queryByText("Log an entry…")).toBeNull();
  expect(screen.queryByRole("button", { name: /opens the entry form/ })).toBeNull();
  const find = screen.getByRole("button", {
    name: "Find an entry — opens the find screen",
  });
  // same control, same corner — it must not move between pages
  expect(find.className).toContain("launcherFind");
  fireEvent.click(find);
  expect(onFind).toHaveBeenCalledTimes(1);
});

test("Find comes before the entry field, Log after it", () => {
  const { container } = render(<CaptureLauncher {...base} />);
  const order = Array.from(
    container.querySelectorAll(".launcherFind, .launcherField, .launcherGo")
  ).map((el) => el.className);
  expect(order).toEqual(["launcherFind", "launcherField", "launcherGo"]);
});
