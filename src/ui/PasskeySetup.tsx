// Setting up a passkey, on a device that is already unlocked (spec §6.1e, §12.1
// phase 3).
//
// The first thing anybody sees of this mechanism, and deliberately not onboarding:
// the account already holds a keeper key, so enrolling is additive and deleting
// the row undoes it.
//
// Three things this screen has to say that no other screen in the app has had to.
// That two platform prompts are expected, because the second one otherwise reads
// as the first having failed. That a refusal to create is not a fault — Safari on a
// Mac will not make a passkey at all when iCloud Keychain is switched off, and
// WebAuthn deliberately does not say which of cancelling, timing out or that has
// happened. And that a credential which authenticates but produces no secret is a
// limit of the password manager rather than a bug, so retrying is not the answer.
//
// None of the three may be dressed up. §6.1b is the account of what happens in
// this project when an interface implies more than the mechanism delivers.

import { useCallback, useEffect, useState } from "react";
import { countPasskeyRoutes, enrolPasskey } from "../store/sync";
import {
  CredentialRefusedError,
  PrfUnsupportedError,
  probeCredentialSupport,
  relyingPartyId,
} from "../lib/prf";
import type { PrfCapability } from "../lib/prf";

/**
 * Why this browser cannot offer a passkey, or null when it can.
 *
 * One sentence per cause rather than one for all three, because they need
 * different answers from the person: an insecure origin is a deployment problem, a
 * browser without WebAuthn wants a different browser, and a device with no
 * built-in check wants a different device. Exported so the wording is testable
 * without a platform to probe.
 */
export const capabilityMessage = (c: PrfCapability): string | null => {
  if (!c.secureContext)
    return "Passkeys need a secure (https) connection, and this page is not on one, so none can be set up here.";
  if (!c.webauthn)
    return "This browser does not support passkeys. Your journal key works everywhere, so nothing is lost — and a passkey set up in another browser will not help this one, since passkeys are held by the browser or password manager rather than by Journlet.";
  if (!c.platformAuthenticator)
    return "This device has no built-in way to check that it is you — no Face ID, Touch ID, Windows Hello or device PIN — so a passkey cannot be set up here.";
  return null;
};

const routeCount = (n: number): string =>
  n === 1 ? "1 passkey can open this journal." : `${n} passkeys can open this journal.`;

interface PasskeySetupProps {
  /**
   * Whether this device holds the keeper key, and so can wrap it.
   *
   * Passed in rather than read here, because SyncView is already subscribed to the
   * store and this is a value that changes with the connection.
   */
  canEnrol: boolean;
  /** The box styling SyncView uses for its other two boxes. */
  boxStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  textStyle: React.CSSProperties;
}

export default function PasskeySetup({
  canEnrol,
  boxStyle,
  labelStyle,
  textStyle,
}: PasskeySetupProps) {
  const [capability, setCapability] = useState<PrfCapability | null>(null);
  const [routes, setRoutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void probeCredentialSupport().then(setCapability);
  }, []);

  const refreshCount = useCallback(() => {
    // A count is all the server can answer (§6.5). Failure is left as null rather
    // than reported: not knowing how many routes exist is not worth a line on the
    // screen, and the button works either way.
    void countPasskeyRoutes().then(setRoutes, () => setRoutes(null));
  }, []);
  useEffect(refreshCount, [refreshCount]);

  const setUp = async () => {
    setDone(null);
    setProblem(null);
    setBusy(true);
    try {
      await enrolPasskey();
      setDone(
        "Passkey set up. On another device: sign in with the same email, then choose “Unlock with a passkey”."
      );
      refreshCount();
    } catch (e) {
      if (e instanceof PrfUnsupportedError)
        setProblem(
          "That passkey was created, but this password manager cannot produce the secret Journlet needs, so nothing was saved. A limit of the password manager rather than a fault, and retrying will not change it. Delete the passkey it just made; your journal key still opens this journal, and a passkey in a different password manager would too."
        );
      else if (e instanceof CredentialRefusedError)
        setProblem(
          "Nothing was set up and nothing has changed. That is what you see if the prompt was cancelled or timed out — or, in Safari on a Mac, if iCloud Keychain is switched off, which stops one being created at all. The system does not say which, on purpose."
        );
      else
        setProblem(
          e instanceof Error ? e.message : "The passkey was not set up."
        );
    } finally {
      setBusy(false);
    }
  };

  const cannot = capability ? capabilityMessage(capability) : null;
  /**
   * Anywhere but journlet.com, enrolment is disabled rather than pointed somewhere
   * else — the Relying Party ID cannot be changed later, and §12.1 makes this
   * binding on every phase. Said here as well as refused in the store, because a
   * button that always fails is the no-guessing rule broken (§4.1).
   */
  const wrongHost = relyingPartyId(location.hostname) === undefined;

  return (
    <div style={boxStyle}>
      <div style={labelStyle}>Passkey unlock</div>
      <p style={{ ...textStyle, marginTop: 0 }}>
        A passkey opens this journal after a Face ID, Touch ID or device PIN
        check, instead of typing the journal key. Set one up wherever you
        journal: any single passkey opens it, and none is the main one.
      </p>
      {/* Said plainly because it is the cost of the design, not a footnote. The
          server holds the key wrapped and nothing else, so a passkey cannot be
          recovered from Journlet if the password manager holding it is lost. */}
      <p style={textStyle}>
        Passkeys live in your password manager, not on our server. Keep your
        journal key too: it is what opens the journal if a passkey is lost.
      </p>

      {routes !== null && routes > 0 && (
        <p style={textStyle}>
          {routeCount(routes)} The server cannot tell them apart, or see what
          kind they are.
        </p>
      )}

      {!canEnrol ? (
        // A device linked by approval never held the keeper key, and wrapping needs
        // it. Said rather than offered and failed: the button would be an action
        // that cannot work, which is the no-guessing rule broken (§4.1).
        <p style={{ ...textStyle, marginBottom: 0 }}>
          This device cannot set one up: it does not hold the journal key itself,
          having been added by another device. Set a passkey up on a device that
          can show the journal key, and it will open this journal here too if the
          two share a password manager.
        </p>
      ) : wrongHost ? (
        <p style={{ ...textStyle, marginBottom: 0 }}>
          Passkeys can only be set up on journlet.com, and this copy of the app is
          served from {location.hostname}. A passkey is tied for good to the
          address it was created on, so one made here could never open your
          journal on the real app.
        </p>
      ) : cannot ? (
        <p style={{ ...textStyle, marginBottom: 0 }}>{cannot}</p>
      ) : (
        <>
          {/* The confirmation goes above the button, and the button stops being the
              primary action once it has been used. Left as it was, a full-strength
              "Set up a passkey on this device" sitting under "Passkey set up" reads
              as the setup not having taken (Gary, on the first hardware run). */}
          {done && (
            <p style={{ ...textStyle, fontWeight: 600 }}>{done}</p>
          )}
          {/* Before the button, not after the second sheet appears. Two prompts
              read as one having failed unless somebody has been told to expect
              them (found while building phase 3a, spec §6.1e). */}
          <p style={textStyle}>
            Two prompts follow: one to create the passkey, one to use it. Both
            are needed — the second is not a sign the first failed.
          </p>
          <button
            className={done ? "miniBtn" : "addBtn"}
            disabled={busy}
            onClick={setUp}
          >
            {busy
              ? "setting up…"
              : done
                ? "set up another passkey"
                : "Set up a passkey on this device"}
          </button>
          {/* Kept rather than hidden, because a second passkey is the thing §6.1e
              wants somebody to add — but only where the first one does not reach.
              Doing it again here would replace the passkey just made, since the
              account id is the user handle, and leave behind a saved route that
              can never be opened again. */}
          {done && (
            <p style={{ ...textStyle, marginBottom: 0, fontSize: 13 }}>
              Worth doing where this passkey cannot reach — another device, or
              another password manager. Setting one up again here would replace
              the one just made rather than add a second way in.
            </p>
          )}
        </>
      )}

      {problem && <p style={{ ...textStyle, marginBottom: 0 }}>{problem}</p>}
    </div>
  );
}
