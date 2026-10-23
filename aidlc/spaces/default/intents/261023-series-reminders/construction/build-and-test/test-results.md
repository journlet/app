> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Test Results: Reminders on Repeating Items

Run on 2026-10-23 inside the `dev` service (`node:22-alpine`, Node v22.23.4) with a fresh `npm ci` into the `app_node_modules` volume. Commands are taken from `build-instructions.md` and the stage-level `construction/code-generation/unit-test-instructions.md`. That file is the only unit-test instruction file, because this is a zero-Unit `poc` run.

## Environment Note

A first attempt on the host, using Node 22 from the npx cache as `code-summary.md` describes, failed before reaching any code. At 11:57 the host `node_modules` had been reinstalled with Linux arm64 binaries, so TypeScript, oxlint, Rollup, Rolldown, lightningcss and sharp had no macOS build. Following the person's instruction, every result below comes from the Docker `dev` service instead. The host `node_modules` was left untouched.

## Build

| Command | Exit | Result |
|---|---|---|
| `npm ci --no-audit --no-fund` | 0 | Installed from `package-lock.json` |
| `npm run lint` | 0 | 0 errors and 40 warnings, all under `.claude/` (12 in `aidlc-lib.ts`, the rest spread across other `.claude/tools` and hook files). None are in `src/` or `tests/`. |
| `npm run typecheck` | 0 | `tsc -b && tsc -p tsconfig.test.json` clean |
| `npm run build` | 0 | `dist/` built, and the PWA `dist/sw.js` was generated (18 precache entries, 1014.30 KiB) |

`code-summary.md` said all 40 lint warnings were in `.claude/tools/aidlc-lib.ts`. The count matches, but they are spread across 13 files, all under `.claude/`. That does not change the result.

## Unit Tests (this change)

The one distinct command from `unit-test-instructions.md` was run once:

```bash
npx vitest run tests/seriesReminders.test.ts tests/recurrence.test.ts tests/recurrenceEnd.test.ts tests/reminders.test.ts tests/ui/EntryActionsSheet.test.tsx tests/ui/RuleActionsSheet.test.tsx
```

| Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 6 | 173 | 173 | 0 | 0 |

These include `tests/ui/EntryActionsSheet.test.tsx` with 77 tests (67 existing, 10 new) and `tests/ui/RuleActionsSheet.test.tsx` with 20 (12 existing, 8 new).

## Full Suite

```bash
npx vitest run
```

| Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 97 | 1,331 | 1,331 | 0 | 0 |

This matches the after-change figure in `code-summary.md`: 1,295 before the change, plus 36 new tests.

## Coverage

No coverage provider or threshold is configured, and `poc` adds no line-coverage floor. Coverage is measured requirement by requirement through `traceability.json` and the test table in `unit-test-instructions.md`. See `cross-unit-traceability.md`.

## Target Verification Matrix (final)

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| TC-SF-1 | `code-generation-plan.md` › Testing Contract › obligations.scope_floor[0] | Existing suite green on Node 22 | 97 files, 1,331 passed, 0 failed | Full-suite run above | build-and-test | Met |
| TC-SV-1 | `code-generation-plan.md` › Testing Contract › obligations.strategy_volume[0] | One verifiable test per requirement | All 20 ACs map to a passing test file, and each FR is reached through its ACs | `traceability.json`, `cross-unit-traceability.md` | build-and-test | Met |
| TC-SV-2 | `code-generation-plan.md` › Testing Contract › obligations.strategy_volume[1] | At least one happy-path unit test per component | Store (`seriesReminders`: AC2.1), `EntryActionsSheet` (AC1.1), `RuleActionsSheet` (AC3.1/AC3.2) | Unit run above | build-and-test | Met |
| REQ-NFR6 | `requirements.md` › NFR6 | Suite green on Node 22; each FR group has a happy path and at least 2 edge or error cases | FR1–FR5 each have a happy path and at least 2 edge cases (see `unit-test-instructions.md` › Planned Tests); suite green | Unit and full runs above | build-and-test | Met |
| REQ-NFR1 | `requirements.md` › NFR1 | Notify within 30 s of set time | Poll interval `CHECK_MS = 30_000`, unchanged by this change | `src/store/reminders.ts:25`; file absent from `git diff --stat` | build-and-test | Met |
