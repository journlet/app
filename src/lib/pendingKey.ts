// Short-lived holding pen for a journal key that arrived by QR.
//
// The other device shows a link like https://app.journlet.com/#jk=J1-…; the
// phone camera opens it here. The fragment never reaches any server. We stash
// the key locally — it must survive the magic-link redirect — and apply it
// once signed in (see store/sync.ts connect()).
//
// The stashed value is the master keeper key in plaintext, the credential that
// unwraps the data key and therefore the whole journal, so it carries a hard
// expiry. sessionStorage would be the obvious home for something this
// short-lived, but the magic link opens in a new tab, which is a fresh
// sessionStorage container, and that would break the very flow this exists
// for. So: localStorage with a timestamp, swept on launch and enforced on
// read. Without the expiry, a scan that never completes sign-in — common,
// since the user scans and then has to go and find the email — leaves the key
// sitting on disk indefinitely.

const PENDING_KEY = "journlet-pending-journal-key";

/** Generous enough for a slow magic-link round trip, short enough to matter. */
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

export const clearPendingKey = (): void => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // best effort
  }
};

/**
 * The stashed journal key, or null if there is none, it is unreadable, or it
 * has expired. Reading an expired key also removes it.
 */
export const pendingJournalKey = (): string | null => {
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
  return record.k;
};

/**
 * Hold a key that cannot be applied yet.
 *
 * Scanning a QR code needs no session, but *using* the key does: the wrapped
 * data key has to be read from the server before anything can be unwrapped. So
 * a device that has been signed out — including one locked out by a lost-device
 * report — can scan first and sign in second, which is the natural order when
 * the key is on a screen in front of you and the email is not.
 */
export const stashKey = (code: string): void => {
  try {
    const record: PendingKeyRecord = { k: code, t: Date.now() };
    localStorage.setItem(PENDING_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable — manual entry still works
  }
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

/**
 * Drop an expired key from disk on launch, whether or not anything reads it
 * this session. The read path alone would let a stale key sit there until the
 * next link attempt, which may never come.
 */
export const sweepPendingKey = (): void => {
  pendingJournalKey();
};
