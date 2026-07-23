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

// Prompt-mode update flow (vite.config.ts registerType: "prompt"): a new build
// waits until the user chooses to apply it. onNeedRefresh fires when one is
// ready; App then shows a plainly labelled "Reload" banner (spec §4). The
// returned updateSW(true) activates the waiting worker and reloads in place —
// no app restart needed.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateReady();
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
