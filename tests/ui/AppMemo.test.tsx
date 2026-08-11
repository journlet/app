// @vitest-environment jsdom
//
// Finding 18: the two whole-journal walks in App were not memoised, so they ran
// on every render — every keystroke in capture, details, an inline edit, the
// thread and nest filters and the search box, and every 30 seconds on setTick.
//
// This test uses the 30-second tick because it is the one re-render that needs
// no interface at all: nothing the walks depend on has changed, so a correct
// App re-renders without walking anything.
//
// The Profiler is load-bearing rather than decoration. Asserting "the walk was
// not called again" would also pass if the tick had simply stopped re-rendering
// — the test would still be green and would be checking nothing. Counting
// commits means the test fails in both directions: if the memo goes, and if the
// re-render it is written against goes.

import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import App from "../../src/App";
import { buildSpreadData } from "../../src/ui/spreadData";
import { buildMigrationHistory } from "../../src/ui/migrationHistory";

vi.mock("../../src/ui/spreadData", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/ui/spreadData")>(
      "../../src/ui/spreadData"
    );
  return { ...actual, buildSpreadData: vi.fn(actual.buildSpreadData) };
});

vi.mock("../../src/ui/migrationHistory", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/ui/migrationHistory")
  >("../../src/ui/migrationHistory");
  return {
    ...actual,
    buildMigrationHistory: vi.fn(actual.buildMigrationHistory),
  };
});

const spreadCalls = () => (buildSpreadData as unknown as Mock).mock.calls.length;
const historyCalls = () =>
  (buildMigrationHistory as unknown as Mock).mock.calls.length;

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

beforeEach(() => {
  vi.useFakeTimers();
  // Pinned, so advancing thirty seconds cannot cross midnight and change
  // `today` underneath the assertion once a day.
  vi.setSystemTime(new Date("2026-07-24T12:00:00Z"));
  (buildSpreadData as unknown as Mock).mockClear();
  (buildMigrationHistory as unknown as Mock).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

test("the 30-second tick re-renders without walking the journal again", () => {
  let commits = 0;
  render(
    <Profiler
      id="app"
      onRender={() => {
        commits++;
      }}
    >
      <App />
    </Profiler>
  );

  const commitsAfterMount = commits;
  const spreadAfterMount = spreadCalls();
  const historyAfterMount = historyCalls();

  // Both walks run once on mount, which is what makes the counts below mean
  // something: a spy that was never called cannot fail to be called again.
  expect(commitsAfterMount).toBeGreaterThan(0);
  expect(spreadAfterMount).toBeGreaterThan(0);
  expect(historyAfterMount).toBeGreaterThan(0);

  act(() => {
    vi.advanceTimersByTime(30_000);
  });

  // The tick really did re-render...
  expect(commits).toBeGreaterThan(commitsAfterMount);
  // ...and neither walk ran again.
  expect(spreadCalls()).toBe(spreadAfterMount);
  expect(historyCalls()).toBe(historyAfterMount);
});
