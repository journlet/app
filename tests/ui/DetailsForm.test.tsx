// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DetailsForm from "../../src/ui/DetailsForm";
import type { Entry } from "../../src/lib/types";

vi.mock("../../src/store/journal", () => ({
  setDetails: vi.fn(),
}));
import { setDetails } from "../../src/store/journal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const base: Entry = {
  id: "e1",
  type: "task",
  text: "read paper",
  priority: false,
  state: "open",
  pageKey: "2026-07-24",
  createdAt: 0,
};

describe("DetailsForm (full-screen)", () => {
  test("with no details it opens straight into edit and saves", () => {
    const onClose = vi.fn();
    render(<DetailsForm entry={base} onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Entry details" }), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(setDetails).toHaveBeenCalledWith("e1", "https://example.com");
  });

  test("with details it reads first, showing a tappable link", () => {
    render(
      <DetailsForm
        entry={{ ...base, details: "see https://example.com" }}
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    // read mode offers an Edit button, not a Save button
    expect(screen.getByRole("button", { name: "Edit details" })).toBeTruthy();
  });

  test("saving empty details removes them and closes", () => {
    const onClose = vi.fn();
    render(
      <DetailsForm entry={{ ...base, details: "old" }} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Entry details" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(setDetails).toHaveBeenCalledWith("e1", "");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
