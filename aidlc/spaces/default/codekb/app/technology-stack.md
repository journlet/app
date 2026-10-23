> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Technology Stack — Journlet app

Versions are the ranges declared in `package.json` at commit `8bca07f`; resolved versions are in `package-lock.json`.

## Languages and Runtime

| Item | Version | Notes |
|---|---|---|
| TypeScript | ~7.0.2 | Project references (`tsc -b`), separate `tsconfig.test.json` |
| Node.js (build and test) | ~22 | Pinned in `.nvmrc`, `engines` and CI; Docker build uses `node:22` |
| Browser target | Modern evergreen, installable PWA | Service worker, Notification API, IndexedDB |

## Frameworks and Libraries (runtime)

| Library | Version | Purpose |
|---|---|---|
| react, react-dom | ^19.2.8 | UI |
| yjs | ^13.6.32 | CRDT journal document |
| y-indexeddb | ^9.0.12 | Local persistence |
| @supabase/supabase-js | ^2.112.4 | Auth, ciphertext relay, Realtime |
| qrcode | ^1.5.4 | Journal-key transfer (show) |
| jsqr | ^1.4.0 | Journal-key transfer (scan) |

## Build and Tooling

| Tool | Version | Purpose |
|---|---|---|
| vite | ^8.2.2 | Dev server and bundler |
| @vitejs/plugin-react | ^6.1.0 | React transform |
| vite-plugin-pwa | ^1.3.0 | Manifest, service-worker build, prompt-mode updates |
| workbox-core / -precaching / -routing | ^7.4.1 | Service worker |
| oxlint | ^1.79.0 | Linting |
| sharp | ^0.35.3 | Icon generation script |

## Testing

| Tool | Version | Purpose |
|---|---|---|
| vitest | ^4.1.11 | Test runner (`vitest run`) |
| @testing-library/react | ^16.3.2 | Component tests |
| @testing-library/dom | ^10.4.1 | DOM queries |
| jsdom | ^30.0.1 | UI test environment (per-file docblock) |
| fake-indexeddb | ^6.2.5 | IndexedDB in Node tests |

## Backend and Hosting

| Item | Purpose |
|---|---|
| Supabase (Postgres, PostgREST, Auth, Realtime) | Auth and ciphertext storage; schema in `supabase/schema.sql` |
| GitHub Pages | Production hosting, deployed from `main` |
| Docker (node:22 build, nginx serve) | Alternative container serving; `Makefile` drives a dev container |
