import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import { ensureKeys } from "./lib/keystore";

registerSW({ immediate: true });

// E2EE keyring: created silently on first launch, no prompts (spec §6).
// Sync (build step 6) will encrypt every CRDT update with this data key.
void ensureKeys();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
