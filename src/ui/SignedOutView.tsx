// Signed out, with a journal already on the device: the three things somebody
// might reasonably want, on one screen (Gary, 13 August 2026).
//
// This state used to be reported by a single yellow line on the journal, and the
// line offered one answer: sign in. §6.1b's decision to keep a signed-out device
// working is right and stays — it is the second choice here — but two others were
// missing. Carrying on had to be a decision rather than the absence of one, and
// there was no way at all to say "I do not want this journal on this device", which
// is the ordinary want on a borrowed laptop or a second browser opened once.
//
// It stands in front of the journal rather than sitting on the Sync screen because
// this state is invisible from the journal: a stale spread looks exactly like a
// current one, and the person who most needs the third choice is the least likely
// to go looking for it. Nothing is hidden for good — one of the three choices is
// to carry on reading, and it is on the same screen as the other two.
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
  /** Carry on reading and writing here, unsynced. Not remembered; see below. */
  onKeepWriting: () => void;
  /**
   * Erase this device's copy. Resolves when the wipe is done, and the caller
   * reloads; rejects with something worth showing if it could not finish.
   */
  onErase: () => Promise<void>;
  children: ReactNode;
}

export default function SignedOutView({
  onKeepWriting,
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
        Sign in with the same email and it picks up where it left off. Nothing is
        lost by signing in: anything written here since it stopped syncing merges
        into your journal.
      </p>
      {children}

      <div
        style={{
          borderTop: "1px solid var(--line)",
          margin: "18px 0 0",
          paddingTop: 14,
        }}
      >
        {/* The §6.1b choice, and it is a choice rather than a default now. It is
            not remembered on purpose: a device whose entries reach nothing must
            not be able to look ordinary for weeks, and one tap per launch is the
            cheapest way to say so that cannot be missed. */}
        <p style={{ ...S.onboardLede, marginBottom: 6 }}>
          Or carry on here. Entries stay on this device and merge into your journal
          the next time you sign in, exactly as after a flight.
        </p>
        <p style={{ ...S.onboardNote, marginBottom: 10 }}>
          This screen comes back the next time the app opens, and the journal
          carries a line saying it is not syncing.
        </p>
        <button className="miniBtn" onClick={onKeepWriting}>
          keep writing on this device only
        </button>

        {/* The third choice, which nothing offered anywhere before today. A device
            that is not yours, or is not yours any more, held a readable journal for
            as long as it sat there, and the only way to clear it was to sign back
            in first. */}
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
