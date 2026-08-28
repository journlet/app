// @vitest-environment jsdom
//
// The install hook re-renders when something behind it might have changed.
//
// Nothing this hook reports is stored: the mode comes from a display media query,
// the banner from a localStorage flag and whether a deferred prompt event exists.
// So the subscription is the whole mechanism, and it changed on 28 August 2026
// from a tick counter inside the component to useSyncExternalStore over the
// store's notification count.
//
// That swap has a trap, and these tests are pointed at it. A tick counter
// re-renders because calling it sets state; useSyncExternalStore re-renders only
// if the snapshot differs, so a notification that does not move the version is one
// React is entitled to ignore. The visibility re-check used to call the subscriber
// directly. It now has to go through emit(), and if anybody moves it back the
// second test here fails while everything still type-checks.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useInstallState } from "../../src/lib/install";

let renders = 0;

function Probe() {
  renders += 1;
  const install = useInstallState();
  return <div data-testid="mode">{install.mode}</div>;
}

beforeEach(() => {
  renders = 0;
  localStorage.clear();
});
afterEach(cleanup);

const becomeVisible = () => {
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

describe("useInstallState", () => {
  test("renders a mode without needing anything wired", () => {
    render(<Probe />);
    // Whatever jsdom looks like, the hook has to answer: the Menu always offers
    // an install route (see lib/install.ts).
    expect(document.querySelector('[data-testid="mode"]')?.textContent).toBeTruthy();
  });

  test("re-renders when the app becomes visible again", () => {
    // The trap. The user may install or change display mode while the app is in
    // the background, and coming back is the only chance to notice.
    render(<Probe />);
    const before = renders;

    becomeVisible();

    expect(renders).toBeGreaterThan(before);
  });

  test("does not re-render on a visibility change to hidden", () => {
    // Going away is not news, and re-rendering on it would be work for nothing.
    render(<Probe />);
    const before = renders;

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(renders).toBe(before);
  });

  test("re-renders when the banner is dismissed", () => {
    // dismissBanner writes a localStorage flag and notifies. Without the notify
    // the banner would stay on screen until something else caused a render, which
    // is the same class of fault as the visibility case. Deliberately no explicit
    // rerender here: the re-render has to come from the notification, or this test
    // would pass on a dismissBanner that told nobody.
    let install!: ReturnType<typeof useInstallState>;
    function Reader() {
      renders += 1;
      install = useInstallState();
      return null;
    }
    render(<Reader />);
    const before = renders;

    act(() => install.dismissBanner());

    expect(renders).toBeGreaterThan(before);
    expect(install.showBanner).toBe(false);
  });
});
