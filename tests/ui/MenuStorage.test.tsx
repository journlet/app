// @vitest-environment jsdom
//
// The storage row on the Menu. It exists so that a storage cap is something a
// person can watch approaching rather than something that surprises them, which
// is the whole reason public.user_usage is readable by its owner.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

let usage: { bytes: number; quota: number } | null = null;

vi.mock("../../src/store/usage", () => ({
  serverUsage: async () => usage,
}));

const MenuView = (await import("../../src/MenuView")).default;

afterEach(() => {
  cleanup();
  usage = null;
});

const renderMenu = () =>
  render(
    <MenuView
      syncStatus="synced"
      theme="system"
      onSetTheme={vi.fn()}
      installMode="hidden"
      canPromptInstall={false}
      onInstall={vi.fn()}
      onOpenIndex={vi.fn()}
      onOpenSearch={vi.fn()}
      onOpenSync={vi.fn()}
      onExport={vi.fn()}
      onBackup={vi.fn()}
      onRestore={vi.fn(async () => "")}
    />
  );

describe("when the server can be asked", () => {
  test("shows what is used against the cap", async () => {
    usage = { bytes: 125780, quota: 20971520 };
    renderMenu();
    await waitFor(() =>
      expect(screen.getByText(/122\.8 KB of 20 MB on the server/)).toBeTruthy()
    );
  });

  test("scales the unit, so a full account does not read in kilobytes", async () => {
    usage = { bytes: 20500000, quota: 20971520 };
    renderMenu();
    await waitFor(() =>
      expect(screen.getByText(/19\.6 MB of 20 MB on the server/)).toBeTruthy()
    );
  });
});

describe("approaching the cap", () => {
  // The warning exists because 5 MB is a limit people will actually reach, and
  // the last fifth of it is close to a year of writing. Said at 80% it is notice;
  // said at the wall it is an apology.
  test("past 80% it invites the person to ask for more", async () => {
    usage = { bytes: 4300000, quota: 5242880 };
    renderMenu();
    await waitFor(() =>
      expect(screen.getByText(/Nearly full/)).toBeTruthy()
    );
    // Read out of the warning itself rather than off the page. The feedback row
    // added on 26 August 2026 names the same mailbox, so a page-wide match now
    // finds two and fails on the count, which would say nothing about this row.
    expect(screen.getByText(/Nearly full/).textContent).toContain(
      "hello@journlet.com"
    );
    // And says what does not stop, because the alarming reading is the wrong one.
    expect(screen.getByText(/Writing here keeps working/)).toBeTruthy();
  });

  test("under 80% it says nothing, so the notice means something", async () => {
    usage = { bytes: 4100000, quota: 5242880 };
    renderMenu();
    await waitFor(() =>
      expect(screen.getByText(/on the server/)).toBeTruthy()
    );
    expect(screen.queryByText(/Nearly full/)).toBeNull();
  });

  test("exactly at 80% is not yet nearly full", async () => {
    usage = { bytes: 4194304, quota: 5242880 };
    renderMenu();
    await waitFor(() => expect(screen.getByText(/on the server/)).toBeTruthy());
    expect(screen.queryByText(/Nearly full/)).toBeNull();
  });
});

describe("when it cannot", () => {
  test("says nothing about the server and still renders the local figures", async () => {
    usage = null;
    renderMenu();
    // The local half is what this row always said, and it must survive a project
    // where user_usage does not exist at all. Matched on the entry count rather
    // than "on this device", which the search row also says.
    await waitFor(() =>
      expect(screen.getByText(/A rough gauge of how full this notebook is/)).toBeTruthy()
    );
    expect(screen.queryByText(/on the server/)).toBeNull();
  });
});
