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

const DB_NAME = "journlet-keys";
const STORE = "keys";
const RING_KEY = "ring-v1";

export interface KeyRing {
  keeperKey: CryptoKey;
  dataKey: CryptoKey;
  wrapped: WrappedDataKey;
  createdAt: number;
  // Account whose remote journal this keeper key has actually unwrapped at
  // least once. This is what separates "never linked" from "was linked and
  // has been locked out": a fresh device and a revoked device both fail to
  // unwrap the server blob, and only this field tells them apart. Absent on
  // rings written before it existed, which reads as never-verified and so
  // degrades to the ordinary needs-key prompt — the safe direction.
  verifiedUserId?: string;
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
