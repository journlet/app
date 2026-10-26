# Requirements: Quick Task Entry (option A, add in place)

Sources are cited in brackets: `Q<n>` is a confirmed answer in `requirements-analysis-questions.md`. "Brief" is `ideation/approval-handoff/initiative-brief.md`, "wireframes" is `ideation/rough-mockups/wireframes.md` (RM-Q<n> are its questions), and IB-n is an item in `ideation/scope-definition/intent-backlog.md`.

## Intent Analysis

With Journlet already open, a person should be able to get a task down with one tap, typing, then Log, so tasks stop slipping because adding one feels like too much effort (`intent-statement.md`). Speed comes from three changes:
- The person types where the task belongs, with no form to open.
- Nothing needs choosing: it is always a task in the period the section is showing.
- The app gets out of the way quickly.

Today's "Log an entry…" bar and full form stay as they are for anything beyond a quick task (`scope-document.md`, brief).

The intent's end-to-end target, a short task saved within about 5 seconds, is now verified only through the app's share of that time (NFR1, NFR2). The rest is the person's typing (Q1).

- **Type:** enhancement to existing capture.
- **Scope:** the home page sections (day, week, month, year) and list collections. The change is client-only (`architecture.md`: client-only React PWA, all domain logic local).
- **Complexity:** standard.

## Functional Requirements

### FR1. Opening a quick line

- **FR1.1** On the home page, each of the day, week, month and year sections has a tap area directly under its own entries. The tap area sits above any "Later this month", scheduled or linked rows shown after them. A tap there opens a quick line in that place. [brief, wireframes option A, RM-Q9, Q14]
- **FR1.2** On a **list** collection page, the same tap area sits under the collection's entries and opens a quick line there. Habit-tracker collections have no tap area. [IB-5, scope-document]
- **FR1.3** When a section or list collection is empty, the empty-state text itself is the tap area and opens the quick line in its place. The empty-state text is "nothing logged", or "nothing matching — N entries hidden by the filter" when a filter hides everything. [Q5, Q9]
- **FR1.4** A tap opens a line only if the touch or pointer moves less than 10 pixels and is held for less than 0.5 seconds. A drag or scroll never opens a line. [Q6, Q17]
- **FR1.5** The tap area is at least 33 pixels high (one line of Journlet's grid) and spans the width of the list. [Q17]
- **FR1.6** A quick line opens only on a section showing the current or a future period. On a section showing a past period, the tap area and the empty-state text do nothing. [Q7]
- **FR1.7** When the line opens, the cursor is in its text box and, on a phone, the keyboard is up, with no further tap needed. [brief, scope-document "one tap"]
- **FR1.8** On a desktop, a click does exactly what a tap does on a phone. There is no start-by-typing and no shortcut key. [RM-Q8]

### FR2. The quick line's layout

- **FR2.1** The open line keeps the entries' bullet column, showing the task bullet "•". Its text starts at the same horizontal position as the other entries' text. [wireframes, rough-mockups review feedback]
- **FR2.2** The text box runs to the right edge of the list. [wireframes]
- **FR2.3** A row of buttons sits under the text box: **Cancel** at the left, then **more** and **Log** at the right. Content below the line moves down by the height of the line and its button row while it is open; nothing above it moves. [RM-Q10]
- **FR2.4** Phone and desktop show the same elements in the same order. The only difference is width. [RM-Q8]

### FR3. Saving, cancelling and "more"

- **FR3.1** Log, or Enter on a keyboard, saves the text as a **task** on the page the section is showing (that day, week, month or year) or in the collection, then closes the line. [scope-document, Q4]
- **FR3.2** Log or Enter with an empty or blank text box saves nothing and closes the line. [wireframes user flow]
- **FR3.3** Cancel, or Escape on a keyboard, closes the line and discards its text. [RM-Q10, wireframes]
- **FR3.4** After Log or Cancel, the section returns to how it looked before: the tap area is under its entries, or the empty-state text shows if it is still empty. [wireframes]
- **FR3.5** "More" closes the quick line and opens today's full entry form. The line's text moves into the form, replacing any text left in it. The form is set to the section's page (or the collection) and to the task type for this entry only. [Q13, RM-Q3]
- **FR3.6** Neither a quick entry nor "more" changes the "Log an entry…" bar's remembered page kind and type. After "more", the bar opens with its own remembered choices as before. [Q8, Q13]

### FR4. Confirming a save

- **FR4.1** When the new task is visible under the active filter and order, it shows a highlight for 1.6 seconds that then fades. [RM-Q4, prototype]
- **FR4.2** A message reads "Logged “<task>” to <page>" with an **Undo** button and shows at the bottom for 6 seconds. Task text longer than 40 characters is cut to 39 characters plus "…", as the full form does today. [Q3, `App.tsx` submitEntry]
- **FR4.3** If a filter hides the new task, the message still shows as in FR4.2 and the filter stays as it is. [Q15]
- **FR4.4** Undo removes the task the visible message names, even if it has been edited since. [Q16]
- **FR4.5** Only one message with Undo shows at a time. A newer "Logged" or "Entry deleted" message replaces an older one, and the older one's Undo is no longer offered. [Q16]
- **FR4.6** Screen readers announce the message when it appears. [RM-Q6]

### FR5. One line at a time

- **FR5.1** Only one quick line is open at a time on a page. [Q10, Q12]
- **FR5.2** While the open line has text, tapping under another section opens nothing new. The line stays as it is until Log or Cancel. [Q10]
- **FR5.3** While the open line is empty, tapping under another section closes it and opens a new line there. [Q12]
- **FR5.4** A line with text stays open with its text when the person taps elsewhere on the page, scrolls away, or switches to another app and back. [Q4]
- **FR5.5** While a line is open in a section, that section's previous and next buttons are disabled. They work again after Log or Cancel. [Q11]

### FR6. What stays the same

- **FR6.1** The "Log an entry…" bar at the foot of the page, and the full entry form it opens, work exactly as today. [brief, IB-6]
- **FR6.2** Section headings work exactly as today, apart from FR5.5 while a line is open. [wireframes option A]

## Non-Functional Requirements

- **NFR1 Speed, opening.** From the tap, the line is open with the cursor in its text box within 0.5 seconds. Checked by an automated test timing from the tap event to focus. On a real phone, the keyboard is up within the same time, checked by hand on the first real-phone check. [Q1, Q17]
- **NFR2 Speed, saving.** From Log, the task is on the page within 0.5 seconds. Checked by an automated test timing from the Log event to the entry being stored and rendered. [Q1, Q17]
- **NFR3 Taps.** With the app open on the right page, adding a task takes one tap before typing and one tap (Log) or Enter to save. Today it takes two taps plus checking the page and type. This is the baseline; no separate timing is taken. [Q2]
- **NFR4 Keyboard visibility.** On a phone, the open line and its button row are scrolled into view above the keyboard in every section, including month, year and a long collection. This is checked on the first real-phone check. [brief, rough-mockups review]
- **NFR5 Accessibility, as today** [RM-Q6]:
  - Each tap area is a button labelled "Add a task to Today", "Add a task to This week" and so on, reached by Tab after that section's entries.
  - When a section is empty, the empty-state text is that button.
  - The text box is labelled "New task, Today" and so on.
  - Cancel, more and Log are ordinary buttons in Tab order.
  - After Log or Cancel, focus returns to the tap area, or to the empty-state text if the section is still empty.
- **NFR6 Sync and storage.** A quick entry is stored and synced exactly as an entry logged from the full form is: encrypted, offline-first, and merged across devices. [`architecture.md` Data Flow]
- **NFR7 Regressions and tests.** All existing tests stay green. Each functional requirement is covered by at least one new test. [org Testing Posture]

## Constraints

- Brownfield React PWA. Quick entry uses the existing entry-adding path in the journal store and adds no new data fields (`code-structure.md`).
- Builds and tests run in the Docker dev service, not on host Node (project rule, `project.md` Corrections).
- The keyboard behaviour (FR1.7, NFR1, NFR4) is proven on a real phone first, before the rest is built. [brief, approval Q3]

## Assumptions

- Some phone browsers raise the keyboard only when the tap itself puts the cursor in the text box, particularly for installed web apps. FR1.7, NFR1 and NFR4 depend on this working, which is why it is checked first. [assumption]

## Out of Scope

- Faster ways into the app, such as home-screen shortcuts. [scope-document]
- Start-by-typing or shortcut keys on the desktop. [RM-Q8]
- Quick entry on sections showing a past period. [Q7]
- Choosing a type other than task, or priority or details, in the quick line itself; these stay behind "more". [scope-document]
- Changes to the "Log an entry…" bar or the full form. [FR6]
- Quick entry on habit-tracker collections, the future log and the index. [IB-5 covers "your own collection pages"; habit trackers take no entries]

## Open Questions

None. Two items pass to the build:
- The real-phone keyboard check is the first step of construction.
- The order after day and week, for month, year and list collections, is set in the build plan. Day comes first, then week. [scope-document Sequencing]
