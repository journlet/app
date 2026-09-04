// @vitest-environment jsdom
//
// Which install route the app offers, per browser.
//
// This file exists because prototype v24 went looking for tests to extend and
// found none: useInstallState.test.tsx covers the notification plumbing, and
// nothing in the suite had ever driven currentMode(). Every mode in the union
// was untested, including the two that had been shipping for months, and the
// one that was wrong — Chrome on iOS being told to go and open Safari — was
// wrong in a branch no assertion touched.
//
// So the modes are asserted here from the outside, through the hook, with the
// user agent stubbed. Nothing in the suite had stubbed one before; if a future
// mode needs a new browser, add it to BROWSERS rather than to a test.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useInstallState } from "../../src/lib/install";
import { HAS_CAPTURED_KEY } from "../../src/lib/storageKeys";

// Real user agents, trimmed to the parts the sniff reads. The tags are the
// point: CriOS is Chrome, FxiOS is Firefox, EdgiOS is Edge, and Safari on iOS
// is the one that carries none of them.
const BROWSERS = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) CriOS/139.0.7258.90 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) FxiOS/139.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) EdgiOS/139.0.3405.86 Mobile/15E148 Safari/605.1.15",
  // iPadOS 13+ presents as a Mac and is only given away by the touch points.
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
} as const;

function pretend(
  userAgent: string,
  { platform = "iPhone", maxTouchPoints = 5 } = {},
) {
  Object.defineProperty(navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
}

let mode = "";
let showBanner = false;

function Probe() {
  const install = useInstallState();
  mode = install.mode;
  showBanner = install.showBanner;
  return null;
}

beforeEach(() => {
  localStorage.clear();
  mode = "";
  showBanner = false;
});
afterEach(cleanup);

describe("the install mode each browser is given", () => {
  test("Safari on iPhone gets its own steps", () => {
    pretend(BROWSERS.iphoneSafari);
    render(<Probe />);
    expect(mode).toBe("ios-safari");
  });

  test("Chrome on iPhone gets steps of its own, not a trip to Safari", () => {
    // The whole point of the change. Chrome has offered Add to Home Screen
    // since iOS 16.4; before this it was handed the ios-other copy, which told
    // the user to open a different browser to do something Chrome can do.
    pretend(BROWSERS.iphoneChrome);
    render(<Probe />);
    expect(mode).toBe("ios-chrome");
  });

  test("Firefox on iPhone is not claimed either way", () => {
    pretend(BROWSERS.iphoneFirefox);
    render(<Probe />);
    expect(mode).toBe("ios-unknown");
  });

  test("Edge on iPhone is not claimed either way", () => {
    pretend(BROWSERS.iphoneEdge);
    render(<Probe />);
    expect(mode).toBe("ios-unknown");
  });

  test("Safari on iPad is iOS, despite saying Macintosh", () => {
    pretend(BROWSERS.ipadSafari, { platform: "MacIntel", maxTouchPoints: 5 });
    render(<Probe />);
    expect(mode).toBe("ios-safari");
  });

  test("a Mac with no touch screen is a desktop, not an iPad", () => {
    // The other half of the iPadOS check. Reverting maxTouchPoints in isIOS()
    // makes every Mac an iPhone, and this is what notices.
    pretend(BROWSERS.macChrome, { platform: "MacIntel", maxTouchPoints: 0 });
    render(<Probe />);
    expect(mode).toBe("desktop");
  });
});

describe("when the nudge is allowed to appear", () => {
  test("Chrome on iPhone gets the banner once an entry has been logged", () => {
    // bannerModes is a list, so a new mode is silent until it is added to it.
    // A mode with correct copy and no banner is the failure this catches.
    pretend(BROWSERS.iphoneChrome);
    localStorage.setItem(HAS_CAPTURED_KEY, "1");
    render(<Probe />);
    expect(showBanner).toBe(true);
  });

  test("an unrecognised iOS browser gets it too", () => {
    pretend(BROWSERS.iphoneFirefox);
    localStorage.setItem(HAS_CAPTURED_KEY, "1");
    render(<Probe />);
    expect(showBanner).toBe(true);
  });

  test("nothing appears before the first capture", () => {
    pretend(BROWSERS.iphoneChrome);
    render(<Probe />);
    expect(showBanner).toBe(false);
  });

  test("the desktop case stays in the Menu and never nudges", () => {
    // Deliberate: "find your browser's install control" is too vague to
    // interrupt somebody with, so it is offered rather than pushed.
    pretend(BROWSERS.macChrome, { platform: "MacIntel", maxTouchPoints: 0 });
    localStorage.setItem(HAS_CAPTURED_KEY, "1");
    render(<Probe />);
    expect(mode).toBe("desktop");
    expect(showBanner).toBe(false);
  });
});
