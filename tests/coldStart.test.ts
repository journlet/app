// @vitest-environment jsdom
//
// What a launch does before Supabase has said who is signed in.
//
// Reported 19 August 2026 with a screen recording: a cold start on a phone that
// had not quite joined the wifi showed the sign-in-or-erase screen, and switching
// to 4G revealed the session had been valid the whole time. The status was seeded
// "signed-out", so for the length of the account check the app stated an answer
// nobody had given it — and the gate reading that value is the one offering to
// delete the journal.
//
// The check is not quick in the case that matters. Supabase refreshes an access
// token that is inside its expiry margin before it will name the user, which is
// every cold start more than an hour after the last one, and on a network that
// half works it retries that call for up to thirty seconds.
//
// So the states these pin are the three a launch can be in, and the difference
// between the last two is the whole fix: signed in, definitely signed out, and
// nobody has said. The third one keeps the journal and waits.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";
import {
  generateDataKey,
  generateKeeperKey,
  wrapDataKey,
} from "../src/lib/crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const dataKey = await generateDataKey();
const keeperKey = await generateKeeperKey();
const wrapped = await wrapDataKey(dataKey, keeperKey);

let doc = new Y.Doc();
let authCallback: ((e: string, s: unknown) => void) | null = null;
/**
 * Which engine asked again, rather than how many times anything did.
 *
 * A booted engine registers listeners on the shared jsdom window and document,
 * and resetting the modules does not unregister them — so every engine an
 * earlier test booted is still listening, still unverified, and still answers an
 * "online" event by asking Supabase again. Counting calls alone therefore counts
 * other tests' engines, which is how "asked nothing" first read as fourteen.
 *
 * Each mocked client gets a number, and the engine under test is the last one
 * built, so an assertion can name the engine it means.
 */
let clients = 0;
let currentClient = 0;
let refreshedBy: number[] = [];
const refreshes = (): number =>
  refreshedBy.filter((id) => id === currentClient).length;

/** Deliver an auth event, as Supabase's own listener would. */
const emit = (event: string, session: unknown): void => {
  if (!authCallback)
    throw new Error("startSync installed no auth listener, so nothing was told");
  authCallback(event, session);
};

const SESSION = { user: { id: USER_ID, email: "g@example.com" } };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const client = ++clients;
    return {
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          authCallback = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: async () => ({ error: null }),
        // Deliberately silent: a refresh that reaches nothing raises no event,
        // which is exactly the case the retry exists for. Tests that want it to
        // succeed emit the event themselves.
        refreshSession: async () => {
          refreshedBy.push(client);
          return { data: { session: null }, error: null };
        },
      },
      from: () => {
        const b = {
          select: () => b,
          eq: () => b,
          gt: () => b,
          order: () => b,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async () => ({ error: null }),
        };
        return b;
      },
      removeChannel: () => {},
      channel: () => {
        const ch = {
          on: () => ch,
          subscribe: (cb?: (s: string) => void) => {
            cb?.("SUBSCRIBED");
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
  ensureKeys: async () => ({
    keeperKey,
    dataKeys: new Map([[0, dataKey]]),
    epoch: 0,
    wrapped,
    createdAt: 0,
  }),
  replaceKeyRing: async () => {},
  wipeKeys: async () => {},
  ensureDeviceKeyPair: async () =>
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]),
}));

/** Pretend the radio is off, as a phone out of range is. */
const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
};

/**
 * Boot the engine without telling it anything, which is the state under test.
 *
 * `mark` is the record of a session having existed here before (lib/sessionMark),
 * written by the previous run of the app. It is what a launch falls back on when
 * the network will not answer, so every test here is really about which side of
 * it the device is on.
 */
const boot = async (mark: boolean) => {
  vi.resetModules();
  doc = new Y.Doc();
  authCallback = null;
  refreshedBy = [];
  localStorage.clear();
  if (mark) localStorage.setItem("journlet-session-seen", "1");
  const sync = await import("../src/store/sync");
  currentClient = clients;
  sync.startSync();
  return sync;
};

beforeEach(() => {
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe("before Supabase has answered", () => {
  test("the app says it is starting, not that nobody is signed in", async () => {
    const sync = await boot(true);
    expect(sync.getSyncStatus()).toBe("starting");
  });

  test("a device that has never held a session waits rather than guessing", async () => {
    // A fresh install has no journal to protect and no session to wait for, so
    // there is nothing to fall back to: it holds the starting screen until it is
    // told, and onboarding is what it is told to show. Opening the journal early
    // here would start a keyring the account may yet have to replace.
    vi.useFakeTimers();
    const sync = await boot(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sync.getSyncStatus()).toBe("starting");
  });

  test("a device that has held one opens its journal rather than waiting", async () => {
    // The backup Gary asked for. Supabase's own ceiling is thirty seconds of
    // retry, and half a minute of splash screen is not a launch — the journal is
    // local and readable, so it opens offline and the answer is still obeyed
    // whenever it lands.
    vi.useFakeTimers();
    const sync = await boot(true);
    await vi.advanceTimersByTimeAsync(4100);
    expect(sync.getSyncStatus()).toBe("offline");
  });

  test("with no network it does not wait at all", async () => {
    // A token refresh cannot succeed with no radio, so the four seconds would be
    // spent to learn nothing. This is §6.1b's aeroplane, and it should look like
    // an app that opens.
    setOnline(false);
    const sync = await boot(true);
    expect(sync.getSyncStatus()).toBe("offline");
  });
});

describe("when Supabase does answer", () => {
  test("a session is obeyed, however late it arrives", async () => {
    vi.useFakeTimers();
    const sync = await boot(true);
    await vi.advanceTimersByTimeAsync(4100);
    expect(sync.getSyncStatus()).toBe("offline");

    emit("INITIAL_SESSION", SESSION);
    await vi.waitFor(() => expect(sync.getSyncStatus()).not.toBe("offline"));
  });

  test("a session that is genuinely gone gets the signed-out screen", async () => {
    // Supabase fires SIGNED_OUT when it destroys a session itself, which it only
    // does when the server has rejected the refresh token or the stored session
    // will not parse. That is the honest signal, and it is the only one that
    // takes the journal off the screen.
    const sync = await boot(true);
    emit("SIGNED_OUT", null);
    expect(sync.getSyncStatus()).toBe("signed-out");
    expect(localStorage.getItem("journlet-session-seen")).toBeNull();
  });

  test("a device that never signed in here is signed out, not left waiting", async () => {
    // No mark and no session: a first launch, or storage cleared underneath the
    // app. Both want onboarding, and both are safe to state, since there is no
    // journal being hidden by saying so.
    const sync = await boot(false);
    emit("INITIAL_SESSION", null);
    expect(sync.getSyncStatus()).toBe("signed-out");
  });

  test("a check that failed is not reported as a sign-out", async () => {
    // The bug itself. Supabase hands the listener a null session when the refresh
    // it needed could not reach the server, and that is indistinguishable from
    // being signed out unless something remembers there was a session — which is
    // what the mark is for. Nothing is torn down and the journal stays up.
    const sync = await boot(true);
    emit("INITIAL_SESSION", null);
    expect(sync.getSyncStatus()).toBe("offline");
    expect(localStorage.getItem("journlet-session-seen")).toBe("1");
  });
});

describe("the first launch after this shipped", () => {
  test("a device already signed in is not treated as a stranger", async () => {
    // Every install signed in before this build has no mark, because the mark is
    // new. Supabase's own stored session is the evidence those devices do carry,
    // and without reading it they would spend one launch — the upgrade — as
    // though they had never had an account.
    vi.useFakeTimers();
    const sync = await boot(false);
    localStorage.setItem("sb-abcdefgh-auth-token", JSON.stringify({ user: {} }));
    await vi.advanceTimersByTimeAsync(4100);
    expect(sync.getSyncStatus()).toBe("offline");
  });

  test("and a stored session is not mistaken for anything else", async () => {
    // The key shape is the coupling here, so a near miss must not answer.
    vi.useFakeTimers();
    const sync = await boot(false);
    localStorage.setItem("sb-auth-token", "not this one");
    localStorage.setItem("journlet-theme", "dark");
    await vi.advanceTimersByTimeAsync(4100);
    expect(sync.getSyncStatus()).toBe("starting");
  });
});

describe("an unverified device that gets a network back", () => {
  test("asks again when the connection returns", async () => {
    const sync = await boot(true);
    emit("INITIAL_SESSION", null);
    expect(sync.getSyncStatus()).toBe("offline");

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(refreshes()).toBeGreaterThan(0));
  });

  test("asks again when the app is looked at", async () => {
    // The case an installed PWA lives in: suspended by iOS for hours, then
    // resumed. Nothing else would ever ask.
    const sync = await boot(true);
    emit("INITIAL_SESSION", null);
    expect(sync.getSyncStatus()).toBe("offline");

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(refreshes()).toBeGreaterThan(0));
  });

  test("stops asking once it has been told", async () => {
    const sync = await boot(true);
    emit("INITIAL_SESSION", SESSION);
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshes()).toBe(0);
    expect(sync.getSyncStatus()).not.toBe("signed-out");
  });
});
