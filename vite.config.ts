import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// journlet.com is served from the domain root, so base stays "/"
export default defineConfig({
  base: "/",
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16) + "Z"),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
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
