// @vitest-environment jsdom
//
// First run, once the journal exists: keeping a way back into it.
//
// This screen used to be a gate — the code on screen, a checkbox to say you had
// saved it, and no way past until you ticked it. §6.1e replaced that, and these
// tests pin the replacement rather than the old shape, because the old shape was
// the mistake: the hardest possible ask at the moment of least investment, which
// buys a ticked box and a screenshot rather than a saved key.
//
// So the assertions are about what it offers and what it refuses to do. The passkey
// leads where it can be done. The code is behind a tap, because a code rendered
// unbidden at first run is a code screenshotted. Nothing is forced. And neither
// route may be described as reissuable, because neither is.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CredentialRefusedError, PrfUnsupportedError } from "../../src/lib/prf";

const CODE = "J1-ABCD-EFGH-IJKL";

let enrol: () => Promise<void> = async () => {};
let usable = true;

vi.mock("../../src/store/sync", () => ({
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
  relyingPartyId: () => "journlet.com",
}));

const { default: RecoveryCodeView } = await import(
  "../../src/ui/RecoveryCodeView"
);
const { keySaved } = await import("../../src/lib/keySaved");

const renderView = async (onContinue = vi.fn()) => {
  render(<RecoveryCodeView code={CODE} onContinue={onContinue} />);
  // The capability probe is async, so wait for the screen it settles into.
  await waitFor(() => expect(screen.getByText(/Keep a way back in/i)).toBeTruthy());
  return onContinue;
};

const revealCode = () =>
  fireEvent.click(screen.getByRole("button", { name: /show my journal key/i }));

beforeEach(() => {
  localStorage.clear();
  enrol = async () => {};
  usable = true;
});
afterEach(cleanup);

describe("what it says", () => {
  test("that nobody can let you back in, operator included", async () => {
    // The server holds ciphertext only, so there is no "forgot my key" path, and a
    // passkey lives in a password manager Journlet cannot see into. Implying
    // otherwise is the most costly dishonesty available on this screen.
    await renderView();

    expect(screen.getByText(/nobody can let you back into it/i)).toBeTruthy();
    expect(screen.getByText(/runs Journlet/i)).toBeTruthy();
  });

  test("what each route is, in terms of where it works", async () => {
    await renderView();

    expect(screen.getByText(/any device your password manager\s+reaches/i))
      .toBeTruthy();
    expect(screen.getByText(/including where passkeys do not reach/i)).toBeTruthy();
  });

  test("and that the reminder is what makes skipping safe", async () => {
    // Named here so leaving is a decision rather than an omission.
    await renderView();

    expect(screen.getByText(/a line there will remind\s+you/i)).toBeTruthy();
  });
});

describe("the passkey, which leads", () => {
  test("is offered first and as the primary action", async () => {
    await renderView();

    const passkey = screen.getByRole("button", { name: /set up a passkey/i });
    expect(passkey.className).toBe("addBtn");
    expect(screen.getByText(/two prompts/i)).toBeTruthy();
  });

  test("confirms, and stops offering itself once done", async () => {
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    await waitFor(() => expect(screen.getByText(/Passkey set up/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /set up a passkey/i })).toBeNull();
  });

  test("a failure says so in the shared words and leaves the code offered", async () => {
    // Both honest failures come from lib/passkeyMessages, so this screen cannot
    // drift from the Sync screen's wording.
    enrol = async () => {
      throw new PrfUnsupportedError();
    };
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    await waitFor(() =>
      expect(screen.getByText(/retrying will not change it/i)).toBeTruthy()
    );
    expect(
      screen.getByRole("button", { name: /show my journal key/i })
    ).toBeTruthy();
  });

  test("a refusal is not dressed up as a fault either", async () => {
    enrol = async () => {
      throw new CredentialRefusedError();
    };
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: /set up a passkey/i }));

    await waitFor(() =>
      expect(screen.getByText(/nothing has changed/i)).toBeTruthy()
    );
  });

  test("and is not offered at all where it cannot be done", async () => {
    // A browser with no platform authenticator, or any host but journlet.com. The
    // code then becomes the only offer rather than the second one, and the screen
    // never mentions a route this device does not have.
    usable = false;
    await renderView();

    expect(screen.queryByRole("button", { name: /set up a passkey/i })).toBeNull();
    expect(screen.getByText(/Your way back in/i)).toBeTruthy();
  });
});

describe("the code, which is belt and braces", () => {
  test("is behind a tap rather than on the screen", async () => {
    // A code rendered unbidden at first run is a code screenshotted, and a
    // screenshot is the worst place it can live.
    await renderView();

    expect(screen.queryByText(CODE)).toBeNull();

    revealCode();

    expect(screen.getByText(CODE)).toBeTruthy();
  });

  test("offers copy and download once shown", async () => {
    await renderView();
    revealCode();

    expect(screen.getByRole("button", { name: /copy to clipboard/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download as file/i })).toBeTruthy();
  });

  test("a download counts as having saved it, so the reminder stops", async () => {
    // The reminder on the Sync screen is a self-report by necessity, but a download
    // is the closest thing to evidence there is, and asking again after one would
    // be the app ignoring what it just watched somebody do.
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.URL.createObjectURL = () => "blob:x";
    globalThis.URL.revokeObjectURL = () => {};
    await renderView();
    revealCode();

    fireEvent.click(screen.getByRole("button", { name: /download as file/i }));

    expect(keySaved()).toBe(true);
    click.mockRestore();
  });

  test("a blocked clipboard changes nothing, including the flag", async () => {
    // Not marking it saved is the point: nothing was saved.
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    await renderView();
    revealCode();

    fireEvent.click(screen.getByRole("button", { name: /copy to clipboard/i }));

    await waitFor(() => expect(keySaved()).toBe(false));
    expect(screen.getByText(CODE)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("what it will not do", () => {
  test("hold the journal hostage to either route", async () => {
    // The change §6.1e asked for. There is no checkbox and no disabled button:
    // whoever wants to start writing can, and the Sync line follows them.
    const onContinue = await renderView();

    const start = screen.getByRole("button", { name: /start journalling/i });
    expect(start.hasAttribute("disabled")).toBe(false);
    fireEvent.click(start);

    expect(onContinue).toHaveBeenCalled();
  });

  test("or ask anybody to tick a box about it", async () => {
    await renderView();

    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
