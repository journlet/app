// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SearchView from "../../src/ui/SearchView";
import { searchJournal, EMPTY_RESULTS } from "../../src/lib/search";
import type { Collection, Entry } from "../../src/lib/types";
import { colPageKey } from "../../src/lib/types";

afterEach(cleanup);

let seq = 0;
const entry = (over: Partial<Entry> & { text: string; pageKey: string }): Entry => ({
  id: `e${++seq}`,
  type: "task",
  priority: false,
  state: "open",
  createdAt: ++seq,
  ...over,
});

const cols: Collection[] = [
  { id: "c1", kind: "list", name: "Reading list", createdAt: 1 },
];

const days: Record<string, Entry[]> = {
  "2026-07-30": [
    entry({ text: "book the vet", pageKey: "2026-07-30" }),
    entry({ text: "ring the bank", state: "done", pageKey: "2026-07-30" }),
  ],
  [colPageKey("c1")]: [entry({ text: "book: the long ships", pageKey: colPageKey("c1") })],
};

const view = (query: string, over: Record<string, unknown> = {}) =>
  render(
    <SearchView
      query={query}
      setQuery={vi.fn()}
      results={query ? searchJournal(query, days, cols, []) : EMPTY_RESULTS}
      onOpenEntry={vi.fn()}
      onOpenCollection={vi.fn()}
      {...over}
    />
  );

test("an empty field explains what it covers and that it stays on device", () => {
  view("");
  expect(screen.getByText(/never on the server/i)).toBeTruthy();
  expect(screen.queryByText(/entries on/)).toBeNull();
});

test("the interface calls it Find, matching the button that opens it", () => {
  const { container } = view("");
  expect(screen.getByRole("heading", { name: "Find" })).toBeTruthy();
  expect(
    container.querySelector("input")?.getAttribute("placeholder")
  ).toBe("Find an entry…");
  expect(container.textContent).not.toContain("Search");
});

test("typing filters and counts the hits across pages", () => {
  view("book");
  expect(screen.getByText(/2 entries on 2 pages/)).toBeTruthy();
});

test("results are grouped under the page they live on, named plainly", () => {
  view("book");
  expect(screen.getByText("Reading list")).toBeTruthy();
  expect(screen.getByText("Thu 30 Jul")).toBeTruthy();
});

test("matched words are marked without altering the entry text", () => {
  const { container } = view("vet");
  const marks = container.querySelectorAll("mark.searchMark");
  expect(marks).toHaveLength(1);
  expect(marks[0].textContent).toBe("vet");
  expect(container.textContent).toContain("book the vet");
});

test("a completed entry keeps its × glyph — never a substitution", () => {
  const { container } = view("bank");
  const bullet = container.querySelector(".bullet");
  expect(bullet?.textContent).toBe("×");
  expect(bullet?.className).toContain("isDone");
});

test("the whole row is one labelled target that opens the entry's page", () => {
  const onOpenEntry = vi.fn();
  view("vet", { onOpenEntry });
  const row = screen.getByRole("button", {
    name: "Open task, “book the vet” on Thu 30 Jul",
  });
  fireEvent.click(row);
  expect(onOpenEntry).toHaveBeenCalledWith("2026-07-30", expect.any(String));
});

test("the label says the state, which the glyph alone cannot", () => {
  view("bank");
  expect(
    screen.getByRole("button", {
      name: "Open task, completed, “ring the bank” on Thu 30 Jul",
    })
  ).toBeTruthy();
});

test("a collection whose name matches is offered as a page", () => {
  const onOpenCollection = vi.fn();
  view("reading", { onOpenCollection });
  fireEvent.click(screen.getByRole("button", { name: "Open Reading list" }));
  expect(onOpenCollection).toHaveBeenCalledWith("c1");
});

test("no match says so plainly and suggests fewer words", () => {
  view("unicorn");
  expect(screen.getByText(/Nothing found for “unicorn”/)).toBeTruthy();
  expect(screen.getByText(/try fewer words/)).toBeTruthy();
});

test("clear empties the field", () => {
  const setQuery = vi.fn();
  view("book", { setQuery });
  fireEvent.click(screen.getByRole("button", { name: "clear" }));
  expect(setQuery).toHaveBeenCalledWith("");
});
