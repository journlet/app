import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import { ensureKeys } from "./lib/keystore";
import { startSync } from "./store/sync";
import { startReminderLoop } from "./store/reminders";

registerSW({ immediate: true });

// E2EE keyring: created silently on first launch, no prompts (spec §6).
void ensureKeys();

// Encrypted sync via Supabase (no-op until configured and signed in)
startSync();

// Local reminder notifications (spec §4.6) — no-op until permission granted
startReminderLoop();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
