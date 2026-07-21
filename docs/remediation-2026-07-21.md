**Confidentiality: Internal | Status: DRAFT - UNREVIEWED**

# Remediation list — feedback from first 24 hours (21 July 2026)

Assessed against the current codebase. Ordered by priority. Statuses updated as items ship.

---

## P1 — Correctness

### 1. Day does not roll over to today on morning open
**Status: fixed** (c1724de) — confirmed working on-device 21 Jul.
**Feedback:** App opened this morning still showing yesterday.
**Root cause (confirmed):** `App.tsx` initialises the per-section anchors (`day`, `week`, `month`, `year`) to `todayKey()` once, in `useState`. Nothing updates them when the date changes, and nothing forces a React re-render on resume, so `nowKeys`, the Due view and the migration banner all render against a stale "today". `recurrence.ts` does have a 60s rollover interval and a `visibilitychange` handler, but those only materialise recurrence instances — they never touch the UI anchors, and iOS suspends timers in backgrounded PWAs anyway.
**Fix:** Add a `visibilitychange`/`pageshow` handler in `App.tsx` that, on resume, compares a stored `today` state to `todayKey()`; if changed, bump it (forcing re-render of `nowKeys`) and advance any anchor still pointing at the previous today. Keep anchors the user deliberately navigated away from untouched.
**Effort:** Small.

### 2. Recurring tasks from yesterday not appearing where expected
**Status: fixed** — root cause was item 1; cadence + next-date line added to the entry sheet. Verify materialisation tomorrow morning.
**Feedback:** Two recurring tasks completed yesterday haven't reappeared.
**Assessment:** Two contributing factors. (a) This is largely item 1: on resume the materialiser does run and insert today's instances, but the day section is still rendering yesterday's page, so they're invisible. (b) The "Repeat this entry…" sheet defaults to every 1 week — if the default wasn't changed, the next occurrence is next week, not today. Completion does not trigger the next instance; instances appear when their date arrives.
**Fix:** Fix item 1 first, then verify. Additionally: show the cadence and next occurrence date on the entry sheet (e.g. "repeats daily — next: Wed 22 Jul") so the behaviour is legible rather than guessed.
**Effort:** Small–medium.

### 2a. Future recurring occurrences invisible in Scheduled ahead
**Status: fixed** (be2359a, cb3eeed) — display-only preview rows, option (a); previews deduped against real future entries, which carry the cadence tag instead.
**Feedback:** If recurring entries only appear on the day they recur, they never show in Scheduled ahead.
**Root cause (confirmed):** The materialiser (`recurrence.ts`) deliberately stops at today (`if (next > today) break`), so future occurrences don't exist as entries and Scheduled ahead — which only lists real entries on future pages — can't show them.
**Fix options:**
- **(a) Virtual display (preferred):** compute each active rule's next occurrence at render time and list it in Scheduled ahead as a derived row (marked "repeats — daily/weekly/…"). No entries written, so no CRDT churn, no cross-device dedupe risk, and completed/struck instances stay accurate.
- **(b) Materialise ahead:** insert the next occurrence (or N days ahead) as real entries. Makes them individually editable early, but adds clutter, sync noise, and widens the offline double-create window the dedupe pass exists for.
Recommend (a); revisit (b) only if editing a future occurrence before its day becomes a real need.
**Effort:** Small–medium.

### 3. Open tasks from previous day/week — migration
**Feedback:** What happens to leftover open tasks? Is there a migration process?
**Assessment:** Yes — spec §4.3 is implemented. Open tasks on expired pages surface via the "N open tasks from past pages — Review and migrate" banner and a review sheet (explicit migrate, never a silent move). It didn't appear this morning because of item 1: `nowKeys` was stale, so yesterday didn't count as a past page.
**Fix:** No new feature needed; verify the banner appears correctly once item 1 is fixed. Consider a brief note in the review sheet explaining Ryder Carroll migration for first-time users.
**Effort:** Verification only.

---

## P2 — Mobile UX

### 4. Capture bar too large on iPhone
**Feedback:** Bottom entry area takes too much space; should collapse to an icon.
**Assessment:** The footer stacks the scope tab row (day/week/month/year/date), an optional date input, and the capture bar (type glyph, priority, inspiration, text input, add) — three rows worst case.
**Fix:** Collapsed-by-default capture: a single compact bar (or icon button) that expands to the full control set on focus/tap. All controls remain plainly labelled when expanded, per the labelling constraint. Sticky scope/type prefs already persist (`sticky.ts`) so the collapsed state loses nothing.
**Alternative (pinned 21 Jul):** on small screens, open capture as a full-screen form instead of an expanding bottom bar. Sidesteps iOS keyboard-pinning fragility entirely (the form owns the whole viewport), gives room for plainly labelled controls, and is a common mobile pattern. Decide between the two when picking this up.
**Effort:** Medium.

### 5. Keyboard pushes content up; capture bar should pin to keyboard
**Status: fixed** (c1724de, f837c42) — reveal-pan counter confirmed working on-device 21 Jul.
**Feedback:** Opening the entry pushes the whole page up; the bar should stay locked to the bottom and move with the keyboard.
**Assessment:** A `visualViewport` pin already exists (`App.tsx`, translateY on the footer) but it only repositions the footer — iOS still scrolls the layout viewport to reveal the focused input, shoving the page content up.
**Fix:** Rework as: footer `position: fixed` driven by `visualViewport` height/offset; suppress the scroll jump (e.g. `interactive-widget=resizes-content` in the viewport meta where supported, plus preventing scroll-into-view on focus); test in standalone PWA mode on iOS specifically, as behaviour differs from Safari tabs.
**Effort:** Medium; fiddly to test.

### 6. Section header squashed by nav buttons
**Status: fixed** (0bc3e57, cb3eeed, 66cb07c) — short nav labels under 480px, 'future'/'past' subs, short month titles ('Sept 2026'). Confirmed on-device 21 Jul.
**Feedback:** "‹ previous / back to now / next ›" buttons squash the header text on narrow screens.
**Assessment:** Title, subtitle and three text buttons share one flex row.
**Fix:** On narrow viewports, either wrap nav onto its own row or compact to chevron buttons with visible-but-shorter labels. Implementation approach is open (plain CSS, a utility framework, whatever is most effective) — the requirement is the outcome: markedly tighter use of space on small screens. A general small-screen audit is item 9.
**Effort:** Small.

---

## P3 — Features and clarity

### 7. Filters on the single-page spread
**Feedback:** Wants e.g. "just tasks", "hide complete".
**Assessment:** No filtering exists. Reasonable for a one-page layout as volume grows.
**Fix:** A plainly labelled filter row (all / tasks only / open only), applied across sections, persisted like other sticky prefs. Purist notation untouched — filtering visibility, not symbols.
**Effort:** Medium.

### 8. Recurrence on any entry, not just day pages
**Feedback:** Wants any entry to be recurring.
**Assessment:** Confirmed limitation: "Repeat this entry…" is gated on `keyScope(sheet.pk) === "day"`. Any entry type on a day page can already recur; week/month/year pages and collections cannot. The materialiser (`recurrence.ts`) only walks day keys.
**Fix:** Extend `Recurrence` to carry a page granularity; materialiser emits `periodKey`-scoped instances (e.g. "every month on the monthly log"). Collections are a separate question — recurrence into a collection has no natural "next page", so propose deferring that half and confirming desired behaviour first.
**Effort:** Medium.

### 9. General responsive/uncluttered pass
**Feedback:** UI needs to be more responsive and less cluttered overall.
**Fix:** A small-screen audit (spacing, tap targets, type scale, vertical density) covering items 4–6 plus anything found on a 375px-wide viewport. Space efficiency is the priority: more journal content visible per screen, less chrome. Keep the prototype's visual style but treat its spacing as negotiable on mobile; tooling choice (plain CSS vs a framework) is open, judged purely on results.
**Effort:** Medium, ongoing.

### 10. "Saved" indicator unclear
**Status: fixed** — permanent 'saved' label removed; transient 'saving…' cue only, sync badge is the persistent status.
**Feedback:** What does "saved" in the top right mean?
**Assessment:** It reflects local persistence (`useJournal.saveState`) — the IndexedDB write of the Yjs doc on this device. Sync status is the separate badge next to it. Two adjacent indicators with overlapping meaning is confusing.
**Fix:** Merge into one status ("saved on this device · synced"), or drop the save dot and keep only the sync badge, surfacing local-save failure as an error state. Aligns with "every UI action plainly labelled".
**Effort:** Small.

### 11. Sign-out should unlink the journal from the device; signed-out state too quiet
**Feedback (21 Jul):** Shouldn't be able to link a journal until logged in; logging out should remove the journal from that device. Confusion arose when the app quietly stopped auto-updating while signed out.
**Assessment:** Linking is already gated on sign-in (the key entry field only appears in the post-sign-in `needs-key` state; a QR scanned while signed out is held as pending and applied after sign-in) but this is not obvious. Sign-out deliberately keeps the journal ("Sign out (journal stays on this device)") per the offline-first design, and the signed-out state is only visible as the small header badge — so sync stops silently.
**Decision (21 Jul, Gary):** wipe on explicit sign-out only.
**Fix:**
- Explicit sign-out removes the journal and keys from the device, behind a clear warning that requires confirming the journal key is saved (unsynced changes and the key are otherwise unrecoverable; server holds ciphertext only).
- Session expiry or other involuntary sign-out must NOT wipe; instead show a prominent "not syncing — signed in needed" banner on the journal spread itself, not just the header badge.
- Make the existing sign-in gate on linking explicit in the Sync screen copy.
- Update the "Lost a device?" copy if needed — its "no one can remotely erase it" claim stays true; wiping is local and voluntary only.
**Effort:** Medium; touches sync/keystore teardown and needs careful messaging.

### 12. User preferences
**Feedback (21 Jul):** A preferences section, e.g. persisting filters; is a Supabase table needed?
**Assessment:** No new table — and one would violate ciphertext-only. Device-local prefs (filters, view choices) belong in localStorage alongside the existing sticky capture prefs; cross-device prefs belong in an encrypted prefs map inside the Yjs doc, syncing through the existing relay.
**Position:** Keep it ruthless. A notebook has no settings, and that absence is part of the appeal — every preference is a small tax on it. Filters, quiet hours, dark mode: fine. If the settings page ever needs sections, something has gone wrong.
**Effort:** Small once a settings surface (item 13) exists.

### 13. Central menu / settings area
**Feedback (21 Jul):** Export's location on the Index doesn't make sense; a central menu or settings area is needed.
**Assessment:** Agreed — sync, export, notification permission and future preferences are scattered. One plainly labelled menu page; prerequisite for items 7 and 12.
**Effort:** Small–medium.

### 14. Shared journals
**Feedback (21 Jul):** e.g. a journal shared with a partner.
**Assessment:** Feasible within constraints. Schema currently keys journals and updates to a single user_id; sharing needs journal_id plus a membership table with RLS checking membership (still auth + dumb storage, no server code). Key sharing rides the existing QR flow, done in person. Main cost: the client becomes multi-journal, and lost-device key rotation affects all members.
**Position:** Interrogate the need before building. The likely real unit of sharing is the collection, not the journal — a shared shopping list, holiday plan or household task list covers most couples' use at roughly a third of the engineering, while the daily log stays private by default. Full shared journals also dilute the product: a journal is personal in a way a list isn't. Recommended approach: live with it a few weeks, note the concrete moments sharing was wished for, then decide journal vs collection as the unit. Either way, design the schema migration early — it touches every table.
**Effort:** Large (shared journals); medium (shared collections).

### 15. Performance at scale — yearly volumes
**Feedback (21 Jul):** Will a growing journal hurt the app? Limit a journal to a year like a physical book?
**Assessment:** No concern at current volumes, but the whole journal is one in-memory CRDT doc with a forever-growing update log. Yearly volumes (one doc per year, old volumes archived read-only, new notebook each January) cap memory, load time and log size, match bullet journal practice, and give sharing (item 14) a natural unit.
**Position: endorsed — strongest idea of the four.** The architecturally correct answer (capping doc and log growth) and the philosophically correct one (a notebook ends; closing a year, running an annual migration and starting fresh has real value) are the same idea, and it gives the app a ritual no digital task tool has. Volumes should shape the schema before item 14 does, not after.
**Effort:** Medium–large; design before the year turns.

---

## Suggested sequence

1. Item 1 (day rollover) — correctness bug, small fix, and currently masking whether migration and recurrence work at all
2. Item 5 (keyboard pinning) — quick capture is the app's headline principle and this taxes every entry made on mobile
3. Items 2, 2a and 3 — verify recurrence and migration behave once rollover is fixed; add next-occurrence visibility in the sheet and Scheduled ahead
4. Items 4, 6 and 9 (compact capture bar, header, density pass) — same code area, best done as one mobile-layout pass
5. Item 7 (filters) — grows in value with journal volume; not urgent yet
6. Items 8 and 10 last — 8 needs a design decision on collections first; 10 is cosmetic
