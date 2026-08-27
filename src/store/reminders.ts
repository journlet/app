// Local reminder scheduling (spec §4.6). Reliable while the app is open or
// recently backgrounded; the Due section on the spread is the dependable
// fallback. Each device tracks what it has already fired locally, so a
// reminder edited to a new time fires again everywhere, but never twice
// for the same time on the same device.
//
// Recurring reminders: a rule's remindTime rides onto each day-occurrence as
// its own remindAt when the occurrence materialises, so a defined recurring
// reminder fires like any other while the app is open. Two refinements keep
// that honest across gaps in usage:
//   1. Fired-tracking is keyed per occurrence (rule + page), not by entry id,
//      so re-materialisation or a twin created offline on another device can
//      never make the same occurrence fire twice.
//   2. On reopen after time away, only occurrences due *today* still nudge;
//      older missed occurrences are marked seen silently rather than dumping
//      a stack of stale pings at once. They remain visible in the Due /
//      overdue view, which is the dependable fallback per spec §4.6.
// Delivery while the app is fully closed needs server push (Edge Function)
// and is deferred — see spec §11 open question 6.

import { readAll } from "./journal";
import { FIRED_REMINDERS_KEY } from "../lib/storageKeys";

const FIRED_KEY = FIRED_REMINDERS_KEY;
const CHECK_MS = 30_000;

type FiredMap = Record<string, number>; // occurrence key → remindAt already fired

// Stable identity for the "already fired" record. A recurring occurrence is
// keyed by its rule and page so it survives the entry being recreated or
// deduped; a one-off reminder is keyed by its entry id.
const firedKey = (e: {
  id: string;
  recurrenceId?: string;
  pageKey: string;
}): string => (e.recurrenceId ? `rec:${e.recurrenceId}:${e.pageKey}` : e.id);

const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const loadFired = (): FiredMap => {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}") as FiredMap;
  } catch {
    return {};
  }
};

const saveFired = (m: FiredMap) => {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(m));
  } catch {
    // best effort
  }
};

export const notificationsSupported = (): boolean =>
  "Notification" in window;

export const notificationPermission = (): NotificationPermission =>
  notificationsSupported() ? Notification.permission : "denied";

export const requestNotificationPermission =
  async (): Promise<NotificationPermission> => {
    if (!notificationsSupported()) return "denied";
    return Notification.requestPermission();
  };

const fire = async (
  title: string,
  entryId: string,
  remindAt: number
): Promise<void> => {
  // Tag is unique per (entry, time): same-tag notifications replace each
  // other SILENTLY in Chrome unless renotify is set, which is how a
  // lingering old notification can swallow a new one unseen.
  const options: NotificationOptions & { renotify?: boolean } = {
    body: "Journlet reminder",
    tag: `journlet-${entryId}-${remindAt}`,
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // fall through to page-context notification
  }
  new Notification(title, options);
};

export const checkReminders = async (): Promise<void> => {
  if (notificationPermission() !== "granted") return;
  const now = Date.now();
  const dayStart = startOfToday();
  const fired = loadFired();
  let changed = false;
  for (const e of readAll()) {
    if (!e.remindAt || e.remindAt > now) continue;
    if (e.state !== "open") continue;
    const key = firedKey(e);
    if (fired[key] === e.remindAt) continue;
    // A recurring occurrence whose time already passed on an earlier day is a
    // missed instance: record it as seen so it never storms on reopen, but
    // don't nudge — it lives on in the Due / overdue view (spec §4.6). A
    // one-off reminder still fires late, since it was meant to be seen once.
    const staleRecurring = Boolean(e.recurrenceId) && e.remindAt < dayStart;
    if (!staleRecurring) await fire(e.text, e.id, e.remindAt);
    fired[key] = e.remindAt;
    changed = true;
  }
  if (changed) saveFired(fired);
};

export const startReminderLoop = (): void => {
  void checkReminders();
  setInterval(() => void checkReminders(), CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkReminders();
  });
};
