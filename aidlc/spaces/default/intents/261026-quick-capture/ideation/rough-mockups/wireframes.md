# Wireframes: Quick Task Entry

Low-fidelity sketches of the four options agreed at scope definition. They keep Journlet's current look, with the small new touches listed below (rough-mockups Q3). A clickable version is in `spec/journlet-prototype-v29-quick-capture.html` (Q2).

**Phone and desktop work the same way** (Q8): every option behaves identically on both, with a click on the desktop doing what a tap does on the phone. There is no start-by-typing and no shortcut key on the desktop. The desktop sketches below differ only in width.

Shared behaviour in every option (scope document):
- The line opens in place: it keeps the entries' bullet column, its text starts where the other entries' text starts, and nothing else on the page moves. The text box runs to the right edge, with a row of buttons under it: **Cancel** on the left, then **more** and **Log** on the right (Q10). The buttons are what you use on a phone; Enter also logs and Escape also cancels on a keyboard.
- Log (or Enter) saves a task and closes the entry. Cancel closes it and discards the text.
- "More" opens the full form with the typed text kept.
- A quick entry is always a task.
- It works on every page in scope: the day, week, month and year sections and your collection pages (intent backlog IB-2 to IB-5).

## Pages in scope, and where a task lands

In Journlet the day, week, month and year are four sections stacked on the home page. Each has its own previous and next buttons, so a section can show today or another day, this week or another week, and so on. Collections are separate pages, each with a single list.

| Page | Where the task lands |
|------|----------------------|
| Home, day section | The day the section is showing (today, or another day if you have moved it) |
| Home, week section | The week the section is showing |
| Home, month section | The month the section is showing |
| Home, year section | The year the section is showing |
| A collection | That collection |

For options that use the bottom bar (B and D), there is no section to tap. The bar logs to the day the day section is showing (today unless you have moved it) on the home page, or to the collection you are in, and it names that day or collection under the field.

## New touches

These are the only additions to Journlet's current look (Q3):
1. A tap area in the empty space just under each section's last entry, shaded only when hovered or focused (option A only).
2. An "add a task" line at the end of each section (option C only).
3. The Cancel, more and Log row under the quick-entry text box (all options, Q10).
4. A brief highlight on a newly saved task (all options, Q4).
5. A "Logged" message with Undo after a quick save (all options, Q4). The prototype shows it for 4 seconds. How long it stays, and whether that suits people who need more time, is for requirements to settle.

## Today, for comparison

Phone (desktop is the same, wider):

```
+--------------------------------+      +--------------------------------+
| JOURNLET                 menu  |      | Cancel      New entry      Log |
|--------------------------------|      |--------------------------------|
| Today  Mon 26 Oct  <prev next> |      | [ What's on your mind?       ] |
|  • Call the garage             |      |                                |
|  • Book dentist                | tap  | Page:  Today v                 |
| This week  26 Oct  <prev next> | ---> | Type:  task  note  event       |
|  • Plan the trip               |      | Mark:  * priority  ! inspir.   |
| ...                            |      | Details ...                    |
|--------------------------------|      |                                |
| Find  [• Log an entry...] +Log |      |   [ keyboard ]                 |
+--------------------------------+      +--------------------------------+
```

Steps: tap the bar, the full-screen form opens, type, check page and type, then Log.

Accessibility: one h2 per section, with the previous and next buttons labelled "Previous week" and so on. The bar sits in the footer landmark and is the keyboard entry point. The form is a dialog titled "New entry".

## Option A: Add in place

Tap the empty space just under a section's last entry and a line opens right there with the keyboard up (Q9). Nothing is drawn until you tap; on a desktop the space shades when the pointer is over it. Headings stay as they are today, with only previous and next.

Phone:

```
+--------------------------------+
| JOURNLET                 menu  |
|--------------------------------|
| Today  Mon 26 Oct  <prev next> |
|  • Call the garage             |
|  • Book dentist                |
|  ............................  |  <- tap this empty space
| This week ...      <prev next> |
+--------------------------------+

after the tap:

+--------------------------------+
| Today  Mon 26 Oct  <prev next> |
|  • Call the garage             |
|  • Book dentist                |
|  • [Buy milk|               ]  |  <- opens in the bullet column, keyboard up
|    Cancel          more  [Log] |
| This week ...      <prev next> |
|--------------------------------|
|   [        keyboard        ]   |
+--------------------------------+
```

Desktop:

```
+--------------------------------------------------------------+
| Today  Mon 26 Oct                            <prev  next>    |
|  • Call the garage                                           |
|  • Book dentist                                              |
|  • [Buy milk|                                             ]  |
|    Cancel                                    more    [Log]   |
| This week  26 Oct – 1 Nov                    <prev  next>    |
+--------------------------------------------------------------+
```

Collection page: the same tap area under the collection's last entry.

Accessibility: each tap area is a button labelled "Add a task to Today" and so on, reached by Tab after that section's entries, so a keyboard or screen-reader user can find it even though nothing is drawn. The open text box is labelled "New task, Today". Focus returns to the tap area after saving or cancelling.

## Option B: Slimmer bottom bar

Tapping the bottom bar turns it into the typing field in place, with the keyboard up. The full-screen form no longer opens first.

Phone:

```
+--------------------------------+
| Today  Mon 26 Oct  <prev next> |
|  • Call the garage             |
| This week ...      <prev next> |
|--------------------------------|
| [• Buy milk|                 ] |  <- the bar becomes the field
| Logs to: Today                 |
| Cancel              more  [Log]|
|   [        keyboard        ]   |
+--------------------------------+
```

Desktop: the same bar at the foot of the page. Click it and type; "Logs to" shows underneath.

Collection page: the bar logs to that collection and says "Logs to: Reading list".

Accessibility: the bar stays in the footer landmark. The field is labelled "New task, logs to Today". Focus goes back to the bar after saving.

## Option C: Always-ready line

Each section, and each collection, ends with a faint "add a task" line. Tap it and type; nothing else opens.

Phone:

```
+--------------------------------+
| Today  Mon 26 Oct  <prev next> |
|  • Call the garage             |
|  + add a task                  |  <- always there; tap and type
| This week ...      <prev next> |
|  • Plan the trip               |
|  + add a task                  |
| This month ...     <prev next> |
|  + add a task                  |
+--------------------------------+
```

When tapped, the line opens in place: the "+" in the bullet column becomes the task bullet "•", a box appears around the words where "add a task" was, and Cancel, more and Log appear on a row below it, keyboard up. Nothing else moves.

```
|  • Pay rent                    |        |  • Pay rent                    |
|  + add a task                  |  tap   |  • [Buy milk|               ]  |
| This month ...                 |  --->  |    Cancel          more  [Log] |
```

Desktop: the same line in each section. Click it and type.

Collection page: one "add a task" line at the end of the list.

Accessibility: each line is a text field labelled "New task, This week" and so on, in normal Tab order after that section's entries. Headings are unchanged.

## Option D: Faster full form

The current bar still opens the full form, but it opens ready to type. The cursor is in the text field, the keyboard is up, the page is set to where you are and the type is task. The other choices fold away behind "more". Log or Enter logs and closes.

Phone:

```
+--------------------------------+
| New entry                      |
|--------------------------------|
| [ Buy milk|                  ] |  <- ready to type at once
| Today · task                   |  <- choices folded away
| Cancel              more  [Log]|  <- more unfolds the choices
|                                |
|   [        keyboard        ]   |
+--------------------------------+
```

Desktop: the same form as a panel over the page, opening with the cursor in the field.

Collection page: the folded line reads "Reading list · task".

Accessibility: a dialog titled "New entry", as today. Focus moves to the text field on open and back to the bar on close, and Escape cancels.

## Comparing the options

All four reach the target: one tap, type, Enter. They differ in what else they change and what they risk.

| | A. Add in place | B. Slimmer bar | C. Always-ready line | D. Faster full form |
|---|---|---|---|---|
| Where you tap | The empty space under the section you want | The bar at the foot, always the same place | The line in the section you want | The bar at the foot |
| Where it logs | The period the section is showing | The day the day section is showing (or the collection), named under the field | The period the section is showing | The day the day section is showing (or the collection), named in the form |
| Logging to next week or this month | One tap: the space under that section | Needs "more" and the full form | One tap: that section's line | Needs "more" |
| How much the page changes | Nothing until you tap | Nothing until you tap | A new line in every section, always visible | Nothing; the form changes |
| Can you see where to tap? | No: you learn the space is tappable | Yes: the bar | Yes: the "add a task" line | Yes: the bar |
| What happens to the bar (IB-6) | Undecided: could stay as is | Becomes the entry | Undecided: could stay as is | Stays, opens faster |
| On a phone, reach | Top of the screen for the day section | Thumb's reach at the foot | Varies with how long each section is | Thumb's reach at the foot |
| Effort to build | Medium | Low | Medium | Lowest |

**My read:** B and D are the smallest change and keep one place to add. A and C are faster when the task belongs somewhere other than today, because you tap the section you want. A and C now differ mainly in visibility: A keeps the page unchanged but has to be learned, while C shows you where to tap at the cost of a line in every section.

## Assumptions & Open Questions

- On phones, some browsers only raise the keyboard when the tap itself puts the cursor in the field. All four options depend on this: A and C open a field where you tap, B turns the bar into a field, and D opens a form with the cursor in place. This needs checking on a real phone during requirements. [assumption]
- How long the "Logged" message with Undo stays on screen is for requirements to settle (new touch 4). [assumption]
- In every section, including month, year and a long collection, the open line and its button row need to scroll into view above the phone keyboard. This is checked on a real phone together with the keyboard-raise check. [assumption]
- For option A, an empty section or collection still has the tap area (where "nothing logged" shows today), at least one line high. How a tap is told apart from a scroll on a phone is for requirements. [assumption]
- Whether the bottom bar stays or is replaced is decided after comparing these options (IB-6). [assumption]
