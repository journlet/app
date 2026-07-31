// The prompt shown on a device already in use when another asks to be added.
//
// A card in the ordinary flow of the journal rather than a modal, and reachable
// without a preliminary tap. An earlier draft put a "review it" step in front of
// it so approval could never interrupt writing; the tap did nothing, and the
// reason for it disappears once the prompt cannot steal focus. Prototyped and
// approved 31 July (spec device-identity-design.md).
//
// Three answers, because two of them mean different things. A mismatched code is
// the one signal that something may be impersonating a device and it has to
// destroy the request; "not now" must not. Folding them together would turn an
// attack into a delay.

import { useState } from "react";
import type { LinkRequest } from "../store/deviceLink";

interface ApprovalCardProps {
  request: LinkRequest;
  onApprove: (request: LinkRequest) => Promise<void>;
  onReject: (deviceId: string) => Promise<void>;
  /** Leaves the request pending and takes the card off this screen. */
  onDefer: (deviceId: string) => void;
}

// The same shape as every other panel on the Sync screen (ST.keyBox): raised
// surface, hairline border, 10px radius, capped at 480. An earlier version
// invented --rule and --warn, neither of which exists, so an invalid var() took
// the whole border declaration with it and the card rendered as loose text
// floating on the page.
const box: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "10px 14px",
  margin: "10px 0 16px",
  maxWidth: 480,
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--ink-soft)",
  marginBottom: 4,
};

const body: React.CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.55,
  color: "var(--ink)",
  margin: "0 0 10px",
};

const ago = (at: number): string => {
  const mins = Math.floor((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "a minute ago";
  return `${mins} minutes ago`;
};

export default function ApprovalCard({
  request,
  onApprove,
  onReject,
  onDefer,
}: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      // Shown rather than swallowed: this is a deliberate action on a security
      // decision, and silence would leave the person unsure whether it took.
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={box}>
      <div style={eyebrow}>A device wants to be added</div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--ink)",
          marginBottom: 3,
        }}
      >
        Add {request.client ?? "another device"} to your journal?
      </div>
      <p style={body}>
        Asked {ago(request.requestedAt)}. It cannot read anything until you say
        so.
      </p>
      {/* The code sits on the page rather than in a nested card: a box inside a
          box at this size reads as clutter, and a hairline above and below is
          enough to say "compare this part". */}
      <div
        style={{
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
          padding: "8px 0 10px",
          margin: "0 0 10px",
        }}
      >
        <div style={{ ...eyebrow, marginBottom: 5 }}>
          The new device should be showing this
        </div>
        <code
          style={{
            display: "block",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 19,
            letterSpacing: "0.1em",
            color: "var(--ink)",
          }}
        >
          {request.code}
        </code>
      </div>
      {error && (
        <p style={{ ...body, color: "var(--danger)" }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="miniBtn"
          disabled={busy}
          onClick={() => void run(() => onApprove(request))}
        >
          codes match, add it
        </button>
        {/* Coloured as the cautious answer, not styled as the destructive one:
            refusing costs nothing and can be repeated, so it should not look
            frightening. */}
        <button
          className="miniBtn"
          disabled={busy}
          style={{ color: "var(--danger)" }}
          onClick={() => void run(() => onReject(request.deviceId))}
        >
          codes are different
        </button>
        <button
          className="miniBtn"
          disabled={busy}
          onClick={() => onDefer(request.deviceId)}
        >
          not now
        </button>
      </div>
    </div>
  );
}
