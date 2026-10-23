> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Requirements: Reminders on Repeating Items

## Intent Analysis

- **Goal:** let a person put a reminder on a repeating item that already exists, and choose each time whether a reminder they add, change or remove applies to one entry or to the whole repeating item from that point onward. Source: intent statement (Problem Statement; intent Q1, Q3, Q7).
- **Type:** bug fix plus enhancement. Today, adding a reminder to an occurrence changes only that entry. A repeating item's reminder time (`remindTime`) can only be set when the repeat is created, and it only exists for day-page repeats (code map: `code-quality-assessment.md` TD-2, TD-3, TD-5).
- **Scope:** several components (Entry Actions Sheet, Rule Actions Sheet, Journal Store, Recurrence Engine), all inside one app. Sync is untouched but carries the change.
- **Complexity:** standard. The subtle parts are cross-device behaviour and telling an occurrence's own reminder apart from one that follows the series.

### Terms

- **Repeating item:** a repeat rule and its occurrences.
- **Occurrence:** an entry the repeating item created, on a day, week, month or year page.
- **Series reminder:** the repeating item's reminder, a time of day (plus, for week, month and year repeats, the first day of the period).
- **Following the series:** an occurrence whose reminder equals the one the current series reminder would give it.
- **Own reminder:** an occurrence whose reminder differs from the one the series reminder would give it (RA Q3).
- **Covered occurrences:** for an action taken from an occurrence, that occurrence and every later one. For an action taken from the repeating item's settings, today's occurrence (if it exists and is still open) and every later one (intent Q7; RA Q1).

## Functional Requirements

### FR1. Choosing between this entry and the whole repeating item

- **FR1.1** When a person adds a reminder to an occurrence, the app asks whether it is for this entry only or for the whole repeating item. (intent Q1)
- **FR1.2** When a person changes or removes a reminder on an occurrence, the app asks the same question. (intent Q3)
- **FR1.3** Choosing "this entry only" changes that occurrence alone, and the repeating item's series reminder is left unchanged. (intent Q1, Q3)
- **FR1.4** An entry that is not an occurrence of a repeating item keeps today's behaviour, with no choice shown. (intent problem statement: the change concerns repeating items only)

Acceptance criteria:

- **AC1.1** Given a daily repeating item with an occurrence today, when I add a reminder to today's occurrence, then I am asked "this entry only" or "the whole repeating item" before anything is saved.
- **AC1.2** Given an occurrence with a reminder, when I change its time or remove it, then I am asked the same question.
- **AC1.3** Given I choose "this entry only", when the reminder is saved, then only that occurrence's reminder changes, and later occurrences created by the repeating item do not get it.
- **AC1.4** Given an entry that is not part of a repeating item, when I add a reminder, then no choice is shown and the reminder is saved as today.
- **AC1.5** (edge case) Given the choice is shown, when I dismiss it without choosing, then nothing is saved.

### FR2. Applying a series reminder from an occurrence

- **FR2.1** Choosing "the whole repeating item" when adding or changing a reminder sets the series reminder, using the time of day of the reminder entered. (RA Q5)
- **FR2.2** The covered occurrences that already exist and follow the series (or have no reminder) get the new reminder on their own day (or, for week, month and year repeats, on the first day of their period; see FR4) at that time of day. Occurrences before the chosen one are not changed. (intent Q7; RA Q5)
- **FR2.3** Occurrences the repeating item creates afterwards carry the series reminder. (intent Q5)
- **FR2.4** Choosing "the whole repeating item" when removing a reminder clears the series reminder and clears the reminder from the covered occurrences that follow the series. (intent Q3; RA Q2)

Acceptance criteria:

- **AC2.1** Given a daily repeating item with no reminder, when I add a 08:30 reminder to today's occurrence and choose the whole repeating item, then today's occurrence reminds at 08:30 today and each later occurrence reminds at 08:30 on its own day, with no reminder added again.
- **AC2.2** Given I enter a reminder for the evening before the occurrence (for example 21:00 the previous day) and choose the whole repeating item, then the series reminder is 21:00 on each occurrence's own day. (RA Q5: same time of day)
- **AC2.3** Given earlier occurrences exist before the one I changed, when I apply a series reminder, then none of those earlier occurrences change.
- **AC2.4** Given a series reminder at 08:30, when I remove it from an occurrence and choose the whole repeating item, then the series reminder is cleared and every covered occurrence that was following the series loses its reminder.

### FR3. Setting a series reminder from the repeating item's own settings

- **FR3.1** The repeating item's own settings let the person add a series reminder, change its time, and remove it. (intent Q2)
- **FR3.2** From the repeating item's settings, the change covers today's occurrence, if it exists and is still open, and every later one. (RA Q1)
- **FR3.3** Covered occurrences are updated as in FR2.2 and FR2.4, and later occurrences follow FR2.3.

Acceptance criteria:

- **AC3.1** Given a repeating item whose settings I open from its preview row, when I look at the options, then I can add, change or remove its reminder.
- **AC3.2** Given today's occurrence exists and is open, when I set a 07:00 reminder from the settings, then today's occurrence reminds at 07:00 today and every later occurrence does the same.
- **AC3.3** (edge case) Given today's occurrence is done or struck, when I set a reminder from the settings, then today's occurrence is unchanged and later occurrences get the reminder.
- **AC3.4** (edge case) Given today's occurrence has not been created yet, when I set a reminder from the settings, then the occurrence gets the reminder when it is created.

### FR4. All kinds of repeat

- **FR4.1** Series reminders work for repeats on day, week, month and year pages. (RA Q4)
- **FR4.2** For a week repeat, the reminder goes off on the Monday of each week at the chosen time. For a month repeat, it goes off on the 1st of each month, and for a year repeat on 1 January. (RA Q8)
- **FR4.3** For a day repeat, the reminder goes off on the occurrence's own day at the chosen time. (RA Q5)

Acceptance criteria:

- **AC4.1** Given a weekly repeating item, when I set a 09:00 series reminder, then each week's occurrence reminds at 09:00 on that week's Monday.
- **AC4.2** Given a monthly repeating item, when I set a 09:00 series reminder, then each month's occurrence reminds at 09:00 on the 1st of that month.
- **AC4.3** Given a yearly repeating item, when I set a 09:00 series reminder, then each year's occurrence reminds at 09:00 on 1 January.
- **AC4.4** (edge case) Given a weekly series reminder is set on a Wednesday, when it applies to this week's occurrence, then that occurrence's reminder (Monday 09:00) is already past, so it appears as overdue in the Due list rather than firing a late notification. This is the app's existing rule for stale repeat reminders.

### FR5. Occurrences with their own reminder

- **FR5.1** An occurrence whose reminder differs from the one the series reminder gives it is treated as having its own reminder. (RA Q3)
- **FR5.2** Adding, changing or removing a series reminder never changes an occurrence that has its own reminder. (intent Q5; RA Q2)
- **FR5.3** No new saved data is introduced to mark an own reminder. An occurrence set by hand to exactly the series-derived time therefore follows the series. (RA Q3)

Acceptance criteria:

- **AC5.1** Given a daily series reminder at 08:30 and one occurrence set by hand to 10:00, when I change the series reminder to 09:00, then that occurrence stays at 10:00 and the other covered occurrences move to 09:00.
- **AC5.2** Given the same setup, when I remove the series reminder for the whole repeating item, then the 10:00 occurrence keeps its reminder and the others lose theirs.
- **AC5.3** (edge case) Given an occurrence set by hand to 08:30 while the series reminder is 08:30, when the series changes to 09:00, then that occurrence moves to 09:00. This follows from FR5.3.

## Non-Functional Requirements

- **NFR1 Promptness:** a series reminder notifies within 30 seconds of its set time while the app is open, the same as one-off reminders today. (RA Q7)
- **NFR2 Sync safety:** a series reminder change syncs to the person's other devices like any other edit. No entry, repeating item or reminder may be lost or corrupted on any device, including one running an older version. (intent Q4; RA Q6)
- **NFR3 Older versions:** a device on an older version may show the old reminder behaviour until it updates. (RA Q6)
- **NFR4 No repeat notifications:** each occurrence notifies at most once for a given reminder time on a given device, as today. A changed series time may notify once more at the new time. (code map TD-9: existing behaviour kept)
- **NFR5 No visible duplicates:** applying a series reminder must not leave two copies of the same occurrence visible on any device. (code map TD-7)
- **NFR6 Tests:** the existing test suite stays green on the repository's pinned Node 22. Each FR group above has at least one automated test covering its happy path and at least two error or edge cases. (org Testing Posture for `poc`; construction phase Testing Standards)
- **NFR7 Security and privacy:** reminders and repeating items stay end-to-end encrypted in sync, and no new data leaves the device unencrypted. (code map `architecture.md` Security Notes)

## Constraints

- **C1:** local-first app on one synced shared document. Repeat rule edits are per-field writes, and when two devices change the same field at once one value wins. (code map `architecture.md`)
- **C2:** repeating items only create the occurrence for the current period, never future ones. "Every later occurrence" is therefore met by the repeating item's own reminder when those occurrences are created. (code map `architecture.md` Key Design Decisions)
- **C3:** older versions read only the repeating item's existing reminder time, and apply it to day repeats only. (code map TD-5, TD-8)
- **C4:** run tests on Node 22 (`.nvmrc`). Under Node 26, 297 tests fail for environmental reasons. (code map TD-10)

## Assumptions

- **A1:** reminder delivery while the app is fully closed is unchanged and out of scope. It is a separate open question in the app's spec. Rationale: the intent concerns where reminders are set, not how they are delivered.
- **A2:** "today" and the start of each period use the device's local time zone, as reminders do today. Rationale: this is consistent with existing reminder handling.

## Out of Scope

- Changing occurrences before the one acted on, or before today when acting from the repeating item's settings. (intent Q7)
- Reminders delivered while the app is closed (server push). (A1)
- Choosing a day within a week, month or year for the reminder; it is always the first day of the period. (RA Q8)
- Making older versions show the new behaviour. (RA Q6)

## Open Questions

- **OQ1:** when a series reminder is changed from a particular occurrence onward, how is "from this occurrence" stored so that earlier occurrences keep the previous reminder and older devices are not confused? The options are splitting the repeating item at that point, or recording a start date for the change. This is for Code Generation to decide within NFR2 and NFR3.
- **OQ2:** for week, month and year repeats on older versions, which ignore reminders on those repeats today, confirm during Code Generation that the new data cannot be misread as a day reminder.
