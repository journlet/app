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
import {
  countPasskeyRoutes,
  enrolPasskey,
  listPasskeyRoutes,
  removePasskeyRoute,
  replaceAllPasskeys,
} from "../store/sync";
import { describeRoute } from "../store/credentials";
import type { CredentialNote, RouteListing } from "../store/credentials";
import { probeCredentialSupport, relyingPartyId } from "../lib/prf";
import type { PrfCapability } from "../lib/prf";
import { enrolFailureMessage } from "../lib/passkeyMessages";

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
  return null;
};

/**
 * What to add when a passkey here will mean using something else, or null.
 *
 * A note rather than a refusal, which is the correction (Gary, 12 August 2026). This
 * device having no fingerprint reader says nothing about whether a passkey can be used
 * here: the platform offers a phone or a security key instead, and on an account whose
 * passkey already lives on a phone that is exactly the route wanted. It used to say "a
 * passkey cannot be set up here" and hide the button, which left a Mac with no Touch ID
 * unable to reach a credential sitting in the same room.
 */
export const noLocalCheckNote = (c: PrfCapability): string | null =>
  c.usable && !c.platformAuthenticator
    ? "This device has no built-in way to check that it is you — no Face ID, Touch ID, Windows Hello or device PIN — so you will be asked to use your phone or a security key instead."
    : null;

const routeCount = (n: number): string =>
  n === 1 ? "1 passkey can open this journal." : `${n} passkeys can open this journal.`;

/** "12 Aug", or "today, 14:20" for something that happened today. */
const when = (at: number): string => {
  const d = new Date(at);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `today, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * When a route last opened the journal, and from where.
 *
 * The changing half of a row, and the half that answers "was that me": the register
 * has held `lastOpenedOn` and `lastOpenedRoute` since it was written and the screen
 * showed neither, so a phone unlocking a wrap enrolled on the Mac read as a bare
 * timestamp. Reported on hardware by Gary on 13 August 2026, the same evening it
 * shipped.
 *
 * The route is named because §6.1k makes it the interesting part: a credential
 * reached locally and the same credential reached through the tunnel derive different
 * secrets, so "opened from the phone" and "opened by the phone on behalf of this
 * machine" are different events and only one of them says the phone holds a working
 * passkey. Where is omitted when the title already names it, which happens on a row
 * the register knows only from an unlock.
 */
const lastOpenedSentence = (
  note: CredentialNote | null,
  titleNamesEnrolment: boolean
): string => {
  if (!note?.lastOpenedAt)
    return "has not opened this journal on any device yet";
  const where =
    titleNamesEnrolment && note.lastOpenedOn ? ` on ${note.lastOpenedOn}` : "";
  const how =
    note.lastOpenedRoute === "this device"
      ? ", with a passkey on that device"
      : note.lastOpenedRoute === "another device"
        ? ", with a passkey from another device"
        : "";
  return `last opened ${when(note.lastOpenedAt)}${where}${how}`;
};

/**
 * The saved routes, laid out to be compared against a password manager.
 *
 * Loaded on request rather than with the box: it costs a round trip, it is only
 * wanted when somebody is actually reconciling, and a list unfurling under a
 * one-line summary is the wall of text this box was cut back from on 12 August.
 */
function RouteList({
  textStyle,
  version,
  onChanged,
}: {
  textStyle: React.CSSProperties;
  /**
   * Bumped by the box whenever it enrols or starts again.
   *
   * Without it this list kept whatever it had loaded, so "start again" left the wrap
   * it had just deleted on the screen — described as "not recognised", since that
   * wrap predated the register, and offering a remove that would have deleted
   * nothing and reported success. Found on hardware within minutes of shipping
   * (Gary, 13 August 2026), which is the second time a two-part screen has gone
   * stale in one direction: §6.1c's register had the same shape of bug.
   */
  version: number;
  /** Told when a removal happened, so the count above can stop being wrong too. */
  onChanged: () => void;
}) {
  const [state, setState] = useState<{
    routes: RouteListing[];
    strays: CredentialNote[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Which row is asking to be removed. One at a time, and never by mistake. */
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProblem(null);
    setBusy(true);
    try {
      setState(await listPasskeyRoutes());
    } catch {
      setProblem(
        "Could not read the saved passkeys just now. Try again in a moment."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // Only when something is already showing: the round trip is deliberate elsewhere,
  // and enrolling should not open a list nobody asked for.
  useEffect(() => {
    if (version > 0 && state) void load();
    // `state` is deliberately not a dependency: including it would reload on the
    // reload's own result, for ever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, load]);

  const remove = async (wrapId: string) => {
    setProblem(null);
    setBusy(true);
    try {
      await removePasskeyRoute(wrapId);
      setRemoving(null);
      await load();
      onChanged();
    } catch {
      setProblem("Could not remove that one. Nothing has changed.");
    } finally {
      setBusy(false);
    }
  };

  if (!state)
    return (
      <div style={{ marginTop: 10 }}>
        <button className="miniBtn" disabled={busy} onClick={() => void load()}>
          {busy ? "checking…" : "which passkeys are these?"}
        </button>
        {problem && <p style={{ ...textStyle, marginBottom: 0 }}>{problem}</p>}
      </div>
    );

  return (
    <div style={{ marginTop: 10 }}>
      {state.routes.map((r) => (
        <div
          key={r.wrapId}
          style={{
            borderTop: "1px solid var(--line)",
            paddingTop: 8,
            marginTop: 8,
          }}
        >
          <div
            style={{
              ...textStyle,
              marginTop: 0,
              marginBottom: 2,
              fontWeight: 600,
            }}
          >
            {describeRoute(r.note)}
          </div>
          <div
            style={{ ...textStyle, fontSize: 13, marginTop: 0, marginBottom: 0 }}
          >
            {r.note?.enrolledAt ? `set up ${when(r.note.enrolledAt)}. ` : ""}
            {lastOpenedSentence(
              r.note,
              !!(r.note?.enrolledAt && r.note?.enrolledOn)
            )}
            {/* The two measured fields, last and small. They are what settles a
                disagreement between this list and a password manager, and §6.1k is
                why the second one is here: the same credential reached two ways
                derives two secrets, so two rows can share the first and differ in
                the second. */}
            {r.note?.credentialId
              ? ` · passkey ${r.note.credentialId.slice(0, 12)}`
              : ""}
            {r.note?.fingerprint ? ` · key ${r.note.fingerprint}` : ""}
          </div>
          {removing === r.wrapId ? (
            <div style={{ marginTop: 6 }}>
              {/* The caveat before the action, as "start again" has it. This
                  withdraws a saved way in and takes nothing back, and a screen that
                  let it read as revocation would be the lost-device feature of 28
                  July over again (§6.1h). */}
              <p style={{ ...textStyle, fontSize: 13, marginTop: 0 }}>
                This removes the saved route only. A device that has already opened
                your journal with this passkey keeps its copy, and your journal key
                still works. The passkey itself stays in the password manager holding
                it, where you can delete it yourself.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="miniBtn"
                  disabled={busy}
                  onClick={() => void remove(r.wrapId)}
                >
                  {busy ? "removing…" : "remove this route"}
                </button>
                {!busy && (
                  <button className="miniBtn" onClick={() => setRemoving(null)}>
                    cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              className="miniBtn"
              style={{ marginTop: 6 }}
              onClick={() => setRemoving(r.wrapId)}
            >
              remove
            </button>
          )}
        </div>
      ))}

      {state.routes.length === 0 && (
        <p style={{ ...textStyle, marginBottom: 0 }}>No saved passkey routes.</p>
      )}

      {/* A note whose route has gone. Shown rather than hidden: the usual cause is
          another device having removed it, and the unusual cause is worth seeing. */}
      {state.strays.length > 0 && (
        <p style={{ ...textStyle, fontSize: 13, marginBottom: 0 }}>
          {state.strays.length === 1
            ? "One passkey this list knew about is no longer a saved route, most likely removed from another device."
            : `${state.strays.length} passkeys this list knew about are no longer saved routes, most likely removed from another device.`}
        </p>
      )}

      <p style={{ ...textStyle, fontSize: 13, marginBottom: 0 }}>
        A row that says “not recognised” was saved before this list existed, or on a
        device that has not synced since. Open the journal with it once and it names
        itself here.
      </p>

      {problem && <p style={{ ...textStyle, marginBottom: 0 }}>{problem}</p>}
    </div>
  );
}

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
  /** Whether the start-again step is open. Same reason: its caveat comes first. */
  const [replacing, setReplacing] = useState(false);
  /** Bumped when the routes change, so the list below reloads rather than going stale. */
  const [version, setVersion] = useState(0);

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

  /**
   * Enrol, either as an addition or as a replacement of everything before it.
   *
   * One function because the failure wording, the busy state and the recount are
   * identical: the only difference is whether the ids read beforehand are deleted
   * afterwards, and that difference lives in the store.
   */
  const setUp = async (replaceAll = false) => {
    setDone(null);
    setProblem(null);
    setBusy(true);
    try {
      await (replaceAll ? replaceAllPasskeys() : enrolPasskey());
      // Short, because the box now says the rest of it for as long as the passkey
      // exists rather than only until the next reload.
      setDone(
        replaceAll
          ? "Passkey set up, and the older routes removed."
          : "Passkey set up."
      );
      // Back to the one-line state, which the new count will now describe.
      setAdding(false);
      setReplacing(false);
      refreshCount();
      setVersion((v) => v + 1);
    } catch (e) {
      // Shared with the first-run screen, which says the same three things.
      setProblem(enrolFailureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cannot = capability ? capabilityMessage(capability) : null;
  const noLocalCheck = capability ? noLocalCheckNote(capability) : null;
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
          {/* Above the list rather than below it, which is where it was and which
              read as a description of the top row: after "start again" the line
              "Passkey set up, and the older routes removed" sat under a stale row
              saying "not recognised", so the two together said the new passkey was
              unrecognised (Gary, on hardware, 13 August 2026). */}
          {done && (
            <p style={{ ...textStyle, fontWeight: 600, marginBottom: 0 }}>{done}</p>
          )}
          {/* The list, once there is something to list: the answer to the question
              the count could only ever raise, which is which of my passkeys these
              are and whether one of them leads nowhere (§6.1l). */}
          <RouteList
            textStyle={textStyle}
            version={version}
            onChanged={refreshCount}
          />
          {details && (
            <>
              <p style={textStyle}>
                On a device that cannot open the journal yet: sign in with the same
                email, then choose “Unlock with a passkey”.
              </p>
              {/* The honest limit, and the reason the line above is a count rather
                  than "this device is set up": §6.5 keeps which device or password
                  manager holds each one off the server deliberately. */}
              <p style={textStyle}>
                Nothing about which device or password manager holds each one is
                recorded on the server. What the list above knows is kept inside your
                journal instead, so it can describe a route only once a device
                holding that route has opened the journal — and it still cannot tell
                you whether one of them is in this browser.
              </p>
              {/* Advice rather than mechanism, and it earns its place: measured on
                  13 August 2026 (spec §6.1k), one credential gives a different secret
                  when a browser reaches it directly and when the same credential is
                  reached by scanning a code from another device. On Apple devices the
                  built-in manager is consistent across both; Google Password Manager
                  was not. So the way to have one passkey that covers a borrowed
                  machine is to keep one in the device's own manager, and saying that
                  is cheaper than every screen having to explain the failure. */}
              <p style={{ ...textStyle, marginBottom: 0 }}>
                Worth having one in your device's own manager — iCloud Keychain on an
                iPhone or Mac. A borrowed computer with none of your passkeys on it
                unlocks by scanning a code from your phone, and that route is reliable
                from the device's own manager and not from every other one.
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
        // Pointing down at the Journal key box rather than explaining it here.
        // The old wording said what this device could not do and then gave advice
        // that could not be followed on it, which is the shape of half-truth §6.1b
        // is the account of. The remedy lives one box below.
        <p style={{ ...textStyle, marginBottom: 0 }}>
          This device cannot add one: it does not hold the journal key itself,
          having been added by another device. You can give it the key under
          Journal key below, and then it can.
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
          {/* Still here for the first passkey, where there is no list above to put
              it over and `enrolled` is false until the count comes back. */}
          {done && !enrolled && (
            <p style={{ ...textStyle, fontWeight: 600 }}>{done}</p>
          )}

          {/* On an account with a passkey, adding another is two taps: the first
              reveals what to expect, the second does it. The warnings have to come
              before the platform sheets — one about the two prompts, one about
              re-using the same password manager — and putting them on screen
              permanently is what made this box a wall of text. */}
          {enrolled && replacing ? (
            <>
              {/* The caveat before the action, and it is the one §11 Q13 turns on:
                  this removes stored routes and takes nothing back. Saying it after
                  the fact would be the lost-device feature of 28 July again. */}
              <p style={{ ...textStyle, fontSize: 13 }}>
                This sets up a new passkey here and removes the saved routes that
                existed before it — useful when you have lost track of how many there
                are, or a passkey has been deleted from a password manager and its
                route is still counted. It does not take the key back from a device
                that already has it, and nothing can. Your journal key does not
                change.
              </p>
              <p style={{ ...textStyle, fontSize: 13 }}>
                Two prompts follow, as before.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="miniBtn"
                  disabled={busy}
                  onClick={() => void setUp(true)}
                >
                  {busy ? "starting again…" : "start again with one passkey"}
                </button>
                {!busy && (
                  <button className="miniBtn" onClick={() => setReplacing(false)}>
                    cancel
                  </button>
                )}
              </div>
            </>
          ) : enrolled && !adding ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button className="miniBtn" onClick={() => setAdding(true)}>
                add another passkey
              </button>
              <button className="miniBtn" onClick={() => setReplacing(true)}>
                start again
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
              {noLocalCheck && (
                <p style={{ ...textStyle, fontSize: 13 }}>{noLocalCheck}</p>
              )}
              <p style={{ ...textStyle, ...(enrolled ? { fontSize: 13 } : {}) }}>
                Two prompts follow: one to create the passkey, one to use it. Both
                are needed — the second is not a sign the first failed.
              </p>
              {/* This used to warn that enrolling again in the same password manager
                  replaced the credential rather than adding one, which was true while
                  the account id was the WebAuthn user handle. Handles became unique
                  per enrolment on 13 August 2026, after that replacement destroyed a
                  working route on the author's own account, so the warning describes
                  something that can no longer happen and is gone with it. What is
                  still true is where a second one is worth having. */}
              {enrolled && (
                <p style={{ ...textStyle, fontSize: 13 }}>
                  Worth adding where the ones you have cannot reach — another device,
                  or another password manager. Adding one never replaces a passkey you
                  already have.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className={enrolled ? "miniBtn" : "addBtn"}
                  disabled={busy}
                  onClick={() => void setUp()}
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
