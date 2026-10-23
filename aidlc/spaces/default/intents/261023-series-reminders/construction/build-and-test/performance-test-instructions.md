> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Performance Test Instructions: Reminders on Repeating Items

## Applicability

Performance test instructions are generated only under the Comprehensive strategy, and only when NFR performance requirements exist. This run is **Minimal**, and the NFR Requirements and NFR Design stages were skipped, so no performance suite is generated.

The one timing requirement is NFR1 (Promptness): a series reminder notifies within 30 seconds of its set time. It is checked statically in the Target Verification Matrix in `build-and-test-summary.md` rather than by a load test. The reminder poll interval, `CHECK_MS = 30_000` at `src/store/reminders.ts:25`, is unchanged by this change; `code-summary.md` lists the files changed and `reminders.ts` is not one of them.

## Load Notes

`applySeriesReminder` walks the existing occurrences of one rule inside a single `doc.transact`, as `code-generation-plan.md` D1 describes. Its cost grows with the number of materialised occurrences of that rule, which is bounded by the days the person has actually opened. No benchmark was requested, and none is run.

## Sources

`code-generation-plan.md` (D1), `code-summary.md` (Files Changed) and `unit-test-instructions.md`, all under `construction/code-generation/`.
