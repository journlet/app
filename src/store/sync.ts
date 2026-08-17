// Encrypted sync engine (spec §4.5, §6): Supabase is auth plus dumb storage
// of ciphertext. All merge logic is client-side Yjs; every payload is
// encrypted with the journal's data key before it leaves the device.
//
// Reconcile strategy: pull every remote update, decrypt, build a shadow doc
// to learn the remote state vector, apply everything to the live doc, then
// push the diff between live and remote states (covers offline edits in one
// payload). After that, live local transactions push individually and
// realtime inserts stream in from other devices.

import * as Y from "yjs";
import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel, Session, SupabaseClient } from "@supabase/supabase-js";
import { doc, REMOTE_ORIGIN, wipeLocalJournal } from "./journal";
import {
  listDevices,
  onDevicesChange,
  markDeviceRemoved,
  markThisDeviceSignedOut,
  thisDeviceId,
  touchThisDevice,
} from "./devices";
import {
  forgetCredentialNote,
  listCredentialNotes,
  noteEnrolment,
  noteUnlock,
  reconcileRoutes,
} from "./credentials";
import type { RouteListing } from "./credentials";
import { readCurrentEpoch, readKeeperWrappedEpochs } from "./deviceLink";
import {
  countKeeperWraps,
  deleteKeeperWraps,
  listKeeperWraps,
  publishKeeperWrap,
} from "./keeperWraps";
import {
  decryptUpdate,
  encryptUpdate,
  LegacyPayloadError,
  readPayloadEpoch,
  unwrapDataKey,
  importJournalKeyCode,
  exportJournalKeyCode,
} from "../lib/crypto";
import type { WrappedDataKey } from "../lib/crypto";
import {
  newWrapId,
  unwrapKeeperKeyFromAny,
  wrapKeeperKey,
} from "../lib/keeperWrap";
import {
  createCredential,
  credentialIdText,
  deriveSecret,
  secretFingerprint,
  forgetCredential,
  relyingPartyId,
} from "../lib/prf";
import { ensureKeys, replaceKeyRing, wipeKeys } from "../lib/keystore";
// From keyring, not keystore: pure accessors, so the sync tests that stub
// storage still exercise the real key selection.
import { currentDataKey, dataKeyFor } from "../lib/keyring";
import { b64decode, b64encode } from "../lib/base64";
import type { KeyRing } from "../lib/keyring";
import {
  clearPendingKey,
  enforcePendingKeyExpiry,
  pendingJournalKey,
  stashKey,
  stashKeyFromUrl,
} from "../lib/pendingKey";
import { markKeySaved } from "../lib/keySaved";
import { markRecoveryPending } from "../lib/recoveryAck";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";
import {
  clearError,
  getSyncStatus,
  isConfigured,
  resetLinkState,
  setError,
  setRemoved,
  setStatus,
  subscribeSync,
  wasRemoved,
} from "./syncStatus";
import type { SyncStatus } from "./syncStatus";
import { DEFAULT_VOLUME, getActiveVolume, setActiveVolume } from "../lib/volume";

const PAGE = 1000;

// Status and error live in store/syncStatus.ts now, and are re-exported here so
// the UI keeps one import surface for the store. See that file for why the
// listener payload had to stop being the status value.
export type { SyncStatus, SyncSnapshot } from "./syncStatus";
export {
  getSyncError,
  getSyncSnapshot,
  getSyncStatus,
  isConfigured,
  subscribeSync,
  wasRemoved,
} from "./syncStatus";

export const supabase: SupabaseClient | null = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ---------- status + listeners ----------

/**
 * Subscribe to the status alone, called once immediately.
 *
 * Kept for callers that only want the value. Anything that needs the error as
 * well should use subscribeSync with getSyncSnapshot, because an error is a
 * change this callback cannot represent: it fires with a status the consumer
 * already holds, which is exactly the bail-out that hid it.
 */
export const onSyncStatus = (fn: (s: SyncStatus) => void): (() => void) => {
  fn(getSyncStatus());
  return subscribeSync(() => fn(getSyncStatus()));
};

// ---------- helpers ----------

interface WrappedKeyJson {
  v: number;
  iv: string;
  blob: string;
}

const wrappedToJson = (w: WrappedDataKey): WrappedKeyJson => ({
  v: w.v,
  iv: b64encode(w.iv),
  blob: b64encode(w.blob),
});

const wrappedFromJson = (j: WrappedKeyJson): WrappedDataKey => ({
  v: j.v,
  iv: b64decode(j.iv),
  blob: b64decode(j.blob),
});

/**
 * What a device is told when its journal has been rotated past it.
 *
 * Not an outage and not a lockout: everything up to the last rotation reads
 * normally, and the fix is having a device that holds the new key open at the
 * same time as this one. Said in one place so the banner, the Sync screen and the
 * console all say the same thing.
 */
const MISSING_EPOCH_KEY =
  "This device does not have the newest key for your journal yet. Open Journlet on another of your devices while this one is open, and it will catch up.";

/** A stored row written under an epoch this device holds no key for. */
class MissingEpochKeyError extends Error {
  constructor(epoch: number) {
    super(`No key held for epoch ${epoch}`);
    this.name = "MissingEpochKeyError";
  }
}

// ---------- engine state ----------

let session: Session | null = null;
let ring: KeyRing | null = null;
let channel: RealtimeChannel | null = null;
let connectedUserId: string | null = null;
let dirty = false;
let started = false;
/**
 * Has this device ever pulled the account's journal successfully?
 *
 * The difference between "your journal is empty" and "I could not fetch your
 * journal" is invisible from the doc alone: both are an empty local journal.
 * Without this the app showed four empty sections and a "waiting" badge when a
 * transient server error stopped the first reconcile, which reads as having lost
 * everything (reported 29 Jul, after a "JWT issued at future" clock error).
 */
let syncedOnce = false;

export const hasSyncedOnce = (): boolean => syncedOnce;

// Persistent shadow of the server's state this session: what the server
// has (by id high-water mark) and its CRDT state vector, so catch-ups
// fetch only unseen rows and pushes send only what the server lacks.
let shadow: Y.Doc | null = null;
let lastMaxId = 0;

const ensureShadow = (): Y.Doc => (shadow ??= new Y.Doc());

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Would sending this diff change anything for a peer that already holds the
 * shadow's state?
 *
 * Yjs includes the entire delete set in every state-vector diff, because
 * tombstones are not covered by a state vector. So on any journal where an
 * entry has ever been deleted — completed, migrated, struck through —
 * `encodeStateAsUpdate(doc, stateVector(shadow))` returns a non-empty update
 * even when the shadow already has everything, and returns the *same bytes*
 * every time. Treating "longer than an empty update" as "the server needs this"
 * therefore re-pushed the whole delete set on every reconcile: every launch,
 * every foreground, every socket rejoin, for the life of the journal. On a
 * nine-day-old journal that was 374 bytes a time and the single largest source
 * of rows in the log.
 *
 * The probe runs on a throwaway copy rather than the shadow itself, so a push
 * that then fails cannot leave the shadow believing the server holds something
 * it does not — that direction loses data, where a redundant row only wastes
 * space.
 */
const wouldChangeServer = (sh: Y.Doc, diff: Uint8Array): boolean => {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(sh));
    const before = Y.encodeStateAsUpdate(probe);
    Y.applyUpdate(probe, diff);
    return !sameBytes(before, Y.encodeStateAsUpdate(probe));
  } finally {
    probe.destroy();
  }
};

/**
 * Drop the sync connection, leaving the session and the link state alone.
 *
 * Load-bearing rather than tidy-up. doConnect's early-out is
 * `connectedUserId === session.user.id && channel`, so a device that has ever
 * connected will refuse to run another connect until one of those is cleared. A
 * device that has just discovered it cannot read the newest rows — removed, or
 * merely behind a rotation — is in exactly that position, and every later
 * connect() silently did nothing: approving it left "Opening your journal…" on
 * screen until the app was restarted (Gary, 3 August). Restarting worked because
 * it cleared this module's state, which is to say the fix was here all along.
 */
const dropConnection = () => {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  connectedUserId = null;
  shadow?.destroy();
  shadow = null;
  lastMaxId = 0;
};

const teardown = () => {
  dropConnection();
  // Link state belongs to a session and a keyring, both of which are going.
  // A pending-approval card left on screen after a sign-out would offer to
  // grant a device access with a data key this device no longer holds.
  keeperUsable = false;
  resetLinkState();
};

// Writes are serialised. The shadow doc only learns that the server has an
// update once the insert *completes*, so anything that computes a diff against
// the shadow while a push is in flight will compute that same update again and
// send it twice. A live edit racing the reconcile fired by visibilitychange is
// the easy way to hit it: background and foreground the app just after typing
// and you get two identical rows a few hundred milliseconds apart.
//
// Everything that inserts, and every diff computed to decide what to insert,
// therefore runs through this queue. Failures do not break the chain.
let writeQueue: Promise<unknown> = Promise.resolve();

const serialised = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
};

// Push diagnostics. Duplicate rows have been chased twice on timing and length
// alone, which cannot distinguish one update sent twice from two different
// updates that happen to be the same size. This records what was actually sent,
// content-addressed, so the question is answerable rather than inferable.
// Readable on a phone via window.__journletPushLog.
interface PushRecord {
  at: string;
  source: string;
  bytes: number;
  hash: string;
}

const pushLog: PushRecord[] = [];

const shortHash = async (bytes: Uint8Array): Promise<string> => {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest).slice(0, 5))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "unhashable";
  }
};

const recordPush = async (
  source: string,
  update: Uint8Array
): Promise<void> => {
  const rec: PushRecord = {
    at: new Date().toISOString(),
    source,
    bytes: update.length,
    hash: await shortHash(update),
  };
  pushLog.push(rec);
  if (pushLog.length > 50) pushLog.shift();
  console.info(
    `journlet push [${rec.source}] ${rec.bytes}b ${rec.hash} ${rec.at}`
  );
  (window as unknown as { __journletPushLog?: PushRecord[] })
    .__journletPushLog = pushLog;
};

/** Why a reconcile ran, for the diagnostics above. */
type SyncTrigger =
  | "connect"
  | "visibility"
  | "online"
  | "socket-rejoin"
  | "live-edit"
  | "retry"
  | "sign-out";

// The raw insert. Only ever called from inside the write queue — call
// pushPayload instead, or serialise it yourself alongside the diff that
// produced it.
const insertPayload = async (
  update: Uint8Array,
  source: SyncTrigger
): Promise<boolean> => {
  if (!supabase || !session || !ring) return false;
  try {
    await recordPush(source, update);
    // One read of the active volume, used for both the AAD and the row, so the
    // binding can never disagree with where the row actually lands.
    const volume = getActiveVolume();
    const writeKey = currentDataKey(ring);
    // Refusing to write is the right failure here. Falling back to an older
    // epoch's key would produce rows that every up-to-date device can read and
    // none would write beside, which is a fork rather than an outage.
    if (!writeKey) throw new Error(MISSING_EPOCH_KEY);
    const payload = b64encode(
      await encryptUpdate(
        writeKey,
        update,
        { userId: session.user.id, volume },
        ring.epoch
      )
    );
    const { error } = await supabase
      .from("journal_updates")
      .insert({ payload, volume });
    if (error) throw new Error(error.message);
    // the server now has it — reflect that in the shadow immediately
    Y.applyUpdate(ensureShadow(), update);
    return true;
  } catch (e) {
    dirty = true;
    setError(e);
    setStatus(navigator.onLine ? "pending" : "offline");
    // Arm the retry here rather than leaving it to the caller. A push that
    // fails after this device has connected once used to schedule nothing at
    // all — see scheduleRetry — so the entry sat unsent until a foreground or a
    // network event happened along.
    scheduleRetry();
    return false;
  }
};

const pushPayload = (
  update: Uint8Array,
  source: SyncTrigger
): Promise<boolean> => serialised(() => insertPayload(update, source));

// Live local edits (origin null = our own transactions; y-indexeddb loads
// and remote applies carry their own origins and must not echo back)
doc.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin !== null || !session || !connectedUserId) return;
  void pushPayload(update, "live-edit").then((ok) => {
    if (ok && !dirty) setStatus("synced");
  });
});

// ---------- journal key handling ----------

/**
 * Whether this device's keeper key is known to open this account's journal.
 *
 * Every fresh device generates a keeper key on first launch, and on a device
 * that is linking to an existing journal that key is simply wrong. Without this
 * flag the Sync screen would happily render it as the recovery code: thirteen
 * groups of characters that look exactly like the real thing and open nothing.
 * A recovery code that does not work is worse than no recovery code, because it
 * gets written down and trusted.
 */
let keeperUsable = false;

// Returns true when this device's keys are good for the remote journal
const ensureJournalKeys = async (): Promise<boolean> => {
  if (!supabase || !ring) return false;
  /**
   * The keyring this connect belongs to, held rather than re-read.
   *
   * `ring` is module state and wipeThisDevice() sets it to null, so a sign-out or
   * an account deletion can take it away from under this function at any of its
   * dozen awaits. TypeScript keeps the narrowing from the guard above across every
   * one of them, so `ring.epoch` compiles and then throws at runtime. It did: an
   * unhandled TypeError in CI, from a test whose device was still polling after
   * teardown, which is the same shape as a user signing out while this runs.
   *
   * Reads below use `held`, which cannot become null. The publish checks that
   * `ring` is still this ring, because a connect whose keyring has been wiped must
   * abandon rather than write one back for an account that has just been left.
   */
  const held = ring;
  const { data, error } = await supabase
    .from("journals")
    .select("wrapped_key")
    .maybeSingle();
  if (error) {
    setError(`Server error reading your journal: ${error.message}`);
    setStatus(navigator.onLine ? "pending" : "offline");
    return false;
  }
  if (!data) {
    // First device: publish our wrapped data key.
    //
    // A device with no keeper key cannot create a journal, and should never be
    // here: not having one means it was approved by another device, which means a
    // journal existed. If the row has gone missing under it, creating a new one
    // would abandon the old ciphertext and look like total data loss, so it says
    // so instead.
    if (!held.keeperKey || !held.wrapped) {
      setError(
        "This account's journal record is missing. This device was linked by another device, so it cannot recreate it."
      );
      setStatus(navigator.onLine ? "pending" : "offline");
      return false;
    }
    const { error: insErr } = await supabase.from("journals").insert({
      user_id: session?.user.id,
      wrapped_key: wrappedToJson(held.wrapped),
    });
    if (insErr) {
      setError(`Server error saving your journal key: ${insErr.message}`);
      setStatus(navigator.onLine ? "pending" : "offline");
      return false;
    }
    // This device just brought a journal into existence, so its recovery code
    // exists and nobody has seen it. Marked only here: a device that adopts an
    // existing journal has just been handed the code and does not need telling
    // (decision 4, spec device-identity-design.md).
    markRecoveryPending();
    keeperUsable = true;
    return true;
  }
  // Journal exists. Gather every epoch key this device can get hold of, by both
  // routes: the keeper key opens all of them, a per-device wrapped row opens one.
  let epoch0Wrapped: WrappedDataKey | undefined;
  let keeperKey0: CryptoKey | undefined;

  if (held.keeperKey) {
    try {
      epoch0Wrapped = wrappedFromJson(data.wrapped_key as WrappedKeyJson);
      keeperKey0 = await unwrapDataKey(epoch0Wrapped, held.keeperKey);
      keeperUsable = true;
    } catch {
      // This device holds a keeper key that will not open the account's journal.
      // Inferring anything more from this — that the key must have been
      // *changed*, and therefore that this device has been locked out and should
      // sign itself out — is what the retreat of 28 July removed, and it caused
      // two worse bugs than the one it addressed. See spec §6.1b.
      keeperUsable = false;
      epoch0Wrapped = undefined;
    }
  }

  /**
   * Keys already on this device, but only when they can be trusted to be the
   * account's.
   *
   * Every fresh install generates its own keyring, so a device that still holds
   * an unproven keeper key also holds a data key of its own invention. Seeding
   * from it unconditionally — which is what I wrote first — made such a device
   * believe it held epoch 0, skip asking to be added, and then decrypt nothing
   * while reporting itself entitled. A ring with no keeper key was granted its
   * keys by another device, so those are genuine.
   */
  const keys = new Map(
    held.keeperKey && !keeperUsable ? [] : held.dataKeys
  );
  if (keeperKey0) keys.set(0, keeperKey0);

  // Later epochs under the keeper key. Every device that can read the journal holds
  // that key since §12.1 phase 7, so this is the only route to an epoch now: the
  // per-device grants that used to sit above this were the mechanism for devices
  // admitted by approval, and approval is gone.
  if (keeperUsable && held.keeperKey) {
    try {
      for (const [epoch, wrappedJson] of await readKeeperWrappedEpochs(supabase)) {
        if (keys.has(epoch)) continue;
        keys.set(
          epoch,
          await unwrapDataKey(
            wrappedFromJson(wrappedJson as WrappedKeyJson),
            held.keeperKey
          )
        );
      }
    } catch (e) {
      console.warn("[devices] could not read the journal keys", e);
    }
  }

  if (keys.size === 0) {
    // Nothing at all: this device cannot open the journal yet. The unlock screen
    // offers the two routes that remain, and nothing is published on this device's
    // behalf — there is no longer anything to publish, since §12.1 phase 7 removed
    // the request table along with approval.
    setStatus("needs-key");
    return false;
  }

  let epoch = held.epoch;
  try {
    epoch = await readCurrentEpoch(supabase);
  } catch (e) {
    // Reading it failed, so trust the highest key actually held rather than a
    // remembered number. Guessing high would stop this device writing at all.
    epoch = Math.max(...keys.keys());
    console.warn("[devices] could not read the current epoch", e);
  }

  // Still ours? If not, a sign-out or a deletion happened while we were reading
  // and this connect is stale. Publishing here would restore a keyring for an
  // account the user has just left.
  if (ring !== held) return false;
  // Built as a const and then published, so everything after this point reads a
  // value that cannot be nulled underneath it. The awaits below are the same
  // hazard as the ones above, one line later.
  const next: KeyRing = {
    ...held,
    // The keeper key goes if it did not work, deliberately. It never opened this
    // journal, and keeping it would leave something that looks like a recovery
    // code on a device that has no business displaying one.
    keeperKey: keeperUsable ? held.keeperKey : undefined,
    wrapped: epoch0Wrapped,
    dataKeys: keys,
    epoch,
  };
  ring = next;
  await replaceKeyRing(next);

  if (!currentDataKey(next)) {
    // The account has rotated to an epoch whose key this device cannot read. Before
    // §12.1 phase 7 that had three possible meanings and only the server could tell
    // them apart: removed, entitled-but-unproven, or simply behind. Two of those were
    // properties of the grant tables, and with those gone there is one meaning left —
    // the row for this epoch is missing or unreadable under the keeper key this device
    // holds, which is the "behind" case. Removal is now a mark in the register rather
    // than an entitlement on the server, and is read from the journal itself.
    setError(MISSING_EPOCH_KEY);
    setStatus(navigator.onLine ? "pending" : "offline");
    return false;
  }
  setRemoved(false);
  return true;
};

// ---------- what a removed device does, and removing one ----------
//
// All that is left of a much larger section. §12.1 phase 7 deleted approval on
// 14 August 2026: the link requests, the code to compare, the per-device ECDH keys,
// the wrapped-key grants and the standing check all went, along with three tables.
// Two ways in remain, a passkey and the journal key, and both hand over the keeper
// key — so there is no longer any such thing as a device that can read the journal
// and not manage it, which is what the deleted machinery existed to arrange.

/**
 * This device has been marked removed in the register, so stop showing the journal.
 *
 * Cooperative, and that is now the whole of it. Before phase 7, removal also revoked
 * this device's grant on the server and rotated the data key, which genuinely denied
 * it future epochs. Every remaining device holds the keeper key, so a rotation would
 * exclude nobody and is not attempted; what removal does is ask this device to hide
 * its copy, and it obliges because it is the same application. Nothing enforces it,
 * §6.1b has always said as much, and the interface says so where the button is.
 */
const enterRemovedState = (): void => {
  if (wasRemoved()) return;
  dropConnection();
  clearError();
  setStatus("needs-key");
  setRemoved(true);
};

export const canRemoveDevices = (): boolean =>
  Boolean(ring?.keeperKey && keeperUsable);

/**
 * Remove another device from this account.
 *
 * A mark in the register inside the encrypted journal, and nothing else. Until
 * §12.1 phase 7 this also revoked that device's rows and rotated the data key to an
 * epoch it could not read, which was the honest half of the feature: it denied future
 * content. That worked because a device admitted by approval held only a wrapped data
 * key. With approval gone, every device holds the keeper key and can read any epoch
 * from `journal_keys`, so rotating would cost a new key and exclude nobody — a
 * ceremony that looks like revocation and is not, which is precisely the version of
 * this feature built and deleted in July.
 *
 * So what is left is cooperative: the marked device sees the mark in the journal and
 * hides its copy (see enterRemovedState). It obliges because it is the same
 * application, not because anything stops it. §6.1b has said from the start that
 * nothing here can reach a device that simply does not open the app, and the Sync
 * screen says what this button does rather than implying more.
 *
 * Still gated on holding the keeper key, unchanged: a device that cannot read the
 * register has no business editing it, and every device can now.
 */
export const removeDevice = async (deviceId: string): Promise<void> => {
  if (!supabase || !session || !ring?.keeperKey || !keeperUsable)
    throw new Error("Only a device that can open this journal can remove another");
  if (deviceId === thisDeviceId())
    throw new Error("Use sign out to remove this device");

  markDeviceRemoved(deviceId);
};

class KeeperKeyMismatchError extends Error {
  constructor() {
    super("That key does not open this account's journal");
    this.name = "KeeperKeyMismatchError";
  }
}

/**
 * Install a keeper key, having proved it against the journal, and let the connect
 * that follows do the rest.
 *
 * The shared half of every route in. A typed journal key code (§6.1) and a passkey
 * wrap (§6.1e) are two ways of *obtaining* the same key and nothing downstream of
 * that differs, so they meet here rather than in two copies that drift: prove it
 * opens the epoch 0 blob, install a keyring holding only what was proved, stop
 * asking to be approved.
 *
 * Not exported, and neither is adoptJournalKey below, because the pair must be
 * callable from *inside* doConnect while provideJournalKey and unlockWithPasskey
 * end by calling connect(). connect() is single-flight, so calling one of those
 * from within doConnect returns the very promise doConnect is still executing, and
 * awaiting that deadlocks: the connect never finishes, `connecting` is never
 * cleared, and every later trigger gets the same dead promise. That wedged a
 * device linked from a QR scan in needs-key permanently, with no reconcile and no
 * device registration — see the tests in tests/linkPending.test.ts.
 */
const adoptKeeperKey = async (keeperKey: CryptoKey): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  /**
   * The account this adoption is for, captured before the first await.
   *
   * Installing a keyring is the one write in this file that can bring back an
   * account the user has just left: wipeThisDevice() nulls `ring` and drops
   * `session`, and a sign-out landing in any of the awaits below would be followed
   * by an assignment that puts the keys back. Same hazard as the `ring !== held`
   * check in ensureJournalKeys, and the same answer — hold it once, re-check it
   * before publishing, rather than reading module state twice and trusting it not
   * to have moved.
   */
  const forUser = session?.user.id;
  if (!forUser) throw new Error("Sign in before using this key");

  const { data, error } = await supabase
    .from("journals")
    .select("wrapped_key")
    .maybeSingle();
  if (error || !data) throw new Error("Could not fetch your journal from the server");
  const wrapped = wrappedFromJson(data.wrapped_key as WrappedKeyJson);
  let dataKey: CryptoKey;
  try {
    dataKey = await unwrapDataKey(wrapped, keeperKey);
  } catch {
    throw new KeeperKeyMismatchError();
  }
  if (session?.user.id !== forUser)
    throw new Error("Signed out before this key could be used");
  // Epoch 0 only, and only the key just proved. Seeding anything else is the
  // mistake ensureJournalKeys documents at length: a device that believes it holds
  // keys it cannot use reports itself entitled and then decrypts nothing. Later
  // epochs are collected by the connect that follows, which can read journal_keys
  // with this same keeper key.
  const next: KeyRing = {
    keeperKey,
    dataKeys: new Map([[0, dataKey]]),
    epoch: 0,
    wrapped,
    createdAt: Date.now(),
  };
  ring = next;
  await replaceKeyRing(next);
  // Proven by the unwrap above: this key opens this account's journal, so this
  // device can display it as the recovery code.
  keeperUsable = true;
};

/** Adopt a keeper key that arrived as a typed or scanned journal key code. */
const adoptJournalKey = async (code: string): Promise<void> => {
  const keeperKey = await importJournalKeyCode(code);
  try {
    await adoptKeeperKey(keeperKey);
    // Somebody who has just typed or scanned the code plainly has it, so the
    // reminder on the Sync screen has nothing to ask this device (§12.1 phase 5).
    // Only on this path: a passkey unlock proves nothing about where the code is.
    markKeySaved();
  } catch (e) {
    // The wording for someone who has just transcribed sixty-seven characters, and the only
    // thing this path adds over the shared one. SyncView shows the message.
    if (e instanceof KeeperKeyMismatchError)
      throw new Error("That journal key does not match this account's journal");
    throw e;
  }
};

/** Link this device: adopt the journal key code from another device, then sync. */
export const provideJournalKey = async (code: string): Promise<void> => {
  await adoptJournalKey(code);
  await connect();
};

/**
 * Give the journal key to a device that is already syncing without it.
 *
 * A device linked by approval holds a wrapped data key and never held the keeper
 * key, so it can read and write the journal and cannot do the three things that
 * need the keeper key: add a passkey, show the key, remove another device. Until
 * now there was no way to change that — the key entry lives on the unlock screen,
 * which a working device never sees — so such a device stayed second-class unless
 * it was signed out and linked again. That gap is what made "this device cannot
 * set one up" read as a fault with no remedy (Gary, third hardware run).
 *
 * Separate from provideJournalKey for one reason, and it is not cosmetic. Adopting
 * reduces the keyring to epoch 0, because that is all a keeper key proves on its
 * own, and doConnect early-outs on a device that is already connected — so the
 * connect that is supposed to collect the later epochs would return immediately
 * and leave this device holding a key for an epoch the account has moved past.
 * Dropping the connection first is what makes the reconnect real, and it is the
 * same move explainMissingKey makes for the same reason.
 */
export const takeJournalKey = async (code: string): Promise<void> => {
  await adoptJournalKey(code);
  dropConnection();
  await connect();
};

/**
 * Take a journal key that has just arrived, from a QR scan or a paste, and do
 * whatever is possible with it now.
 *
 * Signed in, it links immediately. Signed out, it is held for after sign-in,
 * because using a key means reading the wrapped data key off the server and
 * that needs a session. Both are ordinary paths rather than one being an error:
 * a device locked out by a lost-device report has no session by definition, and
 * scanning before signing in is the natural order when the key is on a screen
 * in front of you and the email has yet to arrive.
 *
 * Lives here rather than in the view so the decision is testable: the scanner's
 * decode loop needs a real canvas and cannot run under jsdom at all, which had
 * left this branch uncovered.
 */
export const acceptJournalKey = async (
  code: string
): Promise<"linked" | "held"> => {
  if (!session) {
    stashKey(code);
    return "held";
  }
  await provideJournalKey(code);
  return "linked";
};

// ---------- unlocking with a passkey (spec §6.1e, §12.1 phase 4) ----------
//
// The third way in, alongside the journal key code and approval by another device,
// and the first one that asks nothing of the person beyond a biometric. The keeper
// key is stored wrapped once per enrolled credential; any single wrap opens it, and
// none is privileged. What follows is only about *obtaining* the key — everything
// after that is adoptKeeperKey above, shared with the typed code.
//
// Nothing calls any of this yet. Phase 4 ships the mechanism invisible and one
// later commit turns enrolment and unlocking on together, because a button that
// enrols a credential before unlocking exists would offer a route that leads
// nowhere, which is the class of half-truth that got the lost-device feature
// deleted on 28 July (§6.1b).

/**
 * This account has no passkey route at all.
 *
 * An answer and not a fault: it is what every account looked like before §6.1e,
 * and what one looks like now until somebody enrols. Separate from the error below
 * because the two need opposite screens — this one says nobody has set this up, and
 * that one says the credential in front of you is not one of the ones that were.
 */
export class NoPasskeyRouteError extends Error {
  constructor() {
    super("No passkey has been set up for this journal");
    this.name = "NoPasskeyRouteError";
  }
}

/**
 * Wraps exist and this credential opened none of them.
 *
 * The ordinary answer on a device whose password manager belongs to a different
 * ecosystem from every credential enrolled so far — an iCloud passkey met on
 * Windows, say — which is the case §6.1e adds a second wrap for. So the route out
 * is enrolling this one from a device that is already unlocked, or the journal key
 * code, and not retrying.
 */
export class UnknownCredentialError extends Error {
  /**
   * Whether the credential answered from another device over the platform's QR
   * tunnel, which changes what this failure most likely means.
   *
   * Locally it means what it says: this credential is not one of the enrolled ones.
   * Over the tunnel it may mean that and it may mean the transport, because PRF is
   * not carried faithfully across it by every password manager — a Google Password
   * Manager credential opens its own wrap when Chrome reaches it locally and returns
   * a different secret when the same credential is reached by QR, while an iCloud
   * Keychain one is consistent (Gary's hardware, 13 August 2026). The screen has to
   * say something different in that case, because "not set up here" would send
   * somebody off to delete a passkey that works.
   */
  readonly viaTunnel: boolean;
  constructor(viaTunnel = false) {
    super("That passkey is not one of the ones set up for this journal");
    this.name = "UnknownCredentialError";
    this.viaTunnel = viaTunnel;
  }
}

/**
 * How many passkey routes this account has, without opening any of them.
 *
 * What a screen needs to decide whether to offer the biometric at all. Null rather
 * than zero when there is no session or no sync: the table cannot be read without
 * one, and zero would be a claim rather than an answer.
 */
export const countPasskeyRoutes = async (): Promise<number | null> => {
  if (!supabase || !session) return null;
  return countKeeperWraps(supabase);
};

/**
 * Whether this device can add a passkey route at all.
 *
 * Wrapping needs the keeper key, so enrolment requires already being unlocked —
 * the same entitlement logic as approving a device (§6.1d), and §6.1e says it
 * needs no separate rule. The same condition as canRemoveDevices for an unrelated
 * reason, and kept separate for that reason: one is about rotating, this one is
 * about wrapping, and a future change to either must not silently move the other.
 *
 * A device linked by approval holds no keeper key and so answers false. It is not
 * offered the button, and the screen says why rather than failing at the tap.
 */
export const canEnrolPasskey = (): boolean =>
  Boolean(ring?.keeperKey && keeperUsable);

/**
 * Add a passkey route: create a credential, prove it can produce a secret, wrap
 * the keeper key under it, publish the row.
 *
 * Two platform sheets, and the interface has to say so beforehand. Creating is one
 * prompt and deriving is a second, because the eval cannot be attached to a
 * creation on Safari — and because the derive is the only way to find out whether
 * this credential manager implements the extension at all. Writing a wrap without
 * deriving first would mean storing a route that might not open.
 *
 * Nothing is written unless both sheets succeed, so the failures leave the account
 * exactly as it was. A credential may survive a failure in the person's password
 * manager with nothing pointing at it, which is untidy rather than harmful, and
 * the screen says so instead of pretending it cleaned up.
 */
export const enrolPasskey = async (): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  const userId = session?.user.id;
  if (!userId) throw new Error("Sign in before setting up a passkey");
  // Held once. Everything below is awaits, and the keeper key must not be read
  // again out of module state that a sign-out can empty underneath it.
  const held = ring;
  if (!held?.keeperKey || !keeperUsable)
    throw new Error(
      "This device does not hold the journal key, so it cannot set up a passkey"
    );

  /**
   * Refused outright anywhere but journlet.com, which §12.1 makes binding on every
   * phase of this work.
   *
   * The Relying Party ID is the one decision in the design that cannot be taken
   * back: a credential is bound to the domain it was created against, and one
   * enrolled from the Pages default host or a preview deployment is invisible from
   * app.journlet.com for ever. Since relyingPartyId answers undefined off
   * journlet.com, letting enrolment run there would silently create exactly that
   * credential and report a route the app can never use. Disabled rather than
   * pointed somewhere else, which is what the rule says.
   *
   * The cost is that enrolment cannot be exercised on localhost. That is already
   * true in practice — it can only be tested on hardware from app.journlet.com —
   * and a credential made in development would not follow the app anywhere.
   */
  const rpId = relyingPartyId(location.hostname);
  if (!rpId)
    throw new Error(
      "Passkeys can only be set up on journlet.com. This copy of the app is served from somewhere else, and a passkey created here could never open your journal on the real one."
    );
  const { id: credentialId, provider } = await createCredential(
    { email: session?.user.email ?? "" },
    rpId
  );
  // Naming the credential just created, deliberately: left open, the platform may
  // answer with an older Journlet passkey and the wrap would belong to that one,
  // so this enrolment would add no new route while reporting that it had.
  const { secret, attachment } = await deriveSecret(rpId, credentialId);

  const wrapId = newWrapId();
  const wrapped = await wrapKeeperKey(held.keeperKey, secret, {
    userId,
    wrapId,
  });
  if (session?.user.id !== userId)
    throw new Error("Signed out before the passkey could be saved");
  await publishKeeperWrap(supabase, userId, wrapId, wrapped);
  // Recorded only once the route exists, so a failed publish leaves no note
  // describing something that was never saved (§6.1l). The route is kept because a
  // wrap belongs to a credential *and* a transport: §6.1k measured the same
  // credential deriving a different secret through the phone, so a wrap written
  // over one route keeps working over that route and not necessarily the other.
  noteEnrolment({
    wrapId,
    credentialId: credentialIdText(credentialId),
    fingerprint: await secretFingerprint(secret),
    // Where the platform named it: an AAGUID this build does not know, or one the
    // client anonymised, leaves the row without a provider rather than with a guess.
    provider,
    attachment,
  });
};

/**
 * Start the passkeys again: enrol one here, then remove every route that existed
 * before it (spec §11 Q13 answered 12 August 2026, §12.1 phase 6).
 *
 * What this is, stated as narrowly as the mechanism allows. It is not revocation. A
 * credential that has already unwrapped the keeper key holds it, and nothing here or
 * anywhere else can take that back — only rotating the keeper key could, and that
 * would invalidate every written-down copy of the journal key code and require every
 * other credential to be present to be re-wrapped, which Q13 declined for now.
 *
 * What it is for is the case §6.1f found: enrolling twice in one password manager
 * replaces the credential and leaves a wrap nothing can open, so the count of routes
 * overstates. This is also the only shape per-credential removal can honestly take,
 * because §6.5 keeps credential ids off the rows — the client can count them and
 * cannot tell one from another, so "remove that one" is not a sentence this interface
 * can mean.
 *
 * Order matters and is the whole safety of it. Enrol first, then delete the ids read
 * *before* enrolling. A failure anywhere leaves the account with more routes than it
 * needs rather than none, and a wrap written by another device in the meantime is not
 * swept up by a call that never saw it.
 */
export const replaceAllPasskeys = async (): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  const before = (await listKeeperWraps(supabase)).map((r) => r.wrapId);
  await enrolPasskey();
  await deleteKeeperWraps(supabase, before);
  // And every note no route answers, not merely the ones this call removed (Gary, 13
  // August 2026: "surely if I click start again every reference should be removed").
  // He is right, and the first version of this was scoped wrongly: forgetting only
  // `before` left anything orphaned by an earlier restart in the register for good,
  // so an action whose whole promise is one passkey and a clean list delivered a list
  // with wreckage on it.
  //
  // Computed from a fresh read rather than from `before`, which is what keeps §6.1h's
  // ordering discipline intact: a wrap another device published while this was running
  // is in that read, so its note is not swept, and only notes with no route at all go.
  //
  // The cost, stated because it is real: a stray can be the trace of a route somebody
  // else removed, and sweeping loses it. Acceptable only here, in an action that
  // replaces every route on the account anyway, and never on its own.
  //
  // Tidying must not fail a reset that has already happened, so a read that throws
  // leaves the notes rather than the caller believing the passkey was not set up.
  try {
    const live = new Set((await listKeeperWraps(supabase)).map((r) => r.wrapId));
    listCredentialNotes()
      .filter((n) => !live.has(n.wrapId))
      .forEach((n) => forgetCredentialNote(n.wrapId));
  } catch {
    // Left as it was: the routes are correct, and the list can be tidied by hand.
  }
};

/**
 * Every saved route, with what the register knows about each (§6.1l).
 *
 * Built from the server's rows and decorated with the notes, never the other way
 * round: a note that is missing, stale or tampered with must leave an unlabelled
 * route on the screen rather than a route missing from it. `strays` are notes whose
 * wrap has gone, usually because another device removed it.
 *
 * The reason this exists is reconciliation — laying this list beside what is actually
 * in a password manager and finding the row that matches nothing. It cannot be shown
 * before the journal is open, because the register is inside it (§6.5), and no
 * arrangement of this code will change that.
 */
export const listPasskeyRoutes = async (): Promise<{
  routes: RouteListing[];
  strays: ReturnType<typeof listCredentialNotes>;
}> => {
  if (!supabase) throw new Error("Sync is not configured");
  const wrapIds = (await listKeeperWraps(supabase)).map((r) => r.wrapId);
  return reconcileRoutes(wrapIds, listCredentialNotes());
};

/**
 * Remove one saved route, named by the id the server gave us.
 *
 * What §6.1h ruled out and this makes possible, so its limit has to travel with it:
 * this is not revocation. It withdraws a stored route, and a credential that has
 * already unwrapped the keeper key keeps it, as does anyone holding the journal key
 * code. The interface says so at the point of the action.
 *
 * The id comes from `listPasskeyRoutes`, which read it from `keeper_wraps`, so a
 * corrupted register can misdescribe a route and cannot aim a delete at a different
 * one. The note goes after the row, and only if the row went.
 */
export const removePasskeyRoute = async (wrapId: string): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  await deleteKeeperWraps(supabase, [wrapId]);
  forgetCredentialNote(wrapId);
};

/**
 * Unlock this device from a keeper wrap: derive, trial-decrypt, adopt, connect.
 *
 * Reads the rows *before* asking for the secret, so a device with no route in never
 * raises a platform sheet that could not have led anywhere. The trial decryption is
 * the shape §6.5 forces: the rows carry no credential id, deliberately, since one
 * would tell the operator which password manager somebody uses, so AES-GCM
 * authentication is what picks the row this credential opens.
 *
 * Every failure leaves this device exactly as it was and travels out as itself —
 * no route, an unrecognised credential, a credential manager without the
 * extension, a refusal — because each of the four has a different thing to say and
 * a different way on, and flattening them into one message here is what would make
 * the screen guess (§12.1 phase 4).
 *
 * Public, so it ends in connect(), so nothing inside doConnect may call it. Nothing
 * does and nothing should: the biometric needs a user gesture, so this starts at a
 * button. adoptKeeperKey is the half that is safe in there.
 */
export const unlockWithPasskey = async (): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  // Held rather than re-read, like everywhere else in this file: the trial
  // decryption below binds each row to a user id, and reading `session` again
  // afterwards could bind it to a different one.
  const userId = session?.user.id;
  if (!userId) throw new Error("Sign in before unlocking with a passkey");

  const rows = await listKeeperWraps(supabase);
  if (rows.length === 0) throw new NoPasskeyRouteError();

  const rpId = relyingPartyId(location.hostname);
  const { secret, credentialId, attachment } = await deriveSecret(rpId);
  const opened = await unwrapKeeperKeyFromAny(rows, secret, userId);
  if (!opened) {
    // A credential held on this device that opens nothing is dead for this journal —
    // its wrap was deleted by `start again`, say — so ask its provider to forget it
    // rather than let it be offered for ever with nothing able to say which entry is
    // the useless one. Advisory, feature-detected, unable to throw, and awaited so a
    // provider that acts has acted before the screen speaks.
    //
    // Never for an answer from another device. The tunnel does not carry PRF
    // faithfully for every password manager: on the author's hardware a Google
    // Password Manager credential opens its own wrap locally and returns a different
    // secret when the same credential is reached by QR, while an iCloud Keychain one
    // is consistent. Signalling there would delete a working passkey on the strength
    // of a transport quirk, so an unreported attachment counts as cross-platform.
    if (credentialId && attachment === "platform")
      await forgetCredential(rpId, credentialId);
    throw new UnknownCredentialError(attachment !== "platform");
  }

  await adoptKeeperKey(opened.keeperKey);
  await connect();
  // After the connect rather than before it, which is the ordering §6.1c had to
  // correct in the device register: this device's journal arrives during that call,
  // and writing first meant the write raced the merge instead of riding it.
  //
  // The wrap is known rather than guessed — `unwrapKeeperKeyFromAny` reports which
  // row authenticated — so this is the one place the app can say a particular saved
  // route works, which is what makes a row that never fills in meaningful.
  noteUnlock({
    wrapId: opened.wrapId,
    credentialId: credentialId ? credentialIdText(credentialId) : undefined,
    fingerprint: await secretFingerprint(secret),
    attachment,
  });
};

/**
 * The recovery code, or null on a device that has no business showing one.
 *
 * Null in two cases. A device linked by approval never held the keeper key at
 * all. A device that has not yet proven its keeper key against this account holds
 * one that is almost certainly wrong — every fresh install generates one — and
 * rendering that would produce a plausible-looking code that opens nothing. A
 * recovery code that does not work is worse than none, because it gets written
 * down and relied on.
 */
export const getJournalKeyCode = async (): Promise<string | null> => {
  const r = ring ?? (await ensureKeys());
  if (!r.keeperKey || !keeperUsable) return null;
  return exportJournalKeyCode(r.keeperKey);
};

// Row count of the append-only log for the active volume — instrumentation for
// the volume-close nudge (remediation item 15). Head-only count, no payloads
// fetched. Null when sync is unconfigured or signed out.
export const countUpdates = async (): Promise<number | null> => {
  if (!supabase || !session) return null;
  const { count, error } = await supabase
    .from("journal_updates")
    .select("id", { count: "exact", head: true })
    .eq("volume", getActiveVolume());
  return error ? null : count ?? null;
};

// ---------- reconcile + realtime ----------

// A row that will not decrypt is either an expected leftover from the retired
// payload format or a genuine problem — tampering, truncation, corruption. The
// two must not look the same. Legacy rows are counted and ignored; anything
// else is counted and surfaced, because a journal that quietly drops content
// while the badge reads "synced" is worse than one that admits a problem.
//
// Since epochs there is a third kind, and it matters that it is separate: a row
// written under a key this device has not been given yet is neither corrupt nor
// retired. It will read perfectly as soon as another device passes the key along.
// Counting it as undecryptable would tell someone their writing may be lost when
// nothing is lost at all.
interface SkipTally {
  legacy: number;
  undecryptable: number;
  behind: number;
}

const newTally = (): SkipTally => ({
  legacy: 0,
  undecryptable: 0,
  behind: 0,
});

const decryptRow = async (
  payloadB64: string,
  tally: SkipTally
): Promise<Uint8Array | null> => {
  if (!ring || !session) return null;
  try {
    const payload = b64decode(payloadB64);
    // The epoch is the one thing that *is* read from the row, because it selects
    // which key to try and there is no other way to know. It is authenticated by
    // being inside the AAD, so a forged epoch picks a key that then fails.
    const epoch = readPayloadEpoch(payload);
    const key = dataKeyFor(ring, epoch);
    if (!key) throw new MissingEpochKeyError(epoch);
    // Expected values, never the row's own: a blob moved between volumes or
    // replayed into another account must fail here.
    return await decryptUpdate(key, payload, {
      userId: session.user.id,
      volume: getActiveVolume(),
    });
  } catch (e) {
    if (e instanceof LegacyPayloadError) tally.legacy += 1;
    else if (e instanceof MissingEpochKeyError) tally.behind += 1;
    else tally.undecryptable += 1;
    return null;
  }
};

const reportTally = (tally: SkipTally): void => {
  if (tally.undecryptable > 0) {
    setError(
      `${tally.undecryptable} synced ${
        tally.undecryptable === 1 ? "update" : "updates"
      } could not be decrypted and ${
        tally.undecryptable === 1 ? "was" : "were"
      } skipped. Some recent writing may be missing from this device.`
    );
  }
  else if (tally.behind > 0) {
    // Said instead of the message above, not alongside it: on a device that is
    // behind, both counts can be non-zero and the accurate, actionable one is this.
    //
    // One message rather than a round trip since §12.1 phase 7. This used to ask the
    // server which of removed, unproven or behind applied, because the answer lived in
    // the grant tables. Those are gone: a device that cannot read an epoch is behind,
    // and removal is a mark in the register which the register itself reports.
    setError(MISSING_EPOCH_KEY);
  }
  if (tally.legacy > 0) {
    // Not a fault: these are pre-AAD rows that are never read again. Logged
    // rather than surfaced so the migration is visible without alarming.
    console.info(
      `journlet: ignored ${tally.legacy} update(s) in the retired payload format`
    );
  }
};

const applyRemotePayload = async (payloadB64: string): Promise<void> => {
  const tally = newTally();
  const update = await decryptRow(payloadB64, tally);
  if (update) {
    // The shadow tracks what the server holds, and a row delivered by realtime
    // is by definition already there. Without this the shadow never learns
    // about other devices' edits, so the next reconcile computes them as a
    // local diff and pushes them straight back — one duplicate row per remote
    // edit, forever. It terminates rather than storming (the originating
    // device's shadow does have the update, so it will not echo again), which
    // is why it went unnoticed: the log just quietly grew at twice the rate.
    Y.applyUpdate(ensureShadow(), update);
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  }
  reportTally(tally);
};

let reconciling = false;

const reconcile = async (trigger: SyncTrigger): Promise<boolean> => {
  if (!supabase || !ring || reconciling) return false;
  reconciling = true;
  const sh = ensureShadow();
  const tally = newTally();
  try {
    // Fetch only rows this session hasn't seen yet
    for (;;) {
      const { data, error } = await supabase
        .from("journal_updates")
        .select("id,payload")
        .eq("volume", getActiveVolume())
        .gt("id", lastMaxId)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const update = await decryptRow(row.payload as string, tally);
        if (update) {
          // The shadow only ever learns about updates we could actually read,
          // which is what makes the migration below work by itself.
          Y.applyUpdate(sh, update);
          Y.applyUpdate(doc, update, REMOTE_ORIGIN);
        }
        lastMaxId = Math.max(lastMaxId, row.id as number);
      }
      if (!data || data.length < PAGE) break;
    }
    // Push whatever the server is missing (offline edits, first sync).
    //
    // This is also the entire migration off the retired payload format. On the
    // first sync after the upgrade every stored row is legacy, so the shadow
    // stays empty, so this diff is the whole local journal and goes up as a
    // single v2 payload. Nothing has to read the old rows to convert them, and
    // because Yjs updates merge idempotently it does not matter how many
    // devices do this or in what order.
    // Inside the write queue, so any live push started while we were fetching
    // has settled into the shadow before the diff is taken. Otherwise this
    // recomputes that update and sends a duplicate.
    const ok = await serialised(async () => {
      const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(sh));
      if (diff.length <= 2) return true;
      // Not enough to be non-empty: it has to actually tell the server
      // something. See wouldChangeServer.
      if (!wouldChangeServer(sh, diff)) return true;
      return insertPayload(diff, trigger);
    });
    if (!ok) return false;
    reportTally(tally);
    dirty = false;
    if (connectedUserId) setStatus("synced");
    return true;
  } catch (e) {
    setError(e);
    setStatus(navigator.onLine ? "pending" : "offline");
    scheduleRetry();
    return false;
  } finally {
    reconciling = false;
  }
};

const subscribe = () => {
  if (!supabase || !session || channel) return;
  let everSubscribed = false;
  channel = supabase
    .channel("journal-updates")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "journal_updates",
        // Realtime filters on a single column; the volume is checked in the
        // handler so inserts to another volume are ignored by this doc.
        filter: `user_id=eq.${session.user.id}`,
      },
      (msg) => {
        const row = msg.new as { payload?: string; volume?: string };
        if (row.volume && row.volume !== getActiveVolume()) return;
        if (row.payload) void applyRemotePayload(row.payload);
      }
    )
    .subscribe((state) => {
      if (state === "SUBSCRIBED") {
        // A re-join after a dropped socket means events were missed while
        // down (realtime has no replay) — reconcile to catch up
        if (everSubscribed) void reconcile("socket-rejoin");
        everSubscribed = true;
      }
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        setStatus(navigator.onLine ? "pending" : "offline");
        // A dropped socket has no replay, so the events missed while it was
        // down are only recovered by a reconcile. Supabase re-joins on its own
        // and the "SUBSCRIBED" branch above catches that, but a channel that
        // stays down leaves this device silently behind — which on a desktop
        // tab that is never backgrounded means indefinitely.
        scheduleRetry();
      }
    });
};

const doConnect = async (): Promise<void> => {
  if (!supabase || !session) return;
  if (connectedUserId === session.user.id && channel) return;
  clearError();
  setStatus("connecting");
  ring = await ensureKeys();
  if (!(await ensureJournalKeys())) {
    // A QR-scanned key may be waiting — try it before asking the user.
    const pending =
      getSyncStatus() === "needs-key" ? pendingJournalKey() : null;
    if (!pending) return;
    let adopted = false;
    try {
      // adoptJournalKey, never provideJournalKey: the latter ends in connect(),
      // which from here is this same doConnect and deadlocks on itself.
      await adoptJournalKey(pending);
      adopted = true;
    } catch {
      // wrong or stale key — leave needs-key showing for manual entry
    } finally {
      // Always clear it: the pending key is the master keeper key in
      // plaintext, applied at most once. Whether the link succeeded or
      // failed, it must never linger in localStorage — manual entry is a
      // separate path and does not read this value.
      clearPendingKey();
    }
    if (!adopted) return;
    // Adopting proved the key unwraps the server's blob, so carry on into the
    // same connect rather than asking the caller to start another. This is what
    // makes a QR link reach reconcile and register the device at all.
    setStatus("connecting");
  }
  clearPendingKey(); // linked without needing it
  if (!(await reconcile("connect"))) return;
  syncedOnce = true;
  // Register this device (see store/devices.ts) only once the journal has been
  // pulled, so it is looking at the register the account actually has.
  //
  // This ran before the reconcile until 29 July, to save a second push. On a
  // device that had been wiped and re-linked the local doc is empty at that
  // point, so it never found its existing row: it created a fresh one, the
  // server's row merged in on top, and whichever won the Y.Map conflict decided
  // whether the row kept its history and whether the "signed out" mark was ever
  // cleared. In practice the mark stuck, and a phone that was back and syncing
  // still showed as signed out on the other device.
  //
  // The push it saved was only ever saved when there was nothing to write, and
  // in that case touchThisDevice makes no change and produces no push anyway.
  // So this costs a row exactly when a row is warranted: registering a new
  // device, or an hourly refresh.
  //
  // After connectedUserId is set, which is what lets the live-edit handler push
  // it. Before that assignment the handler ignores every local change, so the
  // row would sit unpushed until some later reconcile happened to notice it.
  connectedUserId = session.user.id;
  subscribe();
  touchThisDevice();
  setStatus("synced");
};

// Single-flight. connect() has four callers — the auth listener, the online
// handler, visibilitychange and provideJournalKey — and doConnect is not
// reentrant: its early-out tests connectedUserId, which is not set until the
// very last line, so two invocations can both get past it and both reconcile.
// A launch that fires two auth events in quick succession is enough.
//
// This is worth having regardless of whether it is the cause of the duplicate
// [connect] pushes seen on 28 July (same update, 125ms apart, one client). I
// could not explain how both reached a push given reconcile already guards
// against overlapping itself, so this is a fix for a real design gap rather
// than a proven diagnosis — see spec §6.1 notes.
let connecting: Promise<void> | null = null;

/**
 * Retry a failed sync on a backoff.
 *
 * Before this, a connect that failed left the app in "pending" until something
 * incidental happened — a foreground, or the network dropping and returning. A
 * transient server error therefore became a stuck app with a working fix nobody
 * could reach: restarting the app was the only way out, which is exactly how the
 * clock-skew error was resolved on 29 Jul.
 *
 * It covered only failures *before* the first successful connect, because the
 * one caller was connect()'s continuation and it armed the timer only when
 * connectedUserId was still unset. Everything that can break afterwards — a
 * refused push, a reconcile that throws, a realtime channel that errors — set
 * "pending" and scheduled nothing. Two escape routes were left, the `online`
 * and `visibilitychange` listeners, and a desktop tab that stays visible and
 * stays online fires neither: reported 17 Aug as a "not syncing" banner that sat
 * there until the tab was reloaded. A phone hits visibilitychange every few
 * minutes, which is why the same fault appeared to clear itself there and gave
 * the two platforms opposite symptoms from one cause.
 *
 * So every failure path arms this now, and the attempt it makes depends on
 * where the device got to (see resync).
 *
 * Backoff rather than a fixed interval, capped, and only while signed in, so a
 * server having a bad minute is not hammered by every device at once.
 */
const RETRY_START_MS = 2_000;
const RETRY_MAX_MS = 60_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_START_MS;

const cancelRetry = () => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = RETRY_START_MS;
};

/**
 * One attempt at getting back in step, whichever half is broken.
 *
 * Before a first successful connect the thing to retry is the connect. After
 * one, the session and the channel are already established and what failed was
 * a push or a fetch, so the thing to retry is a reconcile — and calling
 * connect() there is not merely the wrong choice but a no-op, because doConnect
 * early-outs on `connectedUserId === session.user.id && channel` and returns
 * having done nothing. That is why retryConnect, the "try again" button's
 * implementation, did nothing at all in the state a user is most likely to press
 * it from.
 */
const resync = async (): Promise<void> => {
  if (connectedUserId && channel) {
    await reconcile("retry");
    return;
  }
  await connect();
};

const scheduleRetry = () => {
  // Only for states a retry can actually mend. "needs-key" waits on the user,
  // and retrying it would re-read the journal row every minute for nothing.
  if (retryTimer || !session) return;
  const now = getSyncStatus();
  if (now !== "pending" && now !== "offline") return;
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void resync().finally(() => {
      // Re-arm from here as well as from the failure sites, because a reconcile
      // that fails inside its own catch has already armed the next attempt,
      // while one that fails some other way has not. scheduleRetry reads the
      // status to decide, so "is it still broken" is answered in exactly one
      // place; a success resets the backoff so the next outage starts at two
      // seconds again rather than at a minute.
      if (getSyncStatus() === "synced") cancelRetry();
      else scheduleRetry();
    });
  }, delay);
};

const connect = (): Promise<void> =>
  (connecting ??= doConnect()
    .then(() => {
      if (connectedUserId) cancelRetry();
      else scheduleRetry();
    })
    .finally(() => {
      connecting = null;
    }));

/**
 * Ask again now, for a "try again" button.
 *
 * Through resync, so that a device which connected and then had a push refused
 * actually retries the push. Through connect() this returned immediately having
 * done nothing, and the button reported success by clearing its own spinner.
 */
export const retryConnect = async (): Promise<void> => {
  cancelRetry();
  await resync();
};

// ---------- public API ----------

export const startSync = (): void => {
  if (started || !supabase) return;
  started = true;
  enforcePendingKeyExpiry();
  stashKeyFromUrl();

  supabase.auth.onAuthStateChange((_event, s) => {
    const wasUser = session?.user.id;
    session = s;
    if (!s) {
      teardown();
      // signOutAndWipe() signs out locally, so this fires straight after it.
      // "Not signed in" would be true and useless — it would read as a
      // spontaneous logout with no cause given, which is precisely the
      // confusion this whole change exists to remove.
      setStatus("signed-out");
    } else if (s.user.id !== wasUser || !connectedUserId) {
      void connect();
    }
  });

  // Removal is a mark in the encrypted register since §12.1 phase 7, so this is where
  // a removed device finds out: the mark arrives as ordinary journal content, on the
  // realtime path or the next reconcile, and the register's own observer fires.
  //
  // Read from the register rather than pushed through the snapshot, because the doc is
  // the only place the fact exists. Before phase 7 the server knew — removal deleted
  // this device's grant — and checkStanding asked it. There is nothing to ask now.
  onDevicesChange(() => {
    const mine = listDevices().find((d) => d.isThisDevice);
    if (mine?.removedAt) enterRemovedState();
  });

  window.addEventListener("online", () => {
    if (session) void connect().then(() => dirty && reconcile("online"));
  });
  window.addEventListener("offline", () => {
    if (session) setStatus("offline");
  });

  // Suspended devices (iOS PWAs especially) miss realtime events with no
  // replay — catch up whenever the app comes back to the foreground
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !session) return;
    if (connectedUserId) void reconcile("visibility");
    else void connect();
  });
};

// Ask Supabase to email a sign-in code. Despite the name, this starts sign-in
// rather than completing it: the session is created by verifyEmailCode() below.
//
// No `emailRedirectTo` (removed 4 August 2026). It only ever populated the link
// in the email, and both templates now send the code alone — so the option was
// configuring a link that no longer exists, while implying the redirect path
// was still live. The templates are the enforcement point: a link cannot be
// tapped into the wrong storage container if the email does not contain one.
export const signIn = async (email: string): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw new Error(error.message);
};

// Sign in by typing the 6-digit code from the email — the only way to get
// a session INSIDE an iOS home-screen app, since email links always open
// in the default browser (whose storage is a different container). `type:
// "email"` covers a first-time signup confirmation as well as a returning
// sign-in, so there is one path for both.
export const verifyEmailCode = async (
  email: string,
  code: string
): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: "email",
  });
  if (error) throw new Error(error.message);
};


// Explicit sign-out (item 11): tear down sync, sign out of Supabase, and
// erase this device's journal and keys. Unsynced local changes and the
// journal key are unrecoverable afterwards — the server holds ciphertext
// only — so the UI gates this behind a warning that the key is saved. The
// involuntary path (session expiry, see onAuthStateChange) never calls this;
// it only tears down and shows the "not syncing" banner. Callers reload the
// app immediately after, so a fresh empty journal and a new keyring are
// generated silently, exactly as on a first launch.
// Erase everything this device holds. Shared by sign-out and account deletion
// so the two can never drift on what "wiped" means — a future addition here
// must not silently skip the deletion path, which is the one where leftovers
// would be an incomplete erasure rather than an inconvenience.
const wipeThisDevice = async (): Promise<void> => {
  session = null;
  ring = null;
  await wipeLocalJournal();
  await wipeKeys();
  // Reminders track fired entry ids that no longer exist; reset the active
  // volume so the fresh journal starts on the default (see reminders.ts,
  // volume.ts). Best effort — a wipe must not fail on storage quirks.
  try {
    localStorage.removeItem("journlet-fired-reminders-v1");
  } catch {
    // ignore
  }
  setActiveVolume(DEFAULT_VOLUME);
};

export const signOutAndWipe = async (): Promise<void> => {
  cancelRetry();
  syncedOnce = false;
  // Tell the other devices this one is leaving before tearing sync down. The
  // register lives inside the journal, so this is the only moment it can be
  // said: no other device can detect a sign-out, and after teardown there is no
  // channel to say it on. Best effort — offline, the push fails and the row goes
  // stale instead, which is the old behaviour rather than a new failure.
  try {
    markThisDeviceSignedOut();
    await reconcile("sign-out");
  } catch {
    // Never block leaving on being able to announce it.
  }
  // Nothing on the server to withdraw or surrender any more. Signing out used to
  // retract an outstanding link request and delete this device's key rows, both of
  // which §12.1 phase 7 removed along with the tables they lived in. What remains is
  // the register mark above, which is what the other devices read.
  teardown();
  clearPendingKey();
  if (supabase) {
    try {
      // This device only: wiping one device must not sign the others out.
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Offline: the local wipe still proceeds and the server session lapses.
    }
  }
  await wipeThisDevice();
};

// Account deletion is not in the app. It is a request to the operator, and the
// Sync screen says so and links the page that explains it (assessment Finding
// 24, settled 11 August).
//
// What was here was delete_account(), an RPC granted to authenticated that
// destroyed every row plus the auth user. Reaching the mailbox was enough to
// call it, and no backup sits behind it. A code compared inside the function
// closed that, then turned out to be readable by the caller through the same
// select policy that lets a device read its own journal row, so it closed
// nothing. Rather than protect a verifier, the function is gone: there is no
// longer anything for a mailbox to call.
//
// Signing out still wipes this device, and the Menu still exports a readable
// copy, which is what people usually mean by wanting it gone.

export const getSessionEmail = (): string | null =>
  session?.user.email ?? null;
