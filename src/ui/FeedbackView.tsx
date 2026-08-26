// Send feedback (spec §13.1). The route by which somebody using this app can
// tell the operator something, and the reasoning for it being email rather than a
// table is in lib/feedback.ts.
//
// Three things this screen has to get right, all of them about not overclaiming.
//
// It cannot know whether anything was sent. Handing a mailto: URL to the platform
// is the last thing this app does; whether a mail client opened, and whether the
// person then pressed send, is invisible here. So the button says what it does,
// "Open my mail app", and the line after it says plainly that nothing has gone
// anywhere until they send it there. A "thanks, we got that" would be a lie a
// good half of the time.
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
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);

  // Every keystroke. The alternative, saving on unmount, loses the case this
  // exists for: an app closed or reloaded mid-sentence never unmounts cleanly.
  useEffect(() => {
    saveDraft(message);
  }, [message]);

  const body = feedbackBody(message, report);
  const { url, tooLong } = feedbackMailto(kind, body);
  const empty = message.trim().length === 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      // Clipboard blocked or unavailable. The text is on screen to be selected,
      // and nothing claims to have been copied, because nothing was.
      setCopied(false);
    }
  };

  return (
    <section style={{ maxWidth: 480 }}>
      <div style={ST.head}>
        <h2 style={ST.title}>Send feedback</h2>
        <span style={ST.sub}>by email, from your own mail app</span>
      </div>

      <p style={S.onboardLede}>
        Tell me what is wrong, what is missing, or what you would change. It goes
        to {FEEDBACK_ADDRESS} as an ordinary email, written in your own mail app,
        so you can read every word of it before it leaves.
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
          setOpened(false);
          setCopied(false);
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
            setOpened(false);
            setCopied(false);
          }}
          aria-label="The report that will be attached"
        />
      </div>

      {/* Over the limit the link is not offered at all, rather than offered and
          quietly truncated by whichever client opens it. */}
      {tooLong ? (
        <p style={S.onboardNote}>
          This is longer than a mail link can carry reliably. Copy it and paste it
          into an email to {FEEDBACK_ADDRESS} instead, or shorten it.
        </p>
      ) : (
        <a
          className="addBtn"
          style={{
            display: "inline-block",
            textDecoration: "none",
            opacity: empty ? 0.5 : 1,
            pointerEvents: empty ? "none" : undefined,
          }}
          href={url}
          aria-disabled={empty}
          onClick={() => setOpened(true)}
        >
          Open my mail app
        </a>
      )}

      <div style={ST.row}>
        <button className="miniBtn" disabled={empty} onClick={() => void copy()}>
          {copied ? "copied" : "copy the report"}
        </button>
        {message.trim() && (
          <button
            className="miniBtn"
            onClick={() => {
              clearDraft();
              setMessage("");
              setOpened(false);
              setCopied(false);
            }}
          >
            clear this draft
          </button>
        )}
      </div>

      {/* The honest version of a confirmation. This app cannot see a mail client,
          let alone a sent message, so it reports what it did and leaves the claim
          about sending to the person who can make it. */}
      {opened && (
        <p style={S.onboardNote}>
          Your mail app should now be open with this in it. Nothing has been sent
          until you send it there, and your draft stays here either way. If no mail
          app opened, this device has none set up: copy the report and send it from
          wherever you do read email.
        </p>
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
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 10,
  },
} as const satisfies Record<string, CSSProperties>;
