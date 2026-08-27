// @vitest-environment jsdom
//
// The feedback report and the draft behind it (spec §13.1).
//
// Three things here are worth a test rather than a reading. The block must carry
// no journal content, which is the promise the screen makes in words and the only
// one a reader cannot check for themselves. The mailto: length must be refused
// rather than truncated, because a client that silently drops the tail produces a
// report that looks complete and is not. And an emptied block must produce a body
// with nothing left of it, since somebody who cleared it meant it.

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  FEEDBACK_ADDRESS,
  KIND_SUBJECT,
  MAILTO_LIMIT,
  WEB_LIMIT,
  clearDraft,
  diagnosticLines,
  diagnosticText,
  feedbackBody,
  feedbackClipboard,
  feedbackGmail,
  feedbackMailto,
  loadDraft,
  saveDraft,
} from "../src/lib/feedback";
import type { FeedbackFacts } from "../src/lib/feedback";

const facts = (over: Partial<FeedbackFacts> = {}): FeedbackFacts => ({
  build: "2026-08-26T09:12Z",
  commit: "e4bfbf8",
  installed: true,
  userAgent: "Mozilla/5.0 (iPhone) Safari",
  viewport: { width: 375, height: 812 },
  online: true,
  syncStatus: "synced",
  syncError: null,
  entries: 412,
  docBytes: 98700,
  decodeFaults: "none",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the diagnostics block", () => {
  test("names the build and the commit, which is what tells two reports apart", () => {
    const text = diagnosticText(facts());
    expect(text).toContain("build: 2026-08-26T09:12Z");
    expect(text).toContain("commit: e4bfbf8");
  });

  test("says how the app is running, since installed and tab differ in kind", () => {
    expect(diagnosticText(facts({ installed: true }))).toContain(
      "running: installed app"
    );
    expect(diagnosticText(facts({ installed: false }))).toContain(
      "running: browser tab"
    );
  });

  test("carries the last server error, the single most useful line in it", () => {
    expect(diagnosticText(facts({ syncError: "permission denied for table" }))).toContain(
      "sync error: permission denied for table"
    );
  });

  test("says so when there was no error, rather than leaving a blank", () => {
    expect(diagnosticText(facts())).toContain("sync error: none");
  });

  test("counts entries and sizes the journal, and reveals neither", () => {
    // A count and a size are the point: they distinguish a fresh install from a
    // year-old journal, which is often the whole of a performance report. What must
    // not appear is anything a person wrote.
    expect(diagnosticText(facts())).toContain("journal: 412 entries, 96.4 KB on this device");
  });

  test("says when records could not be read, and nothing when they could", () => {
    expect(diagnosticText(facts())).toContain("unreadable: none");
    expect(
      diagnosticText(facts({ decodeFaults: "1 not shown (entry 1)" }))
    ).toContain("unreadable: 1 not shown (entry 1)");
  });

  test("one entry is not one entries", () => {
    expect(diagnosticText(facts({ entries: 1 }))).toContain("journal: 1 entry,");
  });

  test("holds no address, no page name and no entry text", () => {
    // The promise the screen makes in words. Nothing in FeedbackFacts can carry
    // content, so this guards the shape rather than the values: a field added later
    // that does carry content fails here.
    //
    // It did its job on 27 August 2026, when `decodeFaults` was added and this
    // failed on the count. That line is built from record kinds and field names
    // out of the app's own vocabulary ("entry.type 1"), never from a value in a
    // record, which tests/decode.test.ts asserts directly against an entry whose
    // text would otherwise show up in it.
    const lines = diagnosticLines(facts());
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      expect(line).not.toMatch(/@/);
    }
  });
});

describe("the message body", () => {
  test("puts what the person wrote first, then the block", () => {
    const body = feedbackBody("The week page scrolls oddly", "build: x\ncommit: y");
    expect(body.indexOf("scrolls oddly")).toBeLessThan(body.indexOf("build: x"));
    expect(body).toContain("--- Journlet report ---");
  });

  test("an emptied block leaves no heading behind", () => {
    const body = feedbackBody("Just a thought", "   \n  ");
    expect(body).toBe("Just a thought\n");
    expect(body).not.toContain("Journlet report");
  });

  test("trims, so a stray newline does not arrive as a blank first line", () => {
    expect(feedbackBody("\n\n  said  \n", "")).toBe("said\n");
  });
});

describe("the mail link", () => {
  test("addresses the feedback mailbox and carries the subject for the kind", () => {
    const { url } = feedbackMailto("broken", "hello");
    expect(url.startsWith(`mailto:${FEEDBACK_ADDRESS}?`)).toBe(true);
    expect(url).toContain(encodeURIComponent(KIND_SUBJECT.broken));
  });

  test("each kind gets its own subject, so triage happens in the mailbox", () => {
    const subjects = new Set(Object.values(KIND_SUBJECT));
    expect(subjects.size).toBe(3);
  });

  test("encodes newlines and ampersands rather than breaking the URL on them", () => {
    const { url } = feedbackMailto("other", "one & two\nthree");
    expect(url).toContain("one%20%26%20two%0Athree");
    // One separator only: an unencoded & would read as a second mailto field.
    expect(url.split("&body=")).toHaveLength(2);
  });

  test("a long report is refused rather than handed over to be truncated", () => {
    const { tooLong } = feedbackMailto("broken", "x".repeat(MAILTO_LIMIT + 1));
    expect(tooLong).toBe(true);
  });

  test("an ordinary report is not refused", () => {
    const { tooLong } = feedbackMailto(
      "broken",
      feedbackBody("The capture bar covers the last entry on a short page.", diagnosticText(facts()))
    );
    expect(tooLong).toBe(false);
  });
});

describe("the Gmail composer", () => {
  // Added 26 August 2026, after the mailto: route met somebody with no mail client
  // and produced an account-setup wizard. A browser composer is not a nicety here,
  // it is the route most people actually have.
  test("addresses the feedback mailbox and carries the subject and body", () => {
    const { url } = feedbackGmail("broken", "the week page scrolls oddly");
    expect(url.startsWith("https://mail.google.com/mail/?view=cm&fs=1")).toBe(true);
    expect(url).toContain(`to=${encodeURIComponent(FEEDBACK_ADDRESS)}`);
    expect(url).toContain(encodeURIComponent(KIND_SUBJECT.broken));
    expect(decodeURIComponent(url)).toContain("the week page scrolls oddly");
  });

  test("uses Gmail's own parameter names, not a mailto's", () => {
    // su and body, not subject: Gmail ignores what it does not recognise, so this
    // would fail by arriving with an empty subject rather than by erroring.
    const { url } = feedbackGmail("idea", "hello");
    expect(url).toContain("&su=");
    expect(url).not.toContain("&subject=");
  });

  test("tolerates a far longer report than a mail link does", () => {
    // The constraint is a browser and a server, not a third-party mail client, so
    // refusing at the mailto: limit would send people to the clipboard for nothing.
    const body = "x".repeat(MAILTO_LIMIT + 500);
    expect(feedbackMailto("broken", body).tooLong).toBe(true);
    expect(feedbackGmail("broken", body).tooLong).toBe(false);
  });

  test("still refuses one long enough to be truncated in transit", () => {
    expect(feedbackGmail("broken", "x".repeat(WEB_LIMIT + 1)).tooLong).toBe(true);
  });

  test("encodes newlines and ampersands, which would otherwise end the parameter", () => {
    const { url } = feedbackGmail("other", "one & two\nthree");
    expect(url).toContain("one%20%26%20two%0Athree");
  });
});

describe("the copied text", () => {
  // Added 26 August 2026, from a report pasted into iCloud Mail that arrived as
  // "(no subject)". The links hand over a subject field; the clipboard hands over
  // characters, so the kind chosen on the screen was dropped by the one route that
  // works everywhere.
  test("carries the subject as its first line", () => {
    const text = feedbackClipboard("broken", feedbackBody("it scrolls oddly", ""));
    expect(text.split("\n")[0]).toBe("Subject: Journlet: something is broken");
  });

  test("the subject follows the kind, like the links do", () => {
    expect(feedbackClipboard("idea", "x")).toContain("Journlet: an idea");
    expect(feedbackClipboard("other", "x")).toContain("Journlet: feedback");
  });

  test("keeps the message and the report below it, unchanged", () => {
    const body = feedbackBody("it scrolls oddly", "build: x");
    const text = feedbackClipboard("broken", body);
    expect(text.endsWith(body)).toBe(true);
    expect(text).toContain("it scrolls oddly");
    expect(text).toContain("--- Journlet report ---");
  });

  test("the links do not carry it as well, which would say it twice", () => {
    // A mailto: with "Subject: ..." in its body puts the subject in the message
    // twice, once in the field and once in the text, which reads as a bug.
    const body = feedbackBody("hello", "");
    expect(decodeURIComponent(feedbackMailto("broken", body).url)).not.toContain(
      "Subject: Journlet"
    );
    expect(decodeURIComponent(feedbackGmail("broken", body).url)).not.toContain(
      "Subject: Journlet"
    );
  });
});

describe("the draft", () => {
  test("survives being written and read back, which is the whole point of it", () => {
    saveDraft("half a sentence");
    expect(loadDraft()).toBe("half a sentence");
  });

  test("an emptied message removes the draft rather than storing a blank one", () => {
    saveDraft("something");
    saveDraft("   ");
    expect(loadDraft()).toBe("");
  });

  test("clearing it leaves nothing", () => {
    saveDraft("something");
    clearDraft();
    expect(loadDraft()).toBe("");
  });

  test("storage being blocked loses the draft rather than the screen", () => {
    // Private windows and locked-down browsers throw on access rather than
    // returning null. A feedback screen that cannot be opened would be a poor way
    // to find out about it.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveDraft("x")).not.toThrow();
    expect(loadDraft()).toBe("");
    expect(() => clearDraft()).not.toThrow();
  });
});
