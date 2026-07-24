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
  unwrapDataKey,
  wrapDataKey,
} from "../src/lib/crypto.ts";

// Shared fixtures: a keeper key, a data key, and the data key wrapped by the
// keeper. Built once so the individual cases stay focused on one behaviour.
let keeper: CryptoKey;
let data: CryptoKey;
let wrapped: Uint8Array;
let payload: Uint8Array;
let update: Uint8Array;

beforeAll(async () => {
  keeper = await generateKeeperKey();
  data = await generateDataKey();
  wrapped = await wrapDataKey(data, keeper);
  update = crypto.getRandomValues(new Uint8Array(1024));
  payload = await encryptUpdate(data, update);
});

describe("data key wrapping", () => {
  test("wrap -> unwrap yields a working data key", async () => {
    const unwrapped = await unwrapDataKey(wrapped, keeper);
    const back = await decryptUpdate(unwrapped, payload);
    expect(back).toEqual(update);
  });

  test("wrong keeper key cannot unwrap the data key", async () => {
    const stranger = await generateKeeperKey();
    await expect(unwrapDataKey(wrapped, stranger)).rejects.toBeTruthy();
  });
});

describe("authenticated encryption", () => {
  test("payload carries the version byte", () => {
    expect(payload[0]).toBe(1);
  });

  test("payload is longer than the plaintext (iv + ciphertext + tag)", () => {
    expect(payload.length).toBeGreaterThan(update.length);
  });

  test("encrypt -> decrypt round trip", async () => {
    const back = await decryptUpdate(data, payload);
    expect(back).toEqual(update);
  });

  test("tampered payload is rejected (GCM auth)", async () => {
    const tampered = payload.slice();
    tampered[20] ^= 0xff;
    await expect(decryptUpdate(data, tampered)).rejects.toBeTruthy();
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
    const back = await decryptUpdate(unwrapped, payload);
    expect(back).toEqual(update);
  });

  test("lowercase and spaced entry is forgiven", async () => {
    const code = await exportJournalKeyCode(keeper);
    const sloppy = code.toLowerCase().replace(/-/g, " ");
    await expect(importJournalKeyCode(sloppy)).resolves.toBeTruthy();
  });
});
