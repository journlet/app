// Third first-run stage: signed in, but this device cannot open the account's
// journal yet.
//
// Two routes out, in the order they should be tried. Since step 3 of
// device-identity-design.md the ordinary route is approval on a device already in
// use: this device has already asked, and shows a code to compare. The journal
// key is the fallback for when there is no other device to approve from, and its
// entry form is SyncView's, passed in as a child.

import type { ReactNode } from "react";
import { S } from "./styles";

interface UnlockViewProps {
  /** The code to compare, or null if the request could not be published. */
  linkCode: string | null;
  children: ReactNode;
}

export default function UnlockView({ linkCode, children }: UnlockViewProps) {
  return (
    <section style={{ maxWidth: 480 }}>
      <h2
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 24,
          fontWeight: 600,
          margin: "8px 0 10px",
          color: "var(--ink)",
        }}
      >
        Unlock your journal
      </h2>
      {/* Said first and without hedging. An empty screen at this point reads as
          "my journal is gone", and the truthful reassurance is that the journal
          is on the server, intact, and merely unopened. */}
      <p style={S.onboardLede}>
        You are signed in, and your journal is on the server where it was. This
        device cannot read it yet, because the content is encrypted and the key
        never leaves your devices.
      </p>

      {linkCode && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 14px",
            margin: "14px 0",
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-soft)",
              marginBottom: 5,
            }}
          >
            Waiting to be added
          </div>
          <p style={{ ...S.onboardLede, marginTop: 0 }}>
            Open Journlet on a device you already use. It will ask whether to add
            this one. Check the code below matches the code it shows, then approve
            it there.
          </p>
          {/* Monospaced and spaced out because it exists to be compared
              character by character. Not hidden or masked: it is a fingerprint of
              a public key, so there is nothing here worth keeping secret. */}
          <code
            style={{
              display: "block",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 19,
              letterSpacing: "0.1em",
              textAlign: "center",
              padding: "10px 0",
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
              margin: "0 0 8px",
              color: "var(--ink)",
            }}
          >
            {linkCode}
          </code>
          <p
            style={{
              ...S.onboardLede,
              marginBottom: 0,
              fontSize: 13,
            }}
          >
            This screen updates on its own once you approve. The request lasts
            thirty minutes.
          </p>
        </div>
      )}

      <p style={S.onboardLede}>
        {linkCode
          ? "No other device to hand? Enter your journal key instead. You will find it under Sync → show journal key on the device that created the journal, or wherever you saved it when you started."
          : "Enter your journal key to unlock it. You will find it on a device you are already using, under Sync → show journal key, or wherever you saved it when you started."}
      </p>
      {children}
    </section>
  );
}
