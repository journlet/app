// New-version handling (spec §4: every UI action plainly labelled, no
// guessing). The service worker updates in prompt mode — a new build never
// takes over silently. When one is waiting, main.tsx marks it here; App shows
// a plainly labelled "Update ready — Reload" banner. Reloading applies the
// waiting worker in place, so there is no need to close and reopen the app.

type Listener = () => void;

// Result of a manual "check for updates" (Menu). "found" — a new build is
// waiting (the Reload banner will show); "current" — already up to date;
// "offline" — no connection to check; "unavailable" — no service worker in
// this context (e.g. the dev server).
export type UpdateCheckResult = "found" | "current" | "offline" | "unavailable";

const listeners = new Set<Listener>();
let needRefresh = false;
// The reload function returned by vite-plugin-pwa's registerSW. Calling it
// with `true` tells the waiting worker to activate and reloads once it takes
// control (via the SKIP_WAITING message handled in sw.ts).
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
// Manual update check, wired to the live service worker registration in
// main.tsx. Asks the server for a newer worker right now.
let checker: (() => Promise<UpdateCheckResult>) | null = null;

function emit() {
  listeners.forEach((l) => l());
}

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
  emit();
}

export function getUpdateReady(): boolean {
  return needRefresh;
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
