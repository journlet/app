// Send feedback (spec §13.1). The route by which somebody using this app can
// tell the operator something, and the reasoning for it being email rather than a
// table is in lib/feedback.ts.
//
// Four things this screen has to get right, and the first was got wrong for a day.
//
// There is more than one way to send an email, and this screen used to assume one.
// The primary action was a mailto: link, with the clipboard as a footnote for
// "a device with no mail client configured". On the first use by anybody but the
// author that footnote turned out to be the ordinary case: Gmail in a browser, no
// mail client, and the button produced macOS Mail's Add Account dialog. So the
// routes are now three plainly labelled rows, in this app's usual idiom, and none
// of them is guessed at, because nothing here can detect which one will work and a
// wrong guess costs somebody their report.
//
// It cannot know whether anything was sent. Handing a URL to the platform is the
// last thing this app does; whether a composer opened, and whether the person then
// pressed send, is invisible here. So each button says what it does and the line
// after it says plainly that nothing has gone anywhere yet. A "thanks, we got
// that" would be a lie a good half of the time.
//
// The report has to be readable before it travels. It is shown in an editable box
// rather than described in a sentence, because "diagnostic information" is a
// phrase people have learned to distrust, and the only cure is the actual text.
// Anything in it can be edited or deleted, including all of it.
//
// And the draft has to survive. The moment somebody wants to report a fault is
// often the moment the thing is misbehaving, sometimes offline, sometimes just
// before they get interrupted. The message is written to this device on every
// keystroke and read back on the next visit.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { S } from "./styles";
import { GRID } from "../lib/grid";
import { measureVolume } from "../store/metrics";
import type { SyncStatus } from "../store/syncStatus";
import {
  FEEDBACK_ADDRESS,
  clearDraft,
  diagnosticText,
  feedbackBody,
  feedbackClipboard,
  feedbackGmail,
  feedbackMailto,
  loadDraft,
  saveDraft,
} from "../lib/feedback";
import type { FeedbackKind } from "../lib/feedback";

interface FeedbackViewProps {
  syncStatus: SyncStatus;
  syncError: string | null;
  /** Running from the home screen rather than a browser tab. */
  installed: boolean;
}

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: "broken", label: "Something is broken" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
];

/** Which route was taken, so the note afterwards describes what actually happened. */
type Taken = "gmail" | "mail" | "copy" | null;

export default function FeedbackView({
  syncStatus,
  syncError,
  installed,
}: FeedbackViewProps) {
  const [kind, setKind] = useState<FeedbackKind>("broken");
  const [message, setMessage] = useState(() => loadDraft());
  // Collected once per visit, not once per keystroke, and never carried over from
  // a previous visit: a block describing last week's build would be read as
  // describing this one.
  const [report, setReport] = useState(() => {
    const vol = measureVolume();
    return diagnosticText({
      build: __BUILD_TIME__,
      commit: __BUILD_COMMIT__,
      installed,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      online: navigator.onLine,
      syncStatus,
      syncError,
      entries: vol.entries,
      docBytes: vol.docBytes,
    });
  });
  const [taken, setTaken] = useState<Taken>(null);

  // Every keystroke. The alternative, saving on unmount, loses the case this
  // exists for: an app closed or reloaded mid-sentence never unmounts cleanly.
  useEffect(() => {
    saveDraft(message);
  }, [message]);

  const body = feedbackBody(message, report);
  const gmail = feedbackGmail(kind, body);
  const mailto = feedbackMailto(kind, body);
  const empty = message.trim().length === 0;

  // Editing after sending: the note would be describing a composer holding the
  // previous text, so it goes rather than lingering as a false reassurance.
  const edited = () => setTaken(null);

  const copy = async () => {
    try {
      // Not `body`: the clipboard has no subject field, so the subject travels as
      // the first line or not at all. See lib/feedback.ts.
      await navigator.clipboard.writeText(feedbackClipboard(kind, body));
      setTaken("copy");
    } catch {
      // Clipboard blocked or unavailable. The text is on screen to be selected,
      // and nothing claims to have been copied, because nothing was.
      setTaken(null);
    }
  };

  /** A send route: disabled while there is nothing to send, never hidden. */
  const linkStyle = (): CSSProperties => ({
    opacity: empty ? 0.4 : 1,
    pointerEvents: empty ? "none" : undefined,
    textDecoration: "none",
  });

  return (
    <section style={{ maxWidth: 480 }}>
      <div style={ST.head}>
        <h2 style={ST.title}>Send feedback</h2>
        <span style={ST.sub}>by email, however you send email</span>
      </div>

      <p style={S.onboardLede}>
        Tell me what is wrong, what is missing, or what you would change. It goes
        to {FEEDBACK_ADDRESS} as an ordinary email, written wherever you write
        email, so you can read every word of it before it leaves.
      </p>

      <div style={ST.groupLabel}>What is this about</div>
      <div style={ST.segmented} role="group" aria-label="What this is about">
        {KINDS.map((k) => (
          <button
            key={k.value}
            className="miniBtn"
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
            style={
              kind === k.value
                ? {
                    background: "var(--surface)",
                    color: "var(--ink)",
                    borderColor: "var(--ink)",
                  }
                : undefined
            }
          >
            {k.label}
          </button>
        ))}
      </div>

      <div style={{ ...ST.groupLabel, marginTop: 10 }}>Your message</div>
      <textarea
        style={{ ...S.sheetInput, minHeight: 120, resize: "vertical" }}
        value={message}
        onChange={(ev) => {
          setMessage(ev.target.value);
          edited();
        }}
        placeholder={
          kind === "broken"
            ? "What you did, and what happened instead…"
            : "Whatever you would change…"
        }
        aria-label="Your message"
      />

      <div style={ST.box}>
        <div style={ST.boxLabel}>What will be attached</div>
        {/* Shown rather than summarised. The list is short enough to read, and a
            person who can read it is the only person who can consent to it. */}
        <p style={{ ...S.onboardNote, marginTop: 0 }}>
          Enough to tell one device and one build from another. No entries, no page
          names, no email address: your journal is encrypted and none of it is
          here. Edit or empty this box and only what is left will be sent.
        </p>
        <textarea
          style={{
            ...S.sheetInput,
            minHeight: 130,
            resize: "vertical",
            fontSize: 12.5,
            marginBottom: 0,
          }}
          value={report}
          onChange={(ev) => {
            setReport(ev.target.value);
            edited();
          }}
          aria-label="The report that will be attached"
        />
      </div>

      {/* Three rows rather than one button and a footnote, and in this order: the
          browser composer first because most email is read in one, the device's
          mail app second, and copy and paste last as the one that always works.
          Nothing here is detected. A page cannot ask the platform whether a
          mailto: handler exists, so offering the most likely route and calling it
          the only one is how the first version of this screen failed. */}
      <div style={ST.groupLabel}>How to send it</div>

      <div style={ST.row}>
        <div style={ST.rowText}>
          <div style={ST.rowLabel}>Gmail in a browser</div>
          <div style={ST.rowDesc}>
            Opens Gmail's own compose window with this already in it, using
            whichever Google account that browser is signed in to. Nothing is sent
            to Google unless you tap it.
          </div>
        </div>
        <div style={ST.rowBtn}>
          {gmail.tooLong ? (
            <span style={ST.rowDesc}>too long</span>
          ) : (
            <a
              className="miniBtn"
              style={linkStyle()}
              href={gmail.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={empty}
              onClick={() => setTaken("gmail")}
            >
              open Gmail
            </a>
          )}
        </div>
      </div>

      <div style={ST.row}>
        <div style={ST.rowText}>
          <div style={ST.rowLabel}>A mail app on this device</div>
          <div style={ST.rowDesc}>
            For Apple Mail, Outlook, Thunderbird or whatever else this device opens
            email links with. If nothing is set up, this offers to set one up
            instead of composing anything: cancel it and use one of the others.
          </div>
        </div>
        <div style={ST.rowBtn}>
          {mailto.tooLong ? (
            <span style={ST.rowDesc}>too long</span>
          ) : (
            <a
              className="miniBtn"
              style={linkStyle()}
              href={mailto.url}
              aria-disabled={empty}
              onClick={() => setTaken("mail")}
            >
              open mail app
            </a>
          )}
        </div>
      </div>

      <div style={ST.row}>
        <div style={ST.rowText}>
          <div style={ST.rowLabel}>Copy it and paste it yourself</div>
          <div style={ST.rowDesc}>
            Works everywhere, and it is the route for any other webmail: Outlook,
            Proton, Fastmail, iCloud, a work account. Copy this, then paste it into
            a new email to {FEEDBACK_ADDRESS}. The subject comes with it as the
            first line, since a pasted message cannot carry one of its own.
          </div>
        </div>
        <div style={ST.rowBtn}>
          <button
            className="miniBtn"
            disabled={empty}
            onClick={() => void copy()}
          >
            {taken === "copy" ? "copied" : "copy the report"}
          </button>
        </div>
      </div>

      {/* The honest version of a confirmation. This app cannot see a composer, let
          alone a sent message, so it reports what it did and leaves the claim
          about sending to the person who can make it. Each route gets its own
          words because the thing that can go wrong differs. */}
      {taken === "gmail" && (
        <p style={S.onboardNote}>
          Gmail should now be open in another tab with this in it. Nothing has been
          sent until you send it there, and your draft stays here either way.
        </p>
      )}
      {taken === "mail" && (
        <p style={S.onboardNote}>
          Your mail app should now be open with this in it. Nothing has been sent
          until you send it there, and your draft stays here either way. If you
          were asked to set up an account instead, this device has no mail app:
          cancel that and use Gmail or copy and paste above.
        </p>
      )}
      {taken === "copy" && (
        <p style={S.onboardNote}>
          Copied, with the subject as its first line. Paste all of it into a new
          email to {FEEDBACK_ADDRESS} wherever you write email, and leave the
          subject field alone if that is easier: nothing is lost either way. Your
          draft stays here.
        </p>
      )}

      {message.trim() && (
        <div style={ST.actions}>
          <button
            className="miniBtn"
            onClick={() => {
              clearDraft();
              setMessage("");
              setTaken(null);
            }}
          >
            clear this draft
          </button>
        </div>
      )}

      <p style={{ ...S.onboardNote, marginTop: 14 }}>
        Your draft is kept on this device only, so it survives being offline or
        closing the app, and it is never added to your journal. For anything about
        your data rather than the app, privacy@journlet.com is the address on the
        privacy page.
      </p>
    </section>
  );
}

// `as const satisfies` rather than a Record<string, CSSProperties> annotation.
// The annotation types the values and throws the keys away, so a mistyped key
// compiles and hands back undefined: an element with no styling and no error.
// This keeps the value checking and infers the key union, so a typo is a build
// failure (assessment Finding 15; ui/styles.ts:12 has the longer version).
const ST = {
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: "1px solid var(--line)",
    paddingBottom: 4,
    marginBottom: GRID - 5,
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: `${GRID}px`,
  },
  sub: { fontSize: 11.5, color: "var(--ink-soft)", lineHeight: "13px" },
  groupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--ink-soft)",
    lineHeight: `${GRID}px`,
  },
  segmented: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 8,
  },
  box: {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    padding: "10px 14px",
    margin: "4px 0 14px",
  },
  boxLabel: {
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--ink-soft)",
    marginBottom: 5,
  },
  // The Menu's row, deliberately: these are the same kind of thing, a named
  // action with a sentence saying what it does and a control on the right.
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "4px 0",
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 14, lineHeight: `${GRID}px` },
  rowDesc: {
    fontSize: 11.5,
    lineHeight: "16px",
    color: "var(--ink-soft)",
    paddingBottom: 4,
  },
  // Height matches the label's line box so the control lines up with the label
  // rather than floating above a wrapped description.
  rowBtn: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    height: GRID,
  },
  actions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 10,
  },
} as const satisfies Record<string, CSSProperties>;
