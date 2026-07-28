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
 * Update payload format. Version 2 binds each payload to the account and volume
 * it belongs to via AES-GCM additional authenticated data; version 1 did not.
 *
 * Version 1 is not decryptable by this code and never will be. Supporting both
 * would reintroduce exactly the hole the AAD closes: the version byte sits
 * outside the authenticated envelope, so anyone able to write a row could flip
 * a 2 back to a 1 and have the client decrypt it with no binding checked at
 * all. A v1 payload therefore raises LegacyPayloadError and is skipped.
 *
 * Existing v1 rows are not migrated in place — the update log is append-only by
 * design. They are simply never read again: on first sync after the upgrade the
 * client finds nothing it can decrypt, so the ordinary reconcile push writes the
 * whole local journal back as a single v2 payload. See store/sync.ts.
 */
export const PAYLOAD_VERSION = 2;

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
// Layout: [version:1][iv:12][ciphertext]

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

// Canonical, unambiguous, and versioned. The version is baked in rather than
// read from the payload, so the version byte outside the envelope cannot be
// used to select a weaker binding: a flipped byte is either refused as legacy
// or fails authentication.
const additionalData = (ctx: PayloadContext): Uint8Array =>
  new TextEncoder().encode(
    `journlet/${PAYLOAD_VERSION}\nuser=${ctx.userId}\nvolume=${ctx.volume}`
  );

export const encryptUpdate = async (
  dataKey: CryptoKey,
  update: Uint8Array,
  ctx: PayloadContext
): Promise<Uint8Array> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: ALG,
        iv,
        additionalData: additionalData(ctx) as BufferSource,
      },
      dataKey,
      update as BufferSource
    )
  );
  const out = new Uint8Array(1 + IV_BYTES + ct.length);
  out[0] = PAYLOAD_VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + IV_BYTES);
  return out;
};

export const decryptUpdate = async (
  dataKey: CryptoKey,
  payload: Uint8Array,
  ctx: PayloadContext
): Promise<Uint8Array> => {
  if (payload[0] < PAYLOAD_VERSION) throw new LegacyPayloadError(payload[0]);
  if (payload[0] !== PAYLOAD_VERSION)
    throw new Error(`Unsupported payload version ${payload[0]}`);
  const iv = payload.slice(1, 1 + IV_BYTES);
  const ct = payload.slice(1 + IV_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: ALG,
        iv: iv as BufferSource,
        additionalData: additionalData(ctx) as BufferSource,
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
