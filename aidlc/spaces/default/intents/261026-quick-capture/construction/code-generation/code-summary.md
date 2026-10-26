> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Code Summary: Quick Task Entry (option A, add in place)

Zero-Unit brownfield run, carried out against the approved `code-generation-plan.md`. Steps 1 to 4 (Part A) and 6 to 12 (Part B) are done and ticked. Step 5, the real-phone check, was skipped by the person and is still unticked (see Deviations). After an adversarial architecture review (`reviews/review-01.md`, NOT-READY) the build was repaired for R-01 to R-06. After the second review (`reviews/review-02.md`, R-07 and R-08), the person approved Part C, Step 13, which fixes the deleted-collection trap. Build and Test then looped back once (Loop-back 1, `reviews/review-03.md` R-09), and the person approved Part D, Step 14. All three repairs are recorded below. Nothing has been committed.

## Files Created and Modified

| File | Change |
|---|---|
| `src/ui/quickTap.ts` | **New.** `isTap(start, end)` with `TAP_MAX_MOVE_PX = 10`, `TAP_MAX_MS = 500` and `TAP_AREA_MIN_PX = 33`. A press counts as a tap only below both limits. Distance is the straight-line distance, not each axis separately. |
| `src/ui/QuickLine.tsx` | **New.** It has two parts, both always mounted. The first is the tap area: a `<button>`, wearing the empty-state text when the section is empty. The second is the open line: the bullet "•", a text box aligned with entry text, and a button row with Cancel at the left and more and Log at the right. Its props are `emptyText`, `blocked`, which enforces one line at a time, and `onBlocked`, which tells App when a tap was refused (review R-02). Focus returns to the tap area after Log and Cancel. While the line is open it is kept above the keyboard on `visualViewport` resize. |
| `src/ui/SpreadView.tsx` | New optional props `renderQuickLine(sc, pk, heading, emptyText)` and `quickPage`. The line is placed directly under the section's own entries, above "Later this month", "Scheduled in …" and threaded rows. Past periods get no line, and their empty-state text stays plain. Previous, next and "back to now" are `disabled` in the section showing the line's page (review R-01). |
| `src/CollectionView.tsx` | New optional prop `renderQuickLine(pk, heading, emptyText)`, used only when `kind === "list"`. It receives `colPageKey(collection.id)` and the collection's name. Habit trackers are unchanged. |
| `src/ui/UndoToast.tsx` | Takes a `label` prop (`string \| null`) in place of `isCollection`, and an optional `onUndo`: without one there is no Undo button. It is always mounted. Its `role="status"` / `aria-live="polite"` region (`data-testid="toast-region"`) stays in the page, empty between messages, and only the visible toast inside it comes and goes (review R-04). |
| `src/App.tsx` | Holds the quick-line state `{ pk, sectionKey, label, text }`. Handlers: `openQuick`, `logQuick` (via `addEntry(pk, "task", text, false)`, plus `markCaptured()`) and `moreQuick`. Also `quickOnScreen`, `quickRefused` and `renderQuickLine`, which matches the line on section **and** page key (review R-01). The single toast slot gains a `logged` kind, whose Undo calls `removeEntry(id)`, and a `notice` kind with no Undo (review R-02). `loggedLabel` builds the message. Adds the 1.6 s `isFresh` highlight, and the `captureOneOff` restore in `closeCapture`. `UndoToast` is now always rendered. Step 13 (review R-07) adds the `QuickState` type, `quickPageGone`, `liveQuick` and an effect that drops a line whose collection has gone. A `quick` field on the delete toast restores the line on Undo. Step 14 (review R-09) restores it only into an empty slot. |
| `src/ui/styles.ts` | Adds `quickTap`, `quickTapEmpty`, `quickLine`, `quickInput`, `quickRow`, `quickCancel`, `quickMore` and `quickLog`, built from `GRID` and the existing tokens. |
| `src/index.css` | `.quickTap` background and hover, and `.quickTap:focus-visible` in the shared focus-outline rule. `.miniBtn:disabled` for the locked previous and next. `.entry.isFresh` with a `freshFade` animation of 1.6 s, and a reduced-motion override. |
| `tests/quickTap.test.ts` | **New.** 6 tests. |
| `tests/ui/QuickLine.test.tsx` | **New.** 8 tests. |
| `tests/ui/SpreadView.test.tsx` | 9 new tests: 7 from the plan and 2 from the repair. The existing 20 still pass, for 29 in all. |
| `tests/ui/CollectionView.test.tsx` | 5 new tests. The existing 17 still pass, for 22 in all. |
| `tests/ui/UndoToast.test.tsx` | Rewritten to the `label` prop. The two existing tests are kept with the same assertions. Three new tests are added (one from the plan, two from the repair), for 5 in all. |
| `tests/ui/AppQuickLine.test.tsx` | **New.** 17 tests: 10 from the plan, 2 from the first repair, 4 from Step 13 and 1 from Step 14. They use the real journal store on fake-indexeddb. |

New `data-testid` values: `toast-region`, `quick-tap-day`, `quick-tap-week`, `quick-tap-month`, `quick-tap-year`, `quick-tap-collection`, `quick-input`, `quick-cancel`, `quick-more` and `quick-log`.

## Key Implementation Decisions

- **Keyboard on the first tap (FR1.7, NFR1).**
  - The line is never created when it opens. It is already in the page, hidden.
  - The tap area's `pointerup` handler runs `isTap`. On a tap, in that same event, it hides the tap area, unhides the line and calls `focus()` on the text box. Only after that does it call `onOpen()`, so App's state catches up and draws exactly what is already showing.
  - The click that follows a pointer press does not open the line again. It only focuses the text box again, while still inside the tap.
  - A click with no pointer press behind it opens the line through the same path. That covers the keyboard and assistive technology.
  - Pressing anywhere on the open line except the text box has its mousedown default prevented. This means the mouse events a phone sends after a tap cannot take focus off the text box, and pressing the buttons does not drop the keyboard.
  - `preventDefault` is deliberately **not** called on `pointerdown`, so that a scroll starting on the tap area still scrolls on iOS.
- **One line at a time (FR5.1 to FR5.3; repaired for review R-02).**
  - A line with words in it, **wherever it is**, marks every other tap area `blocked`, so a tap there does nothing. This is FR5.2 read literally. Typed words are never thrown away by opening another line.
  - If the blocked line is not on the screen now showing, the message slot says "Finish or cancel the task you started on <page> first", with no Undo. `<page>` is the line's captured label. On the same screen the line is in plain view, so no message is shown.
  - An empty line simply moves (FR5.3).
- **A line is drawn only under its own page (review R-01).**
  - `renderQuickLine` matches the open line on its section **and** its page key. Page key and label are captured at open (R-14, R-13).
  - If a section is moved to another page by any route, the line is not drawn there. Routes include a jump to an entry's page (`openPage`, the index view's `onOpen`) and the day turning over. Its state and words are kept, and it appears again when the section shows its page.
  - Log can only be pressed on a visible line, so a task can never land on a page other than the one the line is shown under.
  - Previous, next and "back to now" are disabled in the section showing the line's page (`quickPage`). A section moved off that page by a jump is not locked, so the way back stays open.
- **A line whose page has gone is dropped (Step 13, review R-07).**
  - `quickPageGone` is worked out from the live collections list. It is true when the line belongs to a list collection that is no longer there, whether it was deleted on this device or by another device and arrived by sync.
  - While it is true, the line counts as nothing: it blocks no tap area (`liveQuick`), and it is never "on screen". An effect then clears the state, and its words are discarded.
  - Deleting the collection on this device keeps the line, with its words, in the delete toast beside the collection snapshot. Undo within the 6 s restores both in the same event, so the line is back with its words. A remote delete has no Undo here, so its line is simply dropped.
  - **Undo never overwrites a newer line (Step 14, review R-09, Loop-back 1).** `undoDelete` uses `setQuick((q) => (q && q.text.trim() ? q : restoredQuick))`. If the person has started a line with words since the deletion, that line keeps its place and its words. The collection still comes back, without its old line.
- **Nothing closes the line but Log, Cancel and "more" (FR5.4),** apart from its page being deleted. There is no blur handler and no visibility handler. Navigating away does not close it either. The state lives in App.
- **A persistent live region (FR4.6, review R-04).** `UndoToast` is always mounted. Its status region is in the page before the first message, so the arrival of a message's text is a change a screen reader announces. The visible toast and its Undo behave as before.
- **Empty Log (FR3.2).** QuickLine turns a blank Log into a Cancel, and `logQuick` also refuses blank text, so a blank task cannot be stored however it is asked for.
- **"more" (FR3.5, FR3.6, R-12).**
  - The form text is replaced and the details and parent are cleared.
  - The type is set to task through the non-persisting `_setCaptureType`.
  - For a section's line, the scope is set through `_setCaptureScope(keyScope(pk))` and the anchor through `setCaptureAnchor(keyToAnchor(pk))`. For a collection's line, the form already logs into the collection on screen.
  - `persistSticky` is never called. `closeCapture` puts back the scope and type remembered in `sticky.current`.
- **Toast (FR4.2 to FR4.5).**
  - A logged task uses the same single slot and 6 s timer as the delete messages, so a newer message replaces an older one and only one Undo is offered.
  - The message reads `Logged “<text>” to <page>`. Text over 40 characters is cut to 39 characters plus "…", which is the full form's rule.
  - Undo calls `removeEntry(id)`, which removes the task however it has been edited since.
- **Highlight (FR4.1).** A `freshEntry` state with a 1.6 s timer adds `isFresh` to the new row. CSS fades it over the same 1.6 s, and it is static under reduced motion. A row hidden by the filter is not drawn, so it is not highlighted.
- **Grid rhythm.** The tap area is one GRID row (33 px). The open line is two GRID rows, one for the text box and one for the buttons, so content below moves down by whole dot rows (FR2.3).

## Test Coverage Summary

| Suite | Tests | Result |
|---|---|---|
| `tests/quickTap.test.ts` | 6 | pass |
| `tests/ui/QuickLine.test.tsx` | 8 | pass |
| `tests/ui/SpreadView.test.tsx` | 29 (20 existing + 9 new) | pass |
| `tests/ui/CollectionView.test.tsx` | 22 (17 existing + 5 new) | pass |
| `tests/ui/UndoToast.test.tsx` | 5 (2 existing, ported to `label`, + 3 new) | pass |
| `tests/ui/AppQuickLine.test.tsx` | 17 | pass |
| This change's six files together | 87 | pass |
| Full suite, `docker compose run --rm dev npx vitest run` | 1,379 tests in 100 files | pass, exit 0 |
| `docker compose run --rm dev npm run typecheck` | — | exit 0 |
| `docker compose run --rm dev npm run lint` | 0 errors, 40 warnings, all in `.claude/tools/*` and all already there | exit 0 (`npx oxlint src tests`: 0 warnings, 0 errors) |

Step 1 baseline: `tests/ui/SpreadView.test.tsx` had 20 tests passing before any change.

Repair tests (review-01):
- R-01:
  - SpreadView: "back to now" is disabled with previous and next; a section moved off the line's page by a jump is not locked.
  - App: the line is drawn only under its own page, keeps its words while away, and logs only there.
- R-02: in the same App test, a tap while an off-screen line has words opens nothing and shows the message, without Undo.
- R-04: UndoToast: the region exists, empty, before the first message, and the same node then receives it. A notice has no Undo.
- R-06: App: Log in the form after "more" stores a task on the line's page and leaves the remembered choices unchanged, and closing the form brings them back.

Step 13 tests (review R-07, R-08), in `AppQuickLine.test.tsx`:
- a collection's line logs into the collection, as a task, with the "Logged" message naming it;
- off screen with words in it, a tap at home is refused, and the note names the collection;
- deleting the collection drops its line, so the day's tap area opens and takes focus;
- Undo of that deletion brings the line back with its words, still blocking other tap areas until it is finished.

Step 14 test (review R-09), in `AppQuickLine.test.tsx`: a collection holding a line with words is deleted, then a day line is opened and typed in, then Undo is tapped. The day line keeps its words, and the collection is back and reachable from its link.

Traceability: FR1.7, NFR1 and NFR4 are `Deferred` (on-device keyboard behaviour; see Deviations). FR4.3 is `N/A`, covered by inspection only (review R-05). Every other ID is `OK` against a test or implementation file.

Timing (NFR1, NFR2): the two timing tests in `AppQuickLine.test.tsx` assert under 500 ms, from the tap to focus and from Log to the rendered row. No target or threshold was changed anywhere. Every command ran in the Docker `dev` service.

## Deviations from the Plan

- **Step 5 (the real-phone check) was skipped, by the person's decision.** The dev build needs sign-in and there is no non-production database. The check moves to after deployment, and Step 5 stays unticked. Until it is done, these are proven only in jsdom:
  - the keyboard rising on the first tap (FR1.7, and the on-device part of NFR1);
  - the line and its buttons staying above the keyboard (NFR4);
  - a scroll starting on the tap area not opening the line on a real touch screen.

  FR1.7, NFR1 (its on-device part) and NFR4 are recorded as `Deferred` in `traceability.json` (review R-03), with the person as owner and the post-deployment check as the stage. The jsdom tests cover only the in-app part: focus moved synchronously inside the tap, and tap to focus under 0.5 s. They cannot show the keyboard. **The person chose to skip Step 5. The risk that the keyboard does not rise on the first tap, which would mean rework across Part B, is pending their acceptance at the approval gate.**
- **`src/index.css` was changed but is not in the plan's file list.** It holds the `.quickTap` background, hover and focus-visible rules, `.miniBtn:disabled` and the `isFresh` highlight, none of which inline styles can express. Accepted after Part A.
- **`markCaptured()` on Log**, as the full form already does. A quick entry therefore counts towards the install nudge. Accepted after Part A.
- **The text box uses 16 px type, against the entries' 15.5 px.** iOS zooms the page when an input under 16 px is focused. The text's left edge still lines up with the entries' text. Accepted after Part A.
- **`UndoToast` tests were rewritten, not only extended.** The plan replaces the `isCollection` prop with `label`, so the two existing tests now pass the same strings explicitly, with the same assertions.
- **FR4.1 got a test that the plan did not list.** An assertion in the "Log to rendered row" timing test checks the `isFresh` class, so the highlight has automated coverage.
- **FR4.3 is N/A: covered by inspection, not by a test (review R-05).** Every filter ("all", "tasks only", "open only") keeps a new open task, so a filter can never hide one. The code shows the message whether or not the row is drawn and leaves the filter alone. The "open only" test checks only the reachable case.
- **"Back to now" is disabled while a line is open (review R-01).** FR5.5 names only previous and next, but a page sliding away from under the line is exactly what it exists to prevent. This goes beyond FR6.2's "headings as today", for the same reason.
- **Another tap while a line has words shows a notice when that line is off screen (review R-02).** This is new wording, not in the requirements: "Finish or cancel the task you started on <page> first", in the existing message slot, with no Undo.
- **A day rollover hides an open line rather than moving it.** At midnight the app moves a day section that was showing today on to the new day. A line opened on the old day is then not drawn, because it belongs to the old page (R-14, review R-01). It keeps its words and is shown again via "previous". A tap elsewhere shows the notice.
- **A line on a deleted collection loses its words when the deletion is not undone (Step 13, review R-07).** This was approved by the person in the updated plan. It is the only way a quick line's words are discarded without Log, Cancel or "more". A delete made on another device gives no Undo on this one.
- **Loop-back 1 from Build and Test (review R-09, Step 14).** The finding was found by reading the code: Undo of a collection deletion would replace a line started since with the old one. It is now fixed and tested as above. When both lines have words, the newer line wins, and the old line's words are discarded with no prompt. This is the reading the person approved in the updated plan.
- **The live region is persistent (review R-04),** so the first message should now be announced. A real screen-reader check after deployment is still worthwhile.
