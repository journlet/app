// What a device's keyring *is*, and how to read a key out of it.
//
// Separate from keystore.ts, which is about persistence. The split is not
// cosmetic: every sync test mocks the keystore, so anything living there has to
// be restated in six mock factories, and a pure function that reads a Map has no
// business being restated anywhere. Putting the accessors here means a test that
// stubs storage still gets the real logic for choosing a key.

import type { WrappedDataKey } from "./crypto";

export interface KeyRing {
  /**
   * The key the recovery code is made of, and the only thing that can open the
   * account's `journals` row.
   *
   * Optional since approval-based linking (step 3): a device let in by another
   * device is handed the data key directly and never sees this. That is the point
   * rather than a shortcoming — a device that held the keeper key could still
   * read everything after being removed, which would make removing it
   * meaningless. It also means only the device that created the journal, or one
   * linked with the recovery code, can display that code.
   */
  keeperKey?: CryptoKey;
  /**
   * Every data key this device holds, by epoch. All of them are retained: a
   * rotated-away key is the only thing that can read the stretch of journal
   * written under it, and a journal you cannot read the start of is not a
   * journal.
   *
   * A Map rather than a record because it structured-clones into IndexedDB as
   * cleanly as the CryptoKeys inside it do.
   */
  dataKeys: Map<number, CryptoKey>;
  /**
   * The epoch this device writes under, and the key it uses: `dataKeys.get(epoch)`.
   *
   * Zero on an account that has never rotated, which is every account until
   * someone removes a device.
   */
  epoch: number;
  /** The epoch 0 data key wrapped by the keeper key. Present exactly when it is. */
  wrapped?: WrappedDataKey;
  createdAt: number;
}

/**
 * The key this device should encrypt with, or undefined if it does not hold one
 * for its own epoch.
 *
 * Undefined is a real state rather than an error: a device that was offline
 * during a rotation knows the epoch has moved on before it has been given the
 * key. It must not fall back to an older key — writing under a superseded epoch
 * would produce rows every up-to-date device can read but none would write
 * beside, which is a fork rather than a failure.
 */
export const currentDataKey = (ring: KeyRing): CryptoKey | undefined =>
  ring.dataKeys.get(ring.epoch);

/** The key for one stored row's epoch, or undefined if this device lacks it. */
export const dataKeyFor = (
  ring: KeyRing,
  epoch: number
): CryptoKey | undefined => ring.dataKeys.get(epoch);
