import { defineConfig } from "vitest/config";

// The store and lib layers are pure logic (Yjs runs fine in Node, crypto uses
// the Web Crypto global), so the default "node" environment is all we need for
// now. When we start testing React components we can add jsdom + a browser-like
// environment for those files only.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
