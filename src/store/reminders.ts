// Local reminder scheduling (spec §4.6). Reliable while the app is open or
// recently backgrounded; the Due section on the spread is the dependable
// fallback. Each device tracks what it has already fired locally, so a
// reminder edited to a new time fires again everywhere, but never twice
// for the same time on the same device.

import { readAll } from "./journal";

const FIRED_KEY = "journlet-fired-reminders-v1";
const CHECK_MS = 30_000;

type FiredMap = Record<string, number>; // entry id → remindAt already fired

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
  const fired = loadFired();
  let changed = false;
  for (const e of readAll()) {
    if (!e.remindAt || e.remindAt > now) continue;
    if (e.state === "struck" || e.state === "migrated" || e.state === "done")
      continue;
    if (fired[e.id] === e.remindAt) continue;
    await fire(e.text, e.id, e.remindAt);
    fired[e.id] = e.remindAt;
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
