// Telling the operator something (spec §13.1, which had listed "a support/contact
// route" as launch work since 11 August 2026 without deciding what it was).
//
// Email, by a mailto: link, and the reasoning is worth keeping because the
// obvious alternative looks cheaper than it is. A `feedback` table in Supabase
// would need no server code either, and it would cost three things this route
// does not. It collides with §6.5, which classifies every column the database is
// allowed to hold, so it needs a new class for operator-readable prose rather
// than an exception nobody wrote down. It cannot be rate-limited without a
// database function, and the last one of those — the deletion code compared
// inside Postgres — was built and removed. And it puts a box on screen that
// invites somebody to paste journal content into a server this app tells the
// world holds ciphertext only. Email keeps all three problems outside the
// architecture: the report is composed in the person's own mail client, they can
// see every character before it goes, and nothing new is stored anywhere.
//
// What that costs, and it is not nothing. And the first cost was understated here
// for a day, which is worth leaving in rather than editing out.
//
// "A mailto: link does nothing useful on a device with no mail client configured"
// was written as a footnote with the clipboard as its answer. On 26 August 2026, the
// first time anybody but the author used this screen, that turned out to describe the
// ordinary case rather than an edge: Gary reads email in Gmail in a browser, has no
// mail client, and the link produced macOS Mail's Add Account dialog. A route whose
// primary action opens an account-setup wizard for software you do not use is not a
// route with a caveat, it is a dead end, and "you can always copy it" is not a
// primary action.
//
// So the routes are plural, plainly labelled, and none of them is guessed at. A
// browser composer, because most email is read in one. A mailto:, because plenty of
// people do have a mail client and it is the only thing that works for the rest of
// the webmail providers there is no point enumerating. And copy and paste, which
// works everywhere and is now stated as a route rather than as a fallback.
//
// Nothing is detected: a page cannot tell whether a mailto: handler exists, and a
// wrong guess here costs somebody their report. The interface rule this app already
// follows, every action plainly labelled, no guessing, happens to be the only honest
// answer available.
//
// This app also cannot know whether anything was sent, so nothing here ever says it
// was.
//
// Nothing in this module touches the network, the journal, or the database. CSP
// does not enter into it either: `form-action 'none'` governs form submissions
// and mailto: here is an ordinary link, so index.html needs no change.

import type { SyncStatus } from "../store/syncStatus";

/** Where feedback goes. `privacy@` is the data-protection route and stays separate. */
export const FEEDBACK_ADDRESS = "hello@journlet.com";

/**
 * What the report is about, which is the whole of the triage this route offers.
 * Three, because a longer list is a form and this is a message.
 */
export type FeedbackKind = "broken" | "idea" | "other";

export const KIND_SUBJECT: Record<FeedbackKind, string> = {
  broken: "Journlet: something is broken",
  idea: "Journlet: an idea",
  other: "Journlet: feedback",
};

/**
 * Everything the diagnostics block may say. Collected by the screen and passed in
 * rather than read from globals here, so the assembly can be tested without a DOM
 * and so it is visible at the call site exactly what is being gathered.
 *
 * Note what is absent and is meant to stay absent: no entry text, no page names,
 * no email address, no credential or device identifiers. A bug report is worth
 * having and is not worth turning into a second copy of the journal.
 */
export interface FeedbackFacts {
  /** __BUILD_TIME__ */
  build: string;
  /** __BUILD_COMMIT__ */
  commit: string;
  /** Running from the home screen rather than in a browser tab. */
  installed: boolean;
  userAgent: string;
  viewport: { width: number; height: number };
  online: boolean;
  syncStatus: SyncStatus;
  /** Last server error, or null. The single most useful line here. */
  syncError: string | null;
  entries: number;
  /** Encoded CRDT size on this device. A size, never a content. */
  docBytes: number;
}

/** KB the way the Menu says it, so the two agree when read side by side. */
const kb = (bytes: number): string => `${Math.round(bytes / 102.4) / 10} KB`;

/**
 * The diagnostics block, one labelled fact per line.
 *
 * Deterministic order, because the person reading it is the same person every
 * time and a stable shape is quicker to scan than a tidy one. Plain `label: value`
 * so it survives being pasted into anything.
 */
export const diagnosticLines = (f: FeedbackFacts): string[] => [
  `build: ${f.build}`,
  `commit: ${f.commit}`,
  `running: ${f.installed ? "installed app" : "browser tab"}`,
  `browser: ${f.userAgent}`,
  `screen: ${f.viewport.width}x${f.viewport.height}`,
  `network: ${f.online ? "online" : "offline"}`,
  `sync: ${f.syncStatus}`,
  `sync error: ${f.syncError ?? "none"}`,
  `journal: ${f.entries} ${f.entries === 1 ? "entry" : "entries"}, ${kb(f.docBytes)} on this device`,
];

export const diagnosticText = (f: FeedbackFacts): string =>
  diagnosticLines(f).join("\n");

const REPORT_RULE = "--- Journlet report ---";

/**
 * The message body: what the person wrote, then the block they have had the
 * chance to edit or empty.
 *
 * The block is dropped entirely when it is blank, rather than left as a bare
 * heading. Somebody who cleared it meant it.
 */
export const feedbackBody = (message: string, diagnostics: string): string => {
  const said = message.trim();
  const facts = diagnostics.trim();
  if (!facts) return `${said}\n`;
  return `${said}\n\n${REPORT_RULE}\n${facts}\n`;
};

/**
 * Where a mailto: URL stops being reliable.
 *
 * There is no specified limit and every client has its own; the low bar has
 * historically been around 2,000 characters, so this sits under it with room. Past
 * this the screen offers the clipboard instead of a link that would hand the mail
 * client a truncated report and look like it had worked.
 */
export const MAILTO_LIMIT = 1800;

/**
 * The same question for an https composer, which is a different number.
 *
 * A browser URL is not passed to a third-party mail client with its own ideas: the
 * constraint is the browser and the receiving server, and 8,000 characters is the
 * conventional floor for those. This sits well under it. A report is a few hundred
 * characters, so neither limit is reached by anything but a pasted log.
 */
export const WEB_LIMIT = 7000;

export interface ComposeRoute {
  url: string;
  /** Over this route's limit: it would arrive truncated, so it is not offered. */
  tooLong: boolean;
}

export const feedbackMailto = (
  kind: FeedbackKind,
  body: string
): ComposeRoute => {
  const url =
    `mailto:${FEEDBACK_ADDRESS}` +
    `?subject=${encodeURIComponent(KIND_SUBJECT[kind])}` +
    `&body=${encodeURIComponent(body)}`;
  return { url, tooLong: url.length > MAILTO_LIMIT };
};

/**
 * Gmail's own composer, prefilled.
 *
 * Named rather than generic because there is no generic. There is no registry a page
 * can ask "which webmail does this person use", and the two candidates for guessing,
 * the mailto: handler and the address domain, are both wrong often enough to lose
 * somebody's report. So one provider is offered by name, on the grounds that it is
 * the one most people read email in, and everybody else gets copy and paste, which is
 * a worse experience honestly labelled rather than a broken link.
 *
 * Outlook was considered and left out: outlook.live.com and outlook.office.com are
 * different composers for personal and work accounts, nothing here can tell which
 * somebody has, and two rows that might both be wrong is worse than one row that says
 * copy it.
 *
 * Nothing is requested from Google unless the person taps this: it is a link, not a
 * fetch, and index.html sets `referrer: no-referrer` so following it discloses no
 * page. The report travels in the URL, so it reaches Google either way once tapped,
 * which is true of sending mail through Gmail at all and is the person's own
 * arrangement rather than a new disclosure this app introduces.
 */
export const feedbackGmail = (
  kind: FeedbackKind,
  body: string
): ComposeRoute => {
  const url =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(FEEDBACK_ADDRESS)}` +
    `&su=${encodeURIComponent(KIND_SUBJECT[kind])}` +
    `&body=${encodeURIComponent(body)}`;
  return { url, tooLong: url.length > WEB_LIMIT };
};

// The draft, held on this device.
//
// Local rather than in the journal, and the reason is not privacy but sense: an
// unsent complaint about the app is not journal content, and syncing it would put
// it on every device and inside the export. Local also means it survives the two
// things that actually happen — the app being closed mid-sentence, and being
// offline, which is when people most want to report something.
//
// The message is kept and the diagnostics are not. They are re-collected on every
// visit, because a stale block is worse than no block: it would describe the
// build and the sync state of the day the draft was started, and be read as
// describing today.
const DRAFT_KEY = "journlet-feedback-draft";

export const saveDraft = (message: string): void => {
  try {
    if (message.trim()) localStorage.setItem(DRAFT_KEY, message);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked. The draft lives as long as the screen does, which is the
    // behaviour this had before it was persisted at all.
  }
};

export const loadDraft = (): string => {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
};

export const clearDraft = (): void => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing was stored, so nothing is left behind.
  }
};
