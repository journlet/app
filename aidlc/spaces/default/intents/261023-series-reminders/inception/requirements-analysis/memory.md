<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
- 2026-10-23T10:20:00Z — an entry reminder set for a different day (e.g. the evening before) becomes a series reminder at that time of day on each occurrence's own day; per RA Q5, not a fixed gap
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
- 2026-10-23T10:20:00Z — scope grew beyond the bug: week, month and year repeats gain reminders (RA Q4, Q8); flagged to the user before confirmation
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
- 2026-10-23T10:20:00Z — own-reminder detection by comparison (no new data) chosen over an explicit marker; simpler and sync-safe for older versions, at the cost of a hand-set reminder equal to the series time being treated as following the series
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
