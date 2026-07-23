import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import { ensureKeys } from "./lib/keystore";
import { startSync } from "./store/sync";
import { startReminderLoop } from "./store/reminders";
import { startRecurrenceLoop } from "./store/recurrence";
import { persistence } from "./store/journal";
import { markUpdateReady, setUpdateSW } from "./store/appUpdate";
import { applyTheme, loadTheme } from "./lib/theme";

// Apply the saved theme before first render. CSS's prefers-color-scheme
// fallback already covers "system" pre-JS; this pins an explicit light/dark
// choice (CSP forbids an inline head script, so this is as early as it gets).
applyTheme(loadTheme());

// Prompt-mode update flow (vite.config.ts registerType: "prompt"): a new build
// waits until the user chooses to apply it. onNeedRefresh fires when one is
// ready; App then shows a plainly labelled "Reload" banner (spec §4). The
// returned updateSW(true) activates the waiting worker and reloads in place —
// no app restart needed.
//
// The browser only looks for a new worker at registration (i.e. on a fresh
// start), so a long-lived open app would never notice a deploy until it was
// restarted. onRegisteredSW below makes the running app check the server
// itself: on a timer while open, and — the moment that matters most for an
// installed PWA the OS suspends in the background — whenever it regains focus.
const UPDATE_CHECK_MS = 30 * 60 * 1000; // hourly-ish poll while the app stays open

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateReady();
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      // update() re-fetches sw.js; a waiting worker then triggers onNeedRefresh
      if (navigator.onLine) void registration.update();
    };
    setInterval(checkForUpdate, UPDATE_CHECK_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
    window.addEventListener("focus", checkForUpdate);
  },
});
setUpdateSW(updateSW);

// E2EE keyring: created silently on first launch, no prompts (spec §6).
void ensureKeys();

// Encrypted sync via Supabase (no-op until configured and signed in)
startSync();

// Local reminder notifications (spec §4.6) — no-op until permission granted
startReminderLoop();

// Recurring entries materialise once the local journal has loaded
void persistence.whenSynced.then(startRecurrenceLoop);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
