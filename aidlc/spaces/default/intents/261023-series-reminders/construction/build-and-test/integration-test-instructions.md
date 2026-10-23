> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Integration Test Instructions: Reminders on Repeating Items

## Applicability

This run uses the **Minimal** test strategy (`poc` scope), and Minimal generates no integration test instruction set. The Testing Contract in `code-generation-plan.md` calls for unit tests only: one verifiable test per requirement, a happy-path floor per component, and the existing suite kept green.

Two seams in this change sit close to integration level. Both are already covered by the unit-scoped commands in `unit-test-instructions.md`, so nothing extra runs here:

| Seam | Where it is exercised |
|---|---|
| Series write and materialiser in one document (`applySeriesReminder` → `doc.transact` → materialised occurrences) | `tests/seriesReminders.test.ts`, against the real Yjs document with `fake-indexeddb`, not mocks |
| Sheets calling the store (`EntryActionsSheet`, `RuleActionsSheet` → `applySeriesReminder` and `setReminder`) | `tests/ui/EntryActionsSheet.test.tsx` and `tests/ui/RuleActionsSheet.test.tsx`, which assert the calls through `vi.mock` |

## Not Covered at This Strategy

- **Cross-device sync of a series change.** NFR2 and NFR5 involve two devices and Supabase realtime. No automated harness for this exists in the repository, and `code-summary.md` records the cross-device duplicate race (D8) as accepted risk, marked `Deferred` against NFR5. Under a Standard or Comprehensive strategy it would need a two-document Yjs merge test that applies an update from a device that has not yet seen the series change.

## Sources

`code-generation-plan.md` (Testing Contract, D1, D8), `unit-test-instructions.md` (Mocking and Stubbing) and `code-summary.md` (Accepted Risk), all under `construction/code-generation/`.
