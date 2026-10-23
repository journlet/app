# Intent Capture Questions: Reminders on Repeating Items

## Sources

- [desc] Initial description: "It is not possible to set a reminder on an already existing repeating item, if I add a reminder it only does it for that entry"
- [scope] Workflow-selected scope: `poc`.

## Q1. What should happen when you add a reminder to an existing repeating item?

Today, adding a reminder to one entry of a repeating item only sets it on that single entry. This answer decides what "fixed" means.

A. The reminder applies to every occurrence of the repeating item, past and future
B. The reminder applies to this occurrence and every future one, but not to past ones
C. I'm asked each time whether the reminder is for this entry only or for the whole repeating item
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q2. Where would you expect to set a reminder for a repeating item?

This tells us which screen the fix belongs on.

A. From the entry itself, the same place I add a reminder today
B. From the repeating item's own settings, where the repeat is set up
C. From both places
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q3. What should happen when you later change or remove a reminder on a repeating item?

Adding a reminder is half the story; this decides whether changing or removing one is part of this fix.

A. Changing or removing it updates every occurrence the reminder covers, in the same way adding does
B. Changing or removing it only affects the one entry I'm on
C. I'm asked each time whether the change is for this entry only or for the whole repeating item
D. Not part of this fix; only adding a reminder needs to work
E. Not yet defined
X. Other (please specify)

[Answer]: C

## Q4. Who is affected by this problem?

This shapes how carefully existing data needs to be handled.

A. Just me, as the only user of my journal
B. Me and other people who use Journlet
C. Not identified
X. Other (please specify)

[Answer]: B

## Q5. How will you know the fix works?

This becomes the success measure the change is tested against.

A. After adding one reminder to a repeating item, every covered occurrence shows the reminder and notifies me at the set time, with no need to add it again
B. As A, and an entry I set a different reminder on keeps its own reminder
C. Not yet defined
X. Other (please specify)

[Answer]: B

## Q6. Does the workflow's selected size match what you want from this change?

The workflow is set up as a short run (`poc`): agree the behaviour, map the existing code, write down the expected behaviour, build it and test it.

A. Yes, a short run covering only reminders on repeating items is the right boundary
B. Yes, the short run is fine, but the boundary should also cover something else (please say what)
C. No, I want a different product boundary (please describe)
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q7. When you choose "the whole repeating item", which occurrences should the reminder cover?

You chose to be asked each time (Q1 and Q3). This decides what the "whole repeating item" choice actually covers, since reminders on past days can no longer fire.

A. This occurrence and every future one; past occurrences are left as they are
B. Every occurrence, past and future
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q8. Who decides what goes into Journlet and when?

The stakeholder map needs to record who makes the call on this change; nothing so far says who that is.

A. I do; I own Journlet and decide its scope and priorities
B. Someone else decides, and I influence it (please say who)
C. Not identified
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Adding a reminder to an entry of a repeating item asks whether it is for this entry only or for the whole repeating item (Q1).
- "The whole repeating item" means this occurrence and every future one; past occurrences are left as they are (Q7).
- A reminder for a repeating item can be set both from the entry and from the repeating item's own settings (Q2).
- Changing or removing a reminder on a repeating item also asks whether the change is for this entry only or for the whole repeating item (Q3).
- The problem affects you and other people who use Journlet (Q4).
- Success: after adding one reminder to a repeating item, every covered occurrence shows it and notifies at the set time without adding it again, and an entry given its own different reminder keeps it (Q5).
- The short run covering only reminders on repeating items is the right boundary (Q6).
- You own Journlet and decide its scope and priorities (Q8).

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
