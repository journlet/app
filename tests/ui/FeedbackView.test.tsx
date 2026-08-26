// @vitest-environment jsdom
//
// The feedback screen (spec §13.1).
//
// What these tests hold in place is the not-overclaiming. The report has to be on
// screen and editable, because a described block is one nobody can consent to; the
// confirmation has to stop at "your mail app should be open", because this app
// cannot see a sent message; and the draft has to come back, because the moment
// somebody wants to report a fault is often the moment they get interrupted.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/store/metrics", () => ({
  measureVolume: () => ({
    docBytes: 98700,
    entries: 412,
    recurrences: 3,
    collections: 2,
    habits: 1,
  }),
}));

const FeedbackView = (await import("../../src/ui/FeedbackView")).default;

const renderView = (over: { syncError?: string | null; installed?: boolean } = {}) =>
  render(
    <FeedbackView
      syncStatus="synced"
      syncError={over.syncError ?? null}
      installed={over.installed ?? true}
    />
  );

const messageBox = () => screen.getByLabelText("Your message");
const reportBox = () =>
  screen.getByLabelText("The report that will be attached") as HTMLTextAreaElement;

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
afterEach(cleanup);

describe("the report", () => {
  test("is on screen as text, not described in a sentence", () => {
    renderView({ syncError: "permission denied for table" });
    const text = reportBox().value;
    expect(text).toContain("running: installed app");
    expect(text).toContain("sync: synced");
    expect(text).toContain("sync error: permission denied for table");
    expect(text).toContain("journal: 412 entries, 96.4 KB on this device");
  });

  test("can be emptied, and then nothing of it is attached", () => {
    renderView();
    fireEvent.change(messageBox(), { target: { value: "the week page scrolls oddly" } });
    fireEvent.change(reportBox(), { target: { value: "" } });
    const link = screen.getByText("Open my mail app") as HTMLAnchorElement;
    expect(decodeURIComponent(link.href)).toContain("the week page scrolls oddly");
    expect(decodeURIComponent(link.href)).not.toContain("Journlet report");
  });

  test("says in words that no journal content is in it", () => {
    renderView();
    expect(screen.getByText(/No entries, no page names, no email address/)).toBeTruthy();
  });
});

describe("sending", () => {
  test("the link goes to the feedback mailbox and carries the message", () => {
    renderView();
    fireEvent.change(messageBox(), { target: { value: "a thought" } });
    const link = screen.getByText("Open my mail app") as HTMLAnchorElement;
    expect(link.href.startsWith("mailto:hello@journlet.com?")).toBe(true);
    expect(decodeURIComponent(link.href)).toContain("a thought");
  });

  test("the subject follows the chosen kind", () => {
    renderView();
    fireEvent.change(messageBox(), { target: { value: "a thought" } });
    fireEvent.click(screen.getByText("An idea"));
    const link = screen.getByText("Open my mail app") as HTMLAnchorElement;
    expect(decodeURIComponent(link.href)).toContain("Journlet: an idea");
  });

  test("an empty message cannot be sent, so no blank email arrives", () => {
    renderView();
    const link = screen.getByText("Open my mail app");
    expect(link.getAttribute("aria-disabled")).toBe("true");
  });

  test("claims only that a mail app was opened, never that anything was sent", () => {
    renderView();
    fireEvent.change(messageBox(), { target: { value: "a thought" } });
    fireEvent.click(screen.getByText("Open my mail app"));
    expect(screen.getByText(/Nothing has been sent until you send it there/)).toBeTruthy();
    // The words a screen like this usually reaches for, and cannot honestly use.
    expect(screen.queryByText(/thank you for your feedback/i)).toBeNull();
  });

  test("a report too long for a mail link is refused, not truncated", () => {
    renderView();
    fireEvent.change(reportBox(), { target: { value: "x".repeat(2000) } });
    fireEvent.change(messageBox(), { target: { value: "a thought" } });
    expect(screen.queryByText("Open my mail app")).toBeNull();
    expect(screen.getByText(/longer than a mail link can carry/)).toBeTruthy();
  });
});

describe("the draft", () => {
  test("comes back on the next visit, which is what being interrupted needs", () => {
    renderView();
    fireEvent.change(messageBox(), { target: { value: "half a sentence" } });
    cleanup();
    renderView();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("half a sentence");
  });

  test("clearing it empties the box and leaves nothing stored", () => {
    renderView();
    fireEvent.change(messageBox(), { target: { value: "never mind" } });
    fireEvent.click(screen.getByText("clear this draft"));
    expect((messageBox() as HTMLTextAreaElement).value).toBe("");
    cleanup();
    renderView();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("");
  });

  test("the diagnostics are not carried over, since a stale block would misreport", () => {
    // The draft is the message alone. A report kept from a previous visit would
    // describe that day's build and sync state and be read as describing this one.
    renderView();
    fireEvent.change(reportBox(), { target: { value: "edited to nothing useful" } });
    fireEvent.change(messageBox(), { target: { value: "keep me" } });
    cleanup();
    renderView();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("keep me");
    expect(reportBox().value).toContain("sync: synced");
  });
});
