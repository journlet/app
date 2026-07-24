// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CaptureLauncher from "../../src/ui/CaptureLauncher";
import type { Collection } from "../../src/lib/types";

afterEach(cleanup);

const base = {
  onOpen: vi.fn(),
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
