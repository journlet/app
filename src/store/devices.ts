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
  /** What to show: the name you gave it, or the detected client and platform. */
  label: string;
  /** The detected description, kept even when renamed so it can sit beneath. */
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
    // Refresh the detected client too: the same install can change from a
    // browser tab to a home-screen app, and a stale description is exactly the
    // kind of thing that makes someone doubt the list.
    const detected = `${clientName()} (${platformName()})`;
    if (existing.get("client") !== detected) existing.set("client", detected);
    const last = (existing.get("lastSeen") as number) || 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    existing.set("lastSeen", now);
    return;
  }
  doc.transact(() => {
    const rec = new Y.Map<unknown>();
    devices.set(id, rec);
    rec.set("id", id);
    rec.set("client", `${clientName()} (${platformName()})`);
    rec.set("firstSeen", now);
    rec.set("lastSeen", now);
  });
};

export const listDevices = (): DeviceRecord[] => {
  const here = thisDeviceId();
  const out: DeviceRecord[] = [];
  devices.forEach((rec, id) => {
    if (!(rec instanceof Y.Map)) return;
    // `client` is detected, `label` is yours. Rows written before `client`
    // existed have only a label, which stands in for both.
    const client = (rec.get("client") as string) || "";
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
