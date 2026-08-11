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
//   So enrolment creates, derives, and only then knows.

/** The fixed input the authenticator evaluates. Not a secret; see keeperWrap.ts. */
import { PRF_SALT } from "./keeperWrap";

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

/** Whether enrolment is worth offering at all, before anything is created. */
export interface PrfCapability {
  /** WebAuthn refuses outside a secure context, and says so unhelpfully. */
  secureContext: boolean;
  webauthn: boolean;
  /** A built-in authenticator, which is what makes this a Face ID affordance. */
  platformAuthenticator: boolean;
  /** True only if all three above hold. PRF itself cannot be probed; see below. */
  usable: boolean;
}

/**
 * What can be known without creating anything.
 *
 * Deliberately not called "prfSupported", because PRF support is exactly the
 * thing this cannot answer. Chrome reports `prf.enabled` at creation and Safari
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
    usable: secureContext && webauthn && platformAuthenticator,
  };
};

/** Who the credential belongs to, as the person's password manager will show it. */
export interface CredentialAccount {
  /** The Supabase user id. Becomes the WebAuthn user handle. */
  userId: string;
  /** The account email, so the entry is recognisable in a list of passkeys. */
  email: string;
}

const uuidBytes = (uuid: string): Uint8Array<ArrayBuffer> => {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

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
 * The user handle is the account id rather than something random, so enrolling
 * twice on one platform replaces rather than accumulates.
 */
export const createCredential = async (
  account: CredentialAccount,
  rpId: string | undefined
): Promise<void> => {
  try {
    await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        // The challenge is unverified, deliberately. Nothing about this credential
        // is checked by a server: it never authenticates anybody, it only derives
        // bytes, so there is no attestation to trust and no replay to prevent.
        rp: rpId ? { name: "Journlet", id: rpId } : { name: "Journlet" },
        user: {
          id: uuidBytes(account.userId),
          name: account.email,
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
};

/**
 * Ask a credential for the secret.
 *
 * With no allowCredentials, so the platform offers whatever discoverable
 * credential it holds for this Relying Party, including one synced from another
 * device that this one has never seen. That is the case the whole design exists
 * for, and constraining the list would break it.
 *
 * Throws CredentialRefusedError if the sheet was refused and PrfUnsupportedError
 * if it was allowed and produced nothing, because the caller shows different
 * screens for those and must not have to guess which happened.
 */
export const deriveSecret = async (
  rpId: string | undefined
): Promise<ArrayBuffer> => {
  let assertion: Credential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        rpId,
        allowCredentials: [],
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
  return first;
};
