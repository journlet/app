// @vitest-environment jsdom
//
// Smoke test: does App actually mount?
//
// Every other test here renders a single view with hand-made props, so a fault
// in App itself — a hook order change, a const referenced from a dependency
// array before its declaration, a bad import — passes the whole suite and then
// throws a white screen on load. That happened: `capturePinnedPk` was declared
// below the `submitEntry` useCallback that listed it as a dependency, and
// because a dependency array is evaluated the moment the callback is created,
// the app died on mount with "Cannot access 'capturePinnedPk' before
// initialization". Type-checking, linting and 461 tests were all green.
//
// This is deliberately shallow. It asserts that App renders and that nothing
// was thrown, not what it looks like — the point is to catch the crash, and a
// test that knows more about the shell would break every time the shell moves.

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import App from "../../src/App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// jsdom has no matchMedia; the theme and reduced-motion helpers both use it
beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
});

test("App mounts without throwing", () => {
  // React logs render errors to console.error before rethrowing; capture it so
  // a failure reads as the assertion below rather than a wall of React noise
  const errors: unknown[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args[0]);
  });

  expect(() => render(<App />)).not.toThrow();
  // A component that throws during render surfaces here even when a boundary
  // or React's own recovery swallows the throw
  const fatal = errors.filter(
    (e) =>
      e instanceof Error ||
      (typeof e === "string" && /before initialization|is not defined/.test(e))
  );
  expect(fatal).toEqual([]);
});
