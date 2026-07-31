// Per-device key wrapping (spec/device-identity-design.md, step 2).
//
// The property that matters is not "it round-trips" — that would pass with the
// binding removed entirely. It is that a blob wrapped for one device is refused
// by every other device and every other account, which is what makes a shared
// table of ciphertext safe to leave lying around.

import { describe, expect, test } from "vitest";
import { generateDataKey } from "../src/lib/crypto";
import {
  exportDevicePublicKey,
  generateDeviceKeyPair,
  unwrapDataKeyForDevice,
  verificationCode,
  wrapDataKeyForDevice,
} from "../src/lib/deviceKeys";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

const aDevice = async () => {
  const pair = await generateDeviceKeyPair();
  return { pair, publicKey: await exportDevicePublicKey(pair.publicKey) };
};

/** Compare keys by what they can do, since a CryptoKey has no identity. */
const sameKey = async (a: CryptoKey, b: CryptoKey): Promise<boolean> => {
  const [ra, rb] = await Promise.all([
    crypto.subtle.exportKey("raw", a),
    crypto.subtle.exportKey("raw", b),
  ]);
  return new Uint8Array(ra).join() === new Uint8Array(rb).join();
};

describe("handing the data key to one device", () => {
  test("the named device gets the same key back", async () => {
    const dataKey = await generateDataKey();
    const phone = await aDevice();
    const binding = { userId: USER, deviceId: "phone" };

    const wrapped = await wrapDataKeyForDevice(dataKey, phone.publicKey, binding);
    const opened = await unwrapDataKeyForDevice(
      wrapped,
      phone.pair.privateKey,
      binding
    );

    expect(await sameKey(opened, dataKey)).toBe(true);
  });

  test("the key it opens can be used to encrypt, not only held", async () => {
    // An unwrap that produced a key without encrypt/decrypt usage would satisfy
    // the test above and be useless: a device holding it could read the journal
    // but never write, or vice versa. It also has to stay extractable, or this
    // device could never approve the next one.
    const dataKey = await generateDataKey();
    const phone = await aDevice();
    const binding = { userId: USER, deviceId: "phone" };
    const opened = await unwrapDataKeyForDevice(
      await wrapDataKeyForDevice(dataKey, phone.publicKey, binding),
      phone.pair.privateKey,
      binding
    );

    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      opened,
      new TextEncoder().encode("a line in the journal")
    );
    const back = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      dataKey,
      ct
    );
    expect(new TextDecoder().decode(back)).toBe("a line in the journal");
    await expect(crypto.subtle.exportKey("raw", opened)).resolves.toBeTruthy();
  });

  test("another device's private key cannot open it", async () => {
    const dataKey = await generateDataKey();
    const phone = await aDevice();
    const laptop = await aDevice();

    const wrapped = await wrapDataKeyForDevice(dataKey, phone.publicKey, {
      userId: USER,
      deviceId: "phone",
    });

    await expect(
      unwrapDataKeyForDevice(wrapped, laptop.pair.privateKey, {
        userId: USER,
        deviceId: "laptop",
      })
    ).rejects.toThrow();
  });

  test("the right key with the wrong device id is refused", async () => {
    // The binding is what this test exists for. Without it a blob could be
    // moved to another row in the same table and opened there, since every
    // device on the account can write every row.
    const dataKey = await generateDataKey();
    const phone = await aDevice();

    const wrapped = await wrapDataKeyForDevice(dataKey, phone.publicKey, {
      userId: USER,
      deviceId: "phone",
    });

    await expect(
      unwrapDataKeyForDevice(wrapped, phone.pair.privateKey, {
        userId: USER,
        deviceId: "laptop",
      })
    ).rejects.toThrow();
  });

  test("the right key in the wrong account is refused", async () => {
    const dataKey = await generateDataKey();
    const phone = await aDevice();

    const wrapped = await wrapDataKeyForDevice(dataKey, phone.publicKey, {
      userId: USER,
      deviceId: "phone",
    });

    await expect(
      unwrapDataKeyForDevice(wrapped, phone.pair.privateKey, {
        userId: OTHER_USER,
        deviceId: "phone",
      })
    ).rejects.toThrow();
  });

  test("a tampered blob is refused rather than yielding a wrong key", async () => {
    const dataKey = await generateDataKey();
    const phone = await aDevice();
    const binding = { userId: USER, deviceId: "phone" };
    const wrapped = await wrapDataKeyForDevice(dataKey, phone.publicKey, binding);

    const bytes = Uint8Array.from(atob(wrapped.blob), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    const tampered = {
      ...wrapped,
      blob: btoa(String.fromCharCode(...bytes)),
    };

    await expect(
      unwrapDataKeyForDevice(tampered, phone.pair.privateKey, binding)
    ).rejects.toThrow();
  });

  test("every wrap of the same key differs", async () => {
    // Ephemeral ECDH per wrap. Identical blobs would mean a fixed shared secret,
    // which would make the sender's key reusable against every past row.
    const dataKey = await generateDataKey();
    const phone = await aDevice();
    const binding = { userId: USER, deviceId: "phone" };

    const a = await wrapDataKeyForDevice(dataKey, phone.publicKey, binding);
    const b = await wrapDataKeyForDevice(dataKey, phone.publicKey, binding);

    expect(a.blob).not.toBe(b.blob);
    expect(a.epk).not.toBe(b.epk);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    await expect(
      unwrapDataKeyForDevice(b, phone.pair.privateKey, binding)
    ).resolves.toBeTruthy();
  });

  test("a future format version is refused rather than guessed at", async () => {
    const dataKey = await generateDataKey();
    const phone = await aDevice();
    const binding = { userId: USER, deviceId: "phone" };
    const wrapped = await wrapDataKeyForDevice(dataKey, phone.publicKey, binding);

    await expect(
      unwrapDataKeyForDevice({ ...wrapped, v: 2 }, phone.pair.privateKey, binding)
    ).rejects.toThrow(/version 2/);
  });
});

describe("the verification code", () => {
  test("is sixteen characters in four groups", async () => {
    const { publicKey } = await aDevice();
    const code = await verificationCode(publicKey);

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}( [0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(code.replace(/ /g, "")).toHaveLength(16);
  });

  test("avoids the characters that get misread", async () => {
    // Crockford: no I, L, O or U anywhere in the alphabet. Asserted over many
    // codes because a single sample proves nothing about an alphabet.
    for (let i = 0; i < 40; i += 1) {
      const { publicKey } = await aDevice();
      expect(await verificationCode(publicKey)).not.toMatch(/[ILOU]/);
    }
  });

  test("is the same on both devices for the same key", async () => {
    // The entire point: the two screens must agree, or comparing them is
    // meaningless.
    const { publicKey } = await aDevice();
    expect(await verificationCode(publicKey)).toBe(
      await verificationCode(publicKey)
    );
  });

  test("differs between devices", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const { publicKey } = await aDevice();
      codes.add(await verificationCode(publicKey));
    }
    expect(codes.size).toBe(20);
  });

  test("changes completely when one bit of the key changes", async () => {
    // Guards against a "fingerprint" that is really a prefix of the key: that
    // would let a near-miss key show a matching code.
    const { publicKey } = await aDevice();
    const bytes = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    const nudged = btoa(String.fromCharCode(...bytes));

    const a = (await verificationCode(publicKey)).replace(/ /g, "");
    const b = (await verificationCode(nudged)).replace(/ /g, "");
    const shared = [...a].filter((c, i) => c === b[i]).length;

    expect(a).not.toBe(b);
    expect(shared).toBeLessThan(8);
  });
});
