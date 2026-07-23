// Install-to-home-screen help (spec §3 "Installable to home screen", §12 build
// step 9, success criterion 5). Two jobs: nudge people to install once they've
// felt the app work, and make it as easy as the platform allows.
//
// Platforms differ sharply:
//  - Android / desktop Chrome & Edge fire `beforeinstallprompt`. We capture it
//    and offer a one-tap "Install" button that triggers the real native prompt.
//  - iOS has no such event in ANY browser (all are WebKit under the hood).
//    Safari can Add to Home Screen from its Share menu, so we show the steps.
//    Chrome/Firefox/Edge on iOS bury or omit it, so we steer the user to Safari.
//  - Already installed (standalone) or a browser with no install path: show
//    nothing.
//
// Like theme and sticky prefs, the "have they captured yet" flag and the banner
// dismissal are naturally per-device, so they live in localStorage, never the
// synced journal.

import { useEffect, useState } from "react";

// `beforeinstallprompt` isn't in the standard lib.dom types yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CAPTURED_KEY = "journlet-has-captured";
const DISMISSED_KEY = "journlet-install-dismissed-v1";

// Module-level state. The browser fires `beforeinstallprompt` once, and can do
// so before React mounts, so we attach the listener at import time and stash
// the deferred event here.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = (): void => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Stop Chrome's own mini-infobar; we present our own plainly labelled
    // button instead (§4 no-guessing rule).
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // storage unavailable — harmless, standalone check will hide the banner
    }
    emit();
  });
}

/** Running as an installed app rather than a browser tab. */
export const isStandalone = (): boolean =>
  (typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches) ||
  // iOS Safari's legacy standalone flag
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ presents as a Mac; the touch points give it away
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// On iOS every engine is WebKit, but only Safari offers a reliable Add to Home
// Screen. The third-party wrappers tag themselves in the UA (CriOS = Chrome,
// FxiOS = Firefox, EdgiOS = Edge, OPT/OPR = Opera).
const isIOSSafari = (): boolean =>
  isIOS() && !/crios|fxios|edgios|opt\/|opr\//i.test(navigator.userAgent);

const read = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

/** Has the user logged at least one entry on this device? Drives when the
 *  banner first appears — we nudge only after they've felt capture work. */
export const hasCaptured = (): boolean => read(CAPTURED_KEY);

/** Call once an entry is logged. Idempotent; notifies subscribers the first
 *  time so a mounted banner can appear straight after the first capture. */
export const markCaptured = (): void => {
  try {
    if (localStorage.getItem(CAPTURED_KEY) !== "1") {
      localStorage.setItem(CAPTURED_KEY, "1");
      emit();
    }
  } catch {
    // storage unavailable — the banner just won't auto-appear, which is fine
  }
};

export type InstallMode =
  // nothing to offer: already installed, or a browser with no install path
  | "hidden"
  // native beforeinstallprompt available (Android / desktop Chrome & Edge)
  | "prompt"
  // iOS Safari — show Add to Home Screen steps
  | "ios-safari"
  // on iOS but not Safari — steer the user to open in Safari
  | "ios-other";

export interface InstallState {
  mode: InstallMode;
  /** A native install prompt is ready to fire. */
  canPrompt: boolean;
  /** The banner should show now (there's a path, they've captured, not
   *  dismissed). The menu row uses `mode` directly and ignores this. */
  showBanner: boolean;
  /** Fire the native prompt (no-op unless canPrompt). */
  promptInstall: () => Promise<void>;
  /** Hide the banner for good on this device. */
  dismissBanner: () => void;
}

function currentMode(): InstallMode {
  if (isStandalone() || installed) return "hidden";
  if (deferred) return "prompt";
  if (isIOSSafari()) return "ios-safari";
  if (isIOS()) return "ios-other";
  // Desktop Safari / Firefox never fire the event and have no scripted install
  // path — nothing honest to offer, so stay hidden.
  return "hidden";
}

export function useInstallState(): InstallState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    // The user may install or switch display mode without a fresh load; a
    // visibility check re-evaluates cheaply on return to the app.
    const onVis = () => {
      if (document.visibilityState === "visible") l();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      listeners.delete(l);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const mode = currentMode();
  return {
    mode,
    canPrompt: mode === "prompt" && !!deferred,
    showBanner: mode !== "hidden" && hasCaptured() && !read(DISMISSED_KEY),
    promptInstall: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      // A prompt can only be used once; drop it either way.
      deferred = null;
      emit();
    },
    dismissBanner: () => {
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        // storage unavailable — banner reappears next load, acceptable
      }
      emit();
    },
  };
}
