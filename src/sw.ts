/// <reference lib="webworker" />
// Journlet service worker: precaching (Workbox) plus notification handling.
// Tapping a reminder notification focuses the app — or opens it (spec
// success criterion 6).

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Prompt-mode update flow: a new build installs and then *waits* rather than
// taking over silently. It only activates when the page asks it to, via this
// message (sent by updateSW(true) — see src/store/appUpdate.ts) once the user
// taps the "Reload" banner. This keeps every version change a plainly
// labelled, user-chosen action (spec §4).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// The very first install still claims open pages so the app works offline
// immediately; subsequent updates wait for the message above.
clientsClaim();

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clients[0];
      if (existing) await existing.focus();
      else await self.clients.openWindow("/");
    })()
  );
});
