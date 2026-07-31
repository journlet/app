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

const box: React.CSSProperties = {
  border: "1px solid var(--rule)",
  borderRadius: 10,
  padding: "12px 14px",
  margin: "0 0 14px",
  background: "var(--paper)",
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
      <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>
        Add {request.client ?? "another device"} to your journal?
      </div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 14,
          color: "var(--ink-soft)",
          lineHeight: 1.5,
        }}
      >
        Asked {ago(request.requestedAt)}. It cannot read anything until you say
        so.
      </p>
      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 8,
          padding: "8px 10px",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>
          The new device should be showing this code
        </div>
        <code
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 18,
            letterSpacing: "0.12em",
            color: "var(--ink)",
          }}
        >
          {request.code}
        </code>
      </div>
      {error && (
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--warn)" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="miniBtn"
          disabled={busy}
          onClick={() => void run(() => onApprove(request))}
        >
          codes match, add it
        </button>
        <button
          className="miniBtn"
          disabled={busy}
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
