// Third first-run stage: signed in, but this device cannot open the account's
// journal yet.
//
// Two routes out, in the order they should be tried. Since step 3 of
// device-identity-design.md the ordinary route is approval on a device already in
// use: this device has already asked, and shows a code to compare. The journal
// key is the fallback for when there is no other device to approve from, and its
// entry form is SyncView's, passed in as a child.

import type { ReactNode } from "react";
import type { LinkStage } from "../store/sync";
import { S } from "./styles";

interface UnlockViewProps {
  /** Ask to be let back in. Only ever called from a deliberate tap. */
  onAskAgain: () => void;
  /** True while that request is being published. */
  asking: boolean;
  /** Sign out and erase this device's copy. The other way out of here. */
  onSignOut: () => void;
  /** The code to compare, or null if the request could not be published. */
  linkCode: string | null;
  /** "opening" once approval has landed and the journal is being fetched. */
  linkStage: LinkStage | null;
  /** True when this device was removed from the account by another device. */
  removed: boolean;
  children: ReactNode;
}

export default function UnlockView({
  linkCode,
  linkStage,
  removed,
  onAskAgain,
  asking,
  onSignOut,
  children,
}: UnlockViewProps) {
  const opening = linkStage === "opening";
  const declined = linkStage === "declined";
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
      {/* Said first and without hedging. An empty screen at this point reads as
          "my journal is gone", and the truthful reassurance is that the journal
          is on the server, intact, and merely unopened.

          A removed device gets a different first sentence, because the reassuring
          one would be a lie by omission: it is not waiting on a key it is owed,
          somebody took its access away on purpose. Its copy of the journal is
          still here and comes back if it is approved again. */}
      {removed ? (
        <p style={S.onboardLede}>
          Your journal was removed from this device from another of your devices.
          You are still signed in, and nothing here has been erased — approve this
          device again and everything comes back, including anything it had not
          managed to sync.
        </p>
      ) : (
        <p style={S.onboardLede}>
          You are signed in, and your journal is on the server where it was. This
          device cannot read it yet, because the content is encrypted and the key
          never leaves your devices.
        </p>
      )}

      {/* The request was answered with "do not add it", or it lapsed. Said rather
          than left as "waiting", which is what it used to do for the full half
          hour after the answer had been given (Gary, 3 August). The two are not
          distinguished because they mean the same thing here, and because telling
          them apart would need the refusal to leave a record on the server. */}
      {declined && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 14px",
            margin: "14px 0",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--ink)" }}>
            This device was not added
          </div>
          <p style={{ ...S.onboardLede, marginTop: 4 }}>
            The request was turned down, or it ran out of time. Nothing was shared
            with this device. You can ask again, or sign out and leave it.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="miniBtn" disabled={asking} onClick={onAskAgain}>
              {asking ? "asking…" : "ask again"}
            </button>
            {/* Says what it does. Sign-out is the only thing that erases the copy
                held here, so on this screen it is the deliberate way to leave
                rather than a way to give up. */}
            <button className="miniBtn" onClick={onSignOut}>
              sign out and erase this journal
            </button>
          </div>
        </div>
      )}

      {/* Removed, and not asking yet. The request is a button rather than
          something that happens on its own: asking automatically put an approval
          prompt on the device that had just removed this one, seconds after it did
          so, with no sensible answer available (Gary, 3 August). */}
      {removed && !linkCode && !opening && !declined && (
        <div style={{ margin: "14px 0" }}>
          <button className="miniBtn" disabled={asking} onClick={onAskAgain}>
            {asking ? "asking…" : "ask to be added again"}
          </button>
        </div>
      )}

      {/* Approval has landed and the journal is being fetched and decrypted.
          Reported as its own state because it used to be reported as nothing:
          the code sat there telling the user to go and approve something they
          had just approved, which reads as a hang rather than as work in
          progress. It replaces the waiting block rather than sitting alongside
          it, since a code to compare is exactly what is no longer wanted. */}
      {opening && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 14px",
            margin: "14px 0",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--ink)" }}>
            Approved. Opening your journal…
          </div>
          <p style={{ ...S.onboardLede, marginTop: 4, marginBottom: 0 }}>
            Fetching it and decrypting it on this device. This can take a few
            seconds on a long journal.
          </p>
        </div>
      )}

      {linkCode && !opening && !declined && (
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
            {removed ? "Waiting to be added back" : "Waiting to be added"}
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

      {/* The fallback is hidden while opening. Offering a second way in at the
          moment the first one has succeeded invites someone to start over on top
          of work that is already underway. */}
      {!opening && !declined && (
        <>
          <p style={S.onboardLede}>
            {linkCode
              ? "No other device to hand? Enter your journal key instead. You will find it under Sync → show journal key on the device that created the journal, or wherever you saved it when you started."
              : "Enter your journal key to unlock it. You will find it on a device you are already using, under Sync → show journal key, or wherever you saved it when you started."}
          </p>
          {children}
        </>
      )}
    </section>
  );
}
