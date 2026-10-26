# Integration Test Instructions: Quick Task Entry

Test strategy: Standard, which adds integration tests at key boundaries (`code-generation-plan.md` Testing Contract).

## Boundaries Under Test

| Boundary | Test file | What it proves |
|---|---|---|
| Quick line → App → journal store (real Yjs document on fake-indexeddb) | `tests/ui/AppQuickLine.test.tsx` | Log stores a task on the line's page or collection. Undo removes it. "More" hands over to the full form. One line at a time. Text survives navigation. Deleting a collection drops its line. |
| Quick line → shared Undo message | `tests/ui/AppQuickLine.test.tsx`, `tests/ui/UndoToast.test.tsx` | A newer message replaces an older one, and the live region announces the message. |
| Sections and collections → quick line | `tests/ui/SpreadView.test.tsx`, `tests/ui/CollectionView.test.tsx` | Where the line sits, which periods allow it, and that previous, next and "back to now" are paused while it is open. |

## Setup

Run each test file inside the Docker `dev` service after `docker compose run --rm dev npm ci`. The App-level tests use the real journal store with `fake-indexeddb` (installed by `tests/setup.ts`), with no network and no Supabase.

## How to Run

```bash
docker compose run --rm dev npx vitest run tests/ui/AppQuickLine.test.tsx
```

```bash
docker compose run --rm dev npx vitest run tests/ui/SpreadView.test.tsx tests/ui/CollectionView.test.tsx tests/ui/UndoToast.test.tsx
```

## Coverage Expectations

There is no coverage threshold (none is configured, and none is added or lowered). Coverage is measured requirement by requirement in `cross-unit-traceability.md`.

## Test Data

Each test builds its own entries, pages and collections and discards them.
