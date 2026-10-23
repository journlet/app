> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Code Summary: Reminders on Repeating Items

Zero-Unit `poc` run, executed against the approved `code-generation-plan.md`. All fourteen steps are ticked. Nothing has been committed.

## Files Changed

| File | Change |
|---|---|
| `src/lib/types.ts` | Doc comment on `Recurrence.remindTime` only. No shape change. |
| `src/store/journal.ts` | New `setRecurrenceRemindTime(id, time \| null)`. It validates `HH:MM` (00:00 to 23:59), throws `RangeError` on a malformed value, deletes the key on `null` and does nothing for an unknown rule. The `setRecurrenceEnd` "first edit" comment is updated. |
| `src/store/recurrence.ts` | `remindAtForPeriod` (exported) replaces the private `remindAtFor` and covers every scope. New `remindTimeOf`, `seriesTimeLabel`, `applySeriesReminder` and the `SeriesReminderChange` type. The materialiser now gives week, month and year occurrences a reminder. |
| `src/ui/EntryActionsSheet.tsx` | The Reminder step asks "Only this entry" or "The whole repeating item — … from here on" for both save and remove when the entry is an occurrence of a live repeat. `saveRepeat` keeps the time for every scope and uses `remindAtForPeriod`. The time field shows on every scope. |
| `src/ui/RuleActionsSheet.tsx` | Shows the current reminder or "No reminder", with Set or Change reminder, a time step (Save, Remove, Back) and an in-place refusal message. A stopped or spent repeat shows no controls. |
| `tests/seriesReminders.test.ts` | New file with 18 tests: data access and business logic. |
| `tests/ui/EntryActionsSheet.test.tsx` | 10 new tests. The existing 67 still pass, for 77 in all. `applySeriesReminder` was added to the file's `store/recurrence` mock. |
| `tests/ui/RuleActionsSheet.test.tsx` | 8 new tests. The existing 12 still pass, for 20 in all. `applySeriesReminder` and `store/reminders` were added to the mocks. |

New `data-testid` values: `remind-scope-entry`, `remind-scope-series`, `rule-reminder-current`, `rule-reminder-set`, `rule-reminder-time`, `rule-reminder-save`, `rule-reminder-remove` and `rule-reminder-back`.

## Decisions as Implemented

- **D1 (storage):** the rule's existing `remindTime` key is rewritten, and the existing covered occurrences are updated in the same `doc.transact` (`applySeriesReminder`). No new synced key. Earlier occurrences keep their own `remindAt`.
- **D2 (week, month, year):** `remindAtForPeriod` uses `keyToAnchor`, which gives the Monday, the 1st or 1 January, at `remindTime`. It returns `undefined` for no time, a malformed time, or a non-period key such as `col:…`.
- **D3 (following the series):** an occurrence follows when its `remindAt` equals `remindAtForPeriod(ruleBeforeTheChange, pageKey)`. If neither has a reminder, that also counts as following. No new data is stored. The rule is re-read from the document at the time of the action, so a stale copy held by the UI cannot skew the comparison.
- **D4 (covered set), using the narrowed reading in the brief:** from an occurrence (`via: "entry"`), the acted-on occurrence is always updated, whatever its state. A later existing occurrence (`pageKey > from`) is updated only if it is open and following. From settings (`via: "settings"`), an occurrence is updated only if it is open, following and has `pageKey >= periodKey(scope, today)`. Migrated copies are never touched, and passing one as `actedOnId` throws.
- **D5 (wording):** for day repeats the series button reads "The whole repeating item — 21:00 on each occurrence's day from here on". For other scopes it uses `seriesTimeLabel`, for example "… — 18:30 each Monday from here on". On removal it reads "… — no reminder from here on".
- **D6 (settings):** the settings show "Reminder: 08:30 each day", "… each Monday", "… on the 1st", "… on 1 January" or "No reminder". A day-page rule that does not repeat daily reads "08:30 on each day it repeats".
- **D7 (overdue first-day reminder):** no code change. A test confirms that a weekly reminder set on a Wednesday gets a past `remindAt`. `checkReminders` marks it seen without a notification, and `buildSpreadData` lists it in Due.
- **D8 (duplicates):** dedupe is unchanged. See the accepted risk below.

## Node 22 Baseline and After

Node was run as `v22.23.2` from the existing local npx cache (`/Users/garyrutland/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`), put first on `PATH` for every command. nvm is not installed on this machine and no Node was installed. `.nvmrc` and `engines` are unchanged.

| Check | Baseline (before any change) | After |
|---|---|---|
| `npm run lint` (oxlint) | exit 0, 0 errors, 40 warnings, all in `.claude/tools/aidlc-lib.ts` | exit 0, 0 errors, the same 40 warnings, none in `src/` or `tests/` |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm test` (vitest) | 96 files, 1,295 passed, 0 failed | 97 files, 1,331 passed, 0 failed (+36 new) |

The baseline had no failures under Node 22, so there was nothing pre-existing to report. The 297 failures seen on Node 26 are environmental, as the code map expected.

To check that the new tests can fail, the follows-the-series check and the all-scope materialiser change were reverted on purpose. Four of the new tests then failed. The code was restored before the final runs.

## Deviations from the Plan

- **Additional helper `remindTimeOf(remindAt)`** in `src/store/recurrence.ts`. It turns the entry reminder's instant into its time of day, "HH:MM", which is how an evening-before reminder becomes 21:00 on each day (AC2.2). The plan required this behaviour but did not name a helper. Putting it in the store makes it testable there (step 7b).
- **Migrated copies keep the single-step reminder.** A migrated copy carries `recurrenceId` but is not an occurrence (see the head of `recurrence.ts`), so the choice only appears when the entry is the rule's own occurrence (FR1.4 and AC1.4, extending 8c).
- **Remove reminder in the settings sits inside the time step**, next to Save and Back, matching the entry view. It is not a separate top-level button.
- **Back from the choice** returns to the reminder time step rather than closing the whole Reminder step. In both cases nothing is saved (AC1.5).
- **Extra edge tests** beyond the plan's list: a bad call is refused before any write; a missing rule logs a warning and changes nothing; the acted-on occurrence changes even when it is completed while a later completed one does not; a refusal shows in place in both sheets.
- **Not changed:** the header comment in `src/store/reminders.ts` still says a rule's time rides onto each "day-occurrence". The plan's blast radius left that file untouched, so the wording is now slightly out of date. Updating the comment is a one-line follow-up.

## Accepted Risk (D8, NFR5)

On one device no duplicate can arise. The series write and the materialiser run on the same JavaScript thread, and the write is a single transaction. Across devices it can happen: if one device changes the series reminder while another, which has not yet seen the change, materialises the same period, the two twins can end up with different `remindAt` values. `carriesItsOwn` treats a differing `remindAt` as the person's own edit and keeps both, so both stay visible until one is struck out. Changing dedupe to merge them would mean trusting the dedupe pass to discard a twin that may hold an edit, which is the class of fault behind the 18 August 2026 lost completion. The risk is accepted for this `poc` and recorded as `Deferred` against NFR5 in `traceability.json`.
