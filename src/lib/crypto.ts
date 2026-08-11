// End-to-end encryption primitives (spec §6).
//
// Decision (20 July 2026, resolves spec §11 Q4): no passphrase. A random
// 256-bit "keeper" key — shown to the user once as the journal key code —
// wraps a random 256-bit data key. The data key encrypts CRDT updates
// (AES-GCM) before they ever leave the device; the server only sees
// ciphertext. The wrapped-data-key indirection means an optional
// passphrase could be added later without re-encrypting content.

const ALG = "AES-GCM";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Update payload format.
 *
 * Version 1 bound nothing. Version 2 binds each payload to the account and
 * volume via AES-GCM additional authenticated data. Version 3 adds the data key
 * *epoch*, so a journal whose key has been rotated can still read everything
 * written under earlier keys (spec/device-identity-design.md, steps 4 and 5).
 *
 * Version 1 is not decryptable by this code and never will be. Supporting it
 * would reintroduce exactly the hole the AAD closes: the version byte sits
 * outside the authenticated envelope, so anyone able to write a row could flip a
 * 2 back to a 1 and have the client decrypt it with no binding checked at all. A
 * v1 payload raises LegacyPayloadError and is skipped.
 *
 * Version 2 *is* still read, and that is a deliberate departure from how v1 was
 * retired. Every existing row is epoch 0 by definition, so re-encrypting them
 * would buy nothing; and doing it on each rotation would rewrite the whole
 * journal into an append-only log every time a device is removed. The flip
 * argument does not apply in reverse: a 3 forged down to a 2 changes the AAD the
 * recipient computes, so it fails authentication rather than skipping a check.
 */
export const PAYLOAD_VERSION = 3;

/** Where the version 3 header puts the epoch: two bytes, big-endian. */
const EPOCH_BYTES = 2;

/**
 * The epoch a stored payload was written under.
 *
 * Read from the payload rather than passed in, because the caller needs it to
 * choose which key to try, and it cannot know it any other way. Safe to trust for
 * that purpose alone: the epoch is inside the AAD, so a tampered value produces a
 * binding the recipient never computes and the decryption fails. The worst a
 * forged epoch achieves is selecting a key that then does not work.
 */
export const readPayloadEpoch = (payload: Uint8Array): number =>
  payload[0] >= 3 ? (payload[1] << 8) | payload[2] : 0;

/** The wrapped-data-key blob format, unchanged by the AAD work. */
const WRAP_VERSION = 1;

// ---------- key generation ----------

export const generateKeeperKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: ALG, length: 256 }, true, [
    "wrapKey",
    "unwrapKey",
  ]);

export const generateDataKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: ALG, length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

// ---------- data key wrap / unwrap ----------

export interface WrappedDataKey {
  v: number;
  iv: Uint8Array;
  blob: Uint8Array;
}

export const wrapDataKey = async (
  dataKey: CryptoKey,
  keeperKey: CryptoKey
): Promise<WrappedDataKey> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const blob = await crypto.subtle.wrapKey("raw", dataKey, keeperKey, {
    name: ALG,
    iv,
  });
  return { v: WRAP_VERSION, iv, blob: new Uint8Array(blob) };
};

export const unwrapDataKey = (
  wrapped: WrappedDataKey,
  keeperKey: CryptoKey
): Promise<CryptoKey> =>
  crypto.subtle.unwrapKey(
    "raw",
    wrapped.blob as BufferSource,
    keeperKey,
    { name: ALG, iv: wrapped.iv as BufferSource },
    { name: ALG, length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

// ---------- CRDT update payloads ----------
// Layout: v2 [version:1][iv:12][ciphertext]
//         v3 [version:1][epoch:2][iv:12][ciphertext]

/**
 * Where a payload belongs. Encryption and decryption must be given the values
 * the caller *expects*, never the ones the server supplied alongside the row —
 * that is the whole point. A blob moved to another volume, replayed into
 * another account, or handed back under a different version fails to decrypt.
 */
export interface PayloadContext {
  userId: string;
  volume: string;
}

/**
 * A payload in the retired version 1 format. Expected on any account that
 * synced before the AAD change; distinct from a decryption failure because the
 * two mean completely different things to the user.
 */
export class LegacyPayloadError extends Error {
  constructor(version: number) {
    super(`Payload is in retired format version ${version}`);
    this.name = "LegacyPayloadError";
  }
}

/**
 * Canonical, unambiguous, and versioned.
 *
 * The version is a parameter rather than a constant now that two formats are
 * readable, but it is still never taken from the byte in the header: the caller
 * passes the version it has decided to honour, and the epoch is authenticated by
 * being inside this string. So a forged header selects a binding the recipient
 * does not compute and fails, rather than selecting a weaker one.
 */
const additionalData = (
  version: number,
  ctx: PayloadContext,
  epoch: number
): Uint8Array =>
  new TextEncoder().encode(
    version >= 3
      ? `journlet/3\nuser=${ctx.userId}\nvolume=${ctx.volume}\nepoch=${epoch}`
      : `journlet/2\nuser=${ctx.userId}\nvolume=${ctx.volume}`
  );

/**
 * Encrypt an update under the key for `epoch`.
 *
 * Epoch 0 is written as version 2, deliberately. Epoch 0 *is* the pre-rotation
 * state, so installing the epoch machinery changes the format of nothing: the
 * first v3 row on an account appears only after a rotation, which is also the
 * moment every device has had to come online to collect the new key. That turns
 * §6.1a's format-change warning from a deployment risk into something the user
 * triggers when they are ready.
 */
export const encryptUpdate = async (
  dataKey: CryptoKey,
  update: Uint8Array,
  ctx: PayloadContext,
  epoch = 0
): Promise<Uint8Array> => {
  const version = epoch === 0 ? 2 : PAYLOAD_VERSION;
  const header = version >= 3 ? 1 + EPOCH_BYTES : 1;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: ALG,
        iv,
        additionalData: additionalData(version, ctx, epoch) as BufferSource,
      },
      dataKey,
      update as BufferSource
    )
  );
  const out = new Uint8Array(header + IV_BYTES + ct.length);
  out[0] = version;
  if (version >= 3) {
    out[1] = (epoch >> 8) & 0xff;
    out[2] = epoch & 0xff;
  }
  out.set(iv, header);
  out.set(ct, header + IV_BYTES);
  return out;
};

/**
 * Decrypt a stored payload.
 *
 * `dataKey` must be the key for the payload's own epoch — use readPayloadEpoch to
 * choose it. Passing the wrong epoch's key fails authentication rather than
 * producing anything, which is the desired outcome but is not a diagnosis, so
 * callers holding several keys should select rather than guess.
 */
export const decryptUpdate = async (
  dataKey: CryptoKey,
  payload: Uint8Array,
  ctx: PayloadContext
): Promise<Uint8Array> => {
  const version = payload[0];
  if (version < 2) throw new LegacyPayloadError(version);
  if (version > PAYLOAD_VERSION)
    throw new Error(`Unsupported payload version ${version}`);
  const header = version >= 3 ? 1 + EPOCH_BYTES : 1;
  const iv = payload.slice(header, header + IV_BYTES);
  const ct = payload.slice(header + IV_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: ALG,
        iv: iv as BufferSource,
        additionalData: additionalData(
          version,
          ctx,
          readPayloadEpoch(payload)
        ) as BufferSource,
      },
      dataKey,
      ct as BufferSource
    )
  );
};

// ---------- journal key code ----------
// The keeper key rendered for humans: Crockford base32 in groups of four,
// prefixed J1 (journal key, format 1), e.g. J1-XXXX-XXXX-…

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const toBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
};

const fromBase32 = (s: string): Uint8Array => {
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const raw of s) {
    // Crockford: I/L read as 1, O as 0; case-insensitive
    const c = raw.toUpperCase().replace(/[IL]/, "1").replace("O", "0");
    const v = B32.indexOf(c);
    if (v === -1) throw new Error(`Invalid character in journal key: ${raw}`);
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

export const exportJournalKeyCode = async (
  keeperKey: CryptoKey
): Promise<string> => {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keeperKey));
  const s = toBase32(raw);
  const groups = s.match(/.{1,4}/g) ?? [];
  return ["J1", ...groups].join("-");
};

export const importJournalKeyCode = async (
  code: string
): Promise<CryptoKey> => {
  const cleaned = code.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!cleaned.startsWith("J1"))
    throw new Error("Not a Journlet journal key (expected J1 prefix)");
  const bytes = fromBase32(cleaned.slice(2));
  if (bytes.length !== KEY_BYTES)
    throw new Error("Journal key is the wrong length — check for typos");
  return crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    { name: ALG, length: 256 },
    true,
    ["wrapKey", "unwrapKey"]
  );
};
