> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Build Instructions: Reminders on Repeating Items

Inputs: `code-generation-plan.md` (Blast Radius, Testing Contract), `code-summary.md` (Files Changed, Node 22 Baseline and After) and `unit-test-instructions.md` (Framework and Setup), all under `construction/code-generation/`.

## Prerequisites

- Docker with Compose v2. Every command runs inside the project's `dev` service (`node:22-alpine`, set in `docker-compose.yml`). Do not run npm or node on the host. The `dev` service keeps its own `node_modules` named volume (`app_node_modules`), so the host and container installs never clash.
- Network access for the first `npm ci` into the volume.
- No environment variables, config files or local services are needed to build or test. Supabase settings live in `src/lib/supabaseConfig.ts` and are not used by the build or the tests.

## Install Dependencies

```bash
docker compose run --rm --no-deps -T dev sh -c "npm ci --no-audit --no-fund"
```

`npm ci` installs exactly what `package-lock.json` names, which matches CI and the production `Dockerfile`. `--no-deps` stops Compose starting anything else, and `-T` turns off the TTY so the output can be captured.

## Build

```bash
docker compose run --rm --no-deps -T dev sh -c "npm ci --no-audit --no-fund && npm run build"
```

`npm run build` runs `tsc -b`, then `vite build`, then copies `dist/index.html` to `dist/404.html`. The output is `dist/`, which is git-ignored. The build also writes the PWA service worker, `dist/sw.js`, in `injectManifest` mode.

## Verify the Build

Run these in the same container session:

```bash
docker compose run --rm --no-deps -T dev sh -c "npm ci --no-audit --no-fund && npm run lint && npm run typecheck && npm run build"
```

| Check | Pass condition |
|---|---|
| `npm run lint` (oxlint) | exit 0 with 0 errors. The existing 40 warnings are all under `.claude/` and none are in `src/` or `tests/`. |
| `npm run typecheck` | exit 0 (`tsc -b && tsc -p tsconfig.test.json`) |
| `npm run build` | exit 0, with `dist/index.html`, `dist/404.html` and `dist/sw.js` present |

## Troubleshooting

- **`Unable to resolve @typescript/typescript-darwin-arm64` or `Cannot find native binding` (oxlint) on the host.** The host `node_modules` holds another platform's binaries, such as Linux builds from a container that mounted the folder without the named volume. Do not reinstall on the host. Run the command through `docker compose run ... dev` as shown above.
- **About 297 tests fail with `localStorage is not defined`.** That happens on Node 26. The `dev` image is Node 22, as pinned by `.nvmrc` and `engines`, so this cannot occur in the container.
- **A stale volume after a lockfile change.** `npm ci` deletes and reinstalls `node_modules` inside the volume, so re-running the install command is enough. To start completely fresh, run `docker volume rm app_node_modules`.
