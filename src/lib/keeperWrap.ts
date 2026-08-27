// Wrapping the keeper key so a passkey can open it (spec §6.1e).
//
// Why this exists. The keeper key is the top of the hierarchy: it wraps the data
// key for every epoch, so whoever holds it can read the whole journal and produce
// the journal key code. Until now the only way to hold it was to have been shown
// the code once and kept it, which made an irreplaceable string the single route
// back into an account. A test account was lost that way on 11 August 2026.
//
// The WebAuthn PRF extension returns the same 32 bytes from a passkey every time
// for a fixed salt, on every device that passkey syncs to, and the server never
// sees them. Those bytes wrap the keeper key. So the keeper key stops being
// something a person keeps and becomes something a device can obtain after a
// biometric check.
//
// The rule that matters, and the reason this file is a list rather than a single
// blob: the keeper key is wrapped once per enrolled credential, plus once as the
// journal key code, and *any single one* of those opens the journal. Not one, and
// not all of them. There is no main device and no root device.
//
// Nothing here touches WebAuthn. Deriving the secret is a separate step that
// cannot run outside a browser with a real authenticator, so it stays out of this
// module: everything below takes the 32 bytes as an argument and is therefore
// testable. That seam is deliberate — this project's recurring failure is an
// assertion pointed at the wrong level.

import { b64decode, b64encode } from "./base64";

const AES = "AES-GCM";
const IV_BYTES = 12;
const SALT_BYTES = 32;

/**
 * Format version of the wrapped blob, carried in the row.
 *
 * Named for what it versions rather than `WRAP_VERSION`, because lib/crypto.ts
 * versions the wrapped *data* key and had a constant of the same name holding the
 * same 1. They count independently. This one is also load-bearing in a way that
 * one is not: it is interpolated into the AAD below, so its value is part of the
 * stored format and changing it makes every existing row undecryptable. A bump
 * here is a migration, not a relabelling.
 */
const KEEPER_WRAP_VERSION = 1;

/**
 * The fixed input the authenticator is asked to evaluate.
 *
 * Fixed because the whole mechanism rests on the same credential returning the
 * same bytes on every device, so anything varying per device or per call would
 * defeat it. Not a secret: it is sent to the authenticator in the clear, and its
 * only job is to separate this use of the credential from any other.
 *
 * Exported for the enrolment step (§12.1 phase 3), which is the only other place
 * allowed to know it.
 */
export const PRF_SALT: Uint8Array = new TextEncoder().encode(
  "journlet.com/prf/keeper/v1"
);

/** The `wrapped` jsonb column of keeper_wraps. All base64. */
export interface KeeperWrapJson {
  v: number;
  /** Fresh per wrap. HKDF over a PRF secret used twice with the same salt would
   *  derive the same key twice, and a salt per row also binds the derivation to
   *  the row. */
  salt: string;
  iv: string;
  blob: string;
}

/** A row as it comes back from the table: its id, and the ciphertext. */
export interface KeeperWrapRow {
  wrapId: string;
  wrapped: KeeperWrapJson;
}

/**
 * Where a wrapped keeper key is allowed to be opened.
 *
 * Built by the reader from its own user id and the id of the row it is reading,
 * never from anything inside the row. Same rule as payload v3 in lib/crypto.ts
 * and the device wraps in lib/deviceKeys.ts: decrypt against what you expect, not
 * against what the ciphertext arrived with. A blob moved between rows or replayed
 * into another account fails authentication instead of quietly working.
 */
export interface KeeperWrapBinding {
  userId: string;
  wrapId: string;
}

/**
 * The row id, generated on the client rather than by the database.
 *
 * It has to be: the id is inside the AAD, so it must exist before the ciphertext
 * does. A `default gen_random_uuid()` would mean encrypting against an id the
 * server had not chosen yet, and then trusting whatever came back.
 */
export const newWrapId = (): string => crypto.randomUUID();

const bindingBytes = (b: KeeperWrapBinding): Uint8Array =>
  new TextEncoder().encode(
    `journlet/keeper-wrap/${KEEPER_WRAP_VERSION}\nuser=${b.userId}\nwrap=${b.wrapId}`
  );

/**
 * HKDF from the PRF secret, with the binding as `info` as well as the AAD.
 *
 * The secret is 32 bytes from an authenticator rather than a uniformly random
 * key, and it is used for nothing else, so HKDF here is about domain separation
 * more than about the distribution: the same credential wrapping two different
 * rows must not derive the same key. Belt and braces on the binding, as with the
 * device wraps, and it costs nothing.
 */
const deriveWrappingKey = async (
  secret: BufferSource,
  salt: Uint8Array,
  binding: KeeperWrapBinding
): Promise<CryptoKey> => {
  const hkdf = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: bindingBytes(binding) as BufferSource,
    },
    hkdf,
    { name: AES, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

/**
 * Wrap the keeper key for one credential.
 *
 * The caller allocates the wrap id with newWrapId() and writes the row under it.
 * Wrapping needs the keeper key, so only a device that can already read the
 * journal can add a route into it — the same entitlement logic as approving a
 * device, and it needs no separate rule.
 */
export const wrapKeeperKey = async (
  keeperKey: CryptoKey,
  secret: BufferSource,
  binding: KeeperWrapBinding
): Promise<KeeperWrapJson> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveWrappingKey(secret, salt, binding);

  const raw = await crypto.subtle.exportKey("raw", keeperKey);
  const blob = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: AES,
        iv: iv as BufferSource,
        additionalData: bindingBytes(binding) as BufferSource,
      },
      aesKey,
      raw
    )
  );

  return {
    v: KEEPER_WRAP_VERSION,
    salt: b64encode(salt),
    iv: b64encode(iv),
    blob: b64encode(blob),
  };
};

/**
 * Open one wrap, or throw.
 *
 * Throws for a caller that has named the row it wants: a failure there is either
 * the wrong credential or a tampered row, and both are worth surfacing.
 * unwrapKeeperKeyFromAny below is the shape for the case where failure is
 * expected and means nothing.
 */
export const unwrapKeeperKey = async (
  wrapped: KeeperWrapJson,
  secret: BufferSource,
  binding: KeeperWrapBinding
): Promise<CryptoKey> => {
  if (wrapped.v !== KEEPER_WRAP_VERSION)
    throw new Error(`Unsupported keeper wrap version ${wrapped.v}`);
  const aesKey = await deriveWrappingKey(
    secret,
    b64decode(wrapped.salt),
    binding
  );
  const raw = await crypto.subtle.decrypt(
    {
      name: AES,
      iv: b64decode(wrapped.iv) as BufferSource,
      additionalData: bindingBytes(binding) as BufferSource,
    },
    aesKey,
    b64decode(wrapped.blob) as BufferSource
  );
  // Same usages and the same extractability as a keeper key arriving from a typed
  // journal key code (lib/crypto.ts): it has to wrap and unwrap data keys, and it
  // has to be exportable so any unlocked device can display the code. That last
  // part is new, and it is what stops the code being a thing only the device that
  // created the journal can produce.
  return crypto.subtle.importKey("raw", raw, { name: AES, length: 256 }, true, [
    "wrapKey",
    "unwrapKey",
  ]);
};

/**
 * Try every wrap and return the first that opens, or null.
 *
 * This is what a device does on unlock. It cannot know which row belongs to the
 * credential in front of it, and §6.5 forbids the row saying so: a credential id
 * or a label on the row would tell the server which password manager a person
 * uses. So the rows are tried in turn and AES-GCM authentication decides. A
 * handful of failed decryptions costs nothing and reveals nothing.
 *
 * Null rather than an exception, because "none of these is yours" is an answer
 * and not a fault: it is what a device with a passkey from a different ecosystem
 * sees, and its screen offers the code and approval instead.
 */
export const unwrapKeeperKeyFromAny = async (
  rows: readonly KeeperWrapRow[],
  secret: BufferSource,
  userId: string
): Promise<{ wrapId: string; keeperKey: CryptoKey } | null> => {
  for (const row of rows) {
    try {
      const keeperKey = await unwrapKeeperKey(row.wrapped, secret, {
        userId,
        wrapId: row.wrapId,
      });
      return { wrapId: row.wrapId, keeperKey };
    } catch {
      // Wrong credential for this row, or a row that has been tampered with.
      // Indistinguishable here and the next row is worth trying either way.
    }
  }
  return null;
};
