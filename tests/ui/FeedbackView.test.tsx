// @vitest-environment jsdom
//
// The feedback screen (spec §13.1).
//
// What these tests hold in place is the not-overclaiming, and one thing that had to
// be learned the hard way. The routes are plural: the first version of this screen
// made a mailto: the primary action and the clipboard a footnote, and the first
// person to use it had no mail client and got macOS Mail's Add Account dialog. So
// there is a test here that all three routes are offered at once, and a test that
// a report too long for a mail link does not take the browser composer down with
// it. The rest is the honesty: the report on screen and editable, a confirmation
// that stops at "a composer should be open", and a draft that comes back.

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

const renderView = (
  over: { syncError?: string | null; installed?: boolean; journalOpen?: boolean } = {}
) =>
  render(
    <FeedbackView
      syncStatus="synced"
      syncError={over.syncError ?? null}
      installed={over.installed ?? true}
      journalOpen={over.journalOpen ?? true}
    />
  );

const messageBox = () => screen.getByLabelText("Your message") as HTMLTextAreaElement;
const reportBox = () =>
  screen.getByLabelText("The report that will be attached") as HTMLTextAreaElement;
const gmailLink = () => screen.getByText("open Gmail") as HTMLAnchorElement;
const mailLink = () => screen.getByText("open mail app") as HTMLAnchorElement;
const write = (text: string) =>
  fireEvent.change(messageBox(), { target: { value: text } });

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

  // Opened from a gate (4 September 2026): the doc behind this screen is empty
  // because the journal has not been read or cannot be, so the one line a reader
  // can check has to say that rather than reporting a journal with nothing in it.
  test("does not claim an empty journal when it was opened from a gate", () => {
    renderView({ journalOpen: false, syncError: "PGRST301 JWT expired" });
    const text = reportBox().value;
    expect(text).toContain("journal: not open on this device");
    expect(text).not.toContain("412 entries");
    expect(text).toContain("sync error: PGRST301 JWT expired");
  });

  test("can be emptied, and then nothing of it is attached", () => {
    renderView();
    write("the week page scrolls oddly");
    fireEvent.change(reportBox(), { target: { value: "" } });
    const sent = decodeURIComponent(mailLink().href);
    expect(sent).toContain("the week page scrolls oddly");
    expect(sent).not.toContain("Journlet report");
  });

  test("says in words that no journal content is in it", () => {
    renderView();
    expect(screen.getByText(/No entries, no page names, no email address/)).toBeTruthy();
  });
});

describe("the ways to send it", () => {
  // The finding, as a test. Somebody who reads email in a browser and has no mail
  // client must not meet a screen whose only real action is a mailto:.
  test("offers a browser composer, a mail app and the clipboard, all at once", () => {
    renderView();
    write("a thought");
    expect(gmailLink()).toBeTruthy();
    expect(mailLink()).toBeTruthy();
    expect(screen.getByText("copy the report")).toBeTruthy();
  });

  test("Gmail opens its own composer, in another tab, carrying the message", () => {
    renderView();
    write("a thought");
    const link = gmailLink();
    expect(link.href.startsWith("https://mail.google.com/mail/?view=cm")).toBe(true);
    expect(decodeURIComponent(link.href)).toContain("a thought");
    expect(decodeURIComponent(link.href)).toContain("hello@journlet.com");
    // A new tab, or the app would navigate away from an unsent draft.
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noreferrer");
  });

  test("the mail app route goes to the feedback mailbox", () => {
    renderView();
    write("a thought");
    expect(mailLink().href.startsWith("mailto:hello@journlet.com?")).toBe(true);
  });

  test("the subject follows the chosen kind, on both routes", () => {
    renderView();
    write("a thought");
    fireEvent.click(screen.getByText("An idea"));
    expect(decodeURIComponent(gmailLink().href)).toContain("Journlet: an idea");
    expect(decodeURIComponent(mailLink().href)).toContain("Journlet: an idea");
  });

  test("an empty message cannot be sent by any route, so no blank email arrives", () => {
    renderView();
    expect(gmailLink().getAttribute("aria-disabled")).toBe("true");
    expect(mailLink().getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByText("copy the report") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a report too long for a mail link does not take Gmail down with it", () => {
    // The two limits are different because the constraints are: a mail client's
    // URL handler is not a browser address bar. Refusing both would send somebody
    // to the clipboard for no reason.
    renderView();
    fireEvent.change(reportBox(), { target: { value: "x".repeat(2000) } });
    write("a thought");
    expect(screen.queryByText("open mail app")).toBeNull();
    expect(screen.getByText("too long")).toBeTruthy();
    expect(gmailLink()).toBeTruthy();
  });

  test("what is copied carries the subject, which a paste cannot", () => {
    // The finding of 26 August 2026: pasted into iCloud Mail, the report arrived as
    // "(no subject)", because the kind lives in a header field the clipboard has no
    // equivalent of.
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: async (t: string) => void written.push(t) },
    });
    renderView();
    write("a thought");
    fireEvent.click(screen.getByText("copy the report"));
    return Promise.resolve().then(() => {
      expect(written[0]?.startsWith("Subject: Journlet: something is broken")).toBe(true);
      expect(written[0]).toContain("a thought");
    });
  });

  test("the clipboard is always there, whatever the length", () => {
    renderView();
    fireEvent.change(reportBox(), { target: { value: "x".repeat(20000) } });
    write("a thought");
    expect((screen.getByText("copy the report") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("what it claims afterwards", () => {
  test("says a composer should be open, never that anything was sent", () => {
    renderView();
    write("a thought");
    fireEvent.click(mailLink());
    expect(screen.getByText(/Nothing has been sent until you send it there/)).toBeTruthy();
    // The words a screen like this usually reaches for, and cannot honestly use.
    expect(screen.queryByText(/thank you for your feedback/i)).toBeNull();
  });

  test("the mail app note names the dead end that started all this", () => {
    renderView();
    write("a thought");
    fireEvent.click(mailLink());
    expect(screen.getByText(/asked to set up an account instead/)).toBeTruthy();
  });

  test("each route says what it actually did", () => {
    renderView();
    write("a thought");
    fireEvent.click(gmailLink());
    expect(screen.getByText(/Gmail should now be open in another tab/)).toBeTruthy();
    expect(screen.queryByText(/Your mail app should now be open/)).toBeNull();
  });

  test("editing after sending drops the note, which would now describe the old text", () => {
    renderView();
    write("a thought");
    fireEvent.click(gmailLink());
    write("a different thought");
    expect(screen.queryByText(/Gmail should now be open/)).toBeNull();
  });
});

describe("the draft", () => {
  test("comes back on the next visit, which is what being interrupted needs", () => {
    renderView();
    write("half a sentence");
    cleanup();
    renderView();
    expect(messageBox().value).toBe("half a sentence");
  });

  test("clearing it empties the box and leaves nothing stored", () => {
    renderView();
    write("never mind");
    fireEvent.click(screen.getByText("clear this draft"));
    expect(messageBox().value).toBe("");
    cleanup();
    renderView();
    expect(messageBox().value).toBe("");
  });

  test("the diagnostics are not carried over, since a stale block would misreport", () => {
    // The draft is the message alone. A report kept from a previous visit would
    // describe that day's build and sync state and be read as describing this one.
    renderView();
    fireEvent.change(reportBox(), { target: { value: "edited to nothing useful" } });
    write("keep me");
    cleanup();
    renderView();
    expect(messageBox().value).toBe("keep me");
    expect(reportBox().value).toContain("sync: synced");
  });
});
