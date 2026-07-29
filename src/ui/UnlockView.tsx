// Third first-run stage: signed in, but this device cannot open the account's
// journal until it is given the journal key.
//
// Presentational, and the key entry itself is SyncView's, passed in as a child.
// Reached after signing in on a device that has been wiped, or on a new device
// linking to an existing journal.

import type { ReactNode } from "react";
import { S } from "./styles";

interface UnlockViewProps {
  children: ReactNode;
}

export default function UnlockView({ children }: UnlockViewProps) {
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
      <p style={S.onboardLede}>
        Enter your journal key to unlock it. You will find it on a device you are
        already using, under Sync → show journal key, or wherever you saved it
        when you started.
      </p>
      {children}
    </section>
  );
}
