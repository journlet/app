// Global test setup. The journal store creates an IndexeddbPersistence at
// import time, which needs an IndexedDB implementation; fake-indexeddb/auto
// installs one on globalThis for the node test environment.
import "fake-indexeddb/auto";

/**
 * The app's own diagnostics, kept out of the test run.
 *
 * store/sync.ts logs a line on every push and on ignoring a retired payload,
 * store/recurrence.ts on every dedupe, store/metrics.ts on a volume readout. All
 * four are console.info, all four keep a durable record beside the log (pushLog
 * and window.__journletPushLog, dedupeLog, __journletMetrics), and none of them is
 * a fault: they exist to be read in a browser's console.
 *
 * In a test run they are worse than noise. A push is triggered from the Yjs
 * document's update listener, so it can finish after the test that caused it has
 * finished, and after the file's last test has: the run output shows `journlet
 * push` lines attributed to `recordPush` rather than to any test. Vitest sends
 * every console call from the worker to the main process as an `onUserConsoleLog`
 * rpc, so one of those landing while the worker tears down produces
 *
 *     EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending
 *
 * and the run exits 1 having reported every test passed. That is exactly what CI
 * did on 27 August 2026: 84 files passed, 1,194 tests passed, one unhandled error,
 * exit code 1. It is a race against teardown rather than a broken test, which is
 * why it appears and disappears with machine load and why it survived a local run
 * of every shard.
 *
 * Dropped here rather than filtered in the reporter, and that distinction is the
 * whole fix: the rpc is made in the worker, so the call has to not happen. Hiding
 * its output downstream would leave the pending rpc exactly where it was.
 *
 * console.warn and console.error are deliberately left alone. Those are faults and
 * should be seen, and store/decode.ts's warnings are asserted on directly. Should a
 * test ever need one of these lines, they are all still here in `infoLog`.
 */
export const infoLog: unknown[][] = [];

console.info = (...args: unknown[]): void => {
  infoLog.push(args);
};
