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
import { touchThisDevice } from "./devices";
import {
  decryptUpdate,
  encryptUpdate,
  generateKeeperKey,
  LegacyPayloadError,
  unwrapDataKey,
  importJournalKeyCode,
  exportJournalKeyCode,
  wrapDataKey,
} from "../lib/crypto";
import type { WrappedDataKey } from "../lib/crypto";
import { ensureKeys, replaceKeyRing, wipeKeys } from "../lib/keystore";
import type { KeyRing } from "../lib/keystore";
import {
  clearPendingKey,
  pendingJournalKey,
  stashKey,
  stashKeyFromUrl,
  sweepPendingKey,
} from "../lib/pendingKey";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";
import { DEFAULT_VOLUME, getActiveVolume, setActiveVolume } from "../lib/volume";

export type SyncStatus =
  | "disabled" // no Supabase config in the build
  | "signed-out"
  | "revoked" // a lost device was reported elsewhere; re-link to resume
  | "connecting"
  | "needs-key" // remote journal uses a different journal key
  | "synced"
  | "pending" // local changes not yet on the server
  | "offline";

const PAGE = 1000;

export const isConfigured = (): boolean =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ---------- status + listeners ----------

let status: SyncStatus = isConfigured() ? "signed-out" : "disabled";
const listeners = new Set<(s: SyncStatus) => void>();

const setStatus = (s: SyncStatus) => {
  status = s;
  listeners.forEach((fn) => fn(s));
};

export const getSyncStatus = (): SyncStatus => status;

// Last server error, surfaced on the Sync screen so a schema/RLS problem
// doesn't masquerade as "offline"
let lastError: string | null = null;
export const getSyncError = (): string | null => lastError;
const setError = (e: unknown) => {
  lastError =
    e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  listeners.forEach((fn) => fn(status));
};
const clearError = () => {
  lastError = null;
};

export const onSyncStatus = (fn: (s: SyncStatus) => void): (() => void) => {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
};

// ---------- helpers ----------

const b64encode = (bytes: Uint8Array): string => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};

const b64decode = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

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

// ---------- engine state ----------

let session: Session | null = null;
let ring: KeyRing | null = null;
let channel: RealtimeChannel | null = null;
let connectedUserId: string | null = null;
let dirty = false;
let started = false;

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

const teardown = () => {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  connectedUserId = null;
  shadow?.destroy();
  shadow = null;
  lastMaxId = 0;
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
  | "live-edit";

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
    const payload = b64encode(
      await encryptUpdate(ring.dataKey, update, {
        userId: session.user.id,
        volume,
      })
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

// Set when this device has been locked out by a lost-device report made on
// another device. Sticky, because the local sign-out that follows fires the
// auth listener, and "signed out" on its own would leave someone guessing why.
let revoked = false;

export const wasRevoked = (): boolean => revoked;

/**
 * This device's keeper key used to open the remote journal and no longer
 * does, which means a lost device was reported somewhere else and the keeper
 * key was rotated. Give up the session at once rather than carrying on with a
 * token that outlives its authority: the access token is a signed JWT that
 * Postgres validates without consulting any revocation list, so `signOut({
 * scope: "others" })` on the reporting device does not stop this one — it
 * would keep reading and pushing until the token expired.
 *
 * The local journal is deliberately kept. This device is a surviving device,
 * not the lost one, and its content is wanted; it needs the new journal key
 * code to re-link, nothing more. Wiping here would turn "you must re-link"
 * into data loss.
 */
const handleRevoked = async (): Promise<void> => {
  revoked = true;
  teardown();
  // Local scope only. A global sign-out here would sign out every sibling
  // device as a side effect of one of them noticing, and each would then do
  // the same to the others — a revocation storm out of a single report.
  try {
    await supabase?.auth.signOut({ scope: "local" });
  } catch {
    // The session is already unusable; the status below is what matters.
  }
  setStatus("revoked");
};

/**
 * Key operations run one at a time.
 *
 * Rotating the keeper key is a read-modify-write spanning the local keystore and
 * the server, and it deliberately persists locally *first* (see lostDevice for
 * why). That leaves a window in which the two disagree by design: the server
 * still holds a blob the newly rotated keeper key cannot open. A key check
 * landing inside that window sees exactly the signature of revocation, so the
 * device doing the reporting concluded it had been revoked and signed itself
 * out — both devices logged out from one press of the button.
 *
 * Serialising removes the window rather than special-casing it: a check runs
 * either wholly before or wholly after a rotation, never inside one. Worth
 * preferring over an "am I rotating" flag, which would have to be consulted
 * correctly by every future caller to work.
 */
let keyOps: Promise<unknown> = Promise.resolve();

const serialisedKeyOp = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = keyOps.then(fn, fn);
  // Swallowed on the chain only: a failed key op must not wedge every later
  // one, while the caller still sees its own rejection through `next`.
  keyOps = next.then(
    () => undefined,
    () => undefined
  );
  return next;
};

// Returns true when this device's keys are good for the remote journal
const ensureJournalKeys = (): Promise<boolean> =>
  serialisedKeyOp(checkJournalKeys);

const checkJournalKeys = async (): Promise<boolean> => {
  if (!supabase || !ring) return false;
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
    // First device: publish our wrapped data key
    const { error: insErr } = await supabase.from("journals").insert({
      user_id: session?.user.id,
      wrapped_key: wrappedToJson(ring.wrapped),
    });
    if (insErr) {
      setError(`Server error saving your journal key: ${insErr.message}`);
      setStatus(navigator.onLine ? "pending" : "offline");
      return false;
    }
    ring = { ...ring, verifiedUserId: session?.user.id };
    await replaceKeyRing(ring);
    return true;
  }
  // Journal exists: can our keeper unwrap its data key?
  try {
    const remoteWrapped = wrappedFromJson(data.wrapped_key as WrappedKeyJson);
    const dataKey = await unwrapDataKey(remoteWrapped, ring.keeperKey);
    ring = {
      ...ring,
      dataKey,
      wrapped: remoteWrapped,
      verifiedUserId: session?.user.id,
    };
    await replaceKeyRing(ring);
    return true;
  } catch {
    // A fresh device and a locked-out device fail identically here — both hold
    // a keeper key that will not open the server's blob. Only the record of
    // having opened it before tells them apart, and they need opposite
    // handling: one is asked for the journal key, the other has had its
    // authority withdrawn and must stop syncing now.
    if (ring.verifiedUserId && ring.verifiedUserId === session?.user.id) {
      await handleRevoked();
      return false;
    }
    setStatus("needs-key");
    return false;
  }
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
  ring = {
    keeperKey,
    dataKey,
    wrapped,
    createdAt: Date.now(),
    verifiedUserId: session?.user.id,
  };
  await replaceKeyRing(ring);
  revoked = false; // re-linked with the new code: authority restored
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

export const getJournalKeyCode = async (): Promise<string> => {
  const r = ring ?? (await ensureKeys());
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
interface SkipTally {
  legacy: number;
  undecryptable: number;
}

const newTally = (): SkipTally => ({ legacy: 0, undecryptable: 0 });

const decryptRow = async (
  payloadB64: string,
  tally: SkipTally
): Promise<Uint8Array | null> => {
  if (!ring || !session) return null;
  try {
    // Expected values, never the row's own: a blob moved between volumes or
    // replayed into another account must fail here.
    return await decryptUpdate(ring.dataKey, b64decode(payloadB64), {
      userId: session.user.id,
      volume: getActiveVolume(),
    });
  } catch (e) {
    if (e instanceof LegacyPayloadError) tally.legacy += 1;
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
    // The same change feed that carries journal content carries the answer to
    // "has my authority been withdrawn" (Gary's question, 28 Jul): rotating
    // the keeper key after a lost-device report IS an update to this row, so
    // surviving devices can be pushed the event itself instead of waiting to
    // notice. Awake devices react in about a second.
    //
    // The fast path, never the guarantee. A backgrounded PWA misses realtime
    // events with no replay (see the visibilitychange note below), so the
    // check on foreground remains the floor. And a hostile device can simply
    // ignore the message — this makes honest devices prompt, it does not
    // enforce anything. Enforcement is the token lifetime, which is why the
    // JWT expiry setting matters (spec §6.2).
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "journals",
        filter: `user_id=eq.${session.user.id}`,
      },
      () => void ensureJournalKeys()
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
  // Register this device (see store/devices.ts) BEFORE reconciling, so the row
  // rides the reconcile diff instead of becoming a second push straight after
  // it. Only reached once the keys check out, so a device that has just been
  // locked out does not announce itself on the way out.
  touchThisDevice();
  if (!(await reconcile("connect"))) return;
  connectedUserId = session.user.id;
  subscribe();
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

const connect = (): Promise<void> =>
  (connecting ??= doConnect().finally(() => {
    connecting = null;
  }));

// ---------- public API ----------

export const startSync = (): void => {
  if (started || !supabase) return;
  started = true;
  sweepPendingKey();
  stashKeyFromUrl();

  supabase.auth.onAuthStateChange((_event, s) => {
    const wasUser = session?.user.id;
    session = s;
    if (!s) {
      teardown();
      // handleRevoked() signs out locally, so this fires straight after it.
      // "Not signed in" would be true and useless — it would read as a
      // spontaneous logout with no cause given, which is precisely the
      // confusion this whole change exists to remove.
      setStatus(revoked ? "revoked" : "signed-out");
    } else if (s.user.id !== wasUser || !connectedUserId) {
      revoked = false; // a new session supersedes the lockout
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
    if (connectedUserId) void checkKeyThenReconcile();
    else void connect();
  });
};

/**
 * On foreground, ask whether this device still has authority before syncing.
 *
 * reconcile() cannot answer that by itself. A lost-device report rotates the
 * keeper key but reuses the same data key, so every row still decrypts
 * perfectly on a device that has been locked out — sync looks entirely healthy
 * and the badge reads "synced". The only local evidence is the wrapped key on
 * the journal row, so it has to be read explicitly. One head-sized row read
 * per foreground.
 */
const checkKeyThenReconcile = async (): Promise<void> => {
  if (!(await ensureJournalKeys())) return; // sets revoked / needs-key
  await reconcile("visibility");
};

export const signIn = async (email: string): Promise<void> => {
  if (!supabase) throw new Error("Sync is not configured");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
};

// Lost-device response: revoke every other session, then rotate the keeper
// key (rewrapping the SAME data key — no re-encryption of history). The
// lost device keeps its local copy — nothing can remotely erase that — but
// it can never download anything new, and the old journal key code stops
// unlocking the account. Returns the new journal key code to save.
export const lostDevice = (): Promise<string> => serialisedKeyOp(rotateForLoss);

/**
 * Held inside serialisedKeyOp for its whole length, which is load-bearing rather
 * than tidy. The rotation below leaves the local keyring and the server
 * disagreeing for as long as the publish takes, and to a key check that gap is
 * indistinguishable from having been locked out — so an unserialised check
 * landing in it made the reporting device sign itself out, taking every device
 * down from one press of the button.
 */
const rotateForLoss = async (): Promise<string> => {
  if (!supabase || !session) throw new Error("Not signed in");
  const previous = (ring ??= await ensureKeys());
  const { error: soErr } = await supabase.auth.signOut({ scope: "others" });
  if (soErr) throw new Error(soErr.message);

  // Order matters: persist the new keeper key locally BEFORE publishing it.
  // If the local write fails we abort having changed nothing anywhere — the
  // old key still works on every device. Publishing first would leave the
  // server holding a blob no surviving device can unwrap, with the only key
  // that opens it discarded in memory and every other device already signed
  // out: sync stuck in needs-key with no code to re-link from. Persisting
  // first also means the code returned below is never the only copy —
  // getJournalKeyCode() reads it back from the keyring at any time.
  const keeperKey = await generateKeeperKey();
  const wrapped = await wrapDataKey(previous.dataKey, keeperKey);
  const rotated: KeyRing = {
    keeperKey,
    dataKey: previous.dataKey,
    wrapped,
    createdAt: Date.now(),
    // Carried over: this device is the one doing the reporting and has opened
    // the journal. Dropping the marker here would make a later mismatch on
    // this device look like a first link rather than a lockout.
    verifiedUserId: session.user.id,
  };
  await replaceKeyRing(rotated);
  ring = rotated;

  const { error } = await supabase
    .from("journals")
    .update({ wrapped_key: wrappedToJson(wrapped) })
    .eq("user_id", session.user.id);
  if (error) {
    // Publish failed, so the server still holds the old blob: put the old
    // ring back so the two agree again and the old code keeps working. Best
    // effort — if the restore itself fails the next connect() lands in
    // needs-key, which the old code still resolves, because the server was
    // never rotated.
    try {
      await replaceKeyRing(previous);
      ring = previous;
    } catch {
      // fall through to the thrown error
    }
    throw new Error(error.message);
  }
  return exportJournalKeyCode(keeperKey);
};

// Sign in by typing the 6-digit code from the email — the only way to get
// a session INSIDE an iOS home-screen app, since email links always open
// in the default browser (whose storage is a different container).
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

// Routine sign-out of THIS device only. The default scope is global, which
// would silently sign out every other device too — see lostDevice() for the
// deliberate "others" case.
export const signOut = async (): Promise<void> => {
  if (!supabase) return;
  teardown();
  await supabase.auth.signOut({ scope: "local" });
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
  teardown();
  clearPendingKey();
  // After a wipe this is a device with no journal and no keys, which is a fresh
  // device rather than a locked-out one. Leaving the flag set would keep
  // explaining a lockout that no longer applies to anything held here.
  revoked = false;
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
  const { error } = await supabase.rpc("delete_account");
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
