// Second stage of first run: keeping a way back into the journal (spec §6.1e,
// §12.1 phase 5).
//
// This screen used to be a gate. It showed the journal key, made you tick a box to
// say you had saved it, and would not let you past until you did — on the grounds
// that there is no better moment to interrupt somebody. That was wrong, and §6.1e
// says why: it is the hardest possible ask at the moment of least investment.
// Somebody who has just installed a journalling app and written nothing in it is
// being handed sixteen characters they have no reason to care about yet, and the
// honest outcomes are a box ticked without reading it or a screenshot in the camera
// roll.
//
// So: the passkey is the default action, the code is the labelled alternative,
// neither is forced, and skipping both is a button rather than a trap. What makes
// that safe is the reminder on the Sync screen, which stays until the code has been
// saved once — nagged rather than forced, which was Gary's decision of 11 August.
//
// The one thing this screen must not do is imply that either route can be reissued.
// The server holds ciphertext only, so there is no "forgot my key", and a passkey
// lives in a password manager Journlet cannot see into.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { S } from "./styles";
import { enrolPasskey } from "../store/sync";
import { probeCredentialSupport, relyingPartyId } from "../lib/prf";
import { enrolFailureMessage } from "../lib/passkeyMessages";
import { markKeySaved } from "../lib/keySaved";

interface RecoveryCodeViewProps {
  code: string;
  onContinue: () => void;
}

export default function RecoveryCodeView({
  code,
  onContinue,
}: RecoveryCodeViewProps) {
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);

  useEffect(() => {
    // The passkey is only the default action where it can actually be done. A
    // browser without a platform authenticator, or a host that is not journlet.com
    // (§12.1's binding rule), gets the code as the only offer rather than a button
    // that fails — and never learns there was supposed to be another one.
    void probeCredentialSupport().then(
      (c) => setCanPasskey(c.usable && relyingPartyId(location.hostname) !== undefined),
      () => setCanPasskey(false)
    );
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      markKeySaved();
    } catch {
      // Clipboard blocked or unavailable: the code is on screen to be read, and
      // nothing is marked as saved, because nothing was.
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        "Journlet journal key\n\n" +
          code +
          "\n\nKeep this safe. It unlocks your journal on a new device.\n" +
          "If you lose every device you are signed in on and this key, your journal cannot be recovered.\n",
      ],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "journlet-journal-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
    markKeySaved();
  };

  const setUpPasskey = async () => {
    setProblem(null);
    setBusy(true);
    try {
      await enrolPasskey();
      setEnrolled(true);
    } catch (e) {
      setProblem(enrolFailureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ maxWidth: 480 }}>
      <h2 style={ST.title}>Keep a way back in</h2>
      <p style={S.onboardLede}>
        Your journal is encrypted on this device before it goes anywhere, so
        nobody can let you back into it — not even whoever runs Journlet. Set up
        one of these now and you will not lose it if this device goes.
      </p>

      {canPasskey && (
        <div style={ST.box}>
          <div style={ST.boxLabel}>The quick way</div>
          <p style={{ ...S.onboardLede, marginTop: 0 }}>
            A passkey opens your journal on any device your password manager
            reaches, after a Face ID, Touch ID or device PIN check — or, on a device
            with none of those, by using your phone. Nothing to write down.
          </p>
          {enrolled ? (
            <p style={{ ...S.onboardLede, marginBottom: 0, fontWeight: 600 }}>
              Passkey set up. On another device: sign in with the same email, then
              choose “Unlock with a passkey”.
            </p>
          ) : (
            <>
              <p style={{ ...S.onboardLede, fontSize: 13 }}>
                Two prompts follow: one to create the passkey, one to use it. Both
                are needed — the second is not a sign the first failed.
              </p>
              <button className="addBtn" disabled={busy} onClick={setUpPasskey}>
                {busy ? "setting up…" : "Set up a passkey"}
              </button>
            </>
          )}
          {problem && (
            <p style={{ ...S.onboardLede, marginBottom: 0 }}>{problem}</p>
          )}
        </div>
      )}

      <div style={ST.box}>
        <div style={ST.boxLabel}>
          {canPasskey ? "Belt and braces" : "Your way back in"}
        </div>
        <p style={{ ...S.onboardLede, marginTop: 0 }}>
          Your journal key is sixteen characters that open this journal anywhere,
          including where passkeys do not reach. Keep it in a password manager, or
          write it down.
        </p>
        {/* Behind a tap rather than on screen, and this is the change that matters
            most on this screen: a code rendered unbidden at first run is a code
            screenshotted, and a screenshot of it is the worst place it can live.
            Whoever wants it says so. */}
        {showCode ? (
          <>
            <code style={ST.code}>{code}</code>
            <div style={ST.row}>
              <button className="miniBtn" onClick={() => void copy()}>
                {copied ? "copied" : "copy to clipboard"}
              </button>
              <button className="miniBtn" onClick={download}>
                download as file
              </button>
            </div>
          </>
        ) : (
          <button className="miniBtn" onClick={() => setShowCode(true)}>
            show my journal key
          </button>
        )}
      </div>

      {/* Always enabled. The reminder under Sync is what makes that safe, and it is
          named here so leaving is a decision rather than an omission. */}
      <button className="addBtn" style={{ width: "auto" }} onClick={onContinue}>
        Start journalling
      </button>
      <p style={{ ...S.onboardLede, fontSize: 13 }}>
        You can do either of these later under Sync, and a line there will remind
        you until your journal key is saved.
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
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 24,
    fontWeight: 600,
    margin: "8px 0 10px",
    color: "var(--ink)",
  },
  box: {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    padding: "10px 14px",
    margin: "4px 0 14px",
    maxWidth: 480,
  },
  boxLabel: {
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--ink-soft)",
    marginBottom: 5,
  },
  code: {
    display: "block",
    fontSize: 13,
    wordBreak: "break-all",
    lineHeight: 1.6,
    color: "var(--ink)",
    marginBottom: 8,
  },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
} as const satisfies Record<string, CSSProperties>;
