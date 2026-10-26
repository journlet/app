# Cross-Unit Traceability: Quick Task Entry

Source of IDs: `inception/requirements-analysis/requirements.md`. User Stories did not run, so there are no AC IDs. Coverage comes from `construction/code-generation/traceability.json` (stage-level, zero-Unit work).

## Verdict

**Fail: 4 of 38 IDs are not covered with status OK.** All four are surfaced at the approval gate.

## Coverage

| ID | Status | Owning stage | Target file |
|---|---|---|---|
| FR1.1 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| FR1.2 | OK | code-generation | tests/ui/CollectionView.test.tsx |
| FR1.3 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| FR1.4 | OK | code-generation | tests/quickTap.test.ts |
| FR1.5 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| FR1.6 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| FR1.7 | **Deferred** | none scheduled | In-app part: tests/ui/QuickLine.test.tsx. On-device part: unverified |
| FR1.8 | OK | code-generation | src/ui/QuickLine.tsx |
| FR2.1 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR2.2 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR2.3 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR2.4 | OK | code-generation | src/ui/QuickLine.tsx |
| FR3.1 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR3.2 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR3.3 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR3.4 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| FR3.5 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR3.6 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR4.1 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR4.2 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR4.3 | **N/A** | none | No current filter can hide a new open task; covered by inspection only |
| FR4.4 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR4.5 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR4.6 | OK | code-generation | tests/ui/UndoToast.test.tsx |
| FR5.1 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR5.2 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR5.3 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| FR5.4 | OK | code-generation | tests/ui/AppQuickLine.test.tsx (open defect R-09, see test-results.md) |
| FR5.5 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| FR6.1 | OK | code-generation | tests/ui/CaptureForm.test.tsx |
| FR6.2 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| NFR1 | **Deferred** | none scheduled | In-app part: tests/ui/AppQuickLine.test.tsx. On-device part: unverified |
| NFR2 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| NFR3 | OK | code-generation | tests/ui/QuickLine.test.tsx |
| NFR4 | **Deferred** | none scheduled | Real phone only (src/ui/QuickLine.tsx) |
| NFR5 | OK | code-generation | tests/ui/SpreadView.test.tsx |
| NFR6 | OK | code-generation | tests/ui/AppQuickLine.test.tsx |
| NFR7 | OK | code-generation | vitest.config.ts |

## Uncovered Elements

- **FR1.7, NFR1 (on-device part), NFR4:** need the real-phone check. No later stage in this plan owns it.
- **FR4.3:** unreachable with today's filters, so it is covered by inspection.
