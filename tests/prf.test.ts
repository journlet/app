// The two things about PRF that can be tested without an authenticator: which
// domain a credential is bound to, and which of the three outcomes the caller is
// told about.
//
// Everything else in lib/prf.ts is a call into the platform, and this project's
// recurring failure is an assertion pointed at the wrong level, so those parts are
// verified on hardware and listed in the phase 3 checklist rather than mocked into
// looking correct. What is mocked here is only the shape of the answer.

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CredentialRefusedError,
  PrfUnsupportedError,
  createCredential,
  deriveSecret,
  probeCredentialSupport,
  relyingPartyId,
} from "../src/lib/prf";

const ACCOUNT = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "someone@example.invalid",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what a credential is bound to", () => {
  test("the registrable domain, not the hostname it was made on", () => {
    // The finding that cost the 7 August probe a rerun. The site is www and the
    // app is app, so a credential defaulted to its own hostname is invisible to
    // the other one, and this is the string that makes one credential cover both.
    expect(relyingPartyId("app.journlet.com")).toBe("journlet.com");
    expect(relyingPartyId("www.journlet.com")).toBe("journlet.com");
    expect(relyingPartyId("journlet.com")).toBe("journlet.com");
  });

  test("nothing anywhere else, so the platform defaults it", () => {
    // Undefined rather than a guess: a page may only claim a domain it is served
    // from, so claiming journlet.com from localhost is refused outright.
    expect(relyingPartyId("localhost")).toBeUndefined();
    expect(relyingPartyId("127.0.0.1")).toBeUndefined();
  });

  test("and never on the Pages default domain, which is the one-way mistake", () => {
    // Credentials enrolled against journlet.github.io could not follow the app to
    // the custom domain, and the RP ID cannot be changed afterwards (spec §4.7).
    expect(relyingPartyId("journlet.github.io")).toBeUndefined();
  });

  test("not fooled by a hostname that merely ends in the same letters", () => {
    expect(relyingPartyId("notjournlet.com")).toBeUndefined();
    expect(relyingPartyId("journlet.com.example.invalid")).toBeUndefined();
  });
});

describe("what can be known before creating anything", () => {
  test("unusable outside a secure context, whatever else is true", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });

    return expect(probeCredentialSupport()).resolves.toMatchObject({
      secureContext: false,
      usable: false,
    });
  });

  test("unusable with no platform authenticator", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
    });

    await expect(probeCredentialSupport()).resolves.toMatchObject({
      webauthn: true,
      platformAuthenticator: false,
      usable: false,
    });
  });

  test("a probe that throws is an answer, not an error", async () => {
    // Some builds reject rather than resolving false, and a screen that cannot
    // render because a capability check threw is worse than one that offers
    // nothing.
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => {
        throw new Error("no");
      },
    });

    await expect(probeCredentialSupport()).resolves.toMatchObject({
      usable: false,
    });
  });

  test("usable when all three hold", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });

    await expect(probeCredentialSupport()).resolves.toMatchObject({
      usable: true,
    });
  });
});

describe("the three outcomes of asking for a secret", () => {
  const withCredentials = (impl: {
    create?: () => Promise<unknown>;
    get?: () => Promise<unknown>;
  }) =>
    vi.stubGlobal("navigator", {
      credentials: {
        create: impl.create ?? (async () => ({})),
        get: impl.get ?? (async () => null),
      },
    });

  test("a secret comes back as the bytes it is", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    withCredentials({
      get: async () => ({
        getClientExtensionResults: () => ({ prf: { results: { first: bytes } } }),
      }),
    });

    await expect(deriveSecret("journlet.com")).resolves.toBe(bytes);
  });

  test("allowed but no secret is an unsupported credential store", async () => {
    // The case that must not read as a bug. The credential is real and works for
    // signing in; this password manager simply does not implement the extension,
    // and the answer for the person is to use another route rather than retry.
    withCredentials({
      get: async () => ({
        getClientExtensionResults: () => ({ prf: { enabled: false } }),
      }),
    });

    await expect(deriveSecret("journlet.com")).rejects.toBeInstanceOf(
      PrfUnsupportedError
    );
  });

  test("a refusal is a refusal, and does not claim to know why", async () => {
    // NotAllowedError covers cancelling, timing out, and iCloud Keychain being
    // switched off. WebAuthn will not say which, so neither does this.
    withCredentials({
      get: async () => {
        throw new DOMException("nope", "NotAllowedError");
      },
    });

    await expect(deriveSecret("journlet.com")).rejects.toBeInstanceOf(
      CredentialRefusedError
    );
  });

  test("no assertion at all is a refusal too", async () => {
    // navigator.credentials.get resolves null rather than throwing in some
    // conditions, and a null dereference here would be reported as a crash.
    withCredentials({ get: async () => null });

    await expect(deriveSecret("journlet.com")).rejects.toBeInstanceOf(
      CredentialRefusedError
    );
  });

  test("creation failing is a refusal, whatever the platform called it", async () => {
    withCredentials({
      create: async () => {
        throw new DOMException("no keychain", "NotAllowedError");
      },
    });

    await expect(
      createCredential(ACCOUNT, "journlet.com")
    ).rejects.toBeInstanceOf(CredentialRefusedError);
  });

  test("the refusal keeps the original error, so the console still has it", async () => {
    const original = new DOMException("nope", "NotAllowedError");
    withCredentials({
      create: async () => {
        throw original;
      },
    });

    await expect(createCredential(ACCOUNT, "journlet.com")).rejects.toMatchObject(
      { cause: original }
    );
  });
});

describe("what is asked of the authenticator", () => {
  test("a discoverable credential, user verification, and the account id as the handle", async () => {
    // Each of these is load-bearing. Discoverable, or a device that has never seen
    // the account cannot find the credential. Verification required, or the
    // biometric the interface promises is not actually enforced. And the account
    // id as the user handle, so enrolling twice on one platform replaces rather
    // than quietly accumulating.
    let seen: PublicKeyCredentialCreationOptions | undefined;
    vi.stubGlobal("navigator", {
      credentials: {
        create: async (o: CredentialCreationOptions) => {
          seen = o.publicKey;
          return {};
        },
      },
    });

    await createCredential(ACCOUNT, "journlet.com");

    expect(seen?.rp.id).toBe("journlet.com");
    expect(seen?.authenticatorSelection?.residentKey).toBe("required");
    expect(seen?.authenticatorSelection?.userVerification).toBe("required");
    expect(seen?.extensions).toHaveProperty("prf");
    expect(new Uint8Array(seen?.user.id as ArrayBuffer)).toHaveLength(16);
    expect(seen?.user.name).toBe(ACCOUNT.email);
  });

  test("no rp id at all when the host cannot claim one", async () => {
    // Rather than sending an empty string, which is a different thing and is
    // refused.
    let seen: PublicKeyCredentialCreationOptions | undefined;
    vi.stubGlobal("navigator", {
      credentials: {
        create: async (o: CredentialCreationOptions) => {
          seen = o.publicKey;
          return {};
        },
      },
    });

    await createCredential(ACCOUNT, undefined);

    expect(seen?.rp).not.toHaveProperty("id");
  });

  test("the assertion constrains nothing, so a synced credential is offered", async () => {
    // The entire design rests on a device seeing a credential it has never met.
    // Naming the credentials to allow would exclude exactly that.
    let seen: PublicKeyCredentialRequestOptions | undefined;
    vi.stubGlobal("navigator", {
      credentials: {
        get: async (o: CredentialRequestOptions) => {
          seen = o.publicKey;
          return {
            getClientExtensionResults: () => ({
              prf: { results: { first: new Uint8Array(32).buffer } },
            }),
          };
        },
      },
    });

    await deriveSecret("journlet.com");

    expect(seen?.allowCredentials).toEqual([]);
    expect(seen?.userVerification).toBe("required");
  });
});
