// Short-lived holding pen for a journal key that arrived by QR.
//
// The other device shows a link like https://app.journlet.com/#jk=J1-…; the
// phone camera opens it here. The fragment never reaches any server. We stash
// the key locally and apply it once signed in (see store/sync.ts connect()).
//
// The stashed value is the master keeper key in plaintext, the credential that
// unwraps the data key and therefore the whole journal, so it carries a hard
// expiry. sessionStorage would be the obvious home for something this
// short-lived, and localStorage is still the right choice, but the reason
// changed on 4 August 2026 and is worth restating rather than leaving a stale
// one in place. It used to be that the magic link opened a new tab with a
// fresh sessionStorage container. There is no link in the email any more, so
// that particular tab switch is gone. What remains is the gap between scanning
// and signing in: the user leaves for their email client and comes back, and
// iOS is free to discard a backgrounded tab under memory pressure, which would
// empty sessionStorage and break the very flow this exists for. So:
// localStorage with a timestamp, swept on launch and enforced on read. Without
// the expiry, a scan that never completes sign-in, common since the user scans
// and then has to go and find the code, leaves the key sitting on disk
// indefinitely.
//
// Expiry is enforced three ways, because no one of them is enough:
//
//   1. A timer, so a tab left open erases the key at thirty minutes without
//      anything asking for it. Browsers throttle and sometimes freeze timers in
//      background tabs, so this cannot be relied on alone.
//   2. A sweep when the tab becomes visible again, which is what actually
//      covers the common case: the user goes to their email client and comes
//      back, and the timer that should have fired while hidden may not have.
//   3. The check on read, plus a sweep on launch, as the floor.
//
// What none of this covers, and the privacy page says so: if the browser is
// closed before the timer fires, nothing of ours is running, and the key waits
// on disk until the app is next opened. A service worker cannot help, because
// service workers have no access to localStorage at all.

const PENDING_KEY = "journlet-pending-journal-key";

/** Generous enough to go and fetch the emailed code, short enough to matter. */
export const PENDING_TTL_MS = 30 * 60 * 1000;

interface PendingKeyRecord {
  k: string;
  t: number;
}

const isRecord = (v: unknown): v is PendingKeyRecord =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as PendingKeyRecord).k === "string" &&
  typeof (v as PendingKeyRecord).t === "number";

/** The scheduled erase for the key currently held, if there is one. */
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

const cancelExpiry = (): void => {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
};

export const clearPendingKey = (): void => {
  cancelExpiry();
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // best effort
  }
};

/**
 * Schedule the erase for when the key on disk expires, not for a full TTL from
 * now. A reload at minute five has to erase at minute thirty, not at
 * thirty-five, or reloading would extend the life of the credential.
 */
const armExpiry = (): void => {
  cancelExpiry();
  const record = readRecord();
  if (!record) return;
  const left = PENDING_TTL_MS - (Date.now() - record.t);
  if (left <= 0) {
    clearPendingKey();
    return;
  }
  expiryTimer = setTimeout(clearPendingKey, left);
};

/**
 * The stored record, or null if there is none, it is unreadable, or it has
 * expired. Reading an expired record also removes it.
 *
 * Separate from `pendingJournalKey` because the arming needs the timestamp, and
 * because the timestamp must never leave this module: it is the only thing that
 * makes the key ageable, and a caller that could read it could also be tempted
 * to refresh it.
 */
const readRecord = (): PendingKeyRecord | null => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let record: PendingKeyRecord | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) record = parsed;
  } catch {
    // Unparseable, which includes values written by the pre-expiry format.
    // Anything we cannot age is treated as expired and dropped.
  }

  if (!record || Date.now() - record.t > PENDING_TTL_MS) {
    clearPendingKey();
    return null;
  }
  return record;
};

/**
 * The stashed journal key, or null if there is none, it is unreadable, or it
 * has expired. Reading an expired key also removes it.
 */
export const pendingJournalKey = (): string | null => readRecord()?.k ?? null;

/**
 * Hold a key that cannot be applied yet.
 *
 * Scanning a QR code needs no session, but *using* the key does: the wrapped
 * data key has to be read from the server before anything can be unwrapped. So
 * a device that has been signed out — including one locked out by a lost-device
 * report — can scan first and sign in second, which is the natural order when
 * the key is on a screen in front of you and the code is not.
 */
export const stashKey = (code: string): void => {
  try {
    const record: PendingKeyRecord = { k: code, t: Date.now() };
    localStorage.setItem(PENDING_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable, manual entry still works
  }
  armExpiry();
};

/**
 * Take a journal key off the URL fragment, if one is there, and stash it.
 * The fragment is stripped from the address bar either way.
 */
export const stashKeyFromUrl = (): void => {
  const m = window.location.hash.match(/jk=([A-Za-z0-9-]+)/);
  if (!m) return;
  stashKey(m[1]);
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search
  );
};

/** Set once, so repeated calls do not stack listeners. */
let watching = false;

/**
 * Enforce expiry from launch onwards.
 *
 * Drops an already-expired key, whether or not anything reads it this session,
 * because the read path alone would let a stale key sit there until the next
 * link attempt, which may never come. Then schedules the erase for whatever is
 * left of the TTL, and re-checks whenever the tab comes back to the foreground,
 * where a timer that should have fired while hidden may not have.
 */
export const enforcePendingKeyExpiry = (): void => {
  armExpiry();
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") armExpiry();
  });
};
