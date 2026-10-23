# Unit Test Instructions: Reminders on Repeating Items

## Framework and Setup

- **Runner:** vitest, configured in `vitest.config.ts`. Store tests in `tests/` run in the Node environment. UI tests in `tests/ui/` opt into jsdom through their per-file docblock. `tests/setup.ts` installs `fake-indexeddb`.
- **Runtime:** Node 22, as pinned by `.nvmrc` and `engines`. Do not run these tests on the machine's default Node 26. Under it, 297 existing tests fail because the `localStorage` global is undefined, and that would hide real results. Switch first:

```bash
nvm use
```

- **Strategy:** Minimal. That means one verifiable test per requirement at the narrowest level, a happy-path floor per changed component, and at least two edge or error cases per requirement group, as the construction rules require. That is about 22 new tests in total.

## How to Run This Change's Tests

Every command is scoped to this change's test files. Never use a bare `npm test` here; Build and Test runs the full suite separately.

Store and business logic (new file):

```bash
npx vitest run tests/seriesReminders.test.ts
```

Entry sheet (existing file, extended):

```bash
npx vitest run tests/ui/EntryActionsSheet.test.tsx
```

Repeating item settings (existing file, extended):

```bash
npx vitest run tests/ui/RuleActionsSheet.test.tsx
```

All three together, plus the existing recurrence and reminder tests that the change touches:

```bash
npx vitest run tests/seriesReminders.test.ts tests/recurrence.test.ts tests/recurrenceEnd.test.ts tests/reminders.test.ts tests/ui/EntryActionsSheet.test.tsx tests/ui/RuleActionsSheet.test.tsx
```

## Planned Tests

| File | Test | Covers |
|---|---|---|
| `tests/seriesReminders.test.ts` | `setRecurrenceRemindTime` sets, changes and clears | FR2.1, FR2.4, FR3.1 |
| | rejects `"25:00"` and `"8:30"` with `RangeError`; an unknown rule id is a no-op | boundary validation |
| | whole-item add from today's occurrence: today 08:30, earlier unchanged, next materialised 08:30 | AC2.1, AC2.3 |
| | evening-before input becomes 21:00 on each day | AC2.2 |
| | whole-item remove clears followers and keeps an own 10:00 | AC2.4, AC5.2 |
| | change 08:30 to 09:00 keeps own 10:00, and a hand-set 08:30 moves | AC5.1, AC5.3 |
| | no series with an own reminder, then add: own kept; clear then re-add reaches followers | FR5.2 (R-03) |
| | from settings: today done untouched, today open updated, unmaterialised today gets it | AC3.2, AC3.3, AC3.4 |
| | week, month and year materialise on Monday, the 1st and 1 January | AC4.1, AC4.2, AC4.3 |
| | mid-week weekly set gives a past `remindAt`, shown overdue; a migrated copy is never changed | AC4.4 |
| | this entry only: one occurrence changes and the rule is unchanged | AC1.3 |
| `tests/ui/EntryActionsSheet.test.tsx` | an occurrence's save shows the choice and writes nothing yet | AC1.1 |
| | "Only this entry" calls `setReminder` only | AC1.3 |
| | "The whole repeating item" calls `applySeriesReminder` with the page and time | FR2.1 |
| | the series button names the time of day | D5 (R-02) |
| | remove on an occurrence offers the same choice | AC1.2 |
| | dismissing the choice writes nothing | AC1.5 |
| | a non-occurrence saves directly with no choice | AC1.4 |
| `tests/ui/RuleActionsSheet.test.tsx` | shows the current reminder or "No reminder" | AC3.1 (R-06) |
| | set calls `applySeriesReminder` with the current period | AC3.2 |
| | remove clears it; an empty time keeps Save disabled | FR3.1 |
| | a stopped rule shows no reminder controls | FR3.1 edge |

## Coverage Expectations

No coverage provider or threshold is configured, and none is added, relaxed or disabled by this change. Coverage is measured requirement by requirement through the table above and `traceability.json`. All existing tests in the touched files must stay green: 67 in the entry sheet file and 12 in the settings file.

## Mocking and Stubbing

- **Store tests** use the real Yjs document and real mutators with `fake-indexeddb`, as `tests/recurrence.test.ts` does. Reset the document between tests the same way that file does.
- **Dates:** use `vi.useFakeTimers()` and `vi.setSystemTime(...)` to fix "today", including a Wednesday for the mid-week case. Restore real timers in `afterEach`.
- **UI tests** mock `../../src/store/journal` and `../../src/store/recurrence` with `vi.mock`, following the existing `setup()` helper in each file, and assert calls rather than document state.
- **Notifications:** stub `notificationPermission` and `requestNotificationPermission` as the existing reminder tests do. Never call the real Notification API.
- **`localStorage`:** it exists under Node 22 with jsdom. Clear it in `beforeEach` where fired-key state matters.

## Test Data

Build rules and entries inline with small factory helpers in the test file, for example a daily, a weekly, a monthly and a yearly `Recurrence` anchored on fixed 2026 dates. No shared fixtures and no network access. Every test creates and discards its own data.
