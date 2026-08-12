// @vitest-environment jsdom
//
// Setting up a passkey, on the Sync screen of a device that is already unlocked.
//
// These pin the wording, because the wording is the feature here: the mechanism is
// four calls and a row, and everything that can go wrong with it is something a
// person has to be told plainly rather than protected from. Three sentences in
// particular are load-bearing, and each has its own test — that two prompts are
// coming, that a refusal to create is not a fault, and that a password manager
// without the extension is a limit rather than a bug to retry against.
//
// The negative ones matter as much: a device that cannot wrap the keeper key is
// never offered a button, because an action that cannot work is the no-guessing
// rule broken (spec §4.1).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CredentialRefusedError, PrfUnsupportedError } from "../../src/lib/prf";

let routes = 0;
let enrol: () => Promise<void> = async () => {};
let usable = true;

vi.mock("../../src/store/sync", () => ({
  countPasskeyRoutes: async () => routes,
  enrolPasskey: () => enrol(),
}));

vi.mock("../../src/lib/prf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/prf")>()),
  probeCredentialSupport: async () => ({
    secureContext: true,
    webauthn: usable,
    platformAuthenticator: usable,
    usable,
  }),
}));

const { default: PasskeySetup, capabilityMessage } = await import(
  "../../src/ui/PasskeySetup"
);

const show = async (canEnrol = true) => {
  render(
    <PasskeySetup
      canEnrol={canEnrol}
      boxStyle={{}}
      labelStyle={{}}
      textStyle={{}}
    />
  );
  // The capability probe and the count are both async, so wait for the settled
  // screen rather than asserting on the frame before them.
  await waitFor(() => expect(screen.getByText(/Passkey unlock/i)).toBeTruthy());
};

const button = () => screen.queryByRole("button", { name: /set up a passkey/i });

/** Served from the real host unless a test says otherwise (§12.1's binding rule). */
const servedFrom = (hostname: string): void => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, hostname },
  });
};

beforeEach(() => {
  routes = 0;
  usable = true;
  enrol = async () => {};
  servedFrom("app.journlet.com");
});
afterEach(cleanup);

describe("what it says before anything is pressed", () => {
  test("that two prompts are coming, and that the second is not a failure", async () => {
    // Found while building phase 3a: creating and proving are two sheets, because
    // the eval cannot be attached to a creation on Safari. Unannounced, the second
    // reads as the first having gone wrong.
    await show();

    expect(screen.getByText(/two prompts/i)).toBeTruthy();
    expect(screen.getByText(/not a sign the first failed/i)).toBeTruthy();
  });

  test("that any one passkey opens the journal and none is the main one", async () => {
    // The property Gary asked for, and the reason a second passkey is worth adding
    // rather than a duplicate: many wraps, any one sufficient, none privileged.
    await show();

    expect(screen.getByText(/any single passkey opens it/i)).toBeTruthy();
    expect(screen.getByText(/none is the main one/i)).toBeTruthy();
  });

  test("that the journal key is still worth keeping", async () => {
    // The cost, stated where the feature is offered rather than discovered later:
    // durability moves to the password manager, and the server holds ciphertext
    // only, so losing that manager with no code kept means losing the journal.
    await show();

    expect(screen.getByText(/keep your journal key too/i)).toBeTruthy();
  });

  test("how many routes exist, once there are any", async () => {
    routes = 2;
    await show();

    expect(screen.getByText(/2 passkeys can open this journal/i)).toBeTruthy();
  });

  test("nothing about a count on an account that has none", async () => {
    await show();

    expect(screen.queryByText(/can open this journal/i)).toBeNull();
  });
});

describe("an account that already has one", () => {
  test("leads with that, rather than explaining what a passkey is", async () => {
    // The second hardware report: a reload put the pitch and a full-strength setup
    // button back in front of somebody who had just enrolled, which reads as it not
    // having worked. The count is the durable signal — `done` does not survive a
    // reload — so the box changes shape on the count rather than on the click.
    routes = 1;
    await show();

    expect(screen.getByText(/1 passkey can open this journal/i)).toBeTruthy();
    expect(screen.queryByText(/A passkey opens this journal after a Face ID/i))
      .toBeNull();
    expect(button()).toBeNull();
  });

  test("keeps the explaining behind a labelled control, not on the screen", async () => {
    // Gary, third pass: with a passkey set up, none of the prose is answering a
    // question anybody is asking. One line, and the rest on request.
    routes = 1;
    await show();

    expect(screen.queryByText(/sign in with the same email/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /what this means/i }));

    expect(screen.getByText(/sign in with the same email/i)).toBeTruthy();
    expect(screen.getByText(/Unlock with a passkey/i)).toBeTruthy();
    expect(screen.getByText(/not recorded on\s+the server/i)).toBeTruthy();
  });

  test("but a count it could not read is not treated as a passkey", async () => {
    // countPasskeyRoutes answers null offline or signed out. Claiming a passkey
    // exists on that basis would be the interface asserting something it does not
    // know, which is the failure §6.1b is the account of.
    routes = null as unknown as number;
    await show();

    expect(button()).toBeTruthy();
    expect(screen.queryByText(/can open this journal/i)).toBeNull();
  });
});

describe("when it must not offer the button", () => {
  test("a device that does not hold the journal key, and it says why", async () => {
    // Wrapping needs the keeper key, so a device linked by approval cannot enrol.
    // Same entitlement logic as approving a device (§6.1d).
    await show(false);

    expect(button()).toBeNull();
    expect(screen.getByText(/does not hold the journal key itself/i)).toBeTruthy();
  });

  test("anywhere but journlet.com, because that binding cannot be undone", async () => {
    // A credential is bound for good to the domain it was created against, so one
    // enrolled from the Pages default host or a preview deployment could never open
    // the journal on the real app. §12.1 makes this binding on every phase:
    // disabled there rather than pointed somewhere else.
    servedFrom("journlet.github.io");
    await show();

    expect(button()).toBeNull();
    expect(screen.getByText(/only be set up on journlet.com/i)).toBeTruthy();
  });

  test("a browser that cannot do it at all", async () => {
    usable = false;
    await show();

    expect(button()).toBeNull();
    expect(screen.getByText(/does not support passkeys/i)).toBeTruthy();
  });

  test("and the three reasons are three different sentences", () => {
    // Different answers for the person: an insecure origin is a deployment
    // problem, no WebAuthn wants another browser, no platform authenticator wants
    // another device. One message for all three would send someone after the
    // wrong fix.
    const base = {
      secureContext: true,
      webauthn: true,
      platformAuthenticator: true,
      usable: true,
    };
    expect(capabilityMessage({ ...base, secureContext: false })).toMatch(/https/i);
    expect(capabilityMessage({ ...base, webauthn: false })).toMatch(
      /does not support passkeys/i
    );
    expect(capabilityMessage({ ...base, platformAuthenticator: false })).toMatch(
      /Face ID, Touch ID, Windows Hello or device PIN/i
    );
    expect(capabilityMessage(base)).toBeNull();
  });
});

describe("the two failures that are not faults", () => {
  test("a refusal says nothing changed, and offers the possibilities rather than one", async () => {
    // WebAuthn reports cancelling, timing out and iCloud Keychain being switched
    // off identically, on purpose — telling them apart would be a way to probe
    // someone's settings. So this must not assert which happened.
    enrol = async () => {
      throw new CredentialRefusedError();
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText(/nothing has changed/i)).toBeTruthy()
    );
    expect(screen.getByText(/iCloud Keychain is switched off/i)).toBeTruthy();
    expect(screen.getByText(/does not say which/i)).toBeTruthy();
  });

  test("a password manager without the extension says retrying will not help", async () => {
    // The case that must not read as a bug: the credential is real and works for
    // signing in, this manager simply does not implement PRF, and the answer is
    // another route rather than another attempt. It also owns up to the credential
    // it has just left lying around.
    enrol = async () => {
      throw new PrfUnsupportedError();
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText(/retrying will not change it/i)).toBeTruthy()
    );
    expect(screen.getByText(/nothing was saved/i)).toBeTruthy();
    expect(screen.getByText(/delete the passkey it just made/i)).toBeTruthy();
  });

  test("any other failure is passed on in its own words", async () => {
    // A refused insert, most likely. Inventing a friendlier sentence here would
    // hide the only detail anybody could act on.
    enrol = async () => {
      throw new Error("Could not save the passkey route: refused");
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText(/Could not save the passkey route/i)).toBeTruthy()
    );
  });
});

describe("when it works", () => {
  test("it confirms, and the count says the rest from then on", async () => {
    // The confirmation used to carry the "on another device, choose Unlock with a
    // passkey" sentence, and it was the wrong place for it: `done` is component state
    // and a reload clears it, which is how the pitch came back in front of somebody
    // who had already enrolled. The count is durable, and the how-to sits behind
    // "what this means" for whoever wants it.
    enrol = async () => {
      routes = 1;
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() => expect(screen.getByText(/Passkey set up/i)).toBeTruthy());
    expect(screen.getByText(/1 passkey can open this journal/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /what this means/i }));
    expect(screen.getByText(/Unlock with a passkey/i)).toBeTruthy();
  });

  test("the offer becomes secondary rather than staying the loudest thing", async () => {
    // Reported on the first hardware run: a full-strength "Set up a passkey on this
    // device" under "Passkey set up" reads as the setup not having taken. The offer
    // stays, because a second passkey is what §6.1e wants somebody to add.
    enrol = async () => {
      routes = 1;
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() => expect(button()).toBeNull());
    const again = screen.getByRole("button", { name: /add another passkey/i });
    expect(again.className).toBe("miniBtn");
  });

  test("and the box collapses back to one line rather than staying open", async () => {
    // What the confirmation used to have to say, the count now says permanently.
    enrol = async () => {
      routes = 1;
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText(/1 passkey can open this journal/i)).toBeTruthy()
    );
    expect(screen.queryByText(/two prompts/i)).toBeNull();
  });

  test("adding another asks first, and raises no prompt on that tap", async () => {
    // The warnings have to arrive before the platform sheets do, and keeping them on
    // screen for ever is what made this box a wall. So the first tap explains and the
    // second acts — and the first must not reach the authenticator.
    let calls = 0;
    enrol = async () => {
      calls++;
    };
    routes = 1;
    await show();

    fireEvent.click(screen.getByRole("button", { name: /add another passkey/i }));

    expect(calls).toBe(0);
    expect(screen.getByText(/two prompts/i)).toBeTruthy();
    expect(screen.getByText(/replaces it rather than adding a way in/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /set up another passkey/i }));
    await waitFor(() => expect(calls).toBe(1));
  });

  test("and says where another one helps, and where it would replace instead", async () => {
    // The account id is the WebAuthn user handle, so enrolling again in the same
    // password manager replaces the credential rather than adding one — and leaves
    // the row already written as a route nothing can open. §6.5 forbids the
    // credential id that would let the client tidy up, so this is wording or nothing.
    routes = 1;
    await show();

    fireEvent.click(screen.getByRole("button", { name: /add another passkey/i }));

    expect(screen.getByText(/replaces it rather than adding a way in/i)).toBeTruthy();
    expect(screen.getByText(/another\s+device, or another password manager/i))
      .toBeTruthy();
  });

  test("and counts again, so the screen shows the route it just added", async () => {
    // Read back rather than incremented locally: the count is the server's answer,
    // and a number this screen maintained itself would drift from the table the
    // moment anything else wrote to it.
    let calls = 0;
    enrol = async () => {
      routes = 1;
      calls++;
    };
    await show();

    fireEvent.click(button() as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText(/1 passkey can open this journal/i)).toBeTruthy()
    );
    expect(calls).toBe(1);
  });
});
