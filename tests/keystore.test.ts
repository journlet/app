// Device keyring tests (spec §6 / remediation item 11). The ring is
// generated silently on first launch and persists across loads; an explicit
// sign-out wipe must erase it so the next launch starts from fresh keys.

import { describe, expect, test } from "vitest";
import { ensureKeys, wipeKeys } from "../src/lib/keystore.ts";
import { currentDataKey } from "../src/lib/keyring.ts";

const rawKey = (k: CryptoKey): Promise<ArrayBuffer> =>
  crypto.subtle.exportKey("raw", k);

const bytes = (b: ArrayBuffer): string => Array.from(new Uint8Array(b)).join(",");

describe("keystore", () => {
  test("ensureKeys generates a ring and returns the same one across calls", async () => {
    const first = await ensureKeys();
    expect(first.keeperKey).toBeInstanceOf(CryptoKey);
    expect(currentDataKey(first)).toBeInstanceOf(CryptoKey);
    expect(first.wrapped).toBeTruthy();
    // A fresh account has never rotated, so it holds exactly epoch 0.
    expect(first.epoch).toBe(0);
    expect([...first.dataKeys.keys()]).toEqual([0]);

    const again = await ensureKeys();
    // Same persisted ring: identical data key material and creation time.
    expect(again.createdAt).toBe(first.createdAt);
    expect(bytes(await rawKey(currentDataKey(again) as CryptoKey))).toBe(
      bytes(await rawKey(currentDataKey(first) as CryptoKey))
    );
  });

  test("wipeKeys erases the ring so the next ensureKeys generates fresh keys", async () => {
    const before = await ensureKeys();
    const beforeData = bytes(await rawKey(currentDataKey(before) as CryptoKey));

    await wipeKeys();

    const after = await ensureKeys();
    const afterData = bytes(await rawKey(currentDataKey(after) as CryptoKey));
    // A brand-new random data key — the wiped journal is unrecoverable
    // locally, exactly as on a first launch.
    expect(afterData).not.toBe(beforeData);
  });
});
