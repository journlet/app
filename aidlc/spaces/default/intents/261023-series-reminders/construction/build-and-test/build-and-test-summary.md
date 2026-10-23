> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Build and Test Summary: Reminders on Repeating Items

Zero-Unit `poc` run, Minimal test strategy, built on the outputs in `construction/code-generation/`: `code-generation-plan.md`, `unit-test-instructions.md` and `code-summary.md`.

## Build Status

**Success.** `npm ci`, lint, typecheck and build all exit 0 inside the Docker `dev` service on Node 22. See `build-instructions.md` and `test-results.md`. The only prerequisite is Docker. Host Node and npm are not used.

## Test Type Inventory

| Type | Generated | Why |
|---|---|---|
| Unit (store, business logic, UI behaviour) | Yes, by Code Generation: 36 new tests in 3 files | Minimal strategy |
| Integration | No; see `integration-test-instructions.md` | Not part of Minimal. The store tests already run against the real Yjs document. |
| Performance | No; see `performance-test-instructions.md` | Comprehensive only; no NFR stages ran. NFR1 checked statically. |
| Security | No; see `security-test-instructions.md` | Comprehensive only. No new data or attack surface. |

## Coverage Expectations

There is one stage-level scope and no Units. The expectation is one passing test per requirement plus a happy-path floor per changed component, with the existing suite kept green. There is no line-coverage threshold, and none was added or relaxed.

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| TC-SF-1 | `code-generation-plan.md` › Testing Contract › obligations.scope_floor[0] | Existing suite green on Node 22 | 97 files, 1,331 passed, 0 failed | `test-results.md` › Full Suite | build-and-test | Met |
| TC-SV-1 | `code-generation-plan.md` › Testing Contract › obligations.strategy_volume[0] | One verifiable test per requirement | All 20 ACs map to a passing test; each FR is reached through its ACs | `traceability.json`, `cross-unit-traceability.md` | build-and-test | Met |
| TC-SV-2 | `code-generation-plan.md` › Testing Contract › obligations.strategy_volume[1] | At least one happy-path unit test per component | All 3 changed components have one | `test-results.md` › Unit Tests | build-and-test | Met |
| REQ-NFR6 | `requirements.md` › NFR6 | Suite green on Node 22; happy path and at least 2 edge cases per FR group | Met for FR1–FR5 | `unit-test-instructions.md` › Planned Tests, `test-results.md` | build-and-test | Met |
| REQ-NFR1 | `requirements.md` › NFR1 | Notify within 30 s | `CHECK_MS = 30_000`, unchanged | `src/store/reminders.ts:25` | build-and-test | Met |

## Readiness

- **Build-ready:** yes.
- **Test-ready:** yes. Every executed command passed and every target is Met.
- **Deployment-ready:** ready to commit and merge. Nothing is committed yet. Merging to `main` deploys through `.github/workflows/deploy.yaml`, and this scope runs no operation stages.

## Known Limitations

- **Cross-check of FR IDs.** `traceability.json` lists ACs and NFRs but no FR IDs, and NFR5 is `Deferred`. The strict per-ID check in `cross-unit-traceability.md` therefore flags 17 FR sub-requirements and NFR5. Every FR is exercised through its group's ACs. NFR5 is the accepted cross-device duplicate risk (D8).
- **Review findings accepted at the Code Generation gate:** R-01 (loose read-side `remindTime` check), R-02 (mixed-version drift) and R-03 (stale `seriesRule` after the permission await).
- **Small follow-up:** the header comment in `src/store/reminders.ts` still says reminders ride onto "day-occurrences" only.
- **Environment:** at 11:57 the host `node_modules` held Linux binaries, most likely from a container that mounted the folder without the named volume. The container run is unaffected. The host install was left as it was.
