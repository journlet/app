// Device register (decision 28 Jul, Gary). Which devices hold this journal,
// held inside the encrypted doc so the server never sees the list — see the
// note on `devices` in journal.ts for why it lives there and why it is
// informational only rather than a security boundary.

import * as Y from "yjs";
import { devices, doc } from "./journal";
import { uid } from "../lib/types";

const ID_KEY = "journlet-device-id";

export interface DeviceRecord {
  id: string;
  /** What to show: the name you gave it, or the detected description. */
  label: string;
  /**
   * Every client that has opened this copy, and the platform: "Chrome and
   * installed app (macOS)". Plural because one row is one local journal, and a
   * journal can be reached more than one way — see the note on `clients`.
   */
  client: string;
  /** True when `label` is your own name for it rather than the detected one. */
  renamed: boolean;
  firstSeen: number;
  lastSeen: number;
  isThisDevice: boolean;
}

/**
 * Stable id for this device, in localStorage rather than the doc — it has to
 * survive independently of the journal and must NOT sync, or every device
 * would claim the same row. Lost on a browser data clear, which registers the
 * device again under a new id; a stale row is the honest outcome there,
 * since from the journal's point of view that really is a different install.
 */
export const thisDeviceId = (): string => {
  let id: string | null = null;
  try {
    id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(ID_KEY, id);
    }
  } catch {
    // Private mode or blocked storage: fall back to a per-session id. The
    // register gains a row per launch, which is noise, but nothing breaks.
    id ??= uid();
  }
  return id;
};

// Coarse and deliberately non-unique — enough to recognise which of your own
// devices a row is without building a fingerprint. No version numbers, no
// screen dimensions, no user-agent string verbatim.
//
// Both halves are recorded, because one device can hold the journal more than
// once: the installed app and a browser tab on the same Mac are separate
// installs with separate storage, so they are separate rows, and "Mac" twice
// would be unreadable. Named after the client, as WhatsApp's linked-device
// list does: "Chrome (macOS)", "Installed app (iOS)".
const platformName = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iOS";
  if (/iPad/.test(ua)) return "iPadOS";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "unknown platform";
};

// Installed home-screen apps report standalone display mode; iOS Safari uses a
// non-standard navigator flag instead. Worth distinguishing because on iOS the
// installed app and the browser have separate storage, so they behave as two
// devices and someone looking at this list needs to see why.
const isInstalled = (): boolean => {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia unavailable; fall through
  }
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

// Order matters: Edge and Opera both claim Chrome, and Chrome claims Safari.
const clientName = (): string => {
  if (isInstalled()) return "Installed app";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
};

// Last-seen is not refreshed more often than this. Every write here becomes a
// row in the append-only log, and §6.1a is a long account of what happens when
// something writes to that log on every launch and foreground: one device
// syncing several times an hour would generate more register churn than
// journal content. An hour is far finer than the question the register answers
// ("do I recognise this device?") actually needs.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Note that this client has opened this copy of the journal.
 *
 * A row is one local journal — one storage container — not one client, because
 * that is the unit that actually holds the keys and the sign-in. On macOS the
 * installed app and the browser share that container, confirmed by the register
 * itself: both resolved to the same device id and took turns overwriting a
 * single `client` field, so the row's description changed depending on which one
 * you had opened last, and each switch wrote to the append-only log. On iOS the
 * home-screen app has its own container and is therefore its own row.
 *
 * So the clients are collected rather than replaced. Keyed by name in a Y.Map,
 * with last-used as the value: two clients recorded concurrently on different
 * devices both survive the merge, and re-opening a known client is a no-op
 * unless enough time has passed to be worth recording.
 */
const noteClient = (rec: Y.Map<unknown>): void => {
  const name = clientName();
  let clients = rec.get("clients");
  if (!(clients instanceof Y.Map)) {
    clients = new Y.Map<unknown>();
    rec.set("clients", clients);
  }
  const map = clients as Y.Map<unknown>;
  const last = (map.get(name) as number) || 0;
  if (Date.now() - last < TOUCH_INTERVAL_MS) return;
  map.set(name, Date.now());
};

/**
 * Record this device in the register and refresh its last-seen time, called
 * once per connect. A device that stops syncing goes stale rather than
 * vanishing: a row you do not recognise is the entire point of the list, so
 * nothing removes rows automatically.
 */
export const touchThisDevice = (): void => {
  const id = thisDeviceId();
  const now = Date.now();
  const existing = devices.get(id);
  if (existing) {
    noteClient(existing);
    const last = (existing.get("lastSeen") as number) || 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    existing.set("lastSeen", now);
    return;
  }
  doc.transact(() => {
    const rec = new Y.Map<unknown>();
    devices.set(id, rec);
    rec.set("id", id);
    rec.set("platform", platformName());
    rec.set("firstSeen", now);
    rec.set("lastSeen", now);
    noteClient(rec);
  });
};

/** "Chrome", "Chrome and installed app", "Chrome, Safari and installed app". */
const listSentence = (parts: string[]): string => {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

/** How this row describes itself: every client that has opened it, plus the platform. */
const describe = (rec: Y.Map<unknown>): string => {
  const clients = rec.get("clients");
  const platform = (rec.get("platform") as string) || "";
  if (clients instanceof Y.Map && clients.size > 0) {
    const names: { name: string; at: number }[] = [];
    clients.forEach((at, name) => names.push({ name, at: (at as number) || 0 }));
    // Most recently used first, so the one you are looking at leads.
    names.sort((a, b) => b.at - a.at);
    const sentence = listSentence(names.map((n) => n.name));
    return platform ? `${sentence} (${platform})` : sentence;
  }
  // Rows from earlier versions of the register: a single `client` string, or
  // nothing but the label they were named with.
  return (rec.get("client") as string) || "";
};

export const listDevices = (): DeviceRecord[] => {
  const here = thisDeviceId();
  const out: DeviceRecord[] = [];
  devices.forEach((rec, id) => {
    if (!(rec instanceof Y.Map)) return;
    const client = describe(rec);
    const named = (rec.get("label") as string) || "";
    out.push({
      id,
      label: named || client || "Unknown device",
      client: client || named || "Unknown device",
      renamed: Boolean(named),
      firstSeen: (rec.get("firstSeen") as number) || 0,
      lastSeen: (rec.get("lastSeen") as number) || 0,
      isThisDevice: id === here,
    });
  });
  // This device first, then most recently seen — the order in which someone
  // scanning the list for something unfamiliar would want to read it.
  return out.sort((a, b) => {
    if (a.isThisDevice !== b.isThisDevice) return a.isThisDevice ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });
};

/** Give a device your own name, e.g. "Chrome (macOS)" becomes "work laptop". */
export const renameDevice = (id: string, label: string): void => {
  const rec = devices.get(id);
  const trimmed = label.trim();
  if (!rec || !trimmed) return;
  rec.set("label", trimmed);
};

/**
 * Remove a row. Tidying only: it does not revoke anything, and a device still
 * syncing will re-add itself on its next connect. Nothing in the app currently
 * signs another device out, so the UI must not imply that this does.
 */
export const forgetDevice = (id: string): void => {
  if (id === thisDeviceId()) return; // removing your own row is never meant
  devices.delete(id);
};

export const onDevicesChange = (fn: () => void): (() => void) => {
  devices.observeDeep(fn);
  return () => devices.unobserveDeep(fn);
};
