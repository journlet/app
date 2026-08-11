// Wrapping the keeper key for a passkey (spec §6.1e).
//
// The property that matters is not "it round-trips" — that would pass with the
// binding removed entirely, and with every wrap on the account interchangeable.
// There are three, and each one is a thing the design claims out loud:
//
//   1. Any single wrap opens the journal, and none of them is privileged. That is
//      the "one or more, not one, not all" rule, and it is the whole reason the
//      keeper key stops being an irreplaceable string.
//   2. A wrap only opens in the row and the account it was made for, so a table
//      of ciphertext is safe to leave lying around and a hostile server can deny
//      service but not read.
//   3. A row describes nothing. §6.5 allows ciphertext and operational metadata,
//      so the row cannot carry a credential id or a label, which is why unlocking
//      has to work by trying rows rather than by looking one up.

import { describe, expect, test } from "vitest";
import { generateDataKey, generateKeeperKey } from "../src/lib/crypto";
import {
  newWrapId,
  unwrapKeeperKey,
  unwrapKeeperKeyFromAny,
  wrapKeeperKey,
  type KeeperWrapJson,
} from "../src/lib/keeperWrap";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

/**
 * Stands in for the 32 bytes a real authenticator returns.
 *
 * Typed as Uint8Array<ArrayBuffer> rather than plain Uint8Array so it satisfies
 * BufferSource without a cast: a plain one could be backed by a SharedArrayBuffer,
 * which WebCrypto will not take.
 */
const aSecret = (seed: number): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = (seed + i * 7) % 256;
  return out;
};

/** A CryptoKey has no identity, so compare what it is rather than what it is. */
const raw = async (key: CryptoKey): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.exportKey("raw", key))].join(",");

const sameKey = async (a: CryptoKey, b: CryptoKey): Promise<boolean> =>
  (await raw(a)) === (await raw(b));

describe("a wrap opens with the credential that made it", () => {
  test("round trips the keeper key", async () => {
    const keeper = await generateKeeperKey();
    const secret = aSecret(7);
    const wrapId = newWrapId();

    const wrapped = await wrapKeeperKey(keeper, secret, { userId: USER, wrapId });
    const out = await unwrapKeeperKey(wrapped, secret, { userId: USER, wrapId });

    expect(await sameKey(out, keeper)).toBe(true);
  });

  test("the key that comes back can still wrap a data key", async () => {
    // Usages and extractability are not decoration. A keeper key that cannot
    // unwrap is useless, and one that cannot be exported cannot produce the
    // journal key code — which is the thing §6.1e newly promises from any
    // unlocked device.
    const keeper = await generateKeeperKey();
    const wrapId = newWrapId();
    const wrapped = await wrapKeeperKey(keeper, aSecret(1), {
      userId: USER,
      wrapId,
    });

    const out = await unwrapKeeperKey(wrapped, aSecret(1), {
      userId: USER,
      wrapId,
    });

    const dataKey = await generateDataKey();
    await expect(
      crypto.subtle.wrapKey("raw", dataKey, out, {
        name: "AES-GCM",
        iv: new Uint8Array(12),
      })
    ).resolves.toBeTruthy();
    await expect(crypto.subtle.exportKey("raw", out)).resolves.toBeTruthy();
  });

  test("a fresh salt every time, so two wraps of one key differ", async () => {
    const keeper = await generateKeeperKey();
    const secret = aSecret(3);

    const a = await wrapKeeperKey(keeper, secret, {
      userId: USER,
      wrapId: newWrapId(),
    });
    const b = await wrapKeeperKey(keeper, secret, {
      userId: USER,
      wrapId: newWrapId(),
    });

    expect(a.salt).not.toBe(b.salt);
    expect(a.blob).not.toBe(b.blob);
  });
});

describe("a wrap opens nowhere else", () => {
  test("not with a different credential's secret", async () => {
    const keeper = await generateKeeperKey();
    const wrapId = newWrapId();
    const wrapped = await wrapKeeperKey(keeper, aSecret(1), {
      userId: USER,
      wrapId,
    });

    await expect(
      unwrapKeeperKey(wrapped, aSecret(2), { userId: USER, wrapId })
    ).rejects.toThrow();
  });

  test("not under another row's id, so a blob cannot be moved", async () => {
    // The failure this prevents: a server that copies one account's only wrap
    // into a second row cannot make the second row open, so it cannot multiply
    // the routes in, and rotating a wrap id cannot silently keep an old blob
    // alive.
    const keeper = await generateKeeperKey();
    const secret = aSecret(5);
    const wrapped = await wrapKeeperKey(keeper, secret, {
      userId: USER,
      wrapId: newWrapId(),
    });

    await expect(
      unwrapKeeperKey(wrapped, secret, { userId: USER, wrapId: newWrapId() })
    ).rejects.toThrow();
  });

  test("not in another account, so a blob cannot be replayed", async () => {
    const keeper = await generateKeeperKey();
    const secret = aSecret(9);
    const wrapId = newWrapId();
    const wrapped = await wrapKeeperKey(keeper, secret, {
      userId: USER,
      wrapId,
    });

    await expect(
      unwrapKeeperKey(wrapped, secret, { userId: OTHER_USER, wrapId })
    ).rejects.toThrow();
  });

  test("not at a version this code does not understand", async () => {
    // Refused rather than attempted, like a payload version above PAYLOAD_VERSION
    // in lib/crypto.ts. A future format is not a corrupt row and should not be
    // reported as one.
    const keeper = await generateKeeperKey();
    const wrapId = newWrapId();
    const wrapped = await wrapKeeperKey(keeper, aSecret(4), {
      userId: USER,
      wrapId,
    });

    await expect(
      unwrapKeeperKey({ ...wrapped, v: 2 }, aSecret(4), { userId: USER, wrapId })
    ).rejects.toThrow(/version 2/);
  });
});

describe("any one of the wraps is enough", () => {
  /** An account with three credentials enrolled against one keeper key. */
  const anAccount = async () => {
    const keeper = await generateKeeperKey();
    const secrets = [aSecret(11), aSecret(22), aSecret(33)];
    const rows = [];
    for (const secret of secrets) {
      const wrapId = newWrapId();
      rows.push({
        wrapId,
        wrapped: await wrapKeeperKey(keeper, secret, { userId: USER, wrapId }),
      });
    }
    return { keeper, secrets, rows };
  };

  test("each credential opens the same keeper key, and none is privileged", async () => {
    // This is the §6.1e rule in one assertion: unlock with one device or more,
    // not limited to one and not requiring all of them.
    const { keeper, secrets, rows } = await anAccount();

    for (const secret of secrets) {
      const found = await unwrapKeeperKeyFromAny(rows, secret, USER);
      expect(found).not.toBeNull();
      expect(await sameKey(found!.keeperKey, keeper)).toBe(true);
    }
  });

  test("it says which row opened, so the caller can record it", async () => {
    const { secrets, rows } = await anAccount();

    const found = await unwrapKeeperKeyFromAny(rows, secrets[2], USER);

    expect(found?.wrapId).toBe(rows[2].wrapId);
  });

  test("losing two of the three still leaves a way in", async () => {
    // The point of many wraps. Deleting a credential is not a lockout.
    const { keeper, secrets, rows } = await anAccount();

    const found = await unwrapKeeperKeyFromAny([rows[1]], secrets[1], USER);

    expect(await sameKey(found!.keeperKey, keeper)).toBe(true);
  });

  test("an unknown credential gets null rather than an error", async () => {
    // What a device whose password manager holds a different passkey sees. Not a
    // fault: its screen offers the journal key code and approval instead, so this
    // must not throw or it would be reported as something being broken.
    const { rows } = await anAccount();

    await expect(
      unwrapKeeperKeyFromAny(rows, aSecret(99), USER)
    ).resolves.toBeNull();
  });

  test("no wraps at all gets null", async () => {
    // A fresh account, and the signal that the biometric route must not be
    // offered on this screen at all.
    await expect(
      unwrapKeeperKeyFromAny([], aSecret(1), USER)
    ).resolves.toBeNull();
  });

  test("a tampered row is skipped rather than fatal", async () => {
    // A hostile server can replace a blob, which denies service on that row. It
    // must not deny service on the others.
    const { keeper, secrets, rows } = await anAccount();
    const broken = [
      { wrapId: rows[0].wrapId, wrapped: { ...rows[0].wrapped, blob: "AAAA" } },
      rows[1],
    ];

    const found = await unwrapKeeperKeyFromAny(broken, secrets[1], USER);

    expect(await sameKey(found!.keeperKey, keeper)).toBe(true);
  });
});

describe("the row describes nothing (spec §6.5)", () => {
  test("a wrap is exactly a version, a salt, an iv and ciphertext", async () => {
    // Asserted rather than reviewed, because the pressure to add a label here is
    // the same pressure that put "Safari (iOS)" on a link request and kept it
    // there for a fortnight. A credential id would tell the server which password
    // manager somebody uses; a label would name their devices.
    const keeper = await generateKeeperKey();
    const wrapped: KeeperWrapJson = await wrapKeeperKey(keeper, aSecret(8), {
      userId: USER,
      wrapId: newWrapId(),
    });

    expect(Object.keys(wrapped).sort()).toEqual(["blob", "iv", "salt", "v"]);
  });

  test("the wrap id is a plain uuid, carrying nothing about the device", async () => {
    expect(newWrapId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(newWrapId()).not.toBe(newWrapId());
  });
});
