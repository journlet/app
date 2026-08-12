// @vitest-environment jsdom
//
// The passkey route on a device that cannot read the journal yet.
//
// This is the screen somebody meets after signing in on a new device and being
// shown nothing, so two rules govern all of it. It offers the button only when
// pressing it could work, because a Face ID prompt that ends in "no passkey has
// been set up" is how this gets reported as broken. And every failure names the two
// routes that do work, on the screen, rather than leaving them to be found —
// telling someone to wait for something that cannot arrive is the failure §6.1d
// replaced, and telling them nothing is worse.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CredentialRefusedError, PrfUnsupportedError } from "../../src/lib/prf";

let routes: number | null = 1;
let usable = true;
let unlock: () => Promise<void> = async () => {};

class NoPasskeyRoute extends Error {}
class UnknownCredential extends Error {}

vi.mock("../../src/store/sync", () => ({
  countPasskeyRoutes: async () => routes,
  unlockWithPasskey: () => unlock(),
  NoPasskeyRouteError: NoPasskeyRoute,
  UnknownCredentialError: UnknownCredential,
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

const { default: PasskeyUnlock } = await import("../../src/ui/PasskeyUnlock");

const button = () => screen.queryByRole("button", { name: /unlock with a passkey/i });

const show = async (): Promise<void> => {
  render(<PasskeyUnlock textStyle={{}} />);
  // Both questions it asks are async. Settling on "no button" and settling on "a
  // button" are different outcomes, so each caller asserts which it expected.
  await waitFor(() => expect(document.body).toBeTruthy());
  await Promise.resolve();
};

beforeEach(() => {
  routes = 1;
  usable = true;
  unlock = async () => {};
});
afterEach(cleanup);

describe("when it offers nothing at all", () => {
  test("an account with no passkey set up", async () => {
    // Nothing rendered rather than a disabled button with an explanation: on this
    // screen the journal key and approval are the routes, and a dead control above
    // them is noise at the worst moment.
    routes = 0;
    await show();

    await waitFor(() => expect(button()).toBeNull());
  });

  test("a browser that cannot use one, even though the account has one", async () => {
    usable = false;
    await show();

    await waitFor(() => expect(button()).toBeNull());
  });

  test("a count that could not be read, which is not the same as zero", async () => {
    // countPasskeyRoutes answers null when there is no session or no sync. Guessing
    // that as "you have one" would raise a sheet against a table it cannot read.
    routes = null;
    await show();

    await waitFor(() => expect(button()).toBeNull());
  });
});

describe("when it does offer it", () => {
  test("the button says what it does, and what to expect", async () => {
    await show();

    await waitFor(() => expect(button()).toBeTruthy());
    expect(screen.getByText(/Face ID, Touch ID or your device PIN/i)).toBeTruthy();
    expect(screen.getByText(/nothing to type/i)).toBeTruthy();
  });

  test("success says nothing, because the screen it is on goes", async () => {
    await show();
    await waitFor(() => expect(button()).toBeTruthy());

    fireEvent.click(button() as HTMLElement);

    // The label reverts from "waiting…" once the call settles, so this is the
    // finished state rather than the frame before it.
    await waitFor(() => expect(button()).toBeTruthy());
    expect(screen.queryByText(/journal key below/i)).toBeNull();
    expect(screen.queryByText(/nothing has changed/i)).toBeNull();
  });
});

describe("the four ways it fails, each with a way on", () => {
  const failWith = async (e: Error) => {
    unlock = async () => {
      throw e;
    };
    await show();
    await waitFor(() => expect(button()).toBeTruthy());
    fireEvent.click(button() as HTMLElement);
  };

  test("a passkey from a different password manager, and why that happens", async () => {
    // The ordinary answer on a device from another ecosystem, and the case §6.1e
    // adds a second wrap for. Worth explaining rather than just refusing: "not one
    // of the ones set up" sounds like an accusation without the reason.
    await failWith(new UnknownCredential());

    await waitFor(() =>
      expect(screen.getByText(/not one of the ones set up for this journal/i))
        .toBeTruthy()
    );
    expect(screen.getByText(/do not share passkeys with each other/i)).toBeTruthy();
    expect(screen.getByText(/journal key below/i)).toBeTruthy();
    expect(screen.getByText(/approve this device/i)).toBeTruthy();
  });

  test("a password manager without the extension, which retrying will not fix", async () => {
    await failWith(new PrfUnsupportedError());

    await waitFor(() =>
      expect(screen.getByText(/retrying will not change it/i)).toBeTruthy()
    );
    expect(screen.getByText(/journal key below/i)).toBeTruthy();
  });

  test("a refusal, which is the one where trying again is the advice", async () => {
    // Cancelled or timed out. Distinct from the two above precisely because the
    // answer is the opposite one, and a single message for all three would send
    // someone to type sixteen characters when they had fat-fingered a sheet.
    await failWith(new CredentialRefusedError());

    await waitFor(() =>
      expect(screen.getByText(/nothing has changed/i)).toBeTruthy()
    );
    expect(screen.getByText(/try again/i)).toBeTruthy();
  });

  test("no route at all, if the account lost its last one meanwhile", async () => {
    // Guarded against by the count, so this needs the table to have changed since
    // the screen loaded. It still has to say something true.
    await failWith(new NoPasskeyRoute());

    await waitFor(() =>
      expect(screen.getByText(/No passkey has been set up/i)).toBeTruthy()
    );
    expect(screen.getByText(/journal key below/i)).toBeTruthy();
  });

  test("and anything else is passed on rather than renamed", async () => {
    await failWith(new Error("Could not read the passkey routes: refused"));

    await waitFor(() =>
      expect(screen.getByText(/Could not read the passkey routes/i)).toBeTruthy()
    );
  });
});
