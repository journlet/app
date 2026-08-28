// @vitest-environment jsdom
//
// The waiting-build flag, and the banner that depends on it.
//
// This module had no test at all before 28 August 2026, which is how the gap it
// now closes survived: App read `getUpdateReady()` into useState and subscribed in
// an effect afterwards, so a service worker that finished precaching between those
// two raised no banner until the next reload. The last group here is that window,
// asserted through the store rather than the component, because the store is where
// the guarantee has to hold.

import { beforeEach, describe, expect, test, vi } from "vitest";

let appUpdate: typeof import("../src/store/appUpdate");

beforeEach(async () => {
  // Module state: the flag latches, so every test needs its own registry.
  vi.resetModules();
  appUpdate = await import("../src/store/appUpdate");
});

describe("marking a build ready", () => {
  test("starts false and latches true", () => {
    expect(appUpdate.getUpdateReady()).toBe(false);
    appUpdate.markUpdateReady();
    expect(appUpdate.getUpdateReady()).toBe(true);
  });

  test("tells the subscribers once, not once per call", () => {
    // main.tsx marks it from two places, the registration callback and an
    // explicit check, and both can fire for the same waiting worker.
    const fn = vi.fn();
    appUpdate.onUpdateReady(fn);

    appUpdate.markUpdateReady();
    appUpdate.markUpdateReady();
    appUpdate.markUpdateReady();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(appUpdate.getUpdateReady()).toBe(true);
  });

  test("stops telling a subscriber that has unsubscribed", () => {
    const fn = vi.fn();
    appUpdate.onUpdateReady(fn)();
    appUpdate.markUpdateReady();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("a manual check", () => {
  test("reports a build already waiting without asking the server", async () => {
    const checker = vi.fn();
    appUpdate.setUpdateChecker(checker);
    appUpdate.markUpdateReady();

    expect(await appUpdate.checkForUpdate()).toBe("found");
    expect(checker).not.toHaveBeenCalled();
  });

  test("says so plainly when there is no service worker to ask", async () => {
    // The dev server, and any context without one. Not an error: there is
    // nothing to check rather than something that failed.
    expect(await appUpdate.checkForUpdate()).toBe("unavailable");
  });

  test("hands the answer straight back otherwise", async () => {
    appUpdate.setUpdateChecker(async () => "current");
    expect(await appUpdate.checkForUpdate()).toBe("current");
  });
});

describe("the window between reading and subscribing", () => {
  test("a subscriber that arrives late still finds the flag set", () => {
    // The fault. Nothing notifies a listener that was not there, so the flag
    // itself has to carry the answer, and the reader has to consult it after
    // subscribing rather than before. That is what useSyncExternalStore does
    // with this pair, and what useState plus useEffect did not.
    appUpdate.markUpdateReady();

    const fn = vi.fn();
    appUpdate.onUpdateReady(fn);

    expect(fn).not.toHaveBeenCalled();
    expect(appUpdate.getUpdateReady()).toBe(true);
  });

  test("subscribe and read together are shaped for useSyncExternalStore", () => {
    // Both halves of the contract: subscribe returns an unsubscribe, and the
    // snapshot is a primitive, so React's own equality check is the right one.
    const off = appUpdate.onUpdateReady(() => {});
    expect(typeof off).toBe("function");
    expect(typeof appUpdate.getUpdateReady()).toBe("boolean");
    off();
  });
});

describe("applying it", () => {
  test("falls back to a plain reload when no worker handler is wired", async () => {
    // A dev build with no service worker still has to pick up new assets.
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      writable: true,
    });

    await appUpdate.applyUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("otherwise asks the waiting worker to take over and reload in place", async () => {
    const updateSW = vi.fn(async () => {});
    appUpdate.setUpdateSW(updateSW);

    await appUpdate.applyUpdate();

    expect(updateSW).toHaveBeenCalledWith(true);
  });
});
