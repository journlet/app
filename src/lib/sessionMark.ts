// Whether a session has ever existed on this device, as far as this device can
// tell.
//
// It exists to separate two things the sync status ran together until 19 August
// 2026: "there is no session" and "nobody has answered yet". Supabase answers the
// second question over the network — a cold start with an expired access token
// refreshes it before it will say who you are, and on a network that half works
// that call retries for up to thirty seconds — and while it went unanswered the
// app read its own initial "signed-out" as fact and offered to erase the journal.
// Reported with a screen recording, 19 August 2026.
//
// So an unanswered check now falls back on this mark instead of on an assumption.
// A device that has held a session before keeps its journal on screen and waits;
// a device that never has is genuinely new and gets onboarding, which is the
// right screen for it whether or not the network is there.
//
// localStorage deliberately, and the same store Supabase keeps its session in.
// The pairing is the point: clearing site data takes the session and this mark
// together, so the one case where the mark could outlive the session it stands
// for — storage emptied underneath the app — cannot arise. Anywhere else (a
// cookie, IndexedDB) the two could drift apart, and a mark claiming a session
// that is not there would hold a signed-out device on the journal for ever.
//
// Nothing about the account is written here, only that one existed. The address
// is already on the Sync screen and this file has no need of it: a bare flag
// cannot leak an identity to anything that reads the storage it sits in.
import { SESSION_SEEN_KEY } from "./storageKeys";


const SEEN_KEY = SESSION_SEEN_KEY;

/**
 * Note that Supabase has handed this device a session.
 *
 * Written on every auth event that carries one rather than only on sign-in: a
 * token refresh is much the commonest of those events, and a device that has
 * been running for months should not depend on a write that happened once.
 */
export const markSessionSeen = (): void => {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked. sessionSeen() then reads false, so an unverifiable
    // session is treated as no session — the strict direction, and the same one
    // the app took before this mark existed.
  }
};

/**
 * Supabase's own stored session, as a second way of answering the same question.
 *
 * Needed because the mark above is new and the installs are not: on the first
 * launch after this ships, every device already signed in has no mark, and would
 * spend that one launch treated as though it had never had an account. The
 * session Supabase persisted is the evidence those devices do have, and reading
 * it says the same thing the mark says.
 *
 * By key shape rather than by asking Supabase, which is the ugly part and is
 * deliberate: getSession() is the call that has not come back yet, so asking it
 * here would be waiting for the answer this whole file exists to do without. The
 * coupling is to a name (`sb-<project>-auth-token`) rather than to behaviour, and
 * the cost of that name changing is bounded — one slow launch per device, then
 * the mark takes over and this is never consulted again. It cannot produce the
 * bug it guards against, because a wrong answer here can only be "wait", never
 * "you are signed out".
 *
 * Supabase clears that entry before it announces a sign-out, so a device that has
 * genuinely signed out reads false here as well as losing its mark.
 */
const storedSupabaseSession = (): boolean => {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const sessionSeen = (): boolean => {
  try {
    if (localStorage.getItem(SEEN_KEY) === "1") return true;
  } catch {
    return false;
  }
  return storedSupabaseSession();
};

/**
 * Forget it, on a sign-out that actually happened.
 *
 * Only ever called for a real one: the deliberate path, and Supabase's own
 * SIGNED_OUT, which it fires when it destroys a session it has decided is dead.
 * A refresh that failed on the network is not one of those, and clearing the
 * mark there would rebuild the bug this module exists to fix.
 */
export const forgetSession = (): void => {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    // Nothing to do. The next launch waits for Supabase to answer rather than
    // assuming, which is the behaviour this whole change is about.
  }
};
