// Device key store: the keyring lives in its own IndexedDB database and is
// created silently on first launch — no prompts, nothing to remember
// (spec §11 Q4 decision). CryptoKey objects are structured-cloneable, so
// they persist directly without ever touching string form.

import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "./crypto";
import type { KeyRing } from "./keyring";

const DB_NAME = "journlet-keys";
const STORE = "keys";
const RING_KEY = "ring-v1";

export type { KeyRing } from "./keyring";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idbGet = async <T>(key: string): Promise<T | undefined> => {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
};

const idbPut = async (key: string, value: unknown): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

let ringPromise: Promise<KeyRing> | null = null;


/** Adopt a keyring from another device (journal key entry on link). */
export const replaceKeyRing = async (ring: KeyRing): Promise<void> => {
  await idbPut(RING_KEY, ring);
  ringPromise = Promise.resolve(ring);
};

/**
 * Erase this device's keyring entirely (explicit sign-out, spec §6 / item
 * 11). The keeper and data keys are gone locally after this; the server
 * still holds only ciphertext, so without the journal key code the wiped
 * journal is unrecoverable on this device. The next ensureKeys() generates
 * a fresh ring silently, as on a first launch.
 */
export const wipeKeys = (): Promise<void> => {
  ringPromise = null;
  // The whole database goes. It held this device's ECDH keypair too until §12.1
  // phase 7 deleted approval, and the point then was that a device signing out and
  // coming back is a fresh trust decision. Nothing about identity survives here now:
  // what is erased is the keyring, and a device comes back by holding a passkey or
  // the journal key like any other.
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // no open handles we keep; proceed
  });
};

/**
 * A ring stored before epochs existed: one `dataKey` and no map.
 *
 * Upgraded on read rather than by a migration step, because there is exactly one
 * possible answer — whatever key it held is epoch 0's, since epoch 0 is by
 * definition everything written before a rotation was possible.
 */
interface PreEpochKeyRing {
  dataKey?: CryptoKey;
}

const withEpochs = (stored: KeyRing & PreEpochKeyRing): KeyRing => {
  if (stored.dataKeys instanceof Map) return stored;
  const dataKeys = new Map<number, CryptoKey>();
  if (stored.dataKey) dataKeys.set(0, stored.dataKey);
  return { ...stored, dataKeys, epoch: 0 };
};

/** Load the device keyring, generating one silently on first launch. */
export const ensureKeys = (): Promise<KeyRing> => {
  ringPromise ??= (async () => {
    const existing = await idbGet<KeyRing & PreEpochKeyRing>(RING_KEY);
    if (existing) {
      const upgraded = withEpochs(existing);
      // Written back so the upgrade happens once rather than on every launch,
      // and so anything reading the record directly sees the current shape.
      if (upgraded !== existing) await idbPut(RING_KEY, upgraded);
      return upgraded;
    }
    const keeperKey = await generateKeeperKey();
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(dataKey, keeperKey);
    const ring: KeyRing = {
      keeperKey,
      dataKeys: new Map([[0, dataKey]]),
      epoch: 0,
      wrapped,
      createdAt: Date.now(),
    };
    await idbPut(RING_KEY, ring);
    return ring;
  })();
  return ringPromise;
};
