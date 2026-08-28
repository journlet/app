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

import { useSyncExternalStore } from "react";
import { createEmitter } from "./emitter";
import { HAS_CAPTURED_KEY, INSTALL_DISMISSED_KEY } from "./storageKeys";

// `beforeinstallprompt` isn't in the standard lib.dom types yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CAPTURED_KEY = HAS_CAPTURED_KEY;
const DISMISSED_KEY = INSTALL_DISMISSED_KEY;

// Module-level state. The browser fires `beforeinstallprompt` once, and can do
// so before React mounts, so we attach the listener at import time and stash
// the deferred event here.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

const events = createEmitter();
const emit = events.emit;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Stop Chrome's own mini-infobar; we present our own plainly labelled
    // button instead (§4 no-guessing rule).
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  // The user may install or switch display mode without a fresh load, so returning
  // to the app re-evaluates. Registered here rather than inside the hook, where it
  // used to be: one listener whatever is mounted, and it has to go through emit()
  // so the snapshot moves. Calling a subscriber without moving the version is a
  // notification useSyncExternalStore is entitled to ignore, which is the trap in
  // replacing a tick counter with a real store.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") emit();
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
  // already installed / running standalone — nothing to offer
  | "hidden"
  // native beforeinstallprompt available (Android / desktop Chrome & Edge)
  | "prompt"
  // iOS Safari — show Add to Home Screen steps
  | "ios-safari"
  // on iOS but not Safari — steer the user to open in Safari
  | "ios-other"
  // desktop (or any browser) with no native prompt available: Chrome/Edge
  // before the event fires, or Firefox/Safari which never fire it. We still
  // give a route via the browser's own install control.
  | "desktop";

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
  // Chrome/Edge before beforeinstallprompt has fired, or Firefox / desktop
  // Safari which never fire it. There's still a manual route via the browser's
  // own install control, so the menu always offers one; it upgrades to
  // "prompt" the moment the event arrives.
  return "desktop";
}

export function useInstallState(): InstallState {
  // Nothing here is stored, so there is nothing to snapshot but the count of
  // notifications: the mode is read from the display media query, the banner from
  // a localStorage flag and whether a deferred prompt event exists. The count is
  // what tells React that one of those might have moved (see lib/emitter.ts), and
  // useSyncExternalStore rather than useState plus useEffect because the latter
  // loses anything that fires between the render and the subscription.
  useSyncExternalStore(events.subscribe, events.version);

  const mode = currentMode();
  // The auto-banner only fires for the clean, actionable cases — a one-tap
  // native prompt or clear iOS steps. The vague "desktop" case (find your
  // browser's install control) would be nagging, so it lives in the menu only.
  const bannerModes: InstallMode[] = ["prompt", "ios-safari", "ios-other"];
  return {
    mode,
    canPrompt: mode === "prompt" && !!deferred,
    showBanner:
      bannerModes.includes(mode) && hasCaptured() && !read(DISMISSED_KEY),
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
