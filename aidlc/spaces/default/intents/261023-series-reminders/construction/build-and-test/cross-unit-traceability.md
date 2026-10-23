> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Cross-Unit Traceability: Reminders on Repeating Items

Enumerated from `inception/requirements-analysis/requirements.md`: 17 FR sub-requirements and 7 NFRs. User Stories was skipped in this scope, so there are no three-segment ACs to enumerate. Checked against the one stage-level `construction/code-generation/traceability.json`; this zero-Unit run has no per-Unit files. Code Generation's `code-generation-plan.md`, `unit-test-instructions.md` and `code-summary.md` supplied the test-to-requirement mapping.

## Verdict

**FAIL (strict check), surfaced for the approval gate.** No FR ID appears in `traceability.json` with status `OK`; the file lists the requirement ACs (AC1.1–AC5.3) and NFR1–NFR7 instead. NFR5 is `Deferred`, not `OK`. Read through the ACs, every FR is exercised by a passing test, and the build-and-test failure predicate is not triggered: all commands pass and all targets are Met. The open item is the traceability record itself, plus NFR5's accepted risk.

## Functional Requirements

| ID | Direct entry in traceability.json | Exercised through | Target file (exists) | Owner | Strict status |
|---|---|---|---|---|---|
| FR1.1 | none | AC1.1 | `tests/ui/EntryActionsSheet.test.tsx` ✔ | stage-level | Uncovered |
| FR1.2 | none | AC1.2 | `tests/ui/EntryActionsSheet.test.tsx` ✔ | stage-level | Uncovered |
| FR1.3 | none | AC1.3 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR1.4 | none | AC1.4 | `tests/ui/EntryActionsSheet.test.tsx` ✔ | stage-level | Uncovered |
| FR2.1 | none | AC2.1, AC2.2 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR2.2 | none | AC2.1, AC2.3 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR2.3 | none | AC2.1 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR2.4 | none | AC2.4 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR3.1 | none | AC3.1 | `tests/ui/RuleActionsSheet.test.tsx` ✔ | stage-level | Uncovered |
| FR3.2 | none | AC3.2, AC3.3 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR3.3 | none | AC3.2, AC3.4 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR4.1 | none | AC4.1, AC4.2, AC4.3 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR4.2 | none | AC4.1, AC4.2, AC4.3 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR4.3 | none | AC2.1 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR5.1 | none | AC5.1 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR5.2 | none | AC5.1, AC5.2 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |
| FR5.3 | none | AC5.3 | `tests/seriesReminders.test.ts` ✔ | stage-level | Uncovered |

## Non-Functional Requirements

| ID | Status in traceability.json | Target file (exists) | Owner | Strict status |
|---|---|---|---|---|
| NFR1 | OK | `src/store/reminders.ts` ✔ | stage-level | Covered |
| NFR2 | OK | `src/store/recurrence.ts` ✔ | stage-level | Covered |
| NFR3 | OK | `src/lib/types.ts` ✔ | stage-level | Covered |
| NFR4 | OK | `src/store/reminders.ts` ✔ | stage-level | Covered |
| NFR5 | Deferred | n/a: accepted risk D8 (cross-device duplicate race) | stage-level | Uncovered |
| NFR6 | OK | `tests/seriesReminders.test.ts` ✔ | stage-level | Covered |
| NFR7 | OK | `src/store/sync.ts` ✔ | stage-level | Covered |

## Uncovered Elements

- FR1.1, FR1.2, FR1.3, FR1.4, FR2.1, FR2.2, FR2.3, FR2.4, FR3.1, FR3.2, FR3.3, FR4.1, FR4.2, FR4.3, FR5.1, FR5.2, FR5.3: these have no direct `OK` entry, although each is tested through the ACs listed above. Adding FR rows to `traceability.json` would close this.
- NFR5: `Deferred`, the accepted cross-device duplicate risk recorded in `code-summary.md`.
