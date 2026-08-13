// @vitest-environment jsdom
//
// Unlocking a device from a keeper wrap, and adding one (spec §6.1e, §12.1 phases
// 3 and 4).
//
// The decryption itself is not what this file is about — keeperWrap.test.ts covers
// that against fixed bytes, and hardware covers the part where the bytes come from
// a real authenticator. What is only testable here is everything on either side of
// it, on the one kind of device this phase exists for: signed in, holding no
// journal, holding a keeper key of its own invention that opens nothing.
//
// So the assertions are the ones that only come true past the point where a wrong
// turn leaves such a device sitting in needs-key for good. It reconciles, it
// registers itself, and it can produce the journal key code — which is the property
// §6.1e adds, and which no device linked by approval has ever had.
//
// Then the four failures, one test each, because phase 4's actual requirement is
// that every one of them has a different route out on the screen that arrives with
// phase 3: no wrap on the account, a credential that opens none of them, a
// credential manager without the extension, and a refusal. Collapsing any two of
// those into one message is what would make that screen guess.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  exportJournalKeyCode,
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";
import {
  newWrapId,
  unwrapKeeperKey,
  wrapKeeperKey,
} from "../src/lib/keeperWrap";
import type { KeeperWrapJson } from "../src/lib/keeperWrap";
import { CredentialRefusedError, PrfUnsupportedError } from "../src/lib/prf";
import type { KeyRing } from "../src/lib/keystore";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const dataKey = await generateDataKey();
// The account's real keeper key: what the wraps hold and what the journal row is
// wrapped with.
const realKeeper = await generateKeeperKey();
const realWrapped = await wrapDataKey(dataKey, realKeeper);
const realCode = await exportJournalKeyCode(realKeeper);
// This device: a fresh install, so a keeper key that is simply wrong.
const freshKeeper = await generateKeeperKey();

// The 32 bytes a passkey returns. Fixed here because the seam this project puts
// the test boundary on is lib/prf.ts: WebAuthn cannot run in jsdom, and mocking an
// authenticator would be an assertion pointed at the wrong level.
const SECRET = new Uint8Array(32).fill(7);
const OTHER_SECRET = new Uint8Array(32).fill(11);

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

const aWrapOf = async (
  secret: Uint8Array<ArrayBuffer>,
  keeper: CryptoKey = realKeeper
): Promise<{ wrap_id: string; wrapped: KeeperWrapJson }> => {
  const wrapId = newWrapId();
  return {
    wrap_id: wrapId,
    wrapped: await wrapKeeperKey(keeper, secret, { userId: USER_ID, wrapId }),
  };
};

let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;
let storedRing: KeyRing;
/**
 * Every keyring written, in order.
 *
 * The connect that follows an unlock rewrites the keyring itself, and it would
 * rewrite it correctly even if the adoption had installed nonsense — so asserting
 * on the ring left at the end says nothing about the part under test. This project
 * has spent whole days on assertions pointed at the wrong level, so what the
 * adoption itself wrote is kept separately.
 */
let ringWrites: KeyRing[] = [];
let wrapRows: { wrap_id: string; wrapped: KeeperWrapJson }[] = [];
/** What the authenticator does when asked. Reset per test. */
let prfAnswer: () => Promise<ArrayBuffer> = async () => SECRET.buffer;
let derivations = 0;
/** Sign out inside the one await between proving a key and installing it. */
let signOutMidAdopt = false;
/** The id createCredential hands back, and what each derive was told to use. */
const CREATED_ID = new Uint8Array([4, 5, 6, 7]);
let created = 0;
let askedFor: (Uint8Array | undefined)[] = [];
/** How many times the journal row has been read, which is once per real connect. */
let journalReads = 0;
/** Wrap ids the client asked the server to delete. */
let deleted: string[] = [];
/** Credentials the client asked the platform to forget (Signal API). */
let forgotten: Uint8Array[] = [];
/** The credential the stubbed platform says answered the assertion. */
const ANSWERED_ID = new Uint8Array([4, 4, 4, 4]);
/** Where the answer came from: this device, or another one over the QR tunnel. */
let attachment: string | null = "platform";

const signIn = (): void => {
  if (!authCallback)
    throw new Error("startSync installed no auth listener, so nothing signed in");
  authCallback("SIGNED_IN", { user: { id: USER_ID, email: "g@example.com" } });
};

// The real relyingPartyId and the real error classes, since the point of the seam
// is that only the platform call is replaced.
vi.mock("../src/lib/prf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/prf")>()),
  createCredential: async () => {
    created++;
    return CREATED_ID;
  },
  deriveSecret: async (_rpId: string | undefined, credentialId?: Uint8Array) => {
    derivations++;
    askedFor.push(credentialId);
    // The pair the real one answers with: the bytes, plus who produced them, which
    // is what lets a failed unlock disown the credential.
    return {
      secret: await prfAnswer(),
      credentialId: ANSWERED_ID,
      attachment,
    };
  },
  forgetCredential: async (_rpId: string | undefined, id: Uint8Array) => {
    forgotten.push(id);
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    let ownCallback: ((e: string, s: unknown) => void) | null = null;
    return {
      auth: {
        onAuthStateChange: (fn: (e: string, s: unknown) => void) => {
          ownCallback = fn;
          authCallback = fn;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: async () => {
          ownCallback?.("SIGNED_OUT", null);
          return { error: null };
        },
      },
      from: (table: string) => {
        if (table === "journals") {
          return {
            select: () => ({
              maybeSingle: async () => {
                journalReads++;
                if (signOutMidAdopt) {
                  signOutMidAdopt = false;
                  authCallback?.("SIGNED_OUT", null);
                }
                return {
                  data: {
                    wrapped_key: {
                      v: realWrapped.v,
                      iv: b64encode(realWrapped.iv),
                      blob: b64encode(realWrapped.blob),
                    },
                  },
                  error: null,
                };
              },
            }),
            insert: async () => ({ error: null }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "keeper_wraps") {
          const answer = { data: wrapRows, count: wrapRows.length, error: null };
          return {
            select: (_cols: string, opts?: { head?: boolean }) =>
              opts?.head
                ? Promise.resolve(answer)
                : { order: async () => answer },
            insert: async (row: { wrap_id: string; wrapped: KeeperWrapJson }) => {
              wrapRows.push({ wrap_id: row.wrap_id, wrapped: row.wrapped });
              return { error: null };
            },
            delete: () => ({
              in: async (_col: string, ids: string[]) => {
                deleted.push(...ids);
                wrapRows = wrapRows.filter((r) => !ids.includes(r.wrap_id));
                return { error: null };
              },
            }),
          };
        }
        const b = {
          select: () => b,
          eq: () => b,
          gt: () => b,
          order: () => b,
          limit: async () => ({ data: [], error: null }),
          insert: async () => ({ error: null }),
        };
        return b;
      },
      removeChannel: () => {},
      channel: () => {
        const ch = {
          on: () => ch,
          subscribe: (fn: (s: string) => void) => {
            fn("SUBSCRIBED");
            return ch;
          },
        };
        return ch;
      },
    };
  },
}));

vi.mock("../src/store/journal", () => ({
  get doc() {
    return doc;
  },
  get devices() {
    return doc.getMap("devices");
  },
  get credentials() {
    return doc.getMap("credentials");
  },
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
}));

vi.mock("../src/lib/keystore", () => ({
  ensureKeys: async () => storedRing,
  replaceKeyRing: async (r: KeyRing) => {
    storedRing = r;
    ringWrites.push(r);
  },
  wipeKeys: async () => {},
  ensureDeviceKeyPair: async () =>
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]),
}));

/**
 * Boot a device that has never held this journal, signed in and waiting.
 *
 * It gets as far as needs-key on its own, which is the state the unlock screen
 * appears in, and settling there first is also what keeps these tests honest:
 * connect() is single-flight, so unlocking while the opening connect is still in
 * flight would join that one rather than starting a connect that knows about the
 * keeper key just adopted.
 */
const boot = async (signedIn = true) => {
  vi.resetModules();
  doc = new Y.Doc();
  authCallback = null;
  derivations = 0;
  created = 0;
  askedFor = [];
  journalReads = 0;
  deleted = [];
  forgotten = [];
  ringWrites = [];
  localStorage.setItem("journlet-device-id", "phone-id");
  storedRing = {
    keeperKey: freshKeeper,
    dataKeys: new Map([[0, await generateDataKey()]]),
    epoch: 0,
    wrapped: await wrapDataKey(await generateDataKey(), freshKeeper),
    createdAt: 0,
  };
  const sync = await import("../src/store/sync");
  sync.startSync();
  if (!signedIn) return sync;
  signIn();
  await vi.waitFor(() => expect(sync.getSyncStatus()).toBe("needs-key"));
  await new Promise((r) => setTimeout(r, 0));
  return sync;
};

/**
 * Served from the real host by default.
 *
 * Enrolment is refused anywhere else, because the Relying Party ID cannot be
 * changed once a credential exists (§12.1). jsdom would otherwise be localhost,
 * which is one of the hosts that rule excludes.
 */
const servedFrom = (hostname: string): void => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, hostname },
  });
};

beforeEach(async () => {
  localStorage.clear();
  servedFrom("app.journlet.com");
  prfAnswer = async () => SECRET.buffer;
  // Reset here rather than in boot(), which the tests call after choosing it.
  attachment = "platform";
  signOutMidAdopt = false;
  wrapRows = [await aWrapOf(SECRET)];
});

describe("a device unlocking from a passkey", () => {
  test("reaches synced, having arrived holding nothing that worked", async () => {
    const sync = await boot();

    await sync.unlockWithPasskey();

    expect(sync.getSyncStatus()).toBe("synced");
  });

  test("and can then show the journal key code, which is what §6.1e adds", async () => {
    // The consequence Gary asked about and the spec calls out: any unlocked device
    // can produce the code, so saving it later is a real option rather than a
    // consolation. Before the unlock this device has no business showing one, and
    // says so by returning null rather than the plausible-looking string its own
    // fresh keeper key would render.
    const sync = await boot();
    await expect(sync.getJournalKeyCode()).resolves.toBeNull();

    await sync.unlockWithPasskey();

    await expect(sync.getJournalKeyCode()).resolves.toBe(realCode);
  });

  test("registers itself in the device register", async () => {
    // Downstream of everything: registration happens after the reconcile, which is
    // where a connect that never really got going would have stopped.
    const sync = await boot();

    await sync.unlockWithPasskey();

    expect(Object.keys(doc.getMap("devices").toJSON())).toContain("phone-id");
  });

  test("records which wrap opened, so the route can be named later (§6.1l)", async () => {
    // The one fact the app can state about a saved route, and it is measured rather
    // than inferred: unwrapKeeperKeyFromAny reports the row that authenticated. On an
    // account whose wraps predate the register this is also the migration — a row
    // appears the first time its route is used, and one that never appears is the
    // candidate for a wrap nothing can open (§6.1f).
    const sync = await boot();

    await sync.unlockWithPasskey();

    const notes = doc.getMap("credentials").toJSON() as Record<
      string,
      Record<string, unknown>
    >;
    const [wrapId] = Object.keys(notes);
    expect(wrapId).toBe(wrapRows[0].wrap_id);
    expect(notes[wrapId].lastOpenedAt).toBeGreaterThan(0);
    // Not an enrolment this device saw, so it must not claim one: a made-up setup
    // date is exactly the plausible falsehood §6.1b is the account of.
    expect(notes[wrapId].enrolledAt).toBe(0);
  });

  test("and the route it names is the one the server still has", async () => {
    // Reconciliation is one-way by design: the rows come from keeper_wraps and the
    // notes only decorate them, so a note can never hide a route from the screen.
    const sync = await boot();
    await sync.unlockWithPasskey();

    const listed = await sync.listPasskeyRoutes();
    expect(listed.routes.map((r) => r.wrapId)).toEqual(
      wrapRows.map((r) => r.wrap_id)
    );
    expect(listed.routes[0].note).not.toBeNull();
    expect(listed.strays).toHaveLength(0);
  });

  test("tries every wrap, so the newest credential is not the only one that works", async () => {
    // No wrap is privileged and the rows cannot say which credential they belong to
    // (§6.5), so the one that opens may be anywhere in the list. Two decoys in
    // front of it here: each fails authentication and costs nothing.
    wrapRows = [
      await aWrapOf(OTHER_SECRET),
      await aWrapOf(OTHER_SECRET),
      await aWrapOf(SECRET),
    ];
    const sync = await boot();

    await sync.unlockWithPasskey();

    expect(sync.getSyncStatus()).toBe("synced");
  });

  test("installs the key it proved and nothing the device had invented", async () => {
    // Every fresh install generates a keyring of its own, and this one's is wrong in
    // every part. What the adoption writes is therefore only what the unwrap proved:
    // the account's epoch 0 blob and one key for it. Asserted on the ring the
    // adoption wrote rather than the one left afterwards, because the tempting edit
    // — merge with whatever was held — is invisible in the second: the connect
    // repairs it, and a device that reports itself entitled and decrypts nothing is
    // exactly what that hides.
    const sync = await boot();
    const before = ringWrites.length;

    await sync.unlockWithPasskey();

    const adopted = ringWrites[before];
    expect([...adopted.dataKeys.keys()]).toEqual([0]);
    expect(adopted.epoch).toBe(0);
    expect(adopted.wrapped?.blob).toEqual(realWrapped.blob);
  });

  test("counts the routes without opening any, for a screen deciding what to offer", async () => {
    wrapRows = [await aWrapOf(SECRET), await aWrapOf(OTHER_SECRET)];
    const sync = await boot();

    await expect(sync.countPasskeyRoutes()).resolves.toBe(2);
  });
});

describe("adding a passkey from a device that is already unlocked", () => {
  test("needs the keeper key, and writes nothing without it", async () => {
    // Wrapping needs the keeper key, so enrolment requires already being unlocked —
    // the same entitlement logic as approving a device (§6.1d). This device is
    // signed in and holds nothing that works, which is exactly the state in which
    // an offer to add a passkey would be a route to nowhere.
    const sync = await boot();

    expect(sync.canEnrolPasskey()).toBe(false);
    await expect(sync.enrolPasskey()).rejects.toThrow(/does not hold the journal key/);
    expect(wrapRows).toHaveLength(1);
    expect(created).toBe(0);
  });

  test("once unlocked, it adds a second route rather than replacing the first", async () => {
    // Many wraps, any one sufficient, none privileged. Two routes is the whole
    // point of the second one: an iCloud user who also uses Windows.
    const sync = await boot();
    await sync.unlockWithPasskey();

    expect(sync.canEnrolPasskey()).toBe(true);
    prfAnswer = async () => OTHER_SECRET.buffer;
    await sync.enrolPasskey();

    expect(wrapRows).toHaveLength(2);
  });

  test("and the enrolment is recorded against the wrap it wrote", async () => {
    const sync = await boot();
    await sync.unlockWithPasskey();
    const before = new Set(Object.keys(doc.getMap("credentials").toJSON()));

    prfAnswer = async () => OTHER_SECRET.buffer;
    await sync.enrolPasskey();

    const notes = doc.getMap("credentials").toJSON() as Record<
      string,
      Record<string, unknown>
    >;
    const added = Object.keys(notes).filter((id) => !before.has(id));
    expect(added).toHaveLength(1);
    const note = notes[added[0]];
    expect(note.enrolledAt).toBeGreaterThan(0);
    expect(note.enrolledOn).toBeTruthy();
    // The route is part of what a wrap is (§6.1k): the same credential reached
    // through the phone derives a different secret, so a wrap written locally is
    // known to work locally and nowhere else is promised.
    expect(note.enrolledRoute).toBeTruthy();
    // Eight hex characters of the secret, which is what tells two rows apart when
    // everything else about them matches (IDR-017).
    expect(note.fingerprint).toMatch(/^[0-9A-F]{8}$/);
  });

  test("and the wrap it wrote opens on the credential it enrolled", async () => {
    // The check that makes the row worth having. A wrap written without deriving
    // would be a stored route that might not open, which is why enrolment shows two
    // prompts rather than one.
    const sync = await boot();
    await sync.unlockWithPasskey();
    prfAnswer = async () => OTHER_SECRET.buffer;
    await sync.enrolPasskey();

    const added = wrapRows[wrapRows.length - 1];
    await expect(
      unwrapKeeperKey(added.wrapped, OTHER_SECRET, {
        userId: USER_ID,
        wrapId: added.wrap_id,
      })
    ).resolves.toBeTruthy();
  });

  test("naming the credential it just created when it asks for the secret", async () => {
    // Left open, the platform may offer an older Journlet passkey for this account,
    // the wrap would belong to that one, and the enrolment would report success
    // having added no new route. Unlocking is the opposite case and passes nothing,
    // which is why one call does both.
    const sync = await boot();
    await sync.unlockWithPasskey();
    await sync.enrolPasskey();

    expect(askedFor[0]).toBeUndefined(); // the unlock
    expect(askedFor[1]).toEqual(CREATED_ID); // the enrolment
  });

  test("and is refused anywhere but journlet.com, before any prompt", async () => {
    // The one-way decision in the whole design. A credential created against the
    // Pages default host or a preview deployment is invisible from the real app for
    // ever, so this does not create one and does not ask.
    const sync = await boot();
    await sync.unlockWithPasskey();
    servedFrom("journlet.github.io");

    await expect(sync.enrolPasskey()).rejects.toThrow(/only be set up on journlet.com/);
    expect(created).toBe(0);
    expect(wrapRows).toHaveLength(1);
  });

  test("a credential that cannot produce a secret leaves no row behind", async () => {
    // The unsupported-password-manager case. It has created a credential by then,
    // which is untidy and is said on the screen; what must not happen is a row
    // pointing at a route that cannot be opened.
    const sync = await boot();
    await sync.unlockWithPasskey();
    prfAnswer = async () => {
      throw new PrfUnsupportedError();
    };

    await expect(sync.enrolPasskey()).rejects.toBeInstanceOf(PrfUnsupportedError);
    expect(wrapRows).toHaveLength(1);
  });
});

describe("giving the journal key to a device that is already syncing", () => {
  test("forces a real connect rather than joining the one it already has", async () => {
    // The reason takeJournalKey exists rather than provideJournalKey. Adopting
    // reduces the keyring to epoch 0, and doConnect early-outs on a device that is
    // already connected — so the connect that is meant to collect the later epochs
    // would return immediately and leave this device holding a key for an epoch the
    // account has moved past. Reading the journal row again is what proves the
    // connection was dropped first — and the count has to allow for the adoption's
    // own read, which happens either way: one read means the adopt alone, two means
    // a connect followed it.
    const sync = await boot();
    await sync.unlockWithPasskey();
    const before = journalReads;

    await sync.takeJournalKey(realCode);

    expect(journalReads).toBeGreaterThan(before + 1);
  });

  test("and leaves the device holding a key it can show", async () => {
    const sync = await boot();
    await sync.unlockWithPasskey();

    await sync.takeJournalKey(realCode);

    await expect(sync.getJournalKeyCode()).resolves.toBe(realCode);
    expect(sync.canEnrolPasskey()).toBe(true);
  });

  test("a key that does not fit changes nothing", async () => {
    const sync = await boot();
    const wrong = await exportJournalKeyCode(await generateKeeperKey());

    await expect(sync.takeJournalKey(wrong)).rejects.toThrow(/journal key/);

    expect(sync.canEnrolPasskey()).toBe(false);
  });
});

describe("starting again with one passkey (spec §11 Q13, §12.1 phase 6)", () => {
  test("enrols first and deletes only what was there before", async () => {
    // The order is the whole safety of it: a failure leaves more routes than needed
    // rather than none, and a wrap another device wrote in the meantime is not swept
    // up by a call that never saw it.
    wrapRows = [await aWrapOf(SECRET), await aWrapOf(OTHER_SECRET)];
    const older = wrapRows.map((r) => r.wrap_id);
    const sync = await boot();
    await sync.unlockWithPasskey();

    await sync.replaceAllPasskeys();

    expect(deleted.sort()).toEqual([...older].sort());
    expect(wrapRows).toHaveLength(1);
    expect(older).not.toContain(wrapRows[0].wrap_id);
  });

  test("and forgets the notes for the routes it removed", async () => {
    // Otherwise the register describes routes that no longer exist, and the screen
    // reports them as strays "most likely removed from another device" — which is
    // wrong in the case that produces them most often (Gary, on hardware, 13 August).
    const sync = await boot();
    await sync.unlockWithPasskey();
    const stampedOld = Object.keys(doc.getMap("credentials").toJSON());
    expect(stampedOld).toHaveLength(1);

    prfAnswer = async () => OTHER_SECRET.buffer;
    await sync.replaceAllPasskeys();

    const after = Object.keys(doc.getMap("credentials").toJSON());
    expect(after).toHaveLength(1);
    expect(after).not.toEqual(stampedOld);
    const listed = await sync.listPasskeyRoutes();
    expect(listed.strays).toHaveLength(0);
    expect(listed.routes).toHaveLength(1);
    expect(listed.routes[0].note).not.toBeNull();
  });

  test("and sweeps notes left behind by earlier restarts", async () => {
    // The scoping correction: forgetting only the routes this call removed left
    // anything orphaned earlier in the register for good, so an action promising one
    // passkey and a clean list delivered a list with wreckage on it.
    const sync = await boot();
    doc.getMap("credentials").set("ghost-from-an-earlier-restart", new Y.Map());
    await sync.unlockWithPasskey();

    prfAnswer = async () => OTHER_SECRET.buffer;
    await sync.replaceAllPasskeys();

    const listed = await sync.listPasskeyRoutes();
    expect(listed.strays).toHaveLength(0);
    expect(Object.keys(doc.getMap("credentials").toJSON())).toEqual([
      wrapRows[0].wrap_id,
    ]);
  });

  test("but never a note whose route another device published meanwhile", async () => {
    // §6.1h's ordering discipline, applied to the notes: the sweep is computed from a
    // read taken after the delete, so a wrap that appeared while this was running is
    // live and keeps its note. Scoping it to "not in `before`" would have swept it.
    const sync = await boot();
    await sync.unlockWithPasskey();

    // Published during the enrolment, which is the only way it is "meanwhile": after
    // the ids to delete were read and before the sweep reads what is live.
    const meanwhile = { wrap_id: "from-another-device", wrapped: wrapRows[0].wrapped };
    prfAnswer = async () => {
      wrapRows.push(meanwhile);
      doc.getMap("credentials").set(meanwhile.wrap_id, new Y.Map());
      return OTHER_SECRET.buffer;
    };

    await sync.replaceAllPasskeys();

    expect(Object.keys(doc.getMap("credentials").toJSON())).toContain(
      meanwhile.wrap_id
    );
  });

  test("and deletes nothing at all when the enrolment fails", async () => {
    // Which is the case that matters: somebody cancels the sheet and still has every
    // route they had a moment ago.
    wrapRows = [await aWrapOf(SECRET)];
    const sync = await boot();
    await sync.unlockWithPasskey();
    prfAnswer = async () => {
      throw new CredentialRefusedError();
    };

    await expect(sync.replaceAllPasskeys()).rejects.toBeInstanceOf(
      CredentialRefusedError
    );

    expect(deleted).toEqual([]);
    expect(wrapRows).toHaveLength(1);
  });

  test("and the wrap it leaves behind is one this credential opens", async () => {
    wrapRows = [await aWrapOf(OTHER_SECRET)];
    const sync = await boot();
    // Unlock on the old credential, then start again on a new secret.
    prfAnswer = async () => OTHER_SECRET.buffer;
    await sync.unlockWithPasskey();
    prfAnswer = async () => SECRET.buffer;

    await sync.replaceAllPasskeys();

    const left = wrapRows[0];
    await expect(
      unwrapKeeperKey(left.wrapped, SECRET, {
        userId: USER_ID,
        wrapId: left.wrap_id,
      })
    ).resolves.toBeTruthy();
  });
});

describe("the four ways it does not work", () => {
  test("no wrap at all, and no platform sheet raised to find that out", async () => {
    // Read the rows first, ask for the secret second. A biometric prompt that could
    // not have led anywhere is the kind of thing that gets reported as the passkey
    // being broken.
    wrapRows = [];
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toBeInstanceOf(
      sync.NoPasskeyRouteError
    );
    expect(derivations).toBe(0);
  });

  test("a credential that opens none of the wraps, told apart from there being none", async () => {
    // The ordinary answer on a password manager from another ecosystem, whose route
    // on is enrolling this credential from a device that is already unlocked.
    prfAnswer = async () => OTHER_SECRET.buffer;
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toBeInstanceOf(
      sync.UnknownCredentialError
    );
  });

  test("and asks the provider to forget it, so it stops being offered", async () => {
    // The Signal API half, added 13 August 2026. A credential that authenticates and
    // opens nothing is dead for this journal, and until now the password manager went
    // on offering it with nothing on any screen able to say which of two entries was
    // the useless one — four failed attempts in one morning on the author's account.
    // Awaited before the throw, so a provider that acts has acted by the time the
    // screen explains the failure.
    prfAnswer = async () => OTHER_SECRET.buffer;
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toThrow();

    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toEqual(ANSWERED_ID);
  });

  test("but says nothing about one answered over the tunnel, however it failed", async () => {
    // The restriction that arrived before this shipped. On real hardware a Google
    // Password Manager credential opens its own wrap when Chrome reaches it locally
    // and returns a different secret when the same credential is reached through the
    // phone by QR, while an iCloud Keychain one is consistent (Gary, 13 August). So
    // over the tunnel, "opens nothing" is as likely to mean the transport as the
    // credential, and signalling would ask a provider to delete a working way in.
    attachment = "cross-platform";
    prfAnswer = async () => OTHER_SECRET.buffer;
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toThrow();

    expect(forgotten).toEqual([]);
  });

  test("and the error says which it was, since the screen must say different things", async () => {
    // The link between this file and ui/PasskeyUnlock: locally the message may assert
    // "not one of the ones set up here", and over the tunnel it must not, because the
    // same symptom is produced by a password manager deriving differently across that
    // route. Without this assertion the store could stop reporting it and both
    // messages would still pass their own tests.
    prfAnswer = async () => OTHER_SECRET.buffer;
    attachment = "cross-platform";
    const overTunnel = await boot();

    await expect(overTunnel.unlockWithPasskey()).rejects.toMatchObject({
      viaTunnel: true,
    });

    attachment = "platform";
    const local = await boot();

    await expect(local.unlockWithPasskey()).rejects.toMatchObject({
      viaTunnel: false,
    });
  });

  test("nor about one whose origin the browser did not report", async () => {
    // Unreported counts as cross-platform, because the two mistakes are not
    // equivalent: not signalling leaves a dead entry in a list, and signalling
    // wrongly deletes a passkey somebody depends on.
    attachment = null;
    prfAnswer = async () => OTHER_SECRET.buffer;
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toThrow();

    expect(forgotten).toEqual([]);
  });

  test("and says nothing about a credential that worked", async () => {
    // The half that would be a real fault: signalling a live credential asks its
    // provider to delete the only way into this journal.
    const sync = await boot();

    await sync.unlockWithPasskey();

    expect(forgotten).toEqual([]);
  });

  test("and adopts nothing when it does, rather than half-linking", async () => {
    prfAnswer = async () => OTHER_SECRET.buffer;
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toThrow();

    expect(sync.getSyncStatus()).toBe("needs-key");
    await expect(sync.getJournalKeyCode()).resolves.toBeNull();
  });

  test("a wrap that opens on a key the journal does not know is not blamed on a code", async () => {
    // Opening the wrap proves the credential matched the row and nothing more. What
    // came out of it still has to fit the journal, and one day it may not: rotating
    // the keeper key is §11 Q13, still open. Whoever meets that has typed nothing,
    // so the words cannot be about a journal key — which is the entire reason the
    // shared path has its own error and the typed path translates it.
    wrapRows = [await aWrapOf(SECRET, await generateKeeperKey())];
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toThrow(
      /does not open this account/
    );
  });

  test("a credential manager without the extension travels out as itself", async () => {
    // "Use another route", not "try again", and the only way to find out is to ask.
    prfAnswer = async () => {
      throw new PrfUnsupportedError();
    };
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toBeInstanceOf(
      PrfUnsupportedError
    );
  });

  test("so does a refusal, which is the one that does mean try again", async () => {
    prfAnswer = async () => {
      throw new CredentialRefusedError();
    };
    const sync = await boot();

    await expect(sync.unlockWithPasskey()).rejects.toBeInstanceOf(
      CredentialRefusedError
    );
  });

  test("a sign-out landing mid-adopt does not put the keys back", async () => {
    // The invariant the shared adoption path is written around: `ring` is module
    // state, signing out drops it, and an assignment after that would restore a
    // keyring for an account the person has just left. So the account is held
    // before the first await and re-checked before the write, rather than read
    // twice and trusted not to have moved.
    const sync = await boot();
    signOutMidAdopt = true;

    await expect(sync.unlockWithPasskey()).rejects.toThrow(/[Ss]igned out/);

    await expect(sync.getJournalKeyCode()).resolves.toBeNull();
  });

  test("signed out, it asks for nothing at all", async () => {
    // The table cannot be read without a session, so there is nothing to try and no
    // reason to raise a sheet. Counting says null rather than zero for the same
    // reason: zero would be a claim about the account.
    const sync = await boot(false);

    await expect(sync.unlockWithPasskey()).rejects.toThrow(/[Ss]ign in/);
    expect(derivations).toBe(0);
    await expect(sync.countPasskeyRoutes()).resolves.toBeNull();
  });
});
