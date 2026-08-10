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
  markDeviceRemoved,
  markThisDeviceSignedOut,
  thisClientLabel,
  thisDeviceId,
  touchThisDevice,
} from "./devices";
import {
  approveLinkRequest,
  claimWrappedDataKeys,
  listLinkRequests,
  publishDeviceKey,
  publishEpochKey,
  hasPendingRequest,
  publishLinkRequest,
  checkStanding,
  readCurrentEpoch,
  readKeeperWrappedEpochs,
  rejectLinkRequest,
  revokeDevice,
  shareDataKeyWithDevices,
  surrenderDeviceKeys,
} from "./deviceLink";
import type { LinkRequest } from "./deviceLink";
import {
  decryptUpdate,
  deriveDeleteCode,
  encryptUpdate,
  generateDataKey,
  wrapDataKey,
  LegacyPayloadError,
  readPayloadEpoch,
  unwrapDataKey,
  importJournalKeyCode,
  exportJournalKeyCode,
} from "../lib/crypto";
import type { WrappedDataKey } from "../lib/crypto";
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
import { markRecoveryPending } from "../lib/recoveryAck";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";
import {
  clearError,
  getLinkCode,
  getLinkRequests,
  getLinkStage,
  getSyncStatus,
  isConfigured,
  resetLinkState,
  setError,
  setLinkRequests,
  setLinkState,
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
export type { LinkStage, SyncStatus, SyncSnapshot } from "./syncStatus";
export {
  getLinkCode,
  getLinkRequests,
  getLinkStage,
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

/**
 * The other half of that, and deliberately not a variation on it.
 *
 * MISSING_EPOCH_KEY says wait. This one says act, and names the action, because
 * the two situations look identical from the journal and have opposite remedies.
 */
const NEEDS_REAPPROVAL =
  "This device needs approving again before it can be given the newest key for your journal. Open Journlet on another of your devices, approve this one, and check the codes match. What you can already read here is unaffected.";

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
  stopWatchingForGrant();
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
 * flag the Sync screen would happily render it as the recovery code: sixteen
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

  // Rows another device has left for this one. The ordinary route for a device
  // added by approval, and the route by which any device catches up on an epoch
  // it was offline for.
  try {
    for (const [epoch, key] of await claimWrappedDataKeys(
      supabase,
      deviceBinding()
    )) {
      keys.set(epoch, key);
    }
  } catch (e) {
    // A failed check is not a refusal.
    console.warn("[devices] could not check for granted keys", e);
  }

  // The account's delete code, written once (assessment Finding 24). Only a
  // device holding the keeper key can derive it, which is the whole point, and
  // this is the one place in a connect where that is established. Called every
  // time rather than tracked: set_delete_code is a no-op once a code is stored,
  // so this doubles as the backfill for accounts created before the column, and
  // a failure here must never stop a connect.
  if (keeperUsable && held.keeperKey) {
    try {
      const { error } = await supabase.rpc("set_delete_code", {
        code: await deriveDeleteCode(held.keeperKey),
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      console.warn("[account] could not record the delete code", e);
    }
  }

  // Later epochs under the keeper key, for the device holding the recovery code.
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
    // Nothing at all: this device has never been let in. Ask, and show the code.
    await askToBeAdded();
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
    // Behind, or removed. Only the server can say which, and the two need
    // opposite screens. No dropConnection here: this branch is only reached from
    // inside a connect, which by definition has not set connectedUserId yet, so
    // there is nothing to drop. Adding it anyway looked prudent and was code no
    // test could reach.
    const standing = await checkStanding(
      supabase,
      deviceBinding(),
      next.dataKeys
    ).catch(() => "behind" as const);

    if (standing === "removed") {
      enterRemovedState();
      // It may also have asked and been refused since. Same round trip either way.
      await noticeIfDeclined();
      return false;
    }
    if (standing === "unproven") {
      // Holds rows, but nothing another device will accept as proof, so waiting
      // would be waiting forever. Ask, and say which of the two things this is.
      await askToBeAdded();
      setError(NEEDS_REAPPROVAL);
      setStatus(navigator.onLine ? "pending" : "offline");
      return false;
    }
    // Entitled, and behind. The journal reads to the last rotation and no
    // further, which is worth naming rather than reporting as an outage: the fix
    // is having another device open at the same time as this one.
    setError(MISSING_EPOCH_KEY);
    setStatus(navigator.onLine ? "pending" : "offline");
    return false;
  }
  // Withdrawn only now, having established that this device can actually read the
  // journal. It used to happen before this check, which meant every reconnect on a
  // device that was waiting for approval quietly cancelled its own request: the
  // card vanished from the approving device and this one waited for an answer to a
  // question it had retracted.
  await withdrawLinkRequest();
  setRemoved(false);
  return true;
};

// ---------- being added, and adding others ----------

const deviceBinding = () => ({
  userId: session?.user.id ?? "",
  deviceId: thisDeviceId(),
});

// Whether this device has been removed, the code it is displaying, the stage it
// has reached and the requests it could approve all live in the snapshot in
// store/syncStatus.ts, and are re-exported above. They were four module-level
// variables here, reaching the screen through a notification that said nothing
// about them (assessment Finding 12, first slice after Finding 2).

/**
 * The backstop under the realtime subscription below, not the primary path.
 *
 * It was the primary path until 31 July and the delay was plainly visible:
 * approving on one device left the other saying "waiting" for up to five
 * seconds, which reads as a hang rather than as latency. Kept as a floor because
 * realtime can fail to connect, a channel can drop, and a home-screen PWA gets
 * suspended, so the interval is now longer than it was rather than shorter.
 */
const LINK_POLL_MS = 8_000;
let linkPoll: ReturnType<typeof setInterval> | null = null;
/** Its own channel, since the journal channel does not exist yet. */
let grantChannel: RealtimeChannel | null = null;

const stopWatchingForGrant = () => {
  if (linkPoll) {
    clearInterval(linkPoll);
    linkPoll = null;
  }
  if (grantChannel && supabase) void supabase.removeChannel(grantChannel);
  grantChannel = null;
};

const pollForGrant = async (): Promise<void> => {
  if (!supabase || !session || getSyncStatus() !== "needs-key") {
    stopWatchingForGrant();
    return;
  }
  try {
    // Discarding the key is intentional: connect() re-claims and adopts it
    // properly, and duplicating that here is how the two paths drift apart.
    if ((await claimWrappedDataKeys(supabase, deviceBinding())).size === 0) {
      // No key. Is the request even still there? Checked in this order and never
      // the other way round: approving publishes the wrapped key *before* deleting
      // the request, so a grant is always visible by the time the request goes. The
      // reverse order would report a successful approval as a refusal.
      await noticeIfDeclined();
      return;
    }
    stopWatchingForGrant();
    // Said before the work rather than after it. Fetching and decrypting the
    // journal takes a moment, and during that moment the screen would otherwise
    // still be telling the user to go and approve something they just approved.
    setLinkState({ linkStage: "opening" });
    await connect();
  } catch {
    // Still waiting. A failed check is not a refusal.
  }
};

/**
 * Watch for this device being granted the key.
 *
 * A dedicated realtime channel. My earlier reasoning for polling instead — that
 * a device in this state has never subscribed to anything — was about the journal
 * channel, which is opened after the first successful reconcile. Nothing stops
 * this device subscribing to its own row: it has a session, and RLS scopes the
 * subscription to its own account.
 *
 * Both INSERT and UPDATE. An approval is an upsert, so which one arrives depends
 * on whether a row for this device existed before, and treating that as a detail
 * of the moment is how one of the two cases ends up never firing.
 */
const watchForGrant = () => {
  if (!supabase || !session) return;
  if (!linkPoll) linkPoll = setInterval(() => void pollForGrant(), LINK_POLL_MS);
  if (grantChannel) return;
  grantChannel = supabase
    .channel("device-grant")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "device_wrapped_keys",
        filter: `user_id=eq.${session.user.id}`,
      },
      // Not read from the payload. The row carries ciphertext this device has to
      // authenticate against its own binding anyway, so the event is a nudge to
      // go and look properly, nothing more.
      () => void pollForGrant()
    )
    .subscribe();
};

/**
 * Fall back to waiting for approval, having been removed.
 *
 * The session is untouched — removal takes keys away, not sign-in — so this is
 * the same state a new device sits in, reached from the other direction. The local
 * journal is deliberately left on disk: hidden behind the waiting screen rather
 * than erased, so nothing written here is destroyed and re-approval brings it
 * straight back, including anything that never managed to sync (Gary's decision,
 * 3 August).
 *
 * It does *not* ask to be added back. Doing that was the obvious thing and it was
 * wrong: removing a device produced an approval prompt for that same device on the
 * device that had just removed it, seconds later, leaving no answer that made
 * sense — "codes are different" is untrue and "not now" invites it to ask again
 * (Gary, 3 August). A new device asking on sign-in is right, because signing in
 * there *is* the request. Here the account holder has just said no, so asking again
 * has to be a fresh decision taken on the removed device.
 */
const enterRemovedState = (): void => {
  if (wasRemoved()) return;
  // This device is not synced any more, and saying so here is what lets it
  // connect again later. Reached mostly from the realtime path, which never runs
  // ensureJournalKeys, so dropping the connection there alone was not enough —
  // approving left "Opening your journal…" on screen until a restart. See
  // dropConnection.
  dropConnection();
  clearError();
  setStatus("needs-key");
  setRemoved(true);
};

/**
 * Ask to be let back in, from the removed device, because someone there chose to.
 *
 * The same request a new device makes. Separate from entering the removed state so
 * that nothing automatic ever produces it.
 */
export const askToBeAddedBack = async (): Promise<void> => {
  await askToBeAdded();
};

/**
 * Has the request this device is waiting on been answered with a refusal?
 *
 * Called from the poll and from a connect, because the two are the only moments
 * this device looks at the server and either can be the first to find out. Doing
 * it in the poll alone meant a foreground or a "try again" learned nothing.
 *
 * Only ever after a grant has been ruled out. Approving deletes the request as its
 * last step, having published the wrapped key first, so a grant is always visible
 * by the time the request disappears — checking in the other order would report a
 * successful approval as a refusal.
 */
const noticeIfDeclined = async (): Promise<void> => {
  if (!supabase || !session || getLinkStage() !== "waiting") return;
  try {
    if (await hasPendingRequest(supabase, deviceBinding())) return;
  } catch {
    // Could not tell. Keep waiting rather than claim a refusal that may not have
    // happened.
    return;
  }
  stopWatchingForGrant();
  setLinkState({ linkCode: null, linkStage: "declined" });
};

/**
 * Decide which of the two "cannot read the newest rows" stories is true, and say
 * that one. Never assumes removal from a failed check.
 */
const explainMissingKey = async (): Promise<void> => {
  if (!supabase || !session) return;
  try {
    const standing = await checkStanding(
      supabase,
      deviceBinding(),
      ring?.dataKeys ?? new Map()
    );
    if (standing === "behind") {
      setError(MISSING_EPOCH_KEY);
      // Behind, not removed. Reconnect rather than sitting there: a device whose
      // realtime rows have stopped decrypting still reads "synced", applies
      // nothing, and had no way back short of a restart. Dropping the connection
      // and asking again puts it on the ordinary retry backoff, so it recovers by
      // itself the moment another device passes the key along.
      dropConnection();
      void connect();
      return;
    }
    if (standing === "unproven") {
      // Same three-way split as the connect path, and the same reason for it.
      // Reconnecting here would loop: no other device will accept this one's rows,
      // so the backoff would run for ever against something only an approval
      // fixes.
      await askToBeAdded();
      setError(NEEDS_REAPPROVAL);
      return;
    }
  } catch {
    // Could not tell. The safe assumption is the recoverable one.
    setError(MISSING_EPOCH_KEY);
    return;
  }
  enterRemovedState();
};

/**
 * Ask another device to let this one in, and remember the code to display.
 *
 * Failure is not fatal and is not shown. The journal key remains a complete
 * route in, so a device that cannot publish a request falls back to the screen
 * it had before this feature existed rather than to a dead end.
 */
const askToBeAdded = async (): Promise<void> => {
  if (!supabase || !session) return;
  try {
    const code = await publishLinkRequest(
      supabase,
      deviceBinding(),
      thisClientLabel()
    );
    watchForGrant();
    setLinkState({ linkCode: code, linkStage: "waiting" });
  } catch (e) {
    setLinkState({ linkCode: null, linkStage: null });
    console.warn("[devices] could not ask to be added", e);
  }
};

/** Stop asking, once in or once leaving. */
const withdrawLinkRequest = async (): Promise<void> => {
  const wasAsking = getLinkCode() !== null;
  setLinkState({ linkCode: null, linkStage: null });
  stopWatchingForGrant();
  if (!wasAsking || !supabase || !session) return;
  try {
    await rejectLinkRequest(supabase, thisDeviceId());
  } catch {
    // It expires on its own, and the approving device deletes it too.
  }
};

/**
 * Refresh the list of devices asking to be let in.
 *
 * Only on a device that is actually connected and holds the data key: a device
 * that cannot open the journal itself has nothing to grant, and showing it an
 * approval prompt would be offering a decision it cannot carry out.
 */
const sameRequest = (a: LinkRequest, b: LinkRequest | undefined): boolean =>
  b !== undefined &&
  a.deviceId === b.deviceId &&
  a.code === b.code &&
  a.requestedAt === b.requestedAt;

const refreshLinkRequests = async (): Promise<void> => {
  if (!supabase || !session || !connectedUserId || !ring) return;
  try {
    const next = await listLinkRequests(supabase, deviceBinding());
    /**
     * Compare the code and the timestamp, not just the device id.
     *
     * publishLinkRequest upserts on (user_id, device_id) and rewrites
     * public_key and requested_at in place, so a re-ask changes what the row
     * says while leaving the id and the list length alone. Comparing ids only
     * meant this returned early and kept the old row.
     *
     * The consequence landed on the one screen that cannot afford it. A device
     * that signs out and wipes destroys its keypair but keeps its device id in
     * localStorage, so asking again produces a new public key and therefore a
     * new verification code. The approving device went on showing the old one.
     * Two screens, two different codes, and the correct response to that is to
     * refuse — so the mechanism taught the person to distrust a legitimate
     * device. Nothing leaked, because approveDevice wraps to the key it is
     * holding, but a comparison people learn to see fail is a comparison they
     * stop reading.
     *
     * requestedAt is in here for its own reason: it resets on every ask, and
     * LinkPrompts counts down from the cached copy, so a renewed request was
     * displaying "expires in 0 minutes".
     */
    const held = getLinkRequests();
    const unchanged =
      next.length === held.length &&
      next.every((r, i) => sameRequest(r, held[i]));
    if (unchanged) return;
    setLinkRequests(next);
  } catch (e) {
    console.warn("[devices] could not read link requests", e);
  }
};

/** Grant a request, after the person has compared the codes. */
export const approveDevice = async (request: LinkRequest): Promise<void> => {
  const key = ring && currentDataKey(ring);
  if (!supabase || !session || !ring || !key)
    throw new Error("This device cannot add another right now");
  // The current epoch only. A device cannot grant an epoch it does not itself
  // hold, and the newcomer needs the key that is being written under now.
  await approveLinkRequest(
    supabase,
    key,
    request,
    deviceBinding(),
    ring.epoch
  );
  // And every earlier epoch this device holds, now that the row above has made
  // the newcomer entitled. Without this it could read only what was written since
  // the last rotation until some later connect happened to fill the gaps in,
  // which on a re-approved device means its own history missing for a while.
  //
  // The row above is what proves the newcomer: it carries a grant at the current
  // epoch, which this device can verify because it holds that epoch. So no
  // exemption is needed here for a device that is too new to have registered
  // itself. The approval is the evidence, and it is written down.
  for (const epoch of ring.dataKeys.keys()) {
    if (epoch === ring.epoch) continue;
    await shareDataKeyWithDevices(
      supabase,
      ring.dataKeys,
      deviceBinding(),
      epoch
    );
  }
  setLinkRequests(
    getLinkRequests().filter((r) => r.deviceId !== request.deviceId)
  );
};

/**
 * Whether this device is able to remove another.
 *
 * Only a device holding the recovery key can, because removing means rotating,
 * and the new epoch's key has to be published wrapped under that key before any
 * device is given it. Rotating without it would leave content the recovery code
 * cannot reach, which quietly breaks the one promise §6.1 makes about losing every
 * device. So the constraint is real rather than an implementation shortcut, and
 * the Sync screen says so instead of offering an action that would fail.
 */
export const canRemoveDevices = (): boolean =>
  Boolean(ring?.keeperKey && keeperUsable);

/**
 * Whether this device can delete the account (assessment Finding 24).
 *
 * The same condition as removing a device, for the reason getJournalKeyCode
 * gives: every fresh install generates a keeper key, so holding one proves
 * nothing until it has been shown to open this account's journal. Without
 * `keeperUsable` a device whose connect failed would offer the action, derive a
 * code from a key that was never the account's, and be refused by the database
 * with a message about the journal key code — to the person who has it.
 *
 * A separate function from canRemoveDevices rather than a reuse of it: the two
 * capabilities happen to share a condition today and are not the same question.
 */
export const canDeleteAccount = (): boolean =>
  Boolean(ring?.keeperKey && keeperUsable);

/**
 * Remove another device from this account, and rotate the data key.
 *
 * The two halves are one operation from the user's point of view and must not be
 * separable in the interface: revoking alone takes away future keys and nothing
 * else, so the removed device would carry on reading and writing under the key it
 * already holds. That is the version of this feature that was built and deleted
 * in July for being dishonest.
 *
 * Order: revoke, publish the new epoch under the keeper key, hand it to the
 * devices that remain, then adopt it here. Every step is safe to fail at — the
 * worst outcome is a device that has lost access while the account has not yet
 * moved on, which is the direction that does not leak.
 */
export const removeDevice = async (deviceId: string): Promise<void> => {
  if (!supabase || !session || !ring?.keeperKey || !keeperUsable)
    throw new Error(
      "Only the device holding your recovery code can remove another device"
    );
  if (deviceId === thisDeviceId())
    throw new Error("Use sign out to remove this device");

  const binding = deviceBinding();
  await revokeDevice(supabase, deviceId);

  const epoch = (await readCurrentEpoch(supabase)) + 1;
  const dataKey = await generateDataKey();
  const wrapped = await wrapDataKey(dataKey, ring.keeperKey);
  await publishEpochKey(supabase, binding, epoch, wrappedToJson(wrapped));

  // The removed device is not among these: revokeDevice took away both its rows,
  // so it is no longer entitled and the share loop passes over it. Note it is
  // still unmarked in the register at this point, since markDeviceRemoved is the
  // last step, so the row deletion is what excludes it here and the register mark
  // is what keeps its id from being reused later.
  // Built before the share, not after, because verifying another device's grant
  // needs the key for the epoch that grant names and the share needs the new one
  // to hand out. Building the map is not adopting it: the ring below is still
  // the last thing to change, so the ordering guarantee is unaffected.
  const dataKeys = new Map(ring.dataKeys);
  dataKeys.set(epoch, dataKey);

  await shareDataKeyWithDevices(supabase, dataKeys, binding, epoch);

  ring = { ...ring, dataKeys, epoch };
  await replaceKeyRing(ring);

  // Recorded in the register so the other devices show what happened, and pushed
  // under the new epoch as an ordinary edit.
  // No republish here. The register lives in the encrypted document, so the
  // Sync screen's own Yjs observer (store/devices.ts onDevicesChange) is what
  // refreshes the list; the notification this used to send changed nothing in
  // the snapshot and nothing read it.
  markDeviceRemoved(deviceId);
};

/** Refuse a request, whether because the codes differ or it was not expected. */
export const rejectDevice = async (deviceId: string): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  await rejectLinkRequest(supabase, deviceId);
  setLinkRequests(getLinkRequests().filter((r) => r.deviceId !== deviceId));
};

/**
 * Adopt a journal key code, leaving the keyring able to open the journal.
 *
 * Separate from provideJournalKey because this half must be callable from
 * *inside* doConnect, and provideJournalKey ends by calling connect(). connect()
 * is single-flight, so calling it from within doConnect returns the very promise
 * doConnect is still executing, and awaiting that deadlocks: the connect never
 * finishes, `connecting` is never cleared, and every later trigger gets the same
 * dead promise. That wedged a device linked from a QR scan in needs-key
 * permanently, with no reconcile and no device registration — see the tests in
 * tests/linkPending.test.ts.
 */
const adoptJournalKey = async (code: string): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  const keeperKey = await importJournalKeyCode(code);
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
    throw new Error("That journal key does not match this account's journal");
  }
  // Epoch 0 only at this point. Later epochs are collected by the connect that
  // follows, which can read journal_keys with this same keeper key.
  ring = {
    keeperKey,
    dataKeys: new Map([[0, dataKey]]),
    epoch: 0,
    wrapped,
    createdAt: Date.now(),
  };
  await replaceKeyRing(ring);
  // Proven by the unwrap above: this key opens this account's journal, so this
  // device can display it as the recovery code.
  keeperUsable = true;
  await withdrawLinkRequest();
};

/** Link this device: adopt the journal key code from another device, then sync. */
export const provideJournalKey = async (code: string): Promise<void> => {
  await adoptJournalKey(code);
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
    // behind, both counts can be non-zero and the accurate, actionable one is
    // this. Which message it is depends on whether this device still has keys on
    // the server, so it takes a round trip and cannot be answered here.
    void explainMissingKey();
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
    .on(
      "postgres_changes",
      {
        // Every event, not just INSERT: a request withdrawn or approved on
        // another device has to take the prompt off this screen too, or two
        // devices both show a card for something already dealt with.
        event: "*",
        schema: "public",
        table: "device_link_requests",
        filter: `user_id=eq.${session.user.id}`,
      },
      () => void refreshLinkRequests()
    )
    .subscribe((state) => {
      if (state === "SUBSCRIBED") {
        // A re-join after a dropped socket means events were missed while
        // down (realtime has no replay) — reconcile to catch up
        if (everSubscribed) void reconcile("socket-rejoin");
        everSubscribed = true;
      }
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT")
        setStatus(navigator.onLine ? "pending" : "offline");
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
  // Not awaited, and deliberately last. Per-device keys are groundwork: nothing
  // the user can see depends on them yet, and a journal that is synced should say
  // so without waiting on a table it does not read from.
  void shareThisDevicesKeys();
  // Realtime is the fast path, this is the floor: a backgrounded PWA misses
  // events with no replay, so a device that was asleep when a request arrived
  // would otherwise show nothing until something else happened to poke it.
  void refreshLinkRequests();
};

/**
 * Publish this device's public key, then hand the data key to any device that has
 * published one and has not been given it (spec step 2).
 *
 * Failure is swallowed on purpose. There is nothing for the user to do about it,
 * the journal in front of them is syncing normally, and the next launch tries
 * again, so an error banner here would be alarm without a remedy. The console
 * line is for me.
 */
const shareThisDevicesKeys = async (): Promise<void> => {
  if (!supabase || !session || !ring) return;
  const binding = deviceBinding();
  try {
    await publishDeviceKey(supabase, binding);
    const key = currentDataKey(ring);
    if (key)
      await shareDataKeyWithDevices(
        supabase,
        ring.dataKeys,
        binding,
        ring.epoch
      );
  } catch (e) {
    console.warn("[devices] key sharing deferred to the next launch", e);
  }
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
 * Retry a failed connect on a backoff.
 *
 * Before this, a connect that failed left the app in "pending" until something
 * incidental happened — a foreground, or the network dropping and returning. A
 * transient server error therefore became a stuck app with a working fix nobody
 * could reach: restarting the app was the only way out, which is exactly how the
 * clock-skew error was resolved on 29 Jul.
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
    void connect();
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

/** Ask again now, for a "try again" button. */
export const retryConnect = async (): Promise<void> => {
  cancelRetry();
  await connect();
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
    if (connectedUserId) {
      void reconcile("visibility");
      // A request that arrived while this device was asleep produced no event it
      // could hear, so foregrounding is the moment it finds out.
      void refreshLinkRequests();
    } else void connect();
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
  // Withdraw any outstanding request while there is still a session to do it
  // with. A device that asked, gave up and signed out would otherwise leave a
  // prompt on someone else's screen for something that is no longer waiting.
  await withdrawLinkRequest();
  // Give up this device's key rows, for the same reason and in the same window.
  // Sign-out left them behind until 31 July, which meant per-device keys were
  // built and never used for the one thing they exist for.
  if (supabase && session) {
    try {
      await surrenderDeviceKeys(supabase, deviceBinding());
    } catch (e) {
      // Never block leaving. The rows are unopenable regardless once the
      // keystore is wiped, and this device's next sign-in republishes over them.
      console.warn("[devices] could not release this device's keys", e);
    }
  }
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

/**
 * The account was deleted but this device could not be cleared. Distinct from a
 * failed deletion because the two need opposite advice, and telling someone
 * their journal is untouched when the account is already gone is the worst
 * thing this flow could do.
 */
export class DeviceNotClearedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "DeviceNotClearedError";
  }
}

/**
 * Delete the account and everything the server holds for it, then wipe this
 * device (remediation item 16, UK GDPR right to erasure).
 *
 * The server side is one RPC to a security definer function that deletes only
 * auth.uid() — see supabase/schema.sql. Deleting an auth user otherwise needs
 * the service role key, which cannot ship in a client-only app.
 *
 * Server first, deliberately. If the RPC fails, nothing has been destroyed and
 * the caller can say so; wiping first would leave someone with nothing local
 * AND an account they can no longer reach to retry.
 *
 * The consequence is that the RPC is a point of no return, and the two sides of
 * it need different error handling. A wipe that fails afterwards is not a
 * failed deletion — the account is already gone — so it throws
 * DeviceNotClearedError, which the UI must never report as "nothing was
 * deleted". IndexedDB can and does reject: quota, private mode, an eviction
 * mid-flight.
 *
 * Other signed-in devices keep the copy they hold. Their next push fails
 * against the missing user row, and once the refresh token is gone they land
 * back at signed-out. Nothing can remotely erase a device, which the UI says
 * plainly.
 */
export const deleteAccount = async (): Promise<void> => {
  if (!supabase || !session) throw new Error("Not signed in");
  // The code the server compares, derived from the keeper key (Finding 24).
  // Holding the mailbox is no longer enough to destroy the server copy, and
  // there is no backup behind it on the free tier.
  //
  // A device without the keeper key cannot produce it, so it cannot delete the
  // account. Said here as well as being disabled in the interface, because this
  // function is callable from elsewhere and a caller that got past the button
  // should get the reason rather than a refusal from the database.
  // Narrowed into a const rather than asserted through canDeleteAccount(), which
  // the compiler cannot see into. src/ has one non-null assertion in it and this
  // is not worth being the second.
  const keeperKey = ring?.keeperKey;
  if (!keeperKey || !keeperUsable)
    throw new Error(
      "Deleting the account needs the device holding your journal key code. On this device, sign out to remove the journal from it."
    );
  const { error } = await supabase.rpc("delete_account", {
    code: await deriveDeleteCode(keeperKey),
  });
  if (error) throw new Error(error.message);

  // Point of no return. Nothing below may be reported as a failed deletion.
  teardown();
  clearPendingKey();
  try {
    // The JWT outlives the user row, so drop it rather than leaving a token
    // that authenticates to a deleted account.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The account is already gone; a failed sign-out must not block the wipe.
  }
  try {
    await wipeThisDevice();
  } catch (e) {
    throw new DeviceNotClearedError(
      e instanceof Error ? e.message : String(e)
    );
  }
};

export const getSessionEmail = (): string | null =>
  session?.user.email ?? null;
