// What to say when enrolling a passkey does not work (spec §6.1e).
//
// Pulled out of ui/PasskeySetup.tsx when the first-run screen needed the same three
// sentences (§12.1 phase 5). Two copies of wording this careful would have drifted,
// and the drift would be invisible: both screens are reached rarely, and the two
// failures they describe are the ones the spec insists must not read as faults.

import { CredentialRefusedError, PrfUnsupportedError } from "./prf";

/**
 * The refusal, which is the one where trying again is the advice.
 *
 * WebAuthn reports cancelling, timing out and iCloud Keychain being switched off
 * identically and on purpose — telling them apart would be a way to probe
 * somebody's settings — so this offers the possibilities rather than asserting one.
 */
const REFUSED =
  "Nothing was set up and nothing has changed. That is what you see if the prompt was cancelled or timed out — or, in Safari on a Mac, if iCloud Keychain is switched off, which stops one being created at all. The system does not say which, on purpose.";

/**
 * A credential manager without the extension, which retrying will not fix.
 *
 * The credential is real and works for signing in; this manager simply does not
 * implement PRF, and the answer is another route rather than another attempt. It
 * also owns up to the credential left behind, because pretending it cleaned up
 * would be the easier lie.
 */
const UNSUPPORTED =
  "That passkey was created, but this password manager cannot produce the secret Journlet needs, so nothing was saved. A limit of the password manager rather than a fault, and retrying will not change it. Delete the passkey it just made; your journal key still opens this journal, and a passkey in a different password manager would too.";

/**
 * What to put on the screen for a failed enrolment.
 *
 * Anything else keeps its own words — a refused insert is the likely case, and its
 * message is the only detail anybody could act on, so inventing a friendlier
 * sentence would hide it.
 */
export const enrolFailureMessage = (e: unknown): string => {
  if (e instanceof PrfUnsupportedError) return UNSUPPORTED;
  if (e instanceof CredentialRefusedError) return REFUSED;
  return e instanceof Error ? e.message : "The passkey was not set up.";
};
