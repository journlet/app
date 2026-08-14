// Signed in, and this device cannot open the journal yet.
//
// Two routes since §12.1 phase 7 deleted approval on 14 August 2026, where there were
// three: a passkey, which asks for Face ID, Touch ID or a device PIN, and the journal
// key, typed or scanned. Both are on this screen and both are SyncView's, passed in as
// a child, so this file is the framing and the honest sentence at the top.
//
// What went: asking a device you already use, the code to compare, and the waiting card
// that displayed it. Its unique job was admitting a device whose password manager had no
// passkey and whose owner would not type sixty-seven characters, and §6.1i had already
// put it last of the three. The argument for keeping it, that a machine with no biometric
// of its own might have no passkey route at all, is real and answered by the journal key
// rather than by a second person pressing a button (§6.1k, §11 Q14).
//
// A removed device gets a different first sentence and nothing else different. It is not
// waiting on a key it is owed: somebody took its access away deliberately, its copy is
// still here, and the mark is cooperative — see store/sync.ts removeDevice.

import type { ReactNode } from "react";
import { S } from "./styles";

interface UnlockViewProps {
  /** Sign out and erase this device's copy. Still the way to leave from here. */
  onSignOut: () => void;
  /** True when this device was marked removed in the register by another device. */
  removed: boolean;
  children: ReactNode;
}

export default function UnlockView({
  removed,
  onSignOut,
  children,
}: UnlockViewProps) {
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
        {removed ? "This device was removed" : "Unlock your journal"}
      </h2>
      {/* Said first and without hedging. An empty screen here reads as "my journal is
          gone", and the truthful reassurance is that it is on the server, intact, and
          merely unopened.

          A removed device gets the other sentence, because the reassuring one would be
          a lie by omission. */}
      {removed ? (
        <p style={S.onboardLede}>
          Your journal was removed from this device from another of your devices. You
          are still signed in and nothing here has been erased. Unlocking below brings
          it back — the removal asks this device to hide the journal rather than taking
          the key away, which nothing can.
        </p>
      ) : (
        <p style={S.onboardLede}>
          You are signed in, and your journal is on the server where it was. This
          device cannot read it yet, because the content is encrypted and the key
          never leaves your devices.
        </p>
      )}

      <p style={S.onboardLede}>
        Unlock this device below: with a passkey, if you set one up, or with your
        journal key. You will find the key on a device you are already using, under
        Sync → show journal key, where it can also be scanned as a QR code.
      </p>
      {children}

      {/* The way out, and the only other thing this screen can do. Sign-out is what
          erases the copy held here, so on this screen it is a deliberate departure
          rather than a way to give up. */}
      <div style={{ margin: "18px 0 0" }}>
        <button className="miniBtn" onClick={onSignOut}>
          sign out and erase this journal
        </button>
      </div>
    </section>
  );
}
