<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
- 2026-10-23T09:50:00Z — first scan with no existing code map, so ran a full scan rather than a focused one; the map is shared across future work, so whole-repo coverage pays off later
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
- 2026-10-23T09:50:00Z — tests must run under the pinned Node 22; under the machine default (v26) 297 tests fail, including all reminder tests, because localStorage is undefined
- 2026-10-23T09:50:00Z — are weekly, monthly and yearly repeats in scope? Repeat reminders currently only work for day-page repeats
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
