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

const ACCOUNT = { email: "someone@example.invalid" };

/** The handle this used to send: the account id as sixteen raw bytes. */
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const accountIdBytes = (): string => {
  const hex = ACCOUNT_ID.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return String(out);
};

/** What a platform hands back from create: a credential with an id on it. */
const CREATED_ID = new Uint8Array([9, 8, 7, 6]);
const created = () => ({ rawId: CREATED_ID.buffer });

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

  test("no built-in authenticator is reported, and does not make it unusable", async () => {
    // Corrected 12 August 2026. A Mac with no Touch ID was offered no passkey route
    // at all, while the passkey that would have opened it sat on the phone beside it:
    // the platform offers to use that phone, and this check was refusing the design's
    // central case on its behalf. So the fact is reported, for the wording, and kept
    // out of the decision.
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
    });

    await expect(probeCredentialSupport()).resolves.toMatchObject({
      webauthn: true,
      platformAuthenticator: false,
      usable: true,
    });
  });

  test("a probe that throws is an answer, not an error", async () => {
    // Some builds reject rather than resolving false, and a screen that cannot
    // render because a capability check threw is worse than one that offers
    // nothing. Treated as "no built-in check" rather than "no passkeys": the same
    // correction as above, and the same reason.
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => {
        throw new Error("no");
      },
    });

    await expect(probeCredentialSupport()).resolves.toMatchObject({
      platformAuthenticator: false,
      usable: true,
    });
  });

  test("and unusable without WebAuthn at all, which is a different thing", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", undefined);

    await expect(probeCredentialSupport()).resolves.toMatchObject({
      webauthn: false,
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
        create: impl.create ?? (async () => created()),
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

  test("a create that resolves nothing is a refusal, not a credential", async () => {
    // `create` may resolve null in the same conditions `get` does, and a
    // credential with no id is nothing to enrol: the next step has to name it.
    // Returning it anyway would put an undefined id into allowCredentials, which
    // fails later and somewhere less obvious.
    withCredentials({ create: async () => null });

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
  test("a discoverable credential, and user verification", async () => {
    // Both load-bearing. Discoverable, or a device that has never seen the account
    // cannot find the credential. Verification required, or the biometric the
    // interface promises is not actually enforced.
    let seen: PublicKeyCredentialCreationOptions | undefined;
    vi.stubGlobal("navigator", {
      credentials: {
        create: async (o: CredentialCreationOptions) => {
          seen = o.publicKey;
          return created();
        },
      },
    });

    await createCredential(ACCOUNT, "journlet.com");

    expect(seen?.rp.id).toBe("journlet.com");
    expect(seen?.authenticatorSelection?.residentKey).toBe("required");
    expect(seen?.authenticatorSelection?.userVerification).toBe("required");
    expect(seen?.extensions).toHaveProperty("prf");
    expect(seen?.user.name).toBe(ACCOUNT.email);
  });

  test("a handle unique to this enrolment, so nothing already saved is displaced", async () => {
    // The 13 August 2026 change, and the one line in this file with a scar behind it.
    // The handle was the account id, which is how WebAuthn is *told* to overwrite an
    // existing credential for the same relying party — at creation, before the derive
    // and the publish that follow it. So a second attempt that failed or was
    // cancelled took away the credential the first one had made, and the wrap written
    // for it opened nothing afterwards. Found on the author's own account: two wraps,
    // one credential in each of two managers, and the Chrome one opening neither row.
    const handles = new Set<string>();
    vi.stubGlobal("navigator", {
      credentials: {
        create: async (o: CredentialCreationOptions) => {
          handles.add(String(new Uint8Array(o.publicKey?.user.id as ArrayBuffer)));
          return created();
        },
      },
    });

    await createCredential(ACCOUNT, "journlet.com");
    await createCredential(ACCOUNT, "journlet.com");

    // Two enrolments, two handles. Equal handles are the instruction to overwrite.
    expect(handles.size).toBe(2);
    // Sixteen bytes, so the shape is still what an authenticator expects.
    for (const h of handles) expect(h.split(",")).toHaveLength(16);
    // And not the account id, which is what it used to be and what must not come back.
    expect(handles.has(accountIdBytes())).toBe(false);
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

  test("unless a credential is named, which is what enrolment must do", async () => {
    // The other half of the same decision. Enrolment has just created a credential
    // and is proving that one can produce a secret; left open, the platform may
    // offer an older Journlet passkey for the same account, the wrap would be
    // written for that one, and the enrolment would add no new route while
    // reporting that it had.
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

    await deriveSecret("journlet.com", CREATED_ID);

    expect(seen?.allowCredentials).toEqual([
      { type: "public-key", id: CREATED_ID },
    ]);
  });
});
