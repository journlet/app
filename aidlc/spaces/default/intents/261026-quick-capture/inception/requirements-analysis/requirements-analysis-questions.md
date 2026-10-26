# Requirements Analysis Questions: Quick Task Entry

Builds on the approved initiative brief: option A, add in place. Tap the empty space under a section's last entry (or a collection's) and a line opens there, keyboard up, with Cancel, more and Log below. It lands in the period the section is showing, is always a task, and today's "Log an entry…" bar stays as it is. These questions settle the points the brief left for requirements.

## Q1. How should the 5-second target be checked?

The intent says a short task is saved within about 5 seconds of the app being open. Most of that time is your typing, so the check needs to say what the app itself is responsible for.

A. Two app checks: the line is open with the keyboard up within half a second of the tap, and the task shows on the page within half a second of Log
B. One real run on your phone: from the tap to the task showing, a short task (about 20 characters) takes under 5 seconds
C. Both A and B
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q2. Should today's speed be measured first, as a baseline?

The review asked for a "before" figure so the improvement can be shown. Today it is: tap the bar, wait for the form, check page and type, type, Log.

A. Yes: time today's flow once on your phone and record it
B. No: the tap count (today two taps plus checking choices, after one tap) is enough
C. Not yet defined
X. Other (please specify)

[Answer]: B

## Q3. How long should the "Logged" message with Undo stay on screen?

The existing "Entry deleted" message with Undo stays for 6 seconds. The prototype used 4.

A. 6 seconds, matching the existing Undo message
B. 4 seconds, as in the prototype
C. Until you do something else on the page
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q4. What happens if you leave an open line with text in it, without Log or Cancel?

For example you tap somewhere else on the page, scroll away, or switch to another app.

A. The line stays open with your text until you choose Log or Cancel
B. The text is kept as a draft and comes back next time you open a line there
C. It is saved as a task automatically
D. It is discarded, as if you had pressed Cancel
E. Not yet defined
X. Other (please specify)

[Answer]: A

## Q5. What should you tap on a section that has nothing on it yet?

Empty sections show "nothing logged" today, so there is no last entry to tap under.

A. Tapping "nothing logged" itself opens the line in its place
B. A tap area just below "nothing logged", like any other section
C. Not yet defined
X. Other (please specify)

[Answer]: C

## Q6. How should a tap be told apart from a scroll on a phone?

The tap area is empty space, so a thumb scrolling the page will often start on it.

A. Only a short tap that does not move opens the line; a drag or scroll never does
B. Not yet defined
X. Other (please specify)

[Answer]: A

## Q7. Should quick entry work when a section is showing a past period?

Sections can be moved back with "previous" (for example yesterday or last week), and the full form lets you log there today.

A. Yes, the same as for current and future periods
B. Only for the current and future periods
C. Not yet defined
X. Other (please specify)

[Answer]: B

## Q8. Should a quick entry change what the "Log an entry…" bar remembers?

The bar remembers your last choice of page kind and type between uses. A quick entry is always a task on the section you tapped.

A. No: quick entry leaves the bar's remembered choices alone
B. Yes: quick entry updates them, as a full-form entry would
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q9. Follow-up to Q5: on an empty section, which is better?

Q5 was left open, but the build needs one rule. Tapping "nothing logged" gives a bigger, findable target; a tap area below it keeps every section the same.

A. Tapping "nothing logged" opens the line in its place (recommended: the words already sit where the task will go)
B. A tap area just below "nothing logged", like any other section
X. Other (please specify)

[Answer]: A

## Q10. Follow-up to Q4: a line is open with text, and you tap the empty space under another section. What happens?

Q4 says an open line keeps its text until Log or Cancel. This decides whether only one line can be open at a time.

A. Nothing new opens: the first line stays open until you choose Log or Cancel
B. The first line closes and keeps its text as a draft, and a new line opens in the section you tapped
C. The text moves to a new line in the section you tapped
X. Other (please specify)

[Answer]: A

## Q11. A line is open in a section and you press previous or next on that section. What happens?

Review finding R-01: where the task lands must never be a surprise.

A. Previous and next are paused while a line is open in that section; Log or Cancel first (recommended: matches "the line stays until Log or Cancel")
B. The line stays open and logs to the period now shown
C. The line stays open, logs to the period it was opened on, and shows that period's name on the line
D. The line closes, keeping its text as with Q4
X. Other (please specify)

[Answer]: A

## Q12. A line is open but empty, and you tap under another section. What happens?

Review finding R-02: Q10 settled the case with text in it.

A. The empty line closes and a new one opens where you tapped (recommended)
B. Nothing new opens, the same as when it has text
X. Other (please specify)

[Answer]: A

## Q13. What does "more" do?

Review finding R-03: "more" opens the full form, which has its own remembered choices.

A. The quick line closes and its text moves into the full form, set to that page and to task for this entry only; the bar's remembered choices stay as they were, and any old text left in the form is replaced (recommended)
B. As A, but the page and type chosen in the form become the bar's new remembered choices
X. Other (please specify)

[Answer]: A

## Q14. Where does the tap area sit when a section also shows "Later this month", scheduled or linked rows below its entries?

Review finding R-05: some sections show extra groups after their own entries.

A. Directly under the section's own entries, above those extra groups, where the new task will appear (recommended)
B. At the very end of the section, below everything
X. Other (please specify)

[Answer]: A

## Q15. A filter is on that hides the new task (for example "events only"). What do you see after Log?

Review finding R-05: the highlight cannot show a task the filter hides.

A. The "Logged" message still confirms it, naming the page, and the filter stays as it is (recommended)
B. The filter is cleared so you can see the new task
X. Other (please specify)

[Answer]: A

## Q16. What if an "Entry deleted" message is showing when you log a task, or the other way round?

Review finding R-06: there is room for one message with Undo at a time.

A. The newer message replaces the older; Undo always acts on what the visible message names, and removes the logged task even if you have edited it since (recommended)
B. Messages queue: the second shows after the first has gone
X. Other (please specify)

[Answer]: A

## Q17. How big is the tap area, and what counts as a tap?

Review finding R-04: these need numbers to be testable.

A. At least one line high (33 pixels, Journlet's grid). A tap moves less than 10 pixels and is held less than half a second. Speed is checked by automated tests, plus the first real-phone check (recommended)
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Speed is checked as two app checks: the line is open with the keyboard up within half a second of the tap, and the task shows on the page within half a second of Log (Q1).
- No separate baseline timing; the tap count is enough (today two taps plus checking choices, after the change one tap) (Q2).
- The "Logged" message with Undo stays for 6 seconds, matching the existing Undo message (Q3).
- Leaving an open line with text in it (tapping elsewhere, scrolling, switching apps) keeps the line open with your text until you choose Log or Cancel (Q4).
- Only a short tap that does not move opens the line; a drag or scroll never does (Q6).
- Quick entry works on sections showing the current or a future period, not a past one (Q7).
- Quick entry leaves the "Log an entry…" bar's remembered page kind and type alone (Q8).
- On an empty section, tapping "nothing logged" opens the line in its place (Q5 left open, settled by Q9).
- Only one line is open at a time: while a line is open with text, tapping under another section opens nothing new (Q10).
- While a line is open in a section, that section's previous and next are paused until you Log or Cancel (Q11).
- An empty open line closes when you tap under another section, and a new one opens there (Q12).
- "More" closes the line and moves its text into the full form, set to that page and to task for this entry only; the bar's remembered choices stay as they were, and old text in the form is replaced (Q13).
- The tap area sits directly under a section's own entries, above any "Later this month", scheduled or linked rows (Q14).
- If a filter hides the new task, the "Logged" message still confirms it by naming the page, and the filter stays (Q15).
- A newer "Logged" or "Entry deleted" message replaces an older one; Undo acts on what the visible message names, and removes a logged task even if it was edited since (Q16).
- The tap area is at least one line high (33 pixels); a tap moves less than 10 pixels and lasts less than half a second; speed is checked by automated tests plus the first real-phone check (Q17).

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
