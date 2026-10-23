# Code Generation Plan: Reminders on Repeating Items

Zero-Unit `poc` run: the work is scoped from `requirements.md` (FR1 to FR5, NFR1 to NFR7) and the code knowledge base at `aidlc/spaces/default/codekb/app/`. Requirement IDs are preserved exactly.

## Design Decisions

### D1. How "from this occurrence onward" is stored (requirements OQ1)

The constraint that settles it: repeating items only ever create the occurrence for the current period, never ones ahead (`materialiseRecurrences`, C2). So at the moment of any series change, the only covered occurrences that exist are the acted-on one and, at most, the current period's. Every later one is created from the rule.

| Option | For | Against |
|---|---|---|
| **A. Chosen:** update the rule's existing `remindTime` key, then make one explicit pass over the existing covered occurrences, all in one `doc.transact` | No new synced key, so older versions read the change correctly for day repeats (NFR3). Earlier occurrences keep the `remindAt` they already hold, so nothing before the acted-on occurrence changes. Smallest blast radius. | Occurrences for past periods that a device materialises late, during catch-up after days offline, get the new time. They are already stale and are marked seen without notifying (`reminders.ts`), so they never fire. |
| B. Split the rule at the chosen occurrence (end the old rule, start a new one) | Exact history per rule | Changes "repeats" captions, end and count semantics, Scheduled-ahead previews and dedupe grouping. Two rules for one item is the shape the "same words repeat twice" warning was added to prevent. Much larger change. |
| C. Add an effective-from key next to `remindTime` | Exact for late catch-up | A new key that older versions ignore, so they apply the new time to every period (NFR3 is only met loosely). It adds a key to reason about for a case that never notifies anyway. |

### D2. Week, month and year repeats (requirements OQ2, FR4)

The reminder goes on the period's first day at the series time: the ISO-week Monday (`isoWeekToMonday`), the 1st of the month, or 1 January, via the existing `keyToAnchor`. The same `remindTime` key is reused. Older versions only apply `remindTime` when `pageScope === "day"`, so they never misread it for other scopes. They simply give those occurrences no reminder, which is today's behaviour and acceptable under NFR3.

### D3. "Following the series" (FR5, review R-03)

An occurrence follows the series when its `remindAt` equals what the series reminder held before this action would give it. An occurrence with no reminder follows a series that had none. The reference is always the old series value at the moment of the action, so:

- with no series reminder, an occurrence with any reminder counts as its own;
- after a clear, the occurrences that followed now have none and follow again, so a later re-add reaches them while own reminders stay put.

No new data is saved (requirements FR5.3; project rule recorded in `project.md`).

### D4. Covered occurrences and closed entries (review R-01)

From an occurrence, the covered set is that occurrence and every existing occurrence of the same rule on a later page, whatever its state. The acted-on occurrence is always updated, because the person acted on it directly. Later ones that are not open are also skipped. From the repeating item's settings, the covered set is open occurrences whose page is the current period or later (FR3.2, AC3.3).

### D5. Telling the person the time-of-day rule (review R-02)

The series choice button names the result, for example "The whole repeating item — 21:00 on each occurrence's day from here on". So an evening-before reminder visibly becomes a same-day time before anything is saved.

### D6. Settings show the current series reminder (review R-06)

The repeating item's settings show "Reminder: 08:30 each day" (or "each Monday", "on the 1st", "on 1 January"), or "No reminder". There is a button to add or change it, and one to remove it.

### D7. Overdue first-day reminders (review R-05, AC4.4)

Checked against the code: `reminders.ts` treats a recurring occurrence whose `remindAt` is before today's start as stale and marks it seen without notifying. `spreadData.ts` lists every open entry with `remindAt` at or before the end of today in the Due list. AC4.4 already matches current behaviour, so no change is needed.

### D8. Duplicates during sync (NFR5, review R-04)

On a single device, the update and the materialiser run in one JavaScript thread, and the update is one transaction, so no duplicate can arise. Across devices, a series change racing another device's materialisation of the same period can leave two twins whose `remindAt` differ. `carriesItsOwn` deliberately keeps both rather than risk discarding an edit. This plan does not change dedupe. The cross-device case is recorded as an accepted risk in `code-summary.md`, because changing dedupe would put completed work at risk (see the 18 August 2026 note in `recurrence.ts`).

## Blast Radius

| File | Change | Consumers and tests | Impact |
|---|---|---|---|
| `src/store/journal.ts` | New `setRecurrenceRemindTime(id, time \| null)` mutator, next to `setRecurrenceEnd` | `recurrence.ts`, both sheets; `tests/` store tests | Low: additive |
| `src/store/recurrence.ts` | Export a shared `remindAtForPeriod(rule, pageKey)` (all scopes) to replace the private `remindAtFor`. Materialiser applies it to every scope. New `applySeriesReminder(rule, fromPageKey, time \| null, origin)` | `materialiseRecurrences` (boot loop), sheets; `tests/recurrence*.test.ts` | Medium: materialiser now gives week, month and year occurrences a reminder (FR4) |
| `src/ui/EntryActionsSheet.tsx` | Reminder step on an occurrence asks this entry only or the whole repeating item, for save and remove. `saveRepeat` uses the shared helper and keeps a time for every scope (TD-6) | `App.tsx`; `tests/ui/EntryActionsSheet.test.tsx` (67 tests) | Medium: large file (TD-1), so keep edits contained |
| `src/ui/RuleActionsSheet.tsx` | New reminder step: show current, set or change, remove | `App.tsx`; `tests/ui/RuleActionsSheet.test.tsx` (12 tests) | Low |
| `src/lib/types.ts` | Doc comment on `remindTime` only (no shape change) | everything | Low |

No change to sync, the reminder loop, dedupe, Supabase or the build configuration.

## Steps

Ordering follows the Testing Contract below (test-after: implement each layer, then write and run its tests). Layers that do not apply here: API/endpoint (none in this app) and database migration (the Yjs document is schemaless; an existing key is reused).

- [x] **Step 1: Project structure and baseline.** No new files except tests. Switch to Node 22 per `.nvmrc` and record the full-suite baseline: `npm run lint`, `npm run typecheck`, then `npm test`, all under Node 22. Record totals in `code-summary.md`. Any failure under Node 22 is a pre-existing baseline item and must be reported, not fixed silently. (NFR6, C4)
- [x] **Step 2: Verify the test runner.** Confirm that vitest runs the exact scoped command in `unit-test-instructions.md` under Node 22 against the existing `tests/recurrence.test.ts` before any new test is written. (NFR6)
- [x] **Step 3: Data model.** Add a doc comment to `Recurrence.remindTime` in `src/lib/types.ts`: "HH:MM; day repeats remind on the occurrence's day, week/month/year repeats on the period's first day; editable after creation". No shape change. (FR4, D1, D2)
- [x] **Step 4: Data access: implement.** Add `setRecurrenceRemindTime(id: string, time: string | null): void` to `src/store/journal.ts`. It validates `^\d{2}:\d{2}$` with hours 00 to 23 and minutes 00 to 59, throws `RangeError` on a malformed value (boundary validation, no silent failure), deletes the key on `null`, and does nothing for an unknown rule id. Same transaction style as `setRecurrenceEnd`; update that function's "first edit a rule has ever had" comment. (FR2.1, FR3.1, FR2.4)
- [x] **Step 5: Data access: tests.** In `tests/seriesReminders.test.ts`: sets, changes and clears `remindTime`; rejects `"25:00"` and `"8:30"`; unknown id is a no-op. Run the scoped command. (FR2.1, FR2.4, FR3.1)
- [x] **Step 6: Business logic: implement.** In `src/store/recurrence.ts`:
  - [x] 6a. Export `remindAtForPeriod(rule, pageKey)`. For a day key, use that day; otherwise use `keyToAnchor(pageKey)` (Monday, the 1st, 1 January) at `remindTime`. Return `undefined` when there is no or an invalid `remindTime`. Replace `remindAtFor`, and drop the `pageScope === "day"` gate in `materialiseRecurrences` so every scope gets its reminder. (FR4.1 to FR4.3, FR2.3, TD-6)
  - [x] 6b. Export `applySeriesReminder(rule, opts: { from: string; via: "entry" \| "settings"; actedOnId?: string; time: string \| null })`. In one `doc.transact`, it computes each covered occurrence's old series value with `remindAtForPeriod(oldRule, pk)` and its new value with `remindAtForPeriod(newRule, pk)`. It writes `remindTime` through `setRecurrenceRemindTime` semantics, and updates (or clears) each covered occurrence that follows the old series (D3, D4). It never touches pages before `from` or migrated copies, and it returns the ids it changed, for tests and the summary. (FR2.2, FR2.4, FR3.2, FR3.3, FR5.1, FR5.2)
  - [x] 6c. Export `seriesTimeLabel(rule)`, for example "08:30 each day", "09:00 each Monday", "09:00 on the 1st" or "09:00 on 1 January", for the sheets. (D5, D6)
- [x] **Step 7: Business logic: tests.** In `tests/seriesReminders.test.ts`, run the scoped command after each group. (NFR6)
  - [x] 7a. Daily rule, add from today's occurrence: today gets 08:30, an earlier occurrence is unchanged, and the next materialised day has 08:30. (AC2.1, AC2.3)
  - [x] 7b. Evening-before input becomes 21:00 on each day. (AC2.2)
  - [x] 7c. Remove for the whole item clears the following occurrences and keeps the own 10:00 one. (AC2.4, AC5.2)
  - [x] 7d. Change 08:30 to 09:00 keeps the own 10:00 one, and a hand-set 08:30 moves (D3). (AC5.1, AC5.3)
  - [x] 7e. No series reminder plus an own-reminder occurrence, then add a series reminder: the own one is kept. Clear then re-add reaches occurrences that followed. (R-03, FR5.2)
  - [x] 7f. From settings, today's done occurrence is untouched, today's open one is updated, and today not yet materialised gets the reminder on creation. (AC3.2, AC3.3, AC3.4)
  - [x] 7g. Weekly, monthly and yearly materialisation puts `remindAt` on Monday, the 1st and 1 January at the time. (AC4.1, AC4.2, AC4.3)
  - [x] 7h. Edge cases: a weekly reminder set mid-week gives this week's occurrence a past `remindAt`, which `firedKey`/stale logic treats as seen and the Due list shows as overdue. A migrated copy is never changed. (AC4.4, D7)
  - [x] 7i. Not a whole-item action, so this entry only: `setReminder` changes only that occurrence and the rule keeps `remindTime`. (AC1.3)
- [x] **Step 8: Frontend: implement, entry sheet.** In `src/ui/EntryActionsSheet.tsx`, contained in the reminder step and `saveRepeat`:
  - [x] 8a. When `sheetEntry.recurrenceId` resolves to an active rule, "Save reminder" and "Remove reminder" lead to a two-button choice: "Only this entry" and "The whole repeating item — {time} on each occurrence's day from here on" (worded per scope with `seriesTimeLabel`), plus Back. Dismissing saves nothing. Each button gets a `data-testid` (`remind-scope-entry`, `remind-scope-series`). (FR1.1, FR1.2, AC1.5, D5)
  - [x] 8b. "Only this entry" uses the existing `setReminder` path. "The whole repeating item" calls `applySeriesReminder` with `via: "entry"`, `from: sheet.pk` and `actedOnId: sheet.id`. (FR1.3, FR2.1 to FR2.4)
  - [x] 8c. Entries that are not occurrences, or are from a spent rule, keep today's single-step behaviour. (FR1.4, AC1.4)
  - [x] 8d. `saveRepeat` uses `remindAtForPeriod` and keeps the time for every scope; the time field is shown for every scope. (FR4.1, TD-6)
- [x] **Step 9: Frontend: tests, entry sheet.** Add to `tests/ui/EntryActionsSheet.test.tsx`: an occurrence's save shows the choice and writes nothing until chosen; "Only this entry" calls `setReminder` only; "whole" calls `applySeriesReminder` with the right `from` and time; the button label names the time of day; a non-occurrence saves directly; dismissing the choice writes nothing; remove offers the same choice. Run the scoped command, then the whole file's existing 67 tests stay green. (AC1.1, AC1.2, AC1.4, AC1.5, D5)
- [x] **Step 10: Frontend: implement, repeating item settings.** In `src/ui/RuleActionsSheet.tsx`, add a line showing `seriesTimeLabel(rule)` or "No reminder" (`data-testid="rule-reminder-current"`). Add a "Set reminder…" or "Change reminder…" button that opens a time step with an `<input type="time">`, a Save button and Back, and a "Remove reminder" button when one exists. These call `applySeriesReminder` with `via: "settings"` and `from: periodKey(rule.pageScope, today)`, and request notification permission as the entry path does. Spent or stopped rules show no reminder controls. (FR3.1 to FR3.3, D6)
- [x] **Step 11: Frontend: tests, repeating item settings.** Add to `tests/ui/RuleActionsSheet.test.tsx`: shows the current reminder or "No reminder"; set calls `applySeriesReminder` with the current period and the time; remove clears it; an empty or invalid time keeps Save disabled; a stopped rule shows no controls. Run the scoped command, then the file's existing 12 tests stay green. (AC3.1, AC3.2, FR3.1)
- [x] **Step 12: Environment and build.** No configuration changes. Run `npm run lint` and `npm run typecheck` under Node 22 and fix any findings in changed files. No thresholds are added, relaxed or disabled. (NFR6)
- [x] **Step 13: Full regression.** Run the full `npm test` under Node 22 and compare it with the Step 1 baseline. Any new failure is a regression and is fixed before continuing. (NFR6, brownfield Test Validation)
- [x] **Step 14: Documentation and traceability.** Write `code-summary.md` covering files, decisions D1 to D8, the baseline and after totals, and the D8 accepted risk. Write `source-manifest.json` listing every changed source and test path, and `traceability.json` mapping AC1.1 to AC5.3 and NFR1 to NFR7 to existing implementation or test files. NFR1 is met by the unchanged 30-second reminder loop (`src/store/reminders.ts`). NFR2 and NFR7 are met by the unchanged encrypted sync, with the change written through `doc.transact`. NFR4 is met by the unchanged fired-key logic. (all)

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run that layer's tests.",
  "scope": "poc",
  "test_strategy": "minimal",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:ddd208517f68585f816e80821872bd21e26dc15e7bf545c6a78ec96b6afc20da",
  "contract_sha256": "sha256:8780c9b6738d34215859c7d0d02b149a16944cf2942a43d2c2dee67268c80df0"
}
```

## Requirement Traceability

| Requirement | Plan steps |
|---|---|
| FR1 (choice) | 8a, 8b, 8c, 9 |
| FR2 (series from an occurrence) | 4, 6a, 6b, 7a to 7e, 8b |
| FR3 (series from settings) | 4, 6b, 7f, 10, 11 |
| FR4 (all repeat kinds) | 3, 6a, 7g, 7h, 8d |
| FR5 (own reminders) | 6b, 7c to 7e |
| NFR1, NFR4 | unchanged reminder loop; 7h |
| NFR2, NFR3, NFR7 | D1, D2; single `doc.transact`; no new synced key |
| NFR5 | D8 (single-device guaranteed; cross-device accepted risk) |
| NFR6 | 1, 2, 5, 7, 9, 11, 12, 13 |
