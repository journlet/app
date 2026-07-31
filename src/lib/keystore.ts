// Device key store: the keyring lives in its own IndexedDB database and is
// created silently on first launch — no prompts, nothing to remember
// (spec §11 Q4 decision). CryptoKey objects are structured-cloneable, so
// they persist directly without ever touching string form.

import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "./crypto";
import type { WrappedDataKey } from "./crypto";
import { generateDeviceKeyPair } from "./deviceKeys";

const DB_NAME = "journlet-keys";
const STORE = "keys";
const RING_KEY = "ring-v1";
const PAIR_KEY = "device-pair-v1";

export interface KeyRing {
  /**
   * The key the recovery code is made of, and the only thing that can open the
   * account's `journals` row.
   *
   * Optional since approval-based linking (step 3): a device let in by another
   * device is handed the data key directly and never sees this. That is the
   * point rather than a shortcoming — a device that held the keeper key could
   * still read everything after being removed, which would make removing it
   * meaningless. It also means only the device that created the journal, or one
   * linked with the recovery code, can display that code.
   */
  keeperKey?: CryptoKey;
  dataKey: CryptoKey;
  /** The data key wrapped by the keeper key. Present exactly when it is. */
  wrapped?: WrappedDataKey;
  createdAt: number;
}

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
let pairPromise: Promise<CryptoKeyPair> | null = null;

/**
 * This device's own ECDH keypair, generated silently on first launch.
 *
 * A separate record from the keyring, and separate for a reason: the keyring says
 * what this device can read, the keypair says who this device is. A device can
 * have an identity before it has been granted anything, which is exactly the
 * state a device sits in while it waits to be approved.
 */
export const ensureDeviceKeyPair = (): Promise<CryptoKeyPair> => {
  pairPromise ??= (async () => {
    const existing = await idbGet<CryptoKeyPair>(PAIR_KEY);
    if (existing) return existing;
    const pair = await generateDeviceKeyPair();
    await idbPut(PAIR_KEY, pair);
    return pair;
  })();
  return pairPromise;
};

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
  // The device keypair goes with it, because it lives in the same database. That
  // is the right outcome rather than a side effect: a device that has signed out
  // and come back is a fresh trust decision, so it should arrive with a new
  // public key and be approved again on its merits.
  pairPromise = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // no open handles we keep; proceed
  });
};

/** Load the device keyring, generating one silently on first launch. */
export const ensureKeys = (): Promise<KeyRing> => {
  ringPromise ??= (async () => {
    const existing = await idbGet<KeyRing>(RING_KEY);
    if (existing) return existing;
    const keeperKey = await generateKeeperKey();
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(dataKey, keeperKey);
    const ring: KeyRing = { keeperKey, dataKey, wrapped, createdAt: Date.now() };
    await idbPut(RING_KEY, ring);
    return ring;
  })();
  return ringPromise;
};
