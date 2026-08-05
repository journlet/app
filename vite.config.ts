import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Which commit this build came from, so a reported bug can be traced to exact
// source. In CI the checkout is a single known commit (GITHUB_SHA). Locally we
// ask git, and mark the stamp "-dirty" when the tree has uncommitted changes —
// the hash alone would otherwise describe a build that never existed.
function buildCommit(): string {
  const ci = process.env.GITHUB_SHA;
  if (ci) return ci.slice(0, 7);
  try {
    const sha = execSync("git rev-parse --short=7 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty = execSync("git status --porcelain", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    // No git available (e.g. building from a source tarball or Docker context
    // without .git) — say so plainly rather than showing a misleading hash.
    return "unknown";
  }
}

// Vite's dev server delivers CSS by creating a <style> element at runtime
// (node_modules/vite/dist/client/client.mjs). A dynamically inserted <style>
// is checked against style-src exactly like one parsed from markup, so the
// production policy in index.html — style-src 'self', no 'unsafe-inline' — has
// the browser drop the entire stylesheet and `npm run dev` renders the app
// completely unstyled. That is dev-only: the build emits a linked stylesheet
// from /assets, which 'self' allows, so Pages and the nginx parity rig are
// unaffected and neither one shows the problem.
//
// So relax the directive as the HTML is served, and only then. apply: "serve"
// is the whole point: transformIndexHtml never runs during build, so the
// index.html that ships is untouched and the shipped policy stays strict. Do
// not be tempted to move the CSP in here wholesale — keeping it in the markup
// is what makes the real policy readable where a reviewer looks for it.
function devCspAllowInlineStyles(): Plugin {
  const strict = "style-src 'self';";
  return {
    name: "journlet:dev-csp-allow-inline-styles",
    apply: "serve",
    transformIndexHtml(html) {
      if (!html.includes(strict)) {
        // The policy was reworded and this no longer matches. Fail loudly: a
        // silent no-op here serves the strict policy to dev, which presents as
        // broken CSS rather than as a broken plugin, and costs an afternoon.
        throw new Error(
          `dev CSP: could not find ${strict} in index.html — update devCspAllowInlineStyles to match the current policy.`,
        );
      }
      return html.replace(strict, "style-src 'self' 'unsafe-inline';");
    },
  };
}

// journlet.com is served from the domain root, so base stays "/"
export default defineConfig({
  base: "/",
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16) + "Z"),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  plugins: [
    devCspAllowInlineStyles(),
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // "prompt": a new build waits until the user taps Reload (spec §4 —
      // labelled actions, no silent behaviour). See src/store/appUpdate.ts.
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Journlet",
        short_name: "Journlet",
        description: "A bullet journal that feels like a journal.",
        lang: "en-GB",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#F5F4EF",
        background_color: "#F5F4EF",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // Android long-press app-icon shortcut (spec §4.1); iOS has no
        // PWA equivalent — the same URL works via Siri Shortcuts
        shortcuts: [
          {
            name: "New entry",
            short_name: "New entry",
            description: "Open straight into the entry form",
            url: "/?capture",
            icons: [
              { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            ],
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
