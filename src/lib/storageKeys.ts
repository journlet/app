// Every name this application writes into browser storage, in one place, so
// that erasing a device can enumerate them instead of remembering them.
//
// The fault this exists to prevent had already happened. `wipeThisDevice` in
// store/sync.ts removed exactly one key by hand, and the comment above it said
// that a future addition "must not silently skip the deletion path, which is
// the one where leftovers would be an incomplete erasure rather than an
// inconvenience". Eighteen more keys had been added since it was written. One of
// them was `journlet-pending-journal-key`, which holds the master keeper key in
// plaintext (see lib/pendingKey.ts, and §6.1 on what that credential opens), so
// signing out or deleting the account inside its thirty-minute TTL left the key
// to the journal sitting on a device the spec describes as "holding nothing
// after a wipe" (§12.1 phase 3). The TTL bounded it and the sweep would have
// taken it eventually, which is why nothing caught it: the leak closed itself
// within the half hour, and every test of the erase asserted on the journal
// rather than on what was left beside it.
//
// So the rule is inverted here. A storage name does not exist unless it is
// declared below, and declaring it forces the erase decision to be taken in the
// same breath as the key. tests/storageKeys.test.ts reads src/ and fails on any
// `journlet-` literal that is not in this file, which is what keeps the
// enumeration honest rather than making it a second list to hold in step.

/**
 * What an erase does with a key.
 *
 * `remove`: journal-derived, account-scoped, or credential material. An erase
 * takes it, because the device is meant to hold nothing of this journal
 * afterwards.
 *
 * `keep`: a per-device presentation preference whose value says nothing about
 * the journal, the account, or the person holding it. An erase leaves it. The
 * spec is explicit that "wiped" cannot come to mean two things (§6.1j), and
 * losing your theme because you handed a borrowed laptop back would be the
 * second meaning.
 */
export type EraseRule = "remove" | "keep";

interface StorageKey {
  readonly key: string;
  readonly erase: EraseRule;
  /** Why it is classified that way. A test refuses an empty one. */
  readonly why: string;
}

// ---------- credential and account state ----------

/** The keeper key from a scanned QR link, in plaintext, for up to 30 minutes. */
export const PENDING_JOURNAL_KEY = "journlet-pending-journal-key";
/** Whether this device has been told to write the journal key down. */
export const JOURNAL_KEY_SAVED_KEY = "journlet-journal-key-saved";
/** A recovery code was issued and has not been acknowledged. */
export const RECOVERY_PENDING_KEY = "journlet-recovery-pending";
/** A session existed on the last launch, so a cold start should wait for one. */
export const SESSION_SEEN_KEY = "journlet-session-seen";

// ---------- journal-derived state ----------

/** Entry ids whose reminders have already fired. */
export const FIRED_REMINDERS_KEY = "journlet-fired-reminders-v1";
/** Folded groups, keyed by page key and by `later:<month>`. */
export const FUTURELOG_FOLDS_KEY = "journlet-futurelog-folds";
/** An unsent feedback message, in the person's own words. */
export const FEEDBACK_DRAFT_KEY = "journlet-feedback-draft";
/** Whether an entry has ever been logged here, which gates the install prompt. */
export const HAS_CAPTURED_KEY = "journlet-has-captured";

// ---------- per-device preferences ----------

/** Which volume is being written to. */
export const ACTIVE_VOLUME_KEY = "journlet-active-volume";
export const THEME_KEY = "journlet-theme-v1";
export const ORDER_KEY = "journlet-order-v1";
export const FILTER_KEY = "journlet-filter-v1";
export const FILTER_OPEN_KEY = "journlet-filter-open-v1";
/** Sticky capture: last type, priority, inspiration and scope (spec §4.1). */
export const CAPTURE_STICKY_KEY = "journlet-capture-v1";
/** The install banner has been dismissed on this device. */
export const INSTALL_DISMISSED_KEY = "journlet-install-dismissed-v1";
/** This device's handle in the register (spec §6.1c). */
export const DEVICE_ID_KEY = "journlet-device-id";

/**
 * The registry. Order is credential material first, because that is the part
 * where a missing entry is a leak rather than a nuisance.
 */
export const STORAGE_KEYS = [
  {
    key: PENDING_JOURNAL_KEY,
    erase: "remove",
    why: "The master keeper key in plaintext. Leaving it is leaving the journal open.",
  },
  {
    key: JOURNAL_KEY_SAVED_KEY,
    erase: "remove",
    why: "An acknowledgement about this account's key, and a wiped device has no account.",
  },
  {
    key: RECOVERY_PENDING_KEY,
    erase: "remove",
    why: "Names an outstanding recovery code for an account this device has left.",
  },
  {
    key: SESSION_SEEN_KEY,
    erase: "remove",
    why: "Tells the next launch to wait for a session on a device that has just erased everything. Also cleared eagerly by forgetSession(), because signing out offline never reaches Supabase to raise SIGNED_OUT.",
  },
  {
    key: FIRED_REMINDERS_KEY,
    erase: "remove",
    why: "Entry ids from the erased journal, which will never exist again.",
  },
  {
    key: FUTURELOG_FOLDS_KEY,
    erase: "remove",
    why: "Fold state is a device preference, but its keys are page keys and collection ids from the erased journal, so what survives is a map of what used to be here.",
  },
  {
    key: FEEDBACK_DRAFT_KEY,
    erase: "remove",
    why: "The person's own unsent prose. Content, not a preference.",
  },
  {
    key: HAS_CAPTURED_KEY,
    erase: "remove",
    why: "A wiped device is a first-run device, and this is the claim that it is not.",
  },
  {
    key: ACTIVE_VOLUME_KEY,
    erase: "keep",
    why: "Erased by value rather than by absence: wipeThisDevice sets it back to DEFAULT_VOLUME, because a fresh journal has to start on the default volume rather than on whichever one this device was last reading.",
  },
  {
    key: THEME_KEY,
    erase: "keep",
    why: "Light or dark. Says nothing about the journal or the account.",
  },
  {
    key: ORDER_KEY,
    erase: "keep",
    why: "Sort order, one of three fixed values (spec §4.9a).",
  },
  {
    key: FILTER_KEY,
    erase: "keep",
    why: "Which entry types and signifiers are shown. Enum values, no content.",
  },
  {
    key: FILTER_OPEN_KEY,
    erase: "keep",
    why: "Whether the filter row is unfolded.",
  },
  {
    key: CAPTURE_STICKY_KEY,
    erase: "keep",
    why: "Last type, priority, inspiration and scope. Four enums, no content.",
  },
  {
    key: INSTALL_DISMISSED_KEY,
    erase: "keep",
    why: "Per-device by nature (see lib/install.ts). Re-offering the install prompt to somebody who has already refused it is not part of erasing a journal.",
  },
  {
    key: DEVICE_ID_KEY,
    erase: "keep",
    why: "Required to be kept, not merely harmless: the register lives in the journal, and a device that forgot its handle would create a second row on signing back in and leave its own signed-out row standing. That is the fault tests/signOutMark.test.ts was written for.",
  },
] as const satisfies readonly StorageKey[];

// ---------- names that are not localStorage ----------
//
// Declared here so that the enforcement test can be absolute: every `journlet-`
// literal in src/ is accounted for in this file, whatever kind of name it is.
// These two are erased by wipeKeys() and wipeLocalJournal() respectively, which
// delete whole IndexedDB databases and so need no key-level inventory.

/** IndexedDB database holding the keyring (lib/keystore.ts). */
export const KEYRING_DB_NAME = "journlet-keys";
/**
 * Prefix of the IndexedDB document per volume (lib/volume.ts). Byte-for-byte
 * `journlet-journal-v1` for the first volume, so existing journals load
 * unchanged.
 */
export const JOURNAL_DOC_PREFIX = "journlet-journal-";
/**
 * Yjs transaction origin marking an update that arrived from the server, so the
 * push listener does not echo it back (store/journal.ts). Not storage at all.
 */
export const REMOTE_ORIGIN_TAG = "journlet-remote";

/**
 * Erase every key an erase should take.
 *
 * Best effort per key, and deliberately not one try/catch around the loop: a
 * storage quirk on the theme must not stop the pending keeper key from going.
 * The order above puts the credential material first for the same reason.
 */
export const wipeDeviceStorage = (): void => {
  for (const entry of STORAGE_KEYS) {
    if (entry.erase !== "remove") continue;
    try {
      localStorage.removeItem(entry.key);
    } catch {
      // A wipe must not fail on storage quirks.
    }
  }
};
