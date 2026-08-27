// Whether this device still owes the user a look at the recovery code
// (decision 4, spec device-identity-design.md, 29 July 2026).
//
// Set when this device *creates* the journal, which is the one moment a code
// comes into existence that nobody has seen. A device that links to an existing
// journal is never marked: the code already exists and the person linking has
// just used it.
//
// Local, not in the journal. It is a fact about this device having shown
// something on this screen, not about the journal, and syncing it would make
// one device's acknowledgement silence the prompt on another that had shown
// nobody anything.
import { RECOVERY_PENDING_KEY } from "./storageKeys";


const PENDING_KEY = RECOVERY_PENDING_KEY;

/**
 * Note that a journal has just been created here and its code is unseen.
 *
 * Persisted rather than held in memory because the gap between creating the
 * journal and reading the code off the screen includes any number of ways to
 * close a tab. Losing the flag there would mean a journal whose only recovery
 * credential had never been shown to anyone.
 */
export const markRecoveryPending = (): void => {
  try {
    localStorage.setItem(PENDING_KEY, "1");
  } catch {
    // Storage blocked: the prompt is skipped rather than shown forever. The
    // code is still readable under Sync, which is the fallback either way.
  }
};

export const recoveryPending = (): boolean => {
  try {
    return localStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
};

/** The user has said they have saved it. Asked once, never nagged again. */
export const acknowledgeRecovery = (): void => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do: the prompt reappears next launch, which is the safe
    // direction for a credential this important.
  }
};
