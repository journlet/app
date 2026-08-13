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
/** Whether this device has a built-in check. Independent of `usable` since 12 Aug. */
let localCheck = true;
/** Ids the store was told to delete, and what replacing does when it is called. */
let replaced = 0;
let replace: () => Promise<void> = async () => {
  replaced++;
  routes = 1;
};

/** What the register says about each saved route, and what removal did. */
let routeRows: { wrapId: string; note: Record<string, unknown> | null }[] = [];
let strayRows: Record<string, unknown>[] = [];
let removed: string[] = [];
let forgotten: string[] = [];

vi.mock("../../src/store/sync", () => ({
  countPasskeyRoutes: async () => routes,
  enrolPasskey: () => enrol(),
  replaceAllPasskeys: () => replace(),
  listPasskeyRoutes: async () => ({ routes: routeRows, strays: strayRows }),
  removePasskeyRoute: async (wrapId: string) => {
    removed.push(wrapId);
    routeRows = routeRows.filter((r) => r.wrapId !== wrapId);
    routes = routeRows.length;
  },
}));

// Partial, so describeRoute and onCredentialsChange stay real: the wording of a row
// is the thing under test and forgetting is the only part that touches the document.
vi.mock("../../src/store/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/credentials")>()),
  forgetCredentialNote: (wrapId: string) => {
    forgotten.push(wrapId);
    strayRows = strayRows.filter((s) => s.wrapId !== wrapId);
    return true;
  },
}));

vi.mock("../../src/lib/prf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/prf")>()),
  probeCredentialSupport: async () => ({
    secureContext: true,
    webauthn: usable,
    platformAuthenticator: localCheck,
    usable,
  }),
}));

const {
  default: PasskeySetup,
  capabilityMessage,
  noLocalCheckNote,
} = await import("../../src/ui/PasskeySetup");

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

/** Open the list of saved routes, which is loaded on request rather than with the box. */
const openList = async () => {
  fireEvent.click(screen.getByRole("button", { name: /which passkeys are these/i }));
  // All, not one: an account with two routes has two remove buttons, and a query
  // for a single one throws rather than waiting.
  await waitFor(() =>
    expect(
      screen.queryAllByRole("button", { name: /^remove$/i }).length
    ).toBeGreaterThan(0)
  );
};

beforeEach(() => {
  routeRows = [];
  strayRows = [];
  removed = [];
  forgotten = [];
  routes = 0;
  usable = true;
  localCheck = true;
  enrol = async () => {};
  replaced = 0;
  replace = async () => {
    replaced++;
    routes = 1;
  };
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
    // The limit narrowed on 13 August 2026 rather than going away: the register
    // (§6.1l) can now say what a route is, and still nothing about it is on the
    // server, and it still cannot say whether a route lives in this browser.
    expect(
      screen.getByText(/is\s+recorded on the server/i)
    ).toBeTruthy();
    expect(
      screen.getByText(/cannot tell you whether one of them is in this\s+browser/i)
    ).toBeTruthy();
  });

  test("and the explaining includes which manager covers a borrowed computer", async () => {
    // Measured on 13 August 2026 (§6.1k): one credential yields a different secret
    // when a browser reaches it directly and when it is reached by scanning a code
    // from another device, and the device's own manager was the one consistent across
    // both. So this is advice somebody can act on before they are stuck, rather than
    // another failure message after they are. Behind "what this means", because it is
    // nuance rather than the one line the box exists to show.
    routes = 1;
    await show();

    expect(screen.queryByText(/iCloud Keychain/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /what this means/i }));

    expect(screen.getByText(/device's own manager/i)).toBeTruthy();
    expect(screen.getByText(/borrowed computer/i)).toBeTruthy();
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

describe("starting again with one passkey (spec §11 Q13, phase 6)", () => {
  test("is offered only once there is something to replace", async () => {
    await show();
    expect(screen.queryByRole("button", { name: /start again/i })).toBeNull();

    cleanup();
    routes = 2;
    await show();

    expect(screen.getByRole("button", { name: /start again/i })).toBeTruthy();
  });

  test("says what it does not do, before it does anything", async () => {
    // The sentence Q13 turns on. Removing rows withdraws stored routes and takes
    // nothing back, and saying so afterwards would be the lost-device feature of
    // 28 July over again.
    routes = 2;
    await show();

    fireEvent.click(screen.getByRole("button", { name: /start again/i }));

    expect(replaced).toBe(0);
    expect(screen.getByText(/does\s+not take the key back from a device/i))
      .toBeTruthy();
    expect(screen.getByText(/journal key does not change/i)).toBeTruthy();
    expect(screen.getByText(/deleted from a password manager/i)).toBeTruthy();
  });

  test("and only then replaces, saying that the old routes went", async () => {
    routes = 2;
    await show();
    fireEvent.click(screen.getByRole("button", { name: /start again/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /start again with one passkey/i })
    );

    await waitFor(() => expect(replaced).toBe(1));
    expect(screen.getByText(/older routes removed/i)).toBeTruthy();
    expect(screen.getByText(/1 passkey can open this journal/i)).toBeTruthy();
  });

  test("a failure there says the same three things as any other enrolment", async () => {
    // It goes through the same wording, because from the person's side it is the
    // same two sheets. Nothing is deleted when they do not complete.
    routes = 2;
    replace = async () => {
      throw new CredentialRefusedError();
    };
    await show();
    fireEvent.click(screen.getByRole("button", { name: /start again/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /start again with one passkey/i })
    );

    await waitFor(() =>
      expect(screen.getByText(/nothing has changed/i)).toBeTruthy()
    );
  });

  test("cancelling leaves the account alone", async () => {
    routes = 2;
    await show();
    fireEvent.click(screen.getByRole("button", { name: /start again/i }));

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(replaced).toBe(0);
    expect(screen.getByRole("button", { name: /start again/i })).toBeTruthy();
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

  test("but a device with no built-in check is still offered it, with a note", async () => {
    localCheck = false;
    await show();

    expect(button()).toBeTruthy();
    expect(screen.getByText(/use your phone or a security key/i)).toBeTruthy();
  });

  test("a browser that cannot do it at all", async () => {
    usable = false;
    await show();

    expect(button()).toBeNull();
    expect(screen.getByText(/does not support passkeys/i)).toBeTruthy();
  });

  test("and the two reasons are two different sentences", () => {
    // Different answers for the person: an insecure origin is a deployment problem
    // and no WebAuthn wants another browser. One message for both would send
    // somebody after the wrong fix.
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
    expect(capabilityMessage(base)).toBeNull();
  });

  test("and no built-in check is not one of them", () => {
    // The correction of 12 August. A Mac with no Touch ID was told a passkey "cannot
    // be set up here" and shown no button, while the passkey that would have opened
    // it sat on the phone beside it: the platform offers to use that phone, and this
    // check was refusing the design's central case on its behalf.
    const base = {
      secureContext: true,
      webauthn: true,
      platformAuthenticator: false,
      usable: true,
    };

    expect(capabilityMessage(base)).toBeNull();
    expect(noLocalCheckNote(base)).toMatch(/use your phone or a security key/i);
    expect(noLocalCheckNote({ ...base, platformAuthenticator: true })).toBeNull();
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
    expect(screen.getByText(/never replaces a passkey you\s+already have/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /set up another passkey/i }));
    await waitFor(() => expect(calls).toBe(1));
  });

  test("and says where another one helps, without a warning that no longer applies", async () => {
    // It used to say that enrolling again in the same password manager replaced the
    // credential, which was true while the account id was the user handle. Handles
    // became unique per enrolment on 13 August 2026 — after that replacement quietly
    // destroyed a working route — so this asserts the reassurance and the absence of
    // the old warning, since copy describing an impossible failure is its own fault.
    routes = 1;
    await show();

    fireEvent.click(screen.getByRole("button", { name: /add another passkey/i }));

    expect(screen.getByText(/never replaces a passkey you\s+already have/i)).toBeTruthy();
    expect(screen.getByText(/another\s+device, or another password manager/i))
      .toBeTruthy();
    expect(screen.queryByText(/replaces it rather than adding a way in/i)).toBeNull();
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

describe("the list of saved routes (§6.1l)", () => {
  const NAMED = {
    wrapId: "w-new",
    note: {
      wrapId: "w-new",
      enrolledAt: Date.now(),
      enrolledOn: "Installed app (macOS)",
      enrolledRoute: "this device",
      lastOpenedAt: Date.now(),
      lastOpenedOn: "Safari (iOS)",
      lastOpenedRoute: "another device",
    },
  };

  test("reloads after starting again, rather than keeping the route it removed", async () => {
    // The bug this exists for, found on hardware within minutes of shipping: the list
    // held its loaded copy, so after "start again" the wrap that had just been deleted
    // was still on screen, described as "not recognised" because it predated the
    // register, with a remove button pointing at a row the server no longer had.
    routes = 1;
    routeRows = [{ wrapId: "w-old", note: null }];
    replace = async () => {
      routes = 1;
      routeRows = [NAMED];
    };
    await show();
    await openList();
    expect(screen.getByText("Not recognised")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^start again$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /start again with one passkey/i })
    );

    await waitFor(() =>
      expect(screen.getByText(/Set up on Installed app \(macOS\)/i)).toBeTruthy()
    );
    // The old row is gone rather than sitting above the new one.
    expect(screen.queryByText("Not recognised")).toBeNull();
  });

  test("does not open the list for somebody who never asked for it", async () => {
    // The reload is for a list already showing. Enrolling must not unfurl one.
    routes = 1;
    routeRows = [NAMED];
    await show();

    fireEvent.click(screen.getByRole("button", { name: /add another passkey/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /set up another passkey/i })
    );

    await waitFor(() => expect(screen.getByText(/Passkey set up/i)).toBeTruthy());
    expect(
      screen.getByRole("button", { name: /which passkeys are these/i })
    ).toBeTruthy();
  });

  test("says where and how a route was last opened", async () => {
    // Both facts were recorded from the first day and neither was shown, so a phone
    // opening a wrap enrolled on the Mac read as a bare timestamp. The route is the
    // part §6.1k makes load-bearing.
    routes = 1;
    routeRows = [NAMED];
    await show();
    await openList();

    expect(
      screen.getByText(/last opened .* on Safari \(iOS\), with a passkey from another device/i)
    ).toBeTruthy();
  });

  test("a route that has never opened the journal says exactly that", async () => {
    routes = 1;
    routeRows = [{ wrapId: "w1", note: null }];
    await show();
    await openList();

    expect(
      screen.getByText(/has not opened this journal on any device yet/i)
    ).toBeTruthy();
  });

  test("picks up a row another device filled in, without being reopened", async () => {
    // The register arrives over sync, so the event that names a row is usually a
    // *different* device unlocking. Until this was wired the list held whatever it had
    // fetched, and a phone opening a wrap enrolled here changed nothing on screen.
    const { noteUnlock } = await import("../../src/store/credentials");
    routes = 1;
    routeRows = [{ wrapId: "w1", note: null }];
    await show();
    await openList();
    expect(screen.getByText("Not recognised")).toBeTruthy();

    // What a sync delivers: the register changes under the screen.
    routeRows = [NAMED];
    noteUnlock({ wrapId: NAMED.wrapId, attachment: "cross-platform" });

    await waitFor(() =>
      expect(screen.getByText(/Set up on Installed app \(macOS\)/i)).toBeTruthy()
    );
  });

  test("removing a route corrects the count above it", async () => {
    // Two halves of one box, and each used to refresh only itself: the list could be
    // stale after an enrolment and the count stale after a removal.
    routes = 2;
    routeRows = [
      { wrapId: "w1", note: null },
      NAMED,
    ];
    await show();
    expect(screen.getByText(/2 passkeys can open this journal/i)).toBeTruthy();
    await openList();

    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /remove this route/i }));

    await waitFor(() =>
      expect(screen.getByText(/1 passkey can open this journal/i)).toBeTruthy()
    );
    expect(removed).toEqual(["w1"]);
  });

  test("and says what removal is not, before it happens", async () => {
    // §6.1h's limit has to travel with the action: this withdraws a saved route and
    // takes nothing back from a device that already opened the journal.
    routes = 1;
    routeRows = [NAMED];
    await show();
    await openList();

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(screen.getByText(/keeps its copy/i)).toBeTruthy();
    expect(screen.getByText(/journal key still works/i)).toBeTruthy();
    expect(removed).toEqual([]);
  });
});

describe("notes whose route has gone (§6.1l)", () => {
  const STRAY = {
    wrapId: "w-gone",
    enrolledAt: Date.now(),
    enrolledOn: "Chrome (macOS)",
    enrolledRoute: "this device",
    credentialId: "abcdefghijklmn",
    fingerprint: "0E6BC7E0",
  };

  test("is listed with what was known about it, and can be forgotten", async () => {
    // Forgetting notes with their rows only helps from the day it shipped. Everything
    // orphaned by an earlier "start again" was in the register with nothing able to
    // reach it, which is how the device register got its forget on 12 August.
    routes = 1;
    routeRows = [{ wrapId: "w1", note: null }];
    strayRows = [STRAY];
    await show();
    await openList();

    expect(screen.getByText("No longer a saved route")).toBeTruthy();
    expect(screen.getByText(/was set up on Chrome \(macOS\)/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /forget this note/i }));

    await waitFor(() =>
      expect(screen.queryByText("No longer a saved route")).toBeNull()
    );
    expect(forgotten).toEqual(["w-gone"]);
    // The routes themselves are untouched: forgetting is tidying and nothing else.
    expect(removed).toEqual([]);
    expect(screen.getByText("Not recognised")).toBeTruthy();
  });

  test("does not blame another device for what start again did here", async () => {
    routes = 1;
    routeRows = [{ wrapId: "w1", note: null }];
    strayRows = [STRAY];
    await show();
    await openList();

    expect(screen.getByText(/Removed here or on another device/i)).toBeTruthy();
    expect(screen.queryByText(/most likely removed from another device/i)).toBeNull();
  });

  test("says a row is a passkey rather than a device", async () => {
    // The count above says passkeys and the rows below read as devices, which is how
    // one row and two devices came to look like a fault.
    routes = 1;
    routeRows = [{ wrapId: "w1", note: null }];
    await show();
    await openList();

    expect(
      screen.getByText(/One row for each saved passkey, not for each device/i)
    ).toBeTruthy();
  });
});
