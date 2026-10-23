# Requirements Analysis Questions: Reminders on Repeating Items

These questions settle what the earlier step left open and what the code map turned up. Answers already given are not asked again: you chose "ask each time: this entry only, or the whole repeating item"; "whole" means this occurrence onward with past ones left alone; it is settable from the entry and from the repeating item's own settings; and an entry with its own different reminder keeps it.

## Q1. From the repeating item's own settings, which occurrences should a new or changed reminder cover?

There is no "this entry" when you open the repeating item's settings, so "this occurrence onward" needs a starting point. Repeating items only ever create today's occurrence, never ones ahead.

A. Today's occurrence (if it exists and is still open) and every later one
B. Only occurrences after today; today's is left as it is
C. Let me pick the date it starts from each time
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q2. When a series reminder is later changed or removed, what happens to an occurrence that has its own, different reminder?

You said such an entry keeps its own reminder when a series reminder is added. This settles the same thing for changing and removing.

A. It keeps its own reminder; only occurrences following the series are changed or cleared
B. It is overwritten too, so the whole repeating item lines up again
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q3. How exactly should the app know an occurrence "has its own reminder"?

Today nothing records whether an occurrence's reminder came from the repeating item or was set on that entry alone.

A. Treat any occurrence whose reminder differs from the series reminder as having its own (no new data, but a hand-set reminder that happens to match the series time is treated as following the series)
B. Record it explicitly whenever a reminder is set with "this entry only", so it is always exact (adds a small new piece of saved data)
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q4. Which kinds of repeating item should support a series reminder?

Today, repeating items only carry a reminder when they repeat on day pages. Weekly, monthly and yearly repeats have none.

A. Day-page repeats only, as today
B. Every kind of repeat: day, week, month and year pages (these would also need a day and time chosen for the reminder)
C. Not yet defined
X. Other (please specify)

[Answer]: B

## Q5. When you choose "the whole repeating item" from an entry, what time should each occurrence's reminder use?

An entry's reminder is a date and time, which need not be on the entry's own day (for example the evening before).

A. The same time of day, on each occurrence's own day
B. The same gap from each occurrence's day as on this entry (a reminder the evening before stays the evening before)
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q6. What should happen on a device still running an older version of Journlet?

Journlet syncs one journal across devices. An older version will not understand anything new this fix saves, though it still reads the repeating item's basic reminder time.

A. Acceptable for an older version to show the old behaviour until it updates, as long as nothing is lost or corrupted
B. Older versions must show exactly the same reminders as updated ones
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q7. How promptly must a series reminder notify you?

The earlier step's success measure said "notifies at the set time" without a tolerance. Today's one-off reminders are checked about every 30 seconds while the app is open.

A. The same as one-off reminders today: within about 30 seconds of the set time while the app is open
B. A stricter target (please specify)
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q8. For week, month and year repeats, when should the series reminder go off?

You chose to support every kind of repeat (Q4). A week, month or year page has no single day, so the reminder needs one.

A. On the first day of each period at the chosen time (Monday for a week, the 1st for a month, 1 January for a year)
B. On a day I choose within the period (a weekday for a week, a date for a month, a date for a year), at the chosen time
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- From the repeating item's own settings, a new or changed reminder covers today's occurrence (if it exists and is still open) and every later one (Q1).
- When a series reminder is changed or removed, an occurrence with its own, different reminder keeps it; only occurrences following the series change or clear (Q2).
- An occurrence "has its own reminder" when its reminder differs from the series reminder; no new data is saved, so a hand-set reminder matching the series time counts as following the series (Q3).
- Series reminders work for every kind of repeat: day, week, month and year pages (Q4).
- For week, month and year repeats, the reminder goes off on the first day of each period at the chosen time: Monday, the 1st, or 1 January (Q8).
- Choosing "the whole repeating item" from an entry uses that reminder's time of day, on each occurrence's own day (Q5).
- An older version of Journlet may show the old behaviour until it updates, as long as nothing is lost or corrupted (Q6).
- A series reminder notifies within about 30 seconds of its set time while the app is open, the same as one-off reminders today (Q7).

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
