# User Flow: Quick Task Entry

The same flow applies on phone and desktop; a click on the desktop does what a tap does on the phone (rough-mockups Q8).

## Core flow (any option)

```
 task comes to mind, app open
            |
            v
 one tap on the quick-entry point
            |
            v
 entry line open, keyboard up, already a task for that section or collection
            |
            +---- type text, tap Log (or Enter) ----> task saved
            |                                     |
            |                                     v
            |                    task appears in its section, highlighted;
            |                    "Logged" message with Undo at the bottom
            |
            +---- tap "more" ----> full form opens, typed text kept
            |                      (type, page, priority, details)
            |
            +---- tap Cancel (or Escape) ----> line closes, nothing saved
```

Text fallback: the person taps the quick-entry point once, types, and taps Log (or presses Enter). The text box has Cancel, more and Log on a row below it (rough-mockups Q10). The task is saved in place and confirmed with a highlight and a "Logged" message with Undo. "More" passes the typed text to the full form, and Cancel closes the line without saving.

Accessibility: every step is reachable by keyboard. Tab reaches the quick-entry point and Enter opens it. The open line is a labelled text field, Enter saves and Escape closes, and the Cancel, more and Log buttons are ordinary buttons in Tab order. The "Logged" message is announced to screen readers when it appears.

## Flow details

```
Flow: Quick add a task
Persona: Journlet user (owner or another user), on phone or desktop
Trigger: a task comes to mind with the app open
Steps:
  1. Home page or a collection -> tap the quick-entry point -> entry line opens with keyboard up
  2. Entry line -> type the task -> text shows in the line
  3. Entry line -> tap Log (or press Enter) -> task saved as a task in the period the section is showing, or in the collection; line closes
Success outcome: the task is in its section, briefly highlighted; "Logged" with Undo shows at the bottom
Error paths:
  - Log or Enter on an empty line -> nothing saved, line closes
  - Tap Cancel (or Escape) -> line closes, typed text discarded
  - Leave the line with text typed -> open question: keep it as a draft or discard (see below)
  - Tap Undo while the message shows -> the task is removed again
```

## Information architecture

There are no new pages. Quick entry lives inside the existing ones:
- the home page, with its day, week, month and year sections, each of which can show another period through previous and next;
- collection pages.

The full form stays where it is and is reached through "more".

## Assumptions & Open Questions

- What happens to typed text if you leave the line without pressing Enter (keep it as a draft, or discard it) is not yet decided. Requirements analysis should settle it. [assumption]
