// Round-trip and tamper tests for the E2EE primitives (spec §6).
// The server must only ever hold ciphertext, so these guard that wrapping,
// unwrapping, authenticated encryption and the journal key code all behave.

import { beforeAll, describe, expect, test } from "vitest";
import {
  decryptUpdate,
  encryptUpdate,
  exportJournalKeyCode,
  generateDataKey,
  generateKeeperKey,
  importJournalKeyCode,
  LegacyPayloadError,
  PAYLOAD_VERSION,
  unwrapDataKey,
  wrapDataKey,
} from "../src/lib/crypto.ts";
import type { PayloadContext, WrappedDataKey } from "../src/lib/crypto.ts";

const CTX: PayloadContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  volume: "v1",
};

// Shared fixtures: a keeper key, a data key, and the data key wrapped by the
// keeper. Built once so the individual cases stay focused on one behaviour.
let keeper: CryptoKey;
let data: CryptoKey;
let wrapped: WrappedDataKey;
let payload: Uint8Array;
let update: Uint8Array;

beforeAll(async () => {
  keeper = await generateKeeperKey();
  data = await generateDataKey();
  wrapped = await wrapDataKey(data, keeper);
  update = crypto.getRandomValues(new Uint8Array(1024));
  payload = await encryptUpdate(data, update, CTX);
});

describe("data key wrapping", () => {
  test("wrap -> unwrap yields a working data key", async () => {
    const unwrapped = await unwrapDataKey(wrapped, keeper);
    const back = await decryptUpdate(unwrapped, payload, CTX);
    expect(back).toEqual(update);
  });

  test("wrong keeper key cannot unwrap the data key", async () => {
    const stranger = await generateKeeperKey();
    await expect(unwrapDataKey(wrapped, stranger)).rejects.toBeTruthy();
  });

  // The wrapped-key blob format is independent of the payload format and was
  // not changed by the AAD work; pinned so a future payload bump cannot
  // silently relabel keys already stored on the server.
  test("wrapped key still carries format version 1", () => {
    expect(wrapped.v).toBe(1);
  });
});

describe("authenticated encryption", () => {
  test("payload carries the version byte", () => {
    expect(payload[0]).toBe(PAYLOAD_VERSION);
    expect(PAYLOAD_VERSION).toBe(2);
  });

  test("payload is longer than the plaintext (iv + ciphertext + tag)", () => {
    expect(payload.length).toBeGreaterThan(update.length);
  });

  test("encrypt -> decrypt round trip", async () => {
    const back = await decryptUpdate(data, payload, CTX);
    expect(back).toEqual(update);
  });

  test("tampered payload is rejected (GCM auth)", async () => {
    const tampered = payload.slice();
    tampered[20] ^= 0xff;
    await expect(decryptUpdate(data, tampered, CTX)).rejects.toBeTruthy();
  });

  test("a different data key cannot read it", async () => {
    const stranger = await generateDataKey();
    await expect(decryptUpdate(stranger, payload, CTX)).rejects.toBeTruthy();
  });
});

// The point of the AAD: ciphertext is useless anywhere other than exactly where
// it was written. A hostile or compromised server cannot move a blob into
// another notebook or replay it into another account and have it decrypt.
describe("payloads are bound to their account and volume", () => {
  test("a blob moved to another volume will not decrypt", async () => {
    await expect(
      decryptUpdate(data, payload, { ...CTX, volume: "v2" })
    ).rejects.toBeTruthy();
  });

  test("a blob replayed into another account will not decrypt", async () => {
    await expect(
      decryptUpdate(data, payload, {
        ...CTX,
        userId: "22222222-2222-4222-8222-222222222222",
      })
    ).rejects.toBeTruthy();
  });

  test("both wrong is no better", async () => {
    await expect(
      decryptUpdate(data, payload, { userId: "someone-else", volume: "v9" })
    ).rejects.toBeTruthy();
  });

  test("the same plaintext in two volumes yields unrelated ciphertext", async () => {
    const a = await encryptUpdate(data, update, { ...CTX, volume: "v1" });
    const b = await encryptUpdate(data, update, { ...CTX, volume: "v2" });
    expect(a).not.toEqual(b);
  });

  test("a fresh IV is used every time", async () => {
    const a = await encryptUpdate(data, update, CTX);
    const b = await encryptUpdate(data, update, CTX);
    expect(a.slice(1, 13)).not.toEqual(b.slice(1, 13));
  });
});

// Version 1 must never decrypt, whatever the byte says. Supporting it would
// reopen the hole the AAD closes, because the version byte is outside the
// authenticated envelope and so is freely editable by whoever holds the row.
describe("the retired payload format", () => {
  test("a version 1 payload raises LegacyPayloadError", async () => {
    const legacy = payload.slice();
    legacy[0] = 1;
    await expect(decryptUpdate(data, legacy, CTX)).rejects.toBeInstanceOf(
      LegacyPayloadError
    );
  });

  test("downgrading a v2 payload does not bypass the binding", async () => {
    // The attack this blocks: flip the byte to 1 and hope the client decrypts
    // with no AAD checked. It must be refused, not decrypted.
    const downgraded = await encryptUpdate(data, update, CTX);
    downgraded[0] = 1;
    await expect(decryptUpdate(data, downgraded, CTX)).rejects.toBeInstanceOf(
      LegacyPayloadError
    );
  });

  test("an unknown future version is refused but not called legacy", async () => {
    const future = payload.slice();
    future[0] = 9;
    const err = await decryptUpdate(data, future, CTX).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LegacyPayloadError);
  });
});

describe("journal key code", () => {
  test("export produces the expected J1-XXXX format", async () => {
    const code = await exportJournalKeyCode(keeper);
    expect(code).toMatch(/^J1(-[0-9A-Z]{1,4})+$/);
  });

  test("code round trip unlocks the same data key", async () => {
    const code = await exportJournalKeyCode(keeper);
    const reimported = await importJournalKeyCode(code);
    const unwrapped = await unwrapDataKey(wrapped, reimported);
    const back = await decryptUpdate(unwrapped, payload, CTX);
    expect(back).toEqual(update);
  });

  test("lowercase and spaced entry is forgiven", async () => {
    const code = await exportJournalKeyCode(keeper);
    const sloppy = code.toLowerCase().replace(/-/g, " ");
    await expect(importJournalKeyCode(sloppy)).resolves.toBeTruthy();
  });
});
