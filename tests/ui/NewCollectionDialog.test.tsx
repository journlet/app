// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NewCollectionDialog from "../../src/ui/NewCollectionDialog";
import type { CollectionKind } from "../../src/lib/types";

afterEach(cleanup);

const setup = (
  value: { name: string; kind: CollectionKind } = { name: "", kind: "list" }
) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const onCreate = vi.fn();
  render(
    <NewCollectionDialog
      value={value}
      onChange={onChange}
      onClose={onClose}
      onCreate={onCreate}
    />
  );
  return { onChange, onClose, onCreate };
};

test("typing the name calls onChange with the updated draft", () => {
  const { onChange } = setup();
  fireEvent.change(screen.getByLabelText("Collection name"), {
    target: { value: "Reading" },
  });
  expect(onChange).toHaveBeenCalledWith({ name: "Reading", kind: "list" });
});

test("choosing a type calls onChange with the new kind", () => {
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Habit tracker" }));
  expect(onChange).toHaveBeenCalledWith({ name: "", kind: "habits" });
});

test("Create is disabled until the name is non-empty", () => {
  setup({ name: "  ", kind: "list" });
  expect(
    (screen.getByRole("button", { name: "Create collection" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

test("Create passes the trimmed name and kind to onCreate", () => {
  const { onCreate } = setup({ name: "  Books  ", kind: "habits" });
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  expect(onCreate).toHaveBeenCalledWith("habits", "Books");
});

test("Enter with a valid name creates", () => {
  const { onCreate } = setup({ name: "Ideas", kind: "list" });
  fireEvent.keyDown(screen.getByLabelText("Collection name"), { key: "Enter" });
  expect(onCreate).toHaveBeenCalledWith("list", "Ideas");
});

test("Cancel closes without creating", () => {
  const { onClose, onCreate } = setup({ name: "Ideas", kind: "list" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onCreate).not.toHaveBeenCalled();
});
