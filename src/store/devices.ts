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
  /**
   * How the row describes itself: every client that has opened this copy, and
   * the platform, as in "Installed app and Chrome (macOS)". Plural because one
   * row is one local journal and a journal can be reached more than one way —
   * see the note on `clients` below.
   *
   * Detected rather than chosen. Naming rows yourself was offered briefly and
   * withdrawn (28 Jul, Gary): a name you have given a device is exactly what
   * would disguise a device you do not recognise, which is the one thing this
   * list exists to show you.
   */
  name: string;
  firstSeen: number;
  lastSeen: number;
  /**
   * When this device signed out and erased its copy, if it said so before going.
   *
   * Best effort by nature: only the departing device knows, and it can only say
   * so while it still has a connection, so a device signed out while offline
   * leaves no mark and simply goes stale instead.
   */
  signedOutAt?: number;
  /** Set when another device removed this one from the account. */
  removedAt?: number;
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
// Both halves are recorded, because one platform can hold the journal more than
// once and "Mac" twice would be unreadable. Named after the client, as
// WhatsApp's linked-device list does: "Chrome (macOS)", "Installed app (iOS)".
//
// Whether two clients share a row is a platform question, and the answer really
// does differ: on macOS an installed PWA runs in the browser's profile and
// shares its storage, so the installed app and Chrome are one container and one
// row naming both. On iOS the home-screen app shares nothing with Safari — not
// storage, not cookies, not even the service worker instance — so it is its own
// container and its own row. The model lives in noteClient() below; this note
// exists only so the top of the file does not imply a simpler rule than there
// is.
//
// Corrected 4 August 2026, because this comment asserted the macOS case the
// other way round: separate storage, separate rows. That was true of the design
// that preceded the collected-clients refactor and false the moment the
// refactor landed, and it sat sixty lines above the note that contradicted it.
// Gary hit the consequence from the other end — the register showing one row
// for macOS and separate rows for iOS reads as a bug until you know both
// behaviours are real, and this file was the obvious place to check and told
// him the wrong thing. A stale comment about storage boundaries is worse than
// none, because the boundaries are the reason the register looks odd.
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
// devices and someone looking at this list needs to see why. On desktop the
// same distinction is only a label: the installed app shares the browser's
// storage there, so it names a second way into one row rather than a second row.
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

// `thisClientLabel` used to live here, returning "Safari (iOS)" for a link request
// to carry so the approval prompt could name what was asking. Removed under spec
// §6.5: it was the only plaintext description of anything the server held. The
// register still names clients, because the register is inside the encrypted
// journal (§6.1c) where a label costs nothing.

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
    // Fill in the platform if the row predates that field, which rows written
    // by earlier versions of the register do. Without this they render as
    // "Installed app and Chrome" with an empty bracket, since only the device
    // itself can say what it is running on. Written once, then quiet.
    if (!existing.get("platform")) existing.set("platform", platformName());
    // Back from a sign-out: this device holds the journal again, so the mark no
    // longer describes it. Cleared before the interval check below, or a device
    // returning within the hour would keep claiming to have left.
    if (existing.get("signedOutAt")) existing.delete("signedOutAt");
    // And back from a removal, which is the same argument. The removing device
    // set this mark because the removed one could not speak for itself; now it
    // can, and it has been approved again, so the mark is simply out of date.
    // Reported by Gary on 3 August: the phone was working again and still listed
    // as removed on the Mac.
    if (existing.get("removedAt")) existing.delete("removedAt");
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

/**
 * Recover the platform from an older row's single `client` string, which held
 * it in brackets: "Installed app (iOS)". Only that device can fill the field in
 * properly, and it may not connect for days, so read it out of what is already
 * there rather than showing an empty bracket in the meantime.
 */
const platformFromLegacy = (rec: Y.Map<unknown>): string => {
  const legacy = (rec.get("client") as string) || "";
  return /\(([^)]+)\)\s*$/.exec(legacy)?.[1] ?? "";
};

/** How this row describes itself: every client that has opened it, plus the platform. */
const describe = (rec: Y.Map<unknown>): string => {
  // Rows named by hand while renaming existed keep working: the name stands in
  // until that device next connects and records what it actually is.
  const named = rec.get("label") as string | undefined;
  const clients = rec.get("clients");
  const platform =
    (rec.get("platform") as string) || platformFromLegacy(rec) || "";
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
  return (rec.get("client") as string) || named || "";
};

export const listDevices = (): DeviceRecord[] => {
  const here = thisDeviceId();
  const out: DeviceRecord[] = [];
  devices.forEach((rec, id) => {
    if (!(rec instanceof Y.Map)) return;
    out.push({
      id,
      name: describe(rec) || "Unknown device",
      firstSeen: (rec.get("firstSeen") as number) || 0,
      lastSeen: (rec.get("lastSeen") as number) || 0,
      signedOutAt: (rec.get("signedOutAt") as number) || undefined,
      removedAt: (rec.get("removedAt") as number) || undefined,
      isThisDevice: id === here,
    });
  });
  // Oldest first, by when the device was added.
  //
  // Deliberately not "this device first" (fixed 28 Jul, Gary): that gave every
  // device a different list, so the same journal read differently depending on
  // where you looked, and the row at the top changed meaning with it. It
  // actively misled — a phone showing its own row first was taken to be
  // claiming the Mac was syncing. The "this device" badge says where you are;
  // the order does not need to repeat it.
  //
  // And not by last-seen either, though that is shared and so would agree
  // across devices: it changes as devices sync, so rows would shuffle under you
  // over time. `firstSeen` never changes once written, which makes the list
  // stable as well as consistent, and reads as the order you added them in.
  // The id breaks ties, so rows written in the same millisecond, or older rows
  // with no firstSeen at all, still have one settled order everywhere.
  return out.sort(
    (a, b) => a.firstSeen - b.firstSeen || a.id.localeCompare(b.id)
  );
};

/**
 * Note that this device is signing out and erasing its copy.
 *
 * The register lives inside the journal, so the departing device is the only one
 * that can report this, and only in the moment before it tears sync down: no
 * other device can detect a sign-out. Without it a row goes on claiming to hold
 * a journal it has just erased, until its last-seen ages into obviously stale.
 */
export const markThisDeviceSignedOut = (): void => {
  const rec = devices.get(thisDeviceId());
  if (!rec) return;
  rec.set("signedOutAt", Date.now());
};

/**
 * Note that a device was removed from this account by another device.
 *
 * Written by the device doing the removing, since the removed one will never
 * connect again to say so itself. Marked rather than deleted, like a sign-out: the
 * row keeps its name and the date it was added, so the list can still answer "what
 * happened to that laptop" months later.
 */
export const markDeviceRemoved = (id: string): void => {
  const rec = devices.get(id);
  if (!rec) return;
  rec.set("removedAt", Date.now());
};

/**
 * Take a row out of the register altogether (12 August 2026, Gary).
 *
 * Marking rather than deleting was right while removal was rare: the row kept its
 * name and its date, so the list could still answer "what happened to that laptop"
 * months later. Unlocking with a passkey changed the arithmetic — every fresh
 * browser context that unlocks registers itself, so an afternoon of testing left six
 * removed rows above the two devices actually in use, and a list that is mostly
 * wreckage answers nothing at all.
 *
 * Only a row that has already gone: removed, or signed out. A live device's row is
 * rewritten by that device on its next sync, so "forgetting" one would be a control
 * that undoes itself within the hour, and this device's own row would come back
 * before the screen had finished redrawing.
 *
 * Deleting the key is safe in the CRDT sense as well as the honest one. The register
 * is informational and never a security boundary (see above), a removed device holds
 * no current key and so writes nothing that could resurrect its row, and a device
 * that is ever added back registers itself from scratch.
 */
export const forgetDevice = (id: string): boolean => {
  if (id === thisDeviceId()) return false;
  const rec = devices.get(id);
  if (!rec) return false;
  if (!rec.get("removedAt") && !rec.get("signedOutAt")) return false;
  devices.delete(id);
  return true;
};

/** Every row that has already gone, in one action. Returns how many went. */
export const forgetGoneDevices = (): number => {
  const gone: string[] = [];
  devices.forEach((rec, id) => {
    if (id === thisDeviceId()) return;
    if (!(rec instanceof Y.Map)) return;
    if (rec.get("removedAt") || rec.get("signedOutAt")) gone.push(id);
  });
  // Deleted after the walk rather than inside it: mutating a Y.Map while iterating it
  // is the kind of thing that works until the day it does not.
  gone.forEach((id) => devices.delete(id));
  return gone.length;
};

export const onDevicesChange = (fn: () => void): (() => void) => {
  devices.observeDeep(fn);
  return () => devices.unobserveDeep(fn);
};
