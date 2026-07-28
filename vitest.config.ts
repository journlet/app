import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The store and lib layers are pure logic and run in the default "node"
// environment (the journal store's IndexeddbPersistence is polyfilled via
// fake-indexeddb in tests/setup.ts). Component tests under tests/ui opt into
// jsdom with a `// @vitest-environment jsdom` docblock at the top of the file.
// The React plugin gives those .tsx tests the same JSX transform as the app.
export default defineConfig({
  plugins: [react()],
  // vite.config.ts injects these at build time; components that show the build
  // stamp would throw a ReferenceError under test without them.
  define: {
    __BUILD_TIME__: JSON.stringify("test"),
    __BUILD_COMMIT__: JSON.stringify("testsha"),
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
