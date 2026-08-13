// Getting 32 stable bytes out of a passkey (spec §6.1e, §11 Q11).
//
// The WebAuthn PRF extension asks the authenticator to evaluate a fixed input and
// hand back the result. Same credential and same input gives the same bytes, on
// every device that credential syncs to, and the bytes never leave the device.
// lib/keeperWrap.ts turns them into a wrapping key; this file is only about
// obtaining them.
//
// What was proved on hardware on 7 August 2026 (IDR-007, spec §11 Q11): one
// credential created in Chrome on macOS, held in Google Password Manager, synced
// to an iPhone, returned a byte-identical secret in Safari, in Chrome and in the
// home-screen app, and a wrapped key round-tripped in all three. That is the
// load-bearing assumption and it held.
//
// Two things that probe also found, both of which this file has to handle rather
// than treat as faults:
//
//   Creating a credential can be refused by configuration. Safari on macOS stores
//   passkeys only in iCloud Keychain and will not create one when that is off.
//   The refusal is indistinguishable from somebody cancelling the sheet, so this
//   file does not pretend to tell them apart and neither should the interface.
//
//   A credential can authenticate and return no secret. That is a credential
//   manager without PRF support, not a bug, and the only way to find out is to
//   create one and try: Safari does not report `prf.enabled` at creation time.
//   So enrolment creates, derives, and only then knows. Which is also why
//   enrolment raises two platform sheets rather than one — creating is one prompt
//   and proving is a second — and why the second one names the credential the
//   first just made. See deriveSecret for what that prevents.

/** The fixed input the authenticator evaluates. Not a secret; see keeperWrap.ts. */
import { PRF_SALT } from "./keeperWrap";
import { b64encode } from "./base64";

/**
 * The credential authenticated and returned no secret.
 *
 * Distinct from a refusal because the two mean opposite things to a person: this
 * one says "not on this password manager, use another route", where a refusal
 * says "try again".
 */
export class PrfUnsupportedError extends Error {
  constructor() {
    super("This credential store cannot produce a secret for Journlet");
    this.name = "PrfUnsupportedError";
  }
}

/**
 * The platform would not create or use a credential.
 *
 * Covers cancelling the sheet, a timeout, and iCloud Keychain being switched off,
 * because WebAuthn reports all three as NotAllowedError and deliberately gives no
 * more detail — telling them apart would be a way to probe someone's settings.
 * The interface must therefore offer the possibilities rather than assert one.
 */
export class CredentialRefusedError extends Error {
  constructor(cause?: unknown) {
    super("The device would not create or use a passkey");
    this.name = "CredentialRefusedError";
    this.cause = cause;
  }
}

// The PRF extension is not in lib.dom yet, so the shapes it adds are declared
// here and applied with a cast at the two call sites. Narrow on purpose: only the
// fields actually used, so a wrong guess about the rest cannot compile.
interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

/**
 * The Relying Party ID, which is the one deployment decision that cannot be taken
 * back (spec §4.7, §7).
 *
 * A credential is bound to this string, and changing it makes every enrolled
 * credential invisible. It has to be `journlet.com` rather than the page's
 * hostname, because the site is www.journlet.com and the app is app.journlet.com:
 * a defaulted credential binds to one subdomain and cannot be seen from the
 * other. Found by the 7 August probe, and it is the reason enrolment must never
 * run against the GitHub Pages default domain.
 *
 * Undefined anywhere else, which lets the platform default it. On localhost that
 * is the only legal answer, since a page may only claim a domain it is served
 * from, and a credential made there is a development artefact that will not
 * follow the app anywhere.
 *
 * Takes the hostname rather than reading location, so the rule itself is testable.
 */
export const relyingPartyId = (hostname: string): string | undefined =>
  /(^|\.)journlet\.com$/.test(hostname) ? "journlet.com" : undefined;

/** Whether a passkey is worth offering at all, before anything is created. */
export interface PrfCapability {
  /** WebAuthn refuses outside a secure context, and says so unhelpfully. */
  secureContext: boolean;
  webauthn: boolean;
  /**
   * A built-in authenticator — Touch ID, Face ID, Windows Hello, a device PIN.
   *
   * Reported because it changes what to *say*, and deliberately not part of
   * `usable`: a device without one can still use a passkey held on a phone, by
   * scanning a QR code when the platform offers it. Requiring this was a real
   * mistake, found on a Mac with no Touch ID that was offered no passkey route at
   * all while a passkey that would have opened it sat on the phone in the same room
   * (Gary, 12 August 2026). It removed the one route the design exists for.
   */
  platformAuthenticator: boolean;
  /**
   * Worth offering: a secure context and WebAuthn.
   *
   * Not PRF, which cannot be probed at all, and not a built-in authenticator, which
   * is a matter of which sheet the platform shows rather than whether to offer the
   * route.
   */
  usable: boolean;
}

/**
 * What can be known without creating anything.
 *
 * Deliberately not called "prfSupported", because PRF support is exactly the
 * thing this cannot answer, and it does not answer "is there a fingerprint reader"
 * either: a device with no built-in check can still reach a passkey on a phone
 * through the platform's own cross-device flow, so that fact is reported for the
 * wording and kept out of the decision. Chrome reports `prf.enabled` at creation and Safari
 * does not, so the only reliable test is to create a credential and try to derive
 * from it. This answers the cheaper question of whether it is worth asking the
 * person at all, so a browser that cannot do any of it is never offered a button
 * that would fail.
 */
export const probeCredentialSupport = async (): Promise<PrfCapability> => {
  const secureContext = globalThis.isSecureContext === true;
  const webauthn = typeof globalThis.PublicKeyCredential !== "undefined";
  let platformAuthenticator = false;
  if (webauthn) {
    try {
      platformAuthenticator =
        (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()) ===
        true;
    } catch {
      // Some builds throw rather than resolving false. Same answer either way.
      platformAuthenticator = false;
    }
  }
  return {
    secureContext,
    webauthn,
    platformAuthenticator,
    usable: secureContext && webauthn,
  };
};

/**
 * The id of one credential, as the platform's own bytes.
 *
 * Raw bytes rather than the base64url string WebAuthn also exposes on the
 * credential, because the only thing that ever reads this hands it straight back
 * to `allowCredentials`, which wants bytes. A string form would be an encode and a
 * decode with no reader in between.
 *
 * It never reaches the server. §6.5 keeps credential ids off `keeper_wraps`
 * deliberately — a row that named its credential would tell the operator which
 * password manager somebody uses — so this lives for the length of one enrolment
 * and is then dropped.
 */
export type CredentialId = Uint8Array<ArrayBuffer>;

/** What deriveSecret answers with: the bytes, and who produced them. */
export interface DerivedSecret {
  secret: ArrayBuffer;
  /**
   * The credential that answered, so a caller that finds it useless can say so.
   *
   * Null when the platform hands back no raw id, which should not happen for an
   * assertion and is not worth throwing over: the secret is the thing being asked
   * for, and this only enables an optional tidy-up.
   */
  credentialId: CredentialId | null;
}

/** base64url, which is the encoding the Signal API asks for. */
const b64url = (bytes: Uint8Array): string =>
  b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Ask the credential provider to forget a credential this journal cannot use
 * (WebAuthn Signal API, added 13 August 2026).
 *
 * The case it exists for: a passkey that authenticates, produces a secret, and
 * opens none of the wraps. That credential is genuinely useless for journlet.com —
 * its wrap was deleted by `start again`, or it replaced the credential a wrap
 * belonged to back when handles were the account id — and without this the manager
 * goes on offering it for ever, with the person having no way to tell which of two
 * entries is the dead one. Gary was offered one four times in a morning.
 *
 * Three properties make it safe to call here. It is advisory: the provider decides
 * whether to remove, hide or ignore. It is unsupported in most browsers today, so
 * it must be feature-detected and its absence must cost nothing. And it can only
 * ever be said about a credential that just failed, which is why the id is passed
 * in from the assertion and stored nowhere: §6.5 keeps credential ids off the
 * server, and this needs one for the length of one call.
 *
 * Never throws. A tidy-up that breaks an unlock screen would be worse than the mess
 * it tidies.
 */
export const forgetCredential = async (
  rpId: string | undefined,
  credentialId: CredentialId
): Promise<void> => {
  if (!rpId) return;
  const api = globalThis.PublicKeyCredential as unknown as
    | {
        signalUnknownCredential?: (o: {
          rpId: string;
          credentialId: string;
        }) => Promise<void>;
      }
    | undefined;
  // Intent rather than protection: a browser without the API is the expected case,
  // not an exceptional one. The catch below would cover it either way, which is why
  // no test can tell this line from its absence.
  if (typeof api?.signalUnknownCredential !== "function") return;
  try {
    await api.signalUnknownCredential({
      rpId,
      credentialId: b64url(credentialId),
    });
  } catch {
    // Providers are free to refuse, and older ones throw on unknown arguments.
  }
};

/** Who the credential belongs to, as the person's password manager will show it. */
export interface CredentialAccount {
  /** The account email, so the entry is recognisable in a list of passkeys. */
  email: string;
}

const random = (n: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(n));

/**
 * Create a passkey for this account.
 *
 * `residentKey: "required"` because the whole point is that a device which has
 * never seen this account can find the credential without being told what to look
 * for. `userVerification: "required"` because the biometric is what stands
 * between a stolen unlocked laptop and the journal, and it is also what the
 * interface promises. No attachment restriction, so a security key or a phone
 * used from a laptop both work.
 *
 * The user handle is random per enrolment, so enrolling twice on one platform adds
 * a second credential rather than replacing the first. Observed on Gary's account on
 * 13 August 2026: two wraps, one credential in each of two managers, and the Chrome
 * one opening neither row, because an earlier attempt from that Mac had replaced the
 * credential its predecessor's wrap belonged to.
 *
 * Returns the id of the credential it created, because enrolment has to name it
 * when it asks for the secret a moment later. See deriveSecret for what goes
 * quietly wrong when it does not.
 */
export const createCredential = async (
  account: CredentialAccount,
  rpId: string | undefined
): Promise<CredentialId> => {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        // The challenge is unverified, deliberately. Nothing about this credential
        // is checked by a server: it never authenticates anybody, it only derives
        // bytes, so there is no attestation to trust and no replay to prevent.
        rp: rpId ? { name: "Journlet", id: rpId } : { name: "Journlet" },
        user: {
          // Fresh per enrolment, and this is the line the section above is about.
          //
          // It was the account id until 13 August 2026, on §6.1e's reasoning that
          // enrolling twice on one platform should replace rather than accumulate.
          // WebAuthn implements that by overwriting any discoverable credential with
          // the same relying party and user handle — at creation, before this
          // function knows whether the derive and the publish will succeed. So an
          // attempt that failed or was cancelled destroyed the credential an earlier
          // one had made, its wrap opened nothing afterwards, and neither the person
          // nor the app could see it happen.
          //
          // Random means nothing is ever displaced: a failed enrolment costs nothing
          // and every live credential keeps its own wrap. Legal here precisely
          // because Journlet never signs anybody in with a passkey — the credential
          // exists to derive PRF bytes, so nothing ever looks an account up by
          // handle, and a handle carrying an account id had no reader at all.
          id: random(16),
          name: account.email,
          // The email alone. A dated label went in alongside the random handle and
          // came out the same day: it was there so two entries in one manager could
          // be told apart, and with unique handles every credential is live, so
          // there is no wrong one to pick. Password managers show the site and the
          // date they were created anyway, which is the same information from a
          // source that is not us (Gary, 13 August).
          displayName: account.email,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        timeout: 60_000,
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (e) {
    throw new CredentialRefusedError(e);
  }
  // No id means nothing to enrol. `create` is specified as resolving null in the
  // same conditions `get` is, so this is a refusal rather than an impossible
  // state, and treating it as one keeps the caller down to three outcomes.
  const rawId = (credential as PublicKeyCredential | null)?.rawId;
  if (!rawId) throw new CredentialRefusedError();
  return new Uint8Array(rawId);
};

/**
 * Ask a credential for the secret.
 *
 * With no allowCredentials by default, so the platform offers whatever
 * discoverable credential it holds for this Relying Party, including one synced
 * from another device that this one has never seen. Unlocking passes no id for
 * exactly that reason: a credential this device has never met is the case the
 * whole design exists for, and naming one would exclude it.
 *
 * Enrolment is the one caller that does pass an id, and has to. It has just
 * created a credential and is proving that *that* one can produce a secret; left
 * open, the platform may offer an older Journlet passkey for the same account
 * instead, the wrap would be written for that credential rather than the new one,
 * and the enrolment would report success having added no new route. Not dangerous
 * — the wrap it writes is a real one — and invisible, which is worse.
 *
 * Throws CredentialRefusedError if the sheet was refused and PrfUnsupportedError
 * if it was allowed and produced nothing, because the caller shows different
 * screens for those and must not have to guess which happened.
 *
 * Answers with the credential's id as well as the bytes, so a caller that finds the
 * bytes open nothing can ask the provider to forget it. See forgetCredential.
 */
export const deriveSecret = async (
  rpId: string | undefined,
  credentialId?: CredentialId
): Promise<DerivedSecret> => {
  let assertion: Credential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        rpId,
        allowCredentials: credentialId
          ? [{ type: "public-key", id: credentialId as BufferSource }]
          : [],
        userVerification: "required",
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: PRF_SALT } },
        } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (e) {
    throw new CredentialRefusedError(e);
  }
  if (!assertion) throw new CredentialRefusedError();

  const results = (
    assertion as PublicKeyCredential
  ).getClientExtensionResults() as PrfExtensionResults;
  const first = results.prf?.results?.first;
  if (!first) throw new PrfUnsupportedError();
  // The id comes back alongside, for forgetCredential above. Returned rather than
  // stored: it lives as long as the call that might need to disown it.
  const rawId = (assertion as PublicKeyCredential).rawId;
  return {
    secret: first,
    credentialId: rawId ? new Uint8Array(rawId) : null,
  };
};
