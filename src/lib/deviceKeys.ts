// Per-device keypairs, and wrapping the data key for one named device.
//
// Why this exists: with a single shared keeper key there is no such thing as
// removing one device. Every device holds the same secret, so the only lever is
// rotating it, which locks out every device at once. Giving each device its own
// key is what makes "sign this phone out and leave the laptop alone" a coherent
// operation. See spec/device-identity-design.md.
//
// Nothing here is a secret the user ever sees or types. The journal key code in
// lib/crypto.ts remains the recovery path; this is the everyday path.

import { b64decode, b64encode } from "./base64";

const CURVE = "P-256";
const AES = "AES-GCM";
const IV_BYTES = 12;
const SALT_BYTES = 32;

/** Format version of the wrapped blob, carried in the row. */
const WRAP_VERSION = 1;

/**
 * Where a wrapped data key is allowed to be opened.
 *
 * The recipient builds this from its *own* user id and device id and never from
 * the row it is decrypting — the same rule as payload v2 in lib/crypto.ts.
 * Decrypt against what you expect, not against what the ciphertext arrived
 * with, so a blob copied to another device or replayed into another account
 * fails authentication instead of quietly working.
 */
export interface DeviceBinding {
  userId: string;
  deviceId: string;
}

/** The `wrapped` jsonb column of device_wrapped_keys. All base64. */
export interface DeviceWrappedKeyJson {
  v: number;
  /** Ephemeral public key, raw point. */
  epk: string;
  salt: string;
  iv: string;
  blob: string;
}

const bindingBytes = (b: DeviceBinding): Uint8Array =>
  new TextEncoder().encode(
    `journlet/devkey/${WRAP_VERSION}\nuser=${b.userId}\ndevice=${b.deviceId}`
  );

// ---------- the device's own keypair ----------

/**
 * P-256 rather than X25519, which would be the better primitive.
 *
 * WebCrypto's X25519 support is too recent to depend on inside an iOS
 * home-screen app, and a linking flow that fails on the platform the app is
 * most used on is worse than a curve with a longer history. P-256 is present
 * everywhere this runs.
 *
 * The private half is non-extractable: it is only ever used through deriveBits,
 * so there is no reason for it to be exportable, and non-extractable keys still
 * survive structured clone into IndexedDB.
 */
export const generateDeviceKeyPair = (): Promise<CryptoKeyPair> =>
  crypto.subtle.generateKey({ name: "ECDH", namedCurve: CURVE }, false, [
    "deriveBits",
  ]) as Promise<CryptoKeyPair>;

/**
 * `raw` (the 65-byte uncompressed point), not `spki`.
 *
 * This string is what gets hashed into the verification code, so it has to have
 * exactly one form. An spki wrapper carries algorithm identifiers that are
 * free to vary between implementations, and a fingerprint that depends on how
 * the encoder felt is not a fingerprint.
 */
export const exportDevicePublicKey = async (
  publicKey: CryptoKey
): Promise<string> =>
  b64encode(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));

export const importDevicePublicKey = (publicKeyB64: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    b64decode(publicKeyB64) as BufferSource,
    { name: "ECDH", namedCurve: CURVE },
    true,
    []
  );

// ---------- verification code ----------

// Crockford base32: no I, L, O or U, so nothing can be misread as 1, 0 or V.
// Same alphabet as the journal key code, deliberately — one alphabet to learn.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 80 bits, which is 10 bytes, which is exactly 16 base32 characters. */
const CODE_BYTES = 10;

/**
 * The code the two devices compare by eye.
 *
 * Sixteen characters, not the six originally specified. The code has to resist a
 * targeted preimage: something impersonating a device needs a keypair whose
 * fingerprint matches the one the genuine device is displaying. Six characters
 * is 30 bits, and P-256 keygen plus a hash is tens of microseconds, so 2^30 is
 * hours on one core and minutes spread out — well inside the thirty minutes a
 * request stays valid. Sixteen characters is 80 bits and out of reach.
 *
 * Truncating SHA-256 is sound here: the property needed is preimage resistance
 * against a target, not collision resistance between two attacker-chosen keys,
 * so the birthday bound does not apply and 80 bits means 80 bits.
 */
export const verificationCode = async (
  publicKeyB64: string
): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", b64decode(publicKeyB64) as BufferSource)
  );
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of digest.slice(0, CODE_BYTES)) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return (out.match(/.{4}/g) ?? []).join(" ");
};

// ---------- wrapping ----------

/**
 * Wrap the data key so that exactly one device can open it.
 *
 * Ephemeral ECDH: a throwaway keypair is generated per wrap, so the sending
 * device's own long-term private key never takes part and nothing about the
 * sender accumulates in the rows. The recipient needs only its own private key
 * and the ephemeral public key travelling alongside the blob.
 */
export const wrapDataKeyForDevice = async (
  dataKey: CryptoKey,
  recipientPublicKeyB64: string,
  binding: DeviceBinding
): Promise<DeviceWrappedKeyJson> => {
  const recipient = await importDevicePublicKey(recipientPublicKeyB64);
  const ephemeral = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: CURVE },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveWrappingKey(
    ephemeral.privateKey,
    recipient,
    salt,
    binding
  );

  const raw = await crypto.subtle.exportKey("raw", dataKey);
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
    v: WRAP_VERSION,
    epk: await exportDevicePublicKey(ephemeral.publicKey),
    salt: b64encode(salt),
    iv: b64encode(iv),
    blob: b64encode(blob),
  };
};

/**
 * Open a wrapped data key with this device's private key.
 *
 * Throws on anything that does not authenticate, which includes a blob wrapped
 * for a different device: the binding is rebuilt locally, so a mismatched AAD
 * fails the GCM tag rather than producing a wrong-but-plausible key.
 */
export const unwrapDataKeyForDevice = async (
  wrapped: DeviceWrappedKeyJson,
  privateKey: CryptoKey,
  binding: DeviceBinding
): Promise<CryptoKey> => {
  if (wrapped.v !== WRAP_VERSION)
    throw new Error(`Unsupported wrapped key version ${wrapped.v}`);
  const epk = await importDevicePublicKey(wrapped.epk);
  const aesKey = await deriveWrappingKey(
    privateKey,
    epk,
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
  // Extractable, because a device that holds the data key must be able to wrap
  // it for the next device to be approved. Otherwise only the device that
  // created the journal could ever approve anything.
  return crypto.subtle.importKey("raw", raw, { name: AES, length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
};

/**
 * ECDH then HKDF, rather than using the shared secret as a key directly.
 *
 * The raw output of ECDH is a curve point coordinate, not a uniformly random
 * string, and feeding it straight to AES is the classic misstep. HKDF-SHA256
 * with a random salt fixes the distribution and binds the derivation to this
 * one wrap. The binding string goes in as `info` as well as being the AAD:
 * belt and braces, and it costs nothing.
 */
const deriveWrappingKey = async (
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
  binding: DeviceBinding
): Promise<CryptoKey> => {
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
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
