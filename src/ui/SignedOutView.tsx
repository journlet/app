// Signed out, with a journal already on the device: sign in, or erase this copy
// (Gary, 13 August 2026).
//
// This state used to be a single yellow line on the journal, and the journal stayed
// readable and writable behind it for as long as nobody signed in. Reported from
// Chrome on a phone: a journal being read with no account behind it, on a device that
// had merely lost its session.
//
// So decision 3 wins here, and it is worth being precise about which rule gave way.
// "No use without an account" (device-identity-design.md, 29 July) was written about
// starting a journal, and §6.1b then allowed a signed-out device to keep capturing,
// on the reasoning that entries merge on the next sign-in "exactly as after a
// flight". That conflated two states. A device that is offline still has a session
// and still captures, so the flight case is untouched by this screen: an aeroplane
// does not sign anybody out. A device with no session at all is the different thing,
// and letting it keep a readable journal indefinitely is the part that could not be
// defended (Gary, 13 August: "I thought we had already agreed that all journals need
// to be logged in first").
//
// What that costs, stated rather than hidden: a session that lapses while there is no
// network cannot be signed back in until there is one, and until then this device
// shows this screen instead of its journal. Nothing is lost by waiting. Nothing here
// is erased except by the button that says so, and everything comes back on sign-in,
// including entries that never reached the server.
//
// The sign-in form is SyncView's, passed in as a child, for the same reason
// OnboardingView takes it that way: the email and code flow, the resend and the
// change-of-address escapes should not exist twice.
//
// One sentence this screen deliberately does not say, having tried to: "this
// device has never synced, so erasing loses all of it". It was written against
// hasSyncedOnce(), which is module state in store/sync and starts false on every
// launch — so a device that had synced for weeks would have been told its whole
// journal existed nowhere else, at the moment it was deciding whether to destroy
// it. There is no durable record of having ever synced to replace it with, and
// this screen is only ever reached with no session, so the honest wording is the
// one below: what reached the server is safe, and this device cannot say what
// did.

import { useState } from "react";
import type { ReactNode } from "react";
import { S } from "./styles";

interface SignedOutViewProps {
  /**
   * Erase this device's copy. Resolves when the wipe is done, and the caller
   * reloads; rejects with something worth showing if it could not finish.
   */
  onErase: () => Promise<void>;
  children: ReactNode;
}

export default function SignedOutView({
  onErase,
  children,
}: SignedOutViewProps) {
  const [eraseOpen, setEraseOpen] = useState(false);
  const [lossAck, setLossAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        This device is signed out
      </h2>
      {/* Said before anything is asked of anybody, because the first question this
          screen has to answer is "have I lost my journal", and the answer is no.
          The second is "why am I seeing this", and the honest answer is that
          nobody necessarily did anything: sessions lapse on their own. */}
      <p style={S.onboardLede}>
        Your journal is still here on this device, and it is reaching nothing else.
        Sessions run out on their own, so this happens without anybody signing out.
      </p>

      <p style={S.onboardLede}>
        Sign in with the same email and it picks up where it left off. Nothing here is
        lost in the meantime: anything written since it stopped syncing is still on
        this device, and merges into your journal when you sign in.
      </p>
      {children}

      <div
        style={{
          borderTop: "1px solid var(--line)",
          margin: "18px 0 0",
          paddingTop: 14,
        }}
      >
        {/* The other way forward, which nothing offered anywhere before today. A
            device that is not yours, or is not yours any more, held a readable
            journal for as long as it sat there, and the only way to clear it was to
            sign back in first — the opposite of what somebody handing a laptop back
            wants to do. */}
        {eraseOpen ? (
          <div style={{ marginTop: 16 }}>
            <p style={{ ...S.onboardLede, marginBottom: 6 }}>
              Erasing removes this journal from this device and nothing else.
              Whatever reached the server is still there, and comes back on this
              device with a passkey or your journal key.
            </p>
            {/* Cannot be softened by checking, and says so. A signed-out device has
                no way to ask the server what it already holds, so "some of it may
                only be here" is the true statement and a count would be invented. */}
            <p style={{ ...S.onboardLede, fontWeight: 600, marginBottom: 6 }}>
              While it is signed out this device cannot tell what reached the server
              and what did not. Anything written since it last synced exists nowhere
              else.
            </p>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                fontSize: 13.5,
                lineHeight: 1.5,
                color: "var(--ink)",
                maxWidth: 480,
                margin: "6px 0 10px",
              }}
            >
              <input
                type="checkbox"
                checked={lossAck}
                onChange={(ev) => setLossAck(ev.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                I understand entries not yet synced from this device will be lost.
              </span>
            </label>
            {error && (
              <p style={{ ...S.onboardNote, color: "var(--danger)" }}>{error}</p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="sheetBtn isDanger"
                style={{ width: "auto" }}
                disabled={busy || !lossAck}
                onClick={() => {
                  setError(null);
                  setBusy(true);
                  onErase().catch((e: unknown) => {
                    setBusy(false);
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not erase this device cleanly"
                    );
                  });
                }}
              >
                {busy ? "erasing…" : "erase this journal from this device"}
              </button>
              <button
                className="sheetBtn isQuiet"
                style={{ width: "auto" }}
                disabled={busy}
                onClick={() => {
                  setEraseOpen(false);
                  setLossAck(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ margin: "16px 0 0" }}>
            <p style={{ ...S.onboardNote, marginBottom: 6 }}>
              Not your device, or not any more? This copy can be erased from here.
            </p>
            <button className="miniBtn" onClick={() => setEraseOpen(true)}>
              erase this journal from this device
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
