# Test Results: Quick Task Entry

All commands ran in the Docker `dev` service on 26 October 2026. This is the second run, after Loop-back 1 (below).

## Build

| Command | Result |
|---|---|
| `docker compose run --rm dev npm run build` | Success (exit 0), service worker generated |
| `docker compose run --rm dev npm run typecheck` | Exit 0 |
| `docker compose run --rm dev npx oxlint src tests` | 0 warnings, 0 errors |
| `docker compose run --rm dev npm audit --omit=dev` | 0 vulnerabilities |

On the first run, `npm run lint` reported 0 errors and 40 pre-existing warnings, all in `.claude/tools/*`. Nothing under `src` or `tests` changed that.

## Unit and Integration Tests

Each distinct command from `unit-test-instructions.md` ran once:

| Command | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| `npx vitest run tests/quickTap.test.ts` | 6 | 6 | 0 | 0 |
| `npx vitest run tests/ui/QuickLine.test.tsx` | 8 | 8 | 0 | 0 |
| `npx vitest run tests/ui/SpreadView.test.tsx tests/ui/CollectionView.test.tsx tests/ui/UndoToast.test.tsx` | 56 | 56 | 0 | 0 |
| `npx vitest run tests/ui/AppQuickLine.test.tsx` | 17 | 17 | 0 | 0 |
| All six change files together | 87 | 87 | 0 | 0 |
| Full suite, `npx vitest run` (100 files) | 1,379 | 1,379 | 0 | 0 |

No coverage provider is configured, and none was added. Coverage is per requirement in `cross-unit-traceability.md`.

## Failure Details

No command failed. R-09 is now fixed and covered by the new App test (17 of 17), so FR5.4 is Met. The stage still fails on targets:

- **Unverified: the on-device keyboard.** This covers FR1.7, the on-device part of NFR1, and NFR4. The real-phone check was skipped in code generation, and no later stage in this plan owns it.
- **Covered by inspection only: FR4.3.** It is not testable, because no current filter can hide a new open task.

First run (before Loop-back 1): every command passed, but R-09 was Not Met. Undo of a collection deletion overwrote a newer quick line's text.

## Failure Escalation (second run)

- **Rung 1, in-stage fix:** not applicable. The remaining targets are not in test configuration or build scripts.
- **Rung 2, classify and estimate:** the on-device keyboard has no fix in any swappable dimension (library or version, container image, instance type, algorithm, flag). It needs a person and a real phone, on the deployed HTTPS site or a local-only dev build.
- **Rung 3:** not taken. The mode is gated, and there is no code fix to loop back with.
- **Rung 4:** halt-and-ask, no-fix variant, presented to the person. They chose "Accept failure". The on-device keyboard targets stay Unverified, and the person owns the real-phone check after deployment.

## Loop-Back Log

### Loop-back 1 — 2026-10-26T15:31:15Z

- **Diagnosis:** Undo of a collection deletion calls `setQuick(toast.quick)` unconditionally. A newer quick line with text, opened during the 6-second window, is overwritten and its text is lost (FR5.4; code-generation review-03 R-09).
- **Root-cause stage:** code-generation (`src/App.tsx`, `undoDelete`).
- **Planned fix:** restore the stored line only when no line with text is open: `setQuick((q) => (q && q.text.trim() ? q : toast.quick))`. Add one App test of the sequence (delete the collection, open a day line and type, then Undo; the day line keeps its text).
- **Estimated impact:** about 15 minutes of effort, no financial cost, low risk (a one-line guard with a covering test).
