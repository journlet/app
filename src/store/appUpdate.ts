// New-version handling (spec §4: every UI action plainly labelled, no
// guessing). The service worker updates in prompt mode — a new build never
// takes over silently. When one is waiting, main.tsx marks it here; App shows
// a plainly labelled "Update ready — Reload" banner. Reloading applies the
// waiting worker in place, so there is no need to close and reopen the app.

import { createEmitter } from "../lib/emitter";


// Result of a manual "check for updates" (Menu). "found" — a new build is
// waiting (the Reload banner will show); "current" — already up to date;
// "offline" — no connection to check; "unavailable" — no service worker in
// this context (e.g. the dev server).

export type UpdateCheckResult = "found" | "current" | "offline" | "unavailable";

const events = createEmitter();
let needRefresh = false;
// The reload function returned by vite-plugin-pwa's registerSW. Calling it
// with `true` tells the waiting worker to activate and reloads once it takes
// control (via the SKIP_WAITING message handled in sw.ts).
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
// Manual update check, wired to the live service worker registration in
// main.tsx. Asks the server for a newer worker right now.
let checker: (() => Promise<UpdateCheckResult>) | null = null;

export function setUpdateSW(fn: (reloadPage?: boolean) => Promise<void>) {
  updateSW = fn;
}

export function setUpdateChecker(fn: () => Promise<UpdateCheckResult>) {
  checker = fn;
}

// Trigger a manual check. If a new build is already flagged, the banner is
// showing — report that straight away.
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (needRefresh) return "found";
  if (!checker) return "unavailable";
  return checker();
}

export function markUpdateReady() {
  if (needRefresh) return;
  needRefresh = true;
  events.emit();
}

export function getUpdateReady(): boolean {
  return needRefresh;
}

/**
 * Subscribe to the flag changing.
 *
 * Shaped for useSyncExternalStore alongside getUpdateReady, which is how App
 * reads it: `useState(getUpdateReady())` plus an effect that subscribes has a gap
 * between the two, and a worker that finished precaching inside it raised no
 * banner until the next reload. See lib/emitter.ts.
 */
export function onUpdateReady(listener: () => void): () => void {
  return events.subscribe(listener);
}

// User has tapped Reload. Local journal state lives in IndexedDB via Yjs, which
// flushes on every change, so the in-place reload keeps everything.
export async function applyUpdate() {
  if (!updateSW) {
    // No handler wired (e.g. dev build without a service worker) — a plain
    // reload still picks up the latest assets.
    window.location.reload();
    return;
  }
  await updateSW(true);
}
