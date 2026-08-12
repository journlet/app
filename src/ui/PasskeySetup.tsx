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
  /** Whether the explanation is showing, on an account that has a passkey. */
  const [details, setDetails] = useState(false);
  /** Whether the add-another step is open, which is where its warnings live. */
  const [adding, setAdding] = useState(false);

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
      // Short, because the box now says the rest of it for as long as the passkey
      // exists rather than only until the next reload.
      setDone("Passkey set up.");
      // Back to the one-line state, which the new count will now describe.
      setAdding(false);
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

  /**
   * Whether this account already has a passkey, which changes what the box is for.
   *
   * With none, it is an offer and has to explain itself. With one, explaining is
   * the wrong thing: a reload put the pitch and a full-strength "Set up a passkey"
   * back in front of somebody who had just set one up, which reads as it not having
   * worked (Gary, second hardware run). The `done` message could not fix that on
   * its own, because it is component state and a reload clears it — the durable
   * answer is the count, which is the one thing the server can tell us.
   *
   * Null means the count could not be read. Treated as "no passkey" so the box
   * still offers something rather than claiming a state it does not know.
   */
  const enrolled = routes !== null && routes > 0;

  return (
    <div style={boxStyle}>
      <div style={labelStyle}>Passkey unlock</div>

      {enrolled ? (
        <>
          {/* One line by default. Everything this box explained on the way to the
              first passkey is answering a question nobody is asking any more, and
              the Journal key box directly below already carries the keep-it-safe
              warning in stronger terms. So the state, and the rest on request. */}
          <p style={{ ...textStyle, marginTop: 0, marginBottom: 0, fontWeight: 600 }}>
            {routeCount(routes)}
          </p>
          {details && (
            <>
              <p style={textStyle}>
                On a device that cannot open the journal yet: sign in with the same
                email, then choose “Unlock with a passkey”.
              </p>
              {/* The honest limit, and the reason the line above is a count rather
                  than "this device is set up": §6.5 keeps which device or password
                  manager holds each one off the server deliberately. */}
              <p style={{ ...textStyle, marginBottom: 0 }}>
                Which device or password manager holds each one is not recorded on
                the server, so this cannot tell you whether one of them is in this
                browser.
              </p>
            </>
          )}
        </>
      ) : (
        <>
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
        </>
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
          {done && <p style={{ ...textStyle, fontWeight: 600 }}>{done}</p>}

          {/* On an account with a passkey, adding another is two taps: the first
              reveals what to expect, the second does it. The warnings have to come
              before the platform sheets — one about the two prompts, one about
              re-using the same password manager — and putting them on screen
              permanently is what made this box a wall of text. */}
          {enrolled && !adding ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button className="miniBtn" onClick={() => setAdding(true)}>
                add another passkey
              </button>
              <button className="miniBtn" onClick={() => setDetails(!details)}>
                {details ? "hide details" : "what this means"}
              </button>
            </div>
          ) : (
            <>
              {/* Before the button, not after the second sheet appears. Two prompts
                  read as one having failed unless somebody has been told to expect
                  them (found while building phase 3a, spec §6.1e). */}
              <p style={{ ...textStyle, ...(enrolled ? { fontSize: 13 } : {}) }}>
                Two prompts follow: one to create the passkey, one to use it. Both
                are needed — the second is not a sign the first failed.
              </p>
              {/* The account id is the WebAuthn user handle, so a second enrolment
                  in the same password manager replaces the credential rather than
                  adding one — and leaves the row already written as a route nothing
                  can open. §6.5 forbids the credential id that would let the client
                  tidy that up, so saying so is the whole of the remedy. */}
              {enrolled && (
                <p style={{ ...textStyle, fontSize: 13 }}>
                  Worth adding where the ones you have cannot reach — another
                  device, or another password manager. Setting one up again in the
                  same password manager replaces it rather than adding a way in.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className={enrolled ? "miniBtn" : "addBtn"}
                  disabled={busy}
                  onClick={setUp}
                >
                  {busy
                    ? "setting up…"
                    : enrolled
                      ? "set up another passkey"
                      : "Set up a passkey on this device"}
                </button>
                {enrolled && !busy && (
                  <button className="miniBtn" onClick={() => setAdding(false)}>
                    cancel
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {problem && <p style={{ ...textStyle, marginBottom: 0 }}>{problem}</p>}
    </div>
  );
}
