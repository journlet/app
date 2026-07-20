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

// autoUpdate behaviour: take over as soon as a new version is installed
self.skipWaiting();
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
