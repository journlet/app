// The three things to say when enrolling a passkey does not work.
//
// Shared by the Sync screen and the first-run screen since phase 5, which is why it
// is a module rather than two copies: both are reached rarely, so drift between them
// would be invisible, and these are the sentences §6.1e insists must not read as
// faults.

import { describe, expect, test } from "vitest";
import { enrolFailureMessage } from "../src/lib/passkeyMessages";
import { CredentialRefusedError, PrfUnsupportedError } from "../src/lib/prf";

describe("what each failure says", () => {
  test("a credential store without PRF: not a fault, and not worth retrying", () => {
    const m = enrolFailureMessage(new PrfUnsupportedError());

    expect(m).toMatch(/retrying will not change it/i);
    expect(m).toMatch(/nothing was saved/i);
    // It owns up to the credential left behind rather than pretending it tidied up.
    expect(m).toMatch(/delete the passkey it just made/i);
  });

  test("a refusal: the possibilities, never an assertion of which", () => {
    // WebAuthn reports cancelling, timing out and iCloud Keychain being off
    // identically and on purpose, since telling them apart would be a way to probe
    // somebody's settings.
    const m = enrolFailureMessage(new CredentialRefusedError());

    expect(m).toMatch(/cancelled or timed out/i);
    expect(m).toMatch(/iCloud Keychain is switched off/i);
    expect(m).toMatch(/does not say which/i);
  });

  test("anything else keeps its own words", () => {
    // A refused insert is the likely case, and its message is the only detail
    // anybody could act on, so a friendlier sentence would hide it.
    expect(enrolFailureMessage(new Error("Could not save the passkey route: refused")))
      .toMatch(/Could not save the passkey route/);
  });

  test("and something that is not an error at all still says something", () => {
    expect(enrolFailureMessage("nonsense")).toMatch(/was not set up/i);
  });
});
