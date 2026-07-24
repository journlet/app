import { defineConfig } from "vitest/config";

// The store and lib layers are pure logic. Yjs runs fine in Node and crypto
// uses the Web Crypto global, but the journal store instantiates an
// IndexeddbPersistence at import time, so we polyfill IndexedDB for the node
// environment via fake-indexeddb (loaded in tests/setup.ts). When we start
// testing React components we can add jsdom for those files only.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
