// @vitest-environment jsdom
//
// The backup and restore rows in the Menu.
//
// The thing being pinned is the wording on the export row. It used to describe
// itself as a backup, and a person who read it that way would keep Markdown files
// for years and discover at the worst possible moment that nothing can read them
// back. So the export row has to say what it is not, and the backup row has to be
// the one that says "restore".

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MenuView from "../../src/MenuView";

afterEach(cleanup);

const renderMenu = (over: Partial<Parameters<typeof MenuView>[0]> = {}) => {
  const props = {
    syncStatus: "synced" as const,
    theme: "system" as const,
    onSetTheme: vi.fn(),
    installMode: "installed" as const,
    canPromptInstall: false,
    onInstall: vi.fn(),
    onOpenIndex: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenSync: vi.fn(),
    onExport: vi.fn(),
    onBackup: vi.fn(),
    onRestore: vi.fn(async () => "Restored 3 entries from that backup."),
    ...over,
  };
  render(<MenuView {...props} />);
  return props;
};

describe("what each row claims", () => {
  test("the export row says it cannot be restored from", () => {
    renderMenu();
    expect(
      screen.getByText(/cannot read it back/i)
    ).toBeTruthy();
  });

  test("the backup row says it can", () => {
    renderMenu();
    expect(screen.getByText(/Journlet can restore from/i)).toBeTruthy();
  });

  test("the backup row warns the file is not encrypted", () => {
    // It is the journal in plain bytes. Someone choosing where to put it needs to
    // know that before they choose, not after.
    renderMenu();
    expect(screen.getByText(/not encrypted/i)).toBeTruthy();
  });

  test("the restore row says it never removes anything", () => {
    // Which is what makes it safe to try, and why there is no confirmation step.
    renderMenu();
    expect(screen.getByText(/never removes or overwrites/i)).toBeTruthy();
  });
});

describe("using them", () => {
  test("backing up asks the app for a file", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("back up journal"));
    expect(props.onBackup).toHaveBeenCalledTimes(1);
  });

  test("choosing a file restores it and shows what happened", async () => {
    const props = renderMenu();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "b.journlet");

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(props.onRestore).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/Restored 3 entries/i)).toBeTruthy()
    );
  });

  test("a refusal is shown, not swallowed", async () => {
    const props = renderMenu({
      onRestore: vi.fn(async () => "That file is not a Journlet backup."),
    });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([9])], "wrong.txt")] },
    });

    await waitFor(() => expect(props.onRestore).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/not a Journlet backup/i)).toBeTruthy();
  });

  test("the same file can be chosen twice", async () => {
    // The input is cleared after each change, because retrying with the same file
    // after an error is the obvious thing to do and a file input will not fire
    // twice for one value.
    const props = renderMenu();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "b.journlet");

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(props.onRestore).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(props.onRestore).toHaveBeenCalledTimes(2));
  });

  test("choosing nothing does nothing", () => {
    const props = renderMenu();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });

    expect(props.onRestore).not.toHaveBeenCalled();
  });
});
