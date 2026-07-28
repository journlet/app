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
  stashKeyFromUrl,
  sweepPendingKey,
} from "../lib/pendingKey";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";
import { DEFAULT_VOLUME, getActiveVolume, setActiveVolume } from "../lib/volume";

export type SyncStatus =
  | "disabled" // no Supabase config in the build
  | "signed-out"
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

// Returns true when this device's keys are good for the remote journal
const ensureJournalKeys = async (): Promise<boolean> => {
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
    return true;
  }
  // Journal exists: can our keeper unwrap its data key?
  try {
    const remoteWrapped = wrappedFromJson(data.wrapped_key as WrappedKeyJson);
    const dataKey = await unwrapDataKey(remoteWrapped, ring.keeperKey);
    ring = { ...ring, dataKey, wrapped: remoteWrapped };
    await replaceKeyRing(ring);
    return true;
  } catch {
    setStatus("needs-key");
    return false;
  }
};

/** Link this device: adopt the journal key code from another device. */
export const provideJournalKey = async (code: string): Promise<void> => {
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
  ring = { keeperKey, dataKey, wrapped, createdAt: Date.now() };
  await replaceKeyRing(ring);
  await connect();
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
    // A QR-scanned key may be waiting — try it before asking the user
    const pending = pendingJournalKey();
    if (getSyncStatus() === "needs-key" && pending) {
      try {
        await provideJournalKey(pending);
      } catch {
        // wrong or stale key — leave needs-key showing for manual entry
      } finally {
        // Always clear it: the pending key is the master keeper key in
        // plaintext, applied at most once. Whether the link succeeded or
        // failed, it must never linger in localStorage — manual entry is a
        // separate path and does not read this value.
        clearPendingKey();
      }
    }
    return;
  }
  clearPendingKey(); // linked without needing it
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
    if (connectedUserId) void reconcile("visibility");
    else void connect();
  });
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
export const lostDevice = async (): Promise<string> => {
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
