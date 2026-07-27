// Device keyring tests (spec §6 / remediation item 11). The ring is
// generated silently on first launch and persists across loads; an explicit
// sign-out wipe must erase it so the next launch starts from fresh keys.

import { describe, expect, test } from "vitest";
import { ensureKeys, wipeKeys } from "../src/lib/keystore.ts";

const rawKey = (k: CryptoKey): Promise<ArrayBuffer> =>
  crypto.subtle.exportKey("raw", k);

const bytes = (b: ArrayBuffer): string => Array.from(new Uint8Array(b)).join(",");

describe("keystore", () => {
  test("ensureKeys generates a ring and returns the same one across calls", async () => {
    const first = await ensureKeys();
    expect(first.keeperKey).toBeInstanceOf(CryptoKey);
    expect(first.dataKey).toBeInstanceOf(CryptoKey);
    expect(first.wrapped).toBeTruthy();

    const again = await ensureKeys();
    // Same persisted ring: identical data key material and creation time.
    expect(again.createdAt).toBe(first.createdAt);
    expect(bytes(await rawKey(again.dataKey))).toBe(
      bytes(await rawKey(first.dataKey))
    );
  });

  test("wipeKeys erases the ring so the next ensureKeys generates fresh keys", async () => {
    const before = await ensureKeys();
    const beforeData = bytes(await rawKey(before.dataKey));

    await wipeKeys();

    const after = await ensureKeys();
    const afterData = bytes(await rawKey(after.dataKey));
    // A brand-new random data key — the wiped journal is unrecoverable
    // locally, exactly as on a first launch.
    expect(afterData).not.toBe(beforeData);
  });
});
