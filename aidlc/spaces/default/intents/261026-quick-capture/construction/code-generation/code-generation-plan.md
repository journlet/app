# Code Generation Plan: Quick Task Entry (option A, add in place)

## Scope

This is single-unit work. Units Generation was skipped by the plan, so this plan is scoped from `inception/requirements-analysis/requirements.md` and the code map in `aidlc/spaces/default/codekb/app/`. It is brownfield: files change in place and no duplicates are made. Every command runs in the Docker `dev` service (project rule), never on host Node.

Three review points from requirements are settled here:

- **R-12:** "more" opens the full entry form (not "today's" date), set to the section's page or the collection.
- **R-13:** `<page>` in the "Logged" message is the section's heading text, which is what the page reads as on screen: "Today", "This week", "This month", "This year", a period label such as "Tue 27 Oct" or "November" when the section has been moved forward, or the collection's name.
- **R-14:** an open line logs to the page it was opened on, which is captured when it opens. A day rollover while the app is in the background does not move it.

## Files

| File | Change |
|---|---|
| `src/ui/quickTap.ts` | **New.** Pure tap-versus-scroll check: a press counts as a tap only if it moves less than 10 px and lasts less than 500 ms (FR1.4). |
| `src/ui/QuickLine.tsx` | **New.** Two parts. The tap area button (or the empty-state text acting as that button) and the open line: the bullet column "•", a text box aligned with entry text, and Cancel / more / Log beneath. |
| `src/ui/SpreadView.tsx` | Render the tap area or open line directly under each section's own entries and above "Later this month", scheduled and threaded rows. Make the empty-state text the tap area. Show nothing for past periods. Disable previous and next while a line is open in that section. |
| `src/CollectionView.tsx` | Same for list collections only; habit trackers are unchanged. |
| `src/ui/UndoToast.tsx` | Take a `label` prop instead of the hard-coded "Entry deleted" / "Collection deleted". Existing callers pass the same text, so behaviour is unchanged. |
| `src/App.tsx` | Own the quick-line state `{ pk, sectionKey, text } \| null` and the save, cancel and "more" handlers. Extend the single toast slot with a "logged" kind, so a newer message replaces an older one (FR4.5). Undo removes the logged entry. Handle the 1.6 s highlight. |
| `src/ui/styles.ts` | Styles for the tap area, the open line and the button row, built from existing tokens. |
| `tests/quickTap.test.ts`, `tests/ui/QuickLine.test.tsx` | **New** tests. |
| `tests/ui/SpreadView.test.tsx`, `tests/ui/CollectionView.test.tsx`, `tests/ui/UndoToast.test.tsx` | Extended. |
| `tests/ui/AppQuickLine.test.tsx` | **New.** App-level wiring tests. |

**Blast radius: medium.** The change touches the home spread and collection views, App, and the shared Undo message. The journal store and sync are untouched: quick entry calls the existing `addEntry(pk, "task", text, false)`, and Undo calls the existing `removeEntry(id)`. No data fields are added (NFR6).

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run that layer's tests.",
  "scope": "quick-capture",
  "test_strategy": "standard",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:fe8aecc8cd833ea377c9ec12d811ca4d25e94eadb9d281e9cd7b855cefcb19cf",
  "contract_sha256": "sha256:5f606d480e51112f4aeea44751e2173eaf2468fa0e7000845f0bbe77d4e4db92"
}
```

Not applicable here:
- **Data model, repository and API layers:** none change. Quick entry reuses `addEntry` and `removeEntry` unchanged, and there is no server.
- **Environment and build configuration:** none changes.

The testable layers are business logic (the tap check) and frontend behaviour.

## Steps

### Part A: prove the keyboard first (initiative brief, approval Q3)

- [x] **Step 1. Runner check.** Run `docker compose run --rm dev npm ci` once, then `docker compose run --rm dev npx vitest run tests/ui/SpreadView.test.tsx`. Record the exact scoped commands and the existing pass count in `unit-test-instructions.md`. (Contract: runner ready before the first test.)
- [x] **Step 2. Business logic: implement `src/ui/quickTap.ts`** (FR1.4, FR1.5). Export `isTap(start, end)`, which takes `{x, y, t}` points and returns true when the movement is below 10 px and the time is below 500 ms. Also export `TAP_MAX_MOVE_PX = 10`, `TAP_MAX_MS = 500` and `TAP_AREA_MIN_PX = 33`.
- [x] **Step 3. Business logic: write and run `tests/quickTap.test.ts`.** Six tests: a still short press is a tap; a 9 px move is a tap; a 10 px move is not; a 499 ms press is a tap; a 500 ms press is not; a diagonal move uses distance, not each axis.
- [x] **Step 4. Frontend: implement `QuickLine` and wire it to the day section only** (FR1.1, FR1.7, FR2.1 to FR2.3, FR3.1 to FR3.3, NFR1, NFR2).
  - The tap area is a `<button>` at least 33 px high, with `data-testid="quick-tap-<sectionKey>"`.
  - The line is not opened from React state after the event. To meet FR1.7 on phones, the press's `pointerup` handler focuses the text box **synchronously**, inside the same user gesture: the input element is always mounted, hidden, and revealed in that handler before `focus()`. Phone browsers raise the keyboard only for a focus inside the gesture.
  - Log and Enter call `addEntry(pk, "task", text, false)`. Cancel and Escape close the line and discard the text.
  - Elements carry `data-testid` values: `quick-input`, `quick-cancel`, `quick-more`, `quick-log`.
- [ ] **Step 5. Real-phone check (pause for you).** I start `docker compose up dev`, give you the address to open on your phone over your local network, and you try the day section's quick line. **Pass:**
  - One tap opens the line with the keyboard already up, with no second tap.
  - The line and its Cancel / more / Log row stay visible above the keyboard.
  - A scroll that starts on the empty space does not open it.

  If it fails, I stop here, and we decide together before anything else is built.

### Part B: the rest (after a pass at Step 5)

- [x] **Step 6. Frontend: finish `SpreadView`** for all four sections (FR1.1, FR1.3, FR1.6, FR5.5, FR6.2).
  - The line sits directly under each section's own entries, above "Later this month", "Scheduled in …" and threaded rows.
  - The empty-state text ("nothing logged", or "nothing matching — N entries hidden by the filter") becomes the tap-area button and keeps its text.
  - Sections showing a past period (`pk < nowKeys[sc]`) render no tap area, and their empty-state text stays plain text.
  - Previous and next are `disabled` while a line is open in that section.
- [x] **Step 7. Frontend: `CollectionView`** gets the same behaviour for `kind === "list"` only (FR1.2). Habit trackers are unchanged.
- [x] **Step 8. Frontend: App wiring** (FR3.4 to FR3.6, FR4.1 to FR4.6, FR5.1 to FR5.4).
  - **State:** quick-line state lives in `App` and holds the page key captured when the line opens (R-14).
  - **One line at a time:** a tap elsewhere opens nothing while the line has text, and moves an empty line to the new spot.
  - **Text survives:** the text stays through scrolling, taps elsewhere, and leaving and returning to the app.
  - **"More":** closes the line and sets the form's text to the line's text, replacing any old text. It sets the form's page to the line's page (or collection) and its type to task for this opening only, without calling `persistSticky` (FR3.6, R-12). It then opens the form.
  - **"Logged" message:** after Log, show "Logged “<text>” to <page>" in the shared toast slot for 6000 ms. Text over 40 characters is cut to 39 plus "…". `<page>` is the section heading text (R-13). Undo calls `removeEntry(id)`. A newer delete or logged message replaces the older one.
  - **Highlight:** a 1.6 s highlight on the new row when it is visible.
  - **Focus:** after Log or Cancel, focus returns to that section's tap-area button.
- [x] **Step 9. Frontend: `UndoToast` label prop.** Existing callers pass their current text. Add `aria-live="polite"` so screen readers announce it (FR4.6); the existing `role="status"` stays.
- [x] **Step 10. Frontend: write and run the tests** (test-after, Standard: 5 to 8 per component).
  - `tests/ui/QuickLine.test.tsx`: 8 tests covering opening and focus, the bullet and aligned text box, the order of the button row, Log, Enter, Cancel, Escape, and empty Log saving nothing.
  - `tests/ui/SpreadView.test.tsx` (extended): 7 tests covering the tap area under own entries and above "Later this month", the empty-state text as the button, the filter-hidden text, no tap area on a past period, previous and next disabled while open, accessible labels, and the 33 px minimum height.
  - `tests/ui/CollectionView.test.tsx` (extended): 5 tests covering list collections getting a tap area, habit trackers not getting one, empty-list text, logging into the collection, and the label.
  - `tests/ui/UndoToast.test.tsx` (extended): 3 tests covering the label prop, the existing labels unchanged, and Undo calling back.
  - `tests/ui/AppQuickLine.test.tsx` (new): 8 tests:
    - one line at a time with text;
    - an empty line moves;
    - text survives a tap elsewhere and a `visibilitychange`;
    - "more" moves the text and leaves remembered choices unchanged;
    - the "Logged" message wording and truncation;
    - a newer message replaces an older one;
    - Undo removes the entry even after an edit;
    - the filter hiding the task still shows the message.
  - **Timing (NFR1, NFR2):** two tests in `AppQuickLine.test.tsx` measure from the tap event to focus, and from Log to the rendered row, each under 500 ms.
- [x] **Step 11. Regression.** Run the full suite once with `docker compose run --rm dev npx vitest run`. Also run `docker compose run --rm dev npm run typecheck` and `docker compose run --rm dev npm run lint`. All must pass (NFR7).
- [x] **Step 12. Documentation and traceability.** Add short rationale comments in the existing house style (dated, with spec and requirement references). Write `code-summary.md`, `source-manifest.json` and `traceability.json`, mapping FR1.1 to FR6.2 and NFR1 to NFR7 to their implementing and test files.

### Part C: repair after your change request

- [x] **Step 13. Fix the deleted-collection trap (review R-07, R-08; FR5.2, FR5.4).**
  - **Make the stranded line harmless.** An open quick line whose page no longer exists stops blocking other tap areas and is dropped, with its text discarded. "No longer exists" means a list collection that has been deleted, whether on this device or by another synced device.
  - **Undo restores it.** Undo of the collection deletion within its 6 seconds also restores the line with its text.
  - **Add App-level tests** in `tests/ui/AppQuickLine.test.tsx`:
    - a collection line logs to the collection;
    - the "Finish or cancel…" note names the collection when its line is off screen;
    - deleting a collection that holds a line with text leaves the day section's tap area working.
  - **Keep everything else green.** Re-run the scoped files, the full suite, the type check and lint in Docker. Update `code-summary.md` and `traceability.json`.

### Part D: Build and Test loop-back 1

- [x] **Step 14. Undo must not overwrite a newer line (code-generation review R-09; FR5.4; Build and Test Loop-back 1).**
  - **The fix:** in `src/App.tsx` `undoDelete`, restore the stored quick line only when no line with text is open: `setQuick((q) => (q && q.text.trim() ? q : toast.quick))`.
  - **New App test** in `tests/ui/AppQuickLine.test.tsx`: delete a collection holding a line with text, open the day line and type, then tap Undo. The day line keeps its text and the collection comes back.
  - **Checks:** re-run the scoped files, the full suite, the type check and lint in Docker. Update `code-summary.md`.

## Requirement to step map

| Requirements | Steps |
|---|---|
| FR1.1, FR1.3, FR1.6 | 4, 6, 10 |
| FR1.2 | 7, 10 |
| FR1.4, FR1.5 | 2, 3, 6 |
| FR1.7, NFR1, NFR4 | 4, 5, 10 |
| FR1.8, FR2.4 | 4, 10 (same component on all widths) |
| FR2.1 to FR2.3 | 4, 10 |
| FR3.1 to FR3.4 | 4, 8, 10 |
| FR3.5, FR3.6 | 8, 10 |
| FR4.1 to FR4.6 | 8, 9, 10 |
| FR5.1 to FR5.5 | 6, 8, 10, 13, 14 |
| FR6.1, FR6.2, NFR7 | 11 |
| NFR2 | 8, 10 |
| NFR3 | Follows from the one-tap design; checked in Step 5 |
| NFR5 | 4, 6, 9, 10 |
| NFR6 | 4 (reuses `addEntry` and `removeEntry`) |

## Assumptions & Open Questions

- The real-phone check in Step 5 runs in the phone's browser against the local dev server. An installed home-screen app needs the deployed HTTPS site. If you want that checked too, it happens after merge, in Build and Test. [assumption]
