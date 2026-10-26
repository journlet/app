## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-26T14:41:58Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | src/ui/SpreadView.tsx > "back to now" button (about line 205) and aidlc/spaces/default/intents/261026-quick-capture/construction/code-generation/code-summary.md | Known item (c) confirmed as a misfile path. Only previous and next take navLocked. "Back to now" shows on any non-current section and stays enabled while a line is open. A line opened on a future page (for example Next week) and then moved with "back to now" stays open under the current section, because App matches the line on sectionKey alone (renderQuickLine in src/App.tsx). It still logs to the captured future pk, and the toast names the future page. The text box's aria-label is stale as well. The person sees the line under "This week" but the task lands on a different week. This breaks the intent of FR5.5 (the page the line will log to cannot slide away). The same drift is reachable from other setAnchors callers (src/App.tsx lines 1046 and 1610, jump to an entry's page). No test covers it. | Disable "back to now" with navLocked as well. Better, bind the open state to the pk (section and pk), as the collection case already does, so the line cannot appear under a different page. Add a SpreadView test for it, and a test for the App-level jump. | New |
| R-02 | Major | src/App.tsx > openQuick and quickOnScreen; plan R-14 and FR5.2/FR5.4 | Known item (b) confirmed. A line with text on the spread, after navigating to a collection or another view, is not treated as on screen (quickOnScreen is false). Opening a new line there replaces it through openQuick, which returns { text: "" } and silently loses the typed text. No message, no confirmation. FR5.4 says a line with text stays open with its text, and FR5.2 says another tap opens nothing. The code reads "one line" as per screen, and nothing in requirements.md or an approved question backs that reading. The plan's Step 8 text also says the text survives. Silent loss of typed content is the failure this feature exists to prevent. | Either block a new line while a line with text exists anywhere (the literal FR5.2), or carry the old text into "more" or a draft, or get the person's decision on the cross-page rule and record it in requirements. Add a test of spread, then collection, then tap. | New |
| R-03 | Major | aidlc/spaces/default/intents/261026-quick-capture/construction/code-generation/code-generation-plan.md > Step 5 (unticked) and Part B; traceability.json > NFR4, FR1.7 | Known item (a). Plan Step 5 was an explicit gate: if the real-phone keyboard check fails, "stop here" before anything else is built. The human skipped it, which is within their authority, but Part B was built wholesale on an unproven assumption that requirements.md names (Assumptions, Constraints). NFR4 is recorded as Deferred, but FR1.7 and the on-device part of NFR1 are still listed as covered by jsdom tests, which cannot show keyboard behaviour. The synchronous-focus design (always mounted hidden input, reveal in pointerup) is therefore unverified, and the rework risk sits with all of Part B. | Make the deferral explicit in traceability.json for FR1.7 and NFR1 (on-device part) as well as NFR4, with an owner and a stage (Build and Test or post-deploy). The human should record it as an Accepted risk at the gate. Do not mark these requirements covered. | New |
| R-04 | Minor | src/App.tsx > UndoToast render; src/ui/UndoToast.tsx; FR4.6 | Known item (e). The toast mounts with its first message already inside (`{toast && <UndoToast/>}`), so the first "Logged" message may not be announced, which is the case FR4.6 requires. aria-live="polite" on a node inserted with its text does not fix this, and no test can show it in jsdom. The developer flags this honestly. | Keep a persistent live-region container mounted, and update only its text. Otherwise record FR4.6 as unverified until a screen-reader check. | New |
| R-05 | Minor | code-summary.md > FR4.3 note; tests/ui/AppQuickLine.test.tsx | Known item (d). No current filter hides a new open task, so FR4.3's "filter hides the task" branch has no real test, and the "open only" test passes whether or not the branch exists. The code does show the toast regardless. Acceptable as stated, but it should not count as coverage of the hidden case. | Record FR4.3 in traceability.json as covered by inspection only, not by a test. | New |
| R-06 | Minor | src/App.tsx > moreQuick, closeCapture | Known item (f) checked. Restoring the remembered scope and type in closeCapture is correct: the underscore setters do not write sticky.current, and persistSticky only saves sticky.current. If the person changes type inside the form, the form writes sticky as normal and that choice is restored, as the comment says. No defect found. A test that the form's Log, as well as Close, restores them is advisable. | None required; optional extra test. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| type-check (docker compose run --rm dev npm run typecheck) | PASS | tsc -b and the test tsconfig both clean. |
| linter (docker compose run --rm dev npx oxlint src tests) | PASS | 0 warnings, 0 errors. |
| vitest (full suite, in Docker) | PASS | 100 files, 1368 tests passed. The green run does not cover R-01 or R-02. |
| source-manifest.json | PASS | All 14 paths are quick-capture files and match the git diff and untracked files. Nothing unrelated is claimed. |

### Summary

The build is clean and tested, but three Major findings block it. A line can drift onto a different page through "back to now" (R-01), typed text is silently discarded when a line opens on another screen (R-02), and the keyboard gate was skipped while FR1.7 and NFR1 are still claimed as covered (R-03). R-01 and R-02 are small, testable fixes.
