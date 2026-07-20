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
import { doc } from "./journal";
import {
  decryptUpdate,
  encryptUpdate,
  generateKeeperKey,
  unwrapDataKey,
  importJournalKeyCode,
  exportJournalKeyCode,
  wrapDataKey,
} from "../lib/crypto";
import type { WrappedDataKey } from "../lib/crypto";
import { ensureKeys, replaceKeyRing } from "../lib/keystore";
import type { KeyRing } from "../lib/keystore";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";

export type SyncStatus =
  | "disabled" // no Supabase config in the build
  | "signed-out"
  | "connecting"
  | "needs-key" // remote journal uses a different journal key
  | "synced"
  | "pending" // local changes not yet on the server
  | "offline";

const REMOTE_ORIGIN = "journlet-remote";
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

// A journal key can arrive via QR: the other device shows a link like
// https://app.journlet.com/#jk=J1-…; the phone camera opens it here. The
// fragment never reaches any server. We stash it locally (it must survive
// the magic-link redirect) and apply it once signed in.
const PENDING_KEY = "journlet-pending-journal-key";

const stashKeyFromUrl = (): void => {
  const m = window.location.hash.match(/jk=([A-Za-z0-9-]+)/);
  if (!m) return;
  try {
    localStorage.setItem(PENDING_KEY, m[1]);
  } catch {
    // storage unavailable — manual entry still works
  }
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search
  );
};

export const pendingJournalKey = (): string | null => {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
};

const clearPendingKey = (): void => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // best effort
  }
};

let session: Session | null = null;
let ring: KeyRing | null = null;
let channel: RealtimeChannel | null = null;
let connectedUserId: string | null = null;
let dirty = false;
let started = false;

const teardown = () => {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  connectedUserId = null;
};

const pushPayload = async (update: Uint8Array): Promise<boolean> => {
  if (!supabase || !session || !ring) return false;
  try {
    const payload = b64encode(await encryptUpdate(ring.dataKey, update));
    const { error } = await supabase
      .from("journal_updates")
      .insert({ payload });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    dirty = true;
    setError(e);
    setStatus(navigator.onLine ? "pending" : "offline");
    return false;
  }
};

// Live local edits (origin null = our own transactions; y-indexeddb loads
// and remote applies carry their own origins and must not echo back)
doc.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin !== null || !session || !connectedUserId) return;
  void pushPayload(update).then((ok) => {
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

// ---------- reconcile + realtime ----------

const applyRemotePayload = async (payloadB64: string): Promise<void> => {
  if (!ring) return;
  try {
    const update = await decryptUpdate(ring.dataKey, b64decode(payloadB64));
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  } catch {
    // Undecryptable row (corruption or foreign key) — skip rather than crash
    console.warn("journlet: skipped an undecryptable update");
  }
};

const reconcile = async (): Promise<boolean> => {
  if (!supabase || !ring) return false;
  const shadow = new Y.Doc();
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("journal_updates")
        .select("payload")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        try {
          const update = await decryptUpdate(
            ring.dataKey,
            b64decode(row.payload as string)
          );
          Y.applyUpdate(shadow, update);
          Y.applyUpdate(doc, update, REMOTE_ORIGIN);
        } catch {
          console.warn("journlet: skipped an undecryptable update");
        }
      }
      if (!data || data.length < PAGE) break;
    }
    // Push whatever the server is missing (offline edits, first sync)
    const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(shadow));
    if (diff.length > 2) {
      const ok = await pushPayload(diff);
      if (!ok) return false;
    }
    dirty = false;
    return true;
  } catch (e) {
    setError(e);
    setStatus(navigator.onLine ? "pending" : "offline");
    return false;
  } finally {
    shadow.destroy();
  }
};

const subscribe = () => {
  if (!supabase || !session || channel) return;
  channel = supabase
    .channel("journal-updates")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "journal_updates",
        filter: `user_id=eq.${session.user.id}`,
      },
      (msg) => {
        const row = msg.new as { payload?: string };
        if (row.payload) void applyRemotePayload(row.payload);
      }
    )
    .subscribe((state) => {
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT")
        setStatus(navigator.onLine ? "pending" : "offline");
    });
};

const connect = async (): Promise<void> => {
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
        clearPendingKey();
      } catch {
        // wrong or stale key — leave needs-key showing for manual entry
      }
    }
    return;
  }
  clearPendingKey(); // linked without needing it
  if (!(await reconcile())) return;
  connectedUserId = session.user.id;
  subscribe();
  setStatus("synced");
};

// ---------- public API ----------

export const startSync = (): void => {
  if (started || !supabase) return;
  started = true;
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
    if (session) void connect().then(() => dirty && reconcile());
  });
  window.addEventListener("offline", () => {
    if (session) setStatus("offline");
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
  ring ??= await ensureKeys();
  const { error: soErr } = await supabase.auth.signOut({ scope: "others" });
  if (soErr) throw new Error(soErr.message);
  const keeperKey = await generateKeeperKey();
  const wrapped = await wrapDataKey(ring.dataKey, keeperKey);
  const { error } = await supabase
    .from("journals")
    .update({ wrapped_key: wrappedToJson(wrapped) })
    .eq("user_id", session.user.id);
  if (error) throw new Error(error.message);
  ring = { keeperKey, dataKey: ring.dataKey, wrapped, createdAt: Date.now() };
  await replaceKeyRing(ring);
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

export const signOut = async (): Promise<void> => {
  if (!supabase) return;
  teardown();
  await supabase.auth.signOut();
};

export const getSessionEmail = (): string | null =>
  session?.user.email ?? null;
