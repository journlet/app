// Choosing a key out of the ring (spec/device-identity-design.md, steps 4 and 5).
//
// Tiny, and worth having separately because these two functions are the hinge
// between "rotation happened" and "this device writes under the right key". They
// live outside keystore.ts precisely so the sync tests, which all stub storage,
// still run the real thing.

import { describe, expect, test } from "vitest";
import { currentDataKey, dataKeyFor } from "../src/lib/keyring";
import type { KeyRing } from "../src/lib/keyring";
import { generateDataKey } from "../src/lib/crypto";

const ring = async (epoch: number, epochs: number[]): Promise<KeyRing> => {
  const dataKeys = new Map<number, CryptoKey>();
  for (const e of epochs) dataKeys.set(e, await generateDataKey());
  return { dataKeys, epoch, createdAt: 0 };
};

describe("the key this device writes with", () => {
  test("is the one for its own epoch", async () => {
    const r = await ring(2, [0, 1, 2]);
    expect(currentDataKey(r)).toBe(r.dataKeys.get(2));
  });

  test("is nothing at all when that epoch is missing", async () => {
    // A device that was offline during a rotation. It must not silently fall
    // back to an older key: rows written under a superseded epoch are readable
    // by every up-to-date device and written beside by none, which is a fork
    // rather than an outage. Refusing to write is the correct failure.
    const r = await ring(3, [0, 1, 2]);
    expect(currentDataKey(r)).toBeUndefined();
  });

  test("is not the highest key held, when the account has moved past it", async () => {
    // The specific wrong answer worth naming: "use the newest key I have" looks
    // reasonable and produces exactly the fork above.
    const r = await ring(5, [0, 4]);
    expect(currentDataKey(r)).not.toBe(r.dataKeys.get(4));
    expect(currentDataKey(r)).toBeUndefined();
  });
});

describe("the key for a stored row", () => {
  test("is chosen by the row's own epoch, not the device's", async () => {
    // How history stays readable after a rotation.
    const r = await ring(2, [0, 1, 2]);
    expect(dataKeyFor(r, 0)).toBe(r.dataKeys.get(0));
    expect(dataKeyFor(r, 1)).toBe(r.dataKeys.get(1));
  });

  test("is nothing for an epoch this device was never given", async () => {
    const r = await ring(0, [0]);
    expect(dataKeyFor(r, 9)).toBeUndefined();
  });
});
