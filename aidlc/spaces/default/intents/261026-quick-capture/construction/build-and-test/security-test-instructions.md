# Security Test Instructions: Quick Task Entry

## Scope

The change adds a UI path that calls the existing `addEntry` and `removeEntry` mutators. It adds no new data fields, no network calls, no storage keys and no new dependencies (`code-summary.md`).

| Area | Assessment |
|---|---|
| Input handling | Task text renders through React as text, never as HTML. Blank text saves nothing (FR3.2). |
| Data at rest and in transit | Unchanged. Entries are stored and synced encrypted, exactly as from the full form (NFR6). |
| Authentication and authorisation | Unchanged. No new endpoint or server code. |
| Dependencies | No new packages. Production dependencies are scanned with `npm audit` below. |
| Denial of service | Not applicable to a local UI change. |

## How to Run

```bash
docker compose run --rm dev npm audit --omit=dev
```

**Pass:** 0 vulnerabilities in production dependencies.

```bash
docker compose run --rm dev npx oxlint src tests
```

**Pass:** 0 warnings and 0 errors.
