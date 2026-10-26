# Build Instructions: Quick Task Entry

Sources: `construction/code-generation/code-generation-plan.md`, `construction/code-generation/unit-test-instructions.md`, `construction/code-generation/code-summary.md`.

## Prerequisites

- Docker with Docker Compose. Every command runs in the `dev` service (`node:22-alpine`, with its own `node_modules` volume), never on host Node (project rule).
- No environment variables or local services are needed. The Supabase URL and publishable key are committed in `src/lib/supabaseConfig.ts` by design.

## Dependency Installation

```bash
docker compose run --rm dev npm ci
```

## Build

```bash
docker compose run --rm dev npm run build
```

This runs `tsc -b`, the Vite production build and the service worker (`vite-plugin-pwa`, injectManifest), then copies `dist/index.html` to `dist/404.html`.

## Build Verification

```bash
docker compose run --rm dev npm run typecheck
```

```bash
docker compose run --rm dev npm run lint
```

- The type check must exit 0.
- Lint must report 0 errors. Its 40 existing warnings are all in `.claude/tools/*`, and `npx oxlint src tests` must report none.

## Troubleshooting

- **`localStorage` undefined or hundreds of failures:** the tests are running on the host's Node 26. Use the Docker commands above.
- **Native module or binary mismatch:** the container keeps its own `node_modules` volume. Re-run `npm ci` in the container; never copy the host's `node_modules`.
