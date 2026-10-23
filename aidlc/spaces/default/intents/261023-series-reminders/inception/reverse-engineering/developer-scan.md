## Developer Code Scan Results

Repo: project root (`/Users/garyrutland/Claude/Projects/Journlet/app`), unrecorded single repo. Commit at scan: `8bca07f`. Scan breadth: full; depth: Minimal. 233 tracked files outside `aidlc/` and `.claude/` (about 26,500 lines in `src/` and `supabase/`).

### Scan Coverage
- **Analysed deeply**:
  - src/lib/types.ts
  - src/store/reminders.ts
  - src/store/recurrence.ts
  - src/store/journal.ts (entry and recurrence read/write API, Yjs document layout)
  - src/ui/EntryActionsSheet.tsx (reminder step, repeat step, ends step, rule rows)
  - src/ui/RuleActionsSheet.tsx
  - src/App.tsx (reminder caption on entry rows, rule preview rows, sheet mounting only)
  - src/ui/spreadData.ts (Due view and rule previews)
  - src/main.tsx (loop start-up)
  - tests/reminders.test.ts
  - tests/ui/EntryActionsSheet.test.tsx (reminder, repeat and occurrence tests)
  - tests/ui/RuleActionsSheet.test.tsx
  - package.json
  - vitest.config.ts
  - .github/workflows/deploy.yaml
- **Skimmed only**:
  - src/store/sync.ts (header, exported API, Supabase tables touched)
  - src/store/ (other modules: decode, devices, credentials, keeperWraps, deviceLink, metrics, usage, pageOrder, syncStatus, appUpdate)
  - src/lib/ (dates.ts reminder helpers read; the rest at file-name level)
  - src/ui/ (other views and forms, at file-name level)
  - src/ (other top-level views: CollectionView, IndexView, MenuView, SyncView)
  - src/sw.ts (notification click handler only)
  - supabase/ (table and RLS policy declarations only)
  - tests/ (other test files, at file-name and test-title level)
  - build/, scripts/, public/, Dockerfile, docker-compose.yml, nginx.conf, Makefile, tsconfig*.json, vite.config.ts, .oxlintrc.json, README.md

### Packages Found
- `app` — single-page PWA (one npm package, no workspaces) — TypeScript/React — offline-first, end-to-end-encrypted bullet journal (Ryder Carroll method).
- Internal layers (by directory, enforced partly by `tests/moduleBoundaries.test.ts`):
  - `src/lib/` — pure helpers and the domain model (`types.ts`, `dates.ts`, `crypto.ts`, `search.ts`, etc.).
  - `src/store/` — Yjs document and mutators (`journal.ts`), recurrence materialiser (`recurrence.ts`), local reminder loop (`reminders.ts`), encrypted sync engine (`sync.ts`), device/credential registers.
  - `src/ui/` — presentational components and sheets; `src/*.tsx` — top-level views; `App.tsx` (1,855 lines) composes them.
  - `src/sw.ts` — Workbox service worker plus notification-click handling.
  - `supabase/` — SQL schema, RLS, quota trigger, verification and operator scripts.

### Build System
- **Type**: npm + Vite 8 (`vite build`), TypeScript 7 project references (`tsc -b`), vite-plugin-pwa.
- **Config Files**: package.json, package-lock.json, vite.config.ts, vitest.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.node.json, tsconfig.test.json, .oxlintrc.json, .nvmrc (`22`), build/csp.ts (CSP `connect-src` substitution at build), Dockerfile (node:22 build, nginx serve), Makefile (dev container only).
- **Build Dependencies**: `ui/*` and `App.tsx` → `store/journal`, `store/recurrence`, `store/reminders` → `lib/*`; `store/sync` → `store/journal` (`doc`, `REMOTE_ORIGIN`), `lib/crypto`. `store/recurrence` → `store/journal`. `store/reminders` → `store/journal.readAll`.

### APIs Discovered
- No HTTP API of its own. External: Supabase (auth via emailed one-time code, PostgREST tables `journals`, `journal_updates`, `journal_keys`, `keeper_wraps`, `user_usage`, Realtime channel `journal-updates`), all behind RLS on `auth.uid()`.
- Internal store API (relevant subset, `src/store/journal.ts`): `setReminder(id, remindAt|null)` (single entry only), `insertEntry`, `tagEntryRecurrence`, `readRecurrences`, `addRecurrence`, `setRecurrenceEnd`, `endRecurrence`, `advanceRecurrence`. There is no mutator that edits a rule's `remindTime` after creation.
- `src/store/recurrence.ts`: `materialiseRecurrences`, `startRecurrenceLoop`, `nextOccurrence`, `skipOccurrence`, `lastOccurrence`, `isSpent`, `ruleSentence`, etc.
- `src/store/reminders.ts`: `checkReminders`, `startReminderLoop`, notification permission helpers.
- Browser Notification API via the service worker (`reg.showNotification`) with page-context fallback.

### Frameworks & Libraries
- react / react-dom — ^19.2.8 — UI
- yjs — ^13.6.32 — CRDT journal document
- y-indexeddb — ^9.0.12 — local persistence
- @supabase/supabase-js — ^2.112.4 — auth, ciphertext relay, realtime
- qrcode ^1.5.4, jsqr ^1.4.0 — journal-key transfer by QR
- vite ^8.2.2, vite-plugin-pwa ^1.3.0, workbox-* ^7.4.1 — build and service worker
- typescript ~7.0.2 — type checking
- vitest ^4.1.11, @testing-library/react ^16.3.2, jsdom ^30.0.1, fake-indexeddb ^6.2.5 — tests
- oxlint ^1.79.0 — linting

### Test Coverage
- **Test Directories**: `tests/` (store and lib, Node environment), `tests/ui/` (components, jsdom via per-file docblock). 96 test files, 1,295 tests.
- **Test Frameworks**: Vitest, Testing Library, fake-indexeddb (`tests/setup.ts`).
- **Coverage Config**: absent (no coverage provider or threshold in `vitest.config.ts`).
- Intent-relevant tests: `tests/reminders.test.ts` (6: per-occurrence fired keys, stale recurring suppression, one-off late firing, permission gate); `tests/recurrence.test.ts` (14: cadence stepping, materialisation and advancing); `tests/recurrenceEnd.test.ts` (38: ends, spent rules, captions); `tests/ui/EntryActionsSheet.test.tsx` (67, including "reminder mode writes the time the field was left on", "repeat mode starts the rule and tags the entry with it", "an occurrence of a repeat says only this one changes"); `tests/ui/RuleActionsSheet.test.tsx` (12). No test covers changing a rule's reminder time, nor `remindTime` riding onto a materialised occurrence's `remindAt`.

### Code Quality Indicators
- **Linting**: oxlint, `.oxlintrc.json` (restricted-globals rules only, otherwise defaults); `npm run lint`.
- **CI/CD**: `.github/workflows/deploy.yaml` — on PR and push to `main`: `npm ci --ignore-scripts`, lint, typecheck (src and tests), test, build; deploy to GitHub Pages on `main` only. Actions pinned by SHA; least-privilege job permissions. Dependabot configured.
- **Documentation**: README.md present and current (carries a classification block); source is heavily commented with dated design rationale and spec section references (`spec §4.6`, `§11 Q17`). Only one TODO/FIXME/HACK marker in `src/`.

### Technical Debt Signals
- Large files with several responsibilities: `src/store/sync.ts` (1,882 lines), `src/App.tsx` (1,855), `src/ui/EntryActionsSheet.tsx` (1,442), `src/SyncView.tsx` (1,224).
- `Recurrence.remindTime` is write-once: set only by `addRecurrence` at rule creation (`journal.ts:768`); there is no `setRecurrenceRemindTime`. The `setRecurrenceEnd` docblock notes rules were otherwise written once at creation.
- The reminder rides onto an occurrence only at materialisation (`recurrence.ts`, `remindAtFor` and the `insertEntry` call in `materialiseRecurrences`). Occurrences already materialised never pick up a later change to the rule.
- The reminder time on a repeat is restricted to day-scope rules (`EntryActionsSheet.tsx` `saveRepeat`; `materialiseRecurrences` sets `remindAt` only when `pageScope === "day"`).
- Duplicate `remindAt` arithmetic: `saveRepeat` builds the first occurrence's timestamp inline instead of reusing `remindAtFor` (which is private to `recurrence.ts`).
- Fired-reminder tracking lives in `localStorage` per device (`FIRED_REMINDERS_KEY`), keyed `rec:<ruleId>:<pageKey>` with the fired `remindAt`; changing the time re-arms it by design.
- Local test baseline: running the suite on Node v26.11.1 (the machine's default) gives 297 failures out of 1,295, including all 6 in `tests/reminders.test.ts` (`localStorage.clear` on an undefined global). The repo pins Node `~22` (`.nvmrc`, `engines`, CI). This looks environmental, but the baseline must be taken on Node 22 before Construction.
- Supabase URL and publishable anon key are committed in `src/lib/supabaseConfig.ts`. This is by design (public key, RLS and end-to-end encryption guard the data) and is not a secret leak; no auth bypass found in the scanned areas.

## Handoff Summary
- **Intent-relevant finding**: A reminder on an existing repeating item reaches only one entry because the only reminder write path from the entry view is `setReminder(sheet.id, ts)` (`src/ui/EntryActionsSheet.tsx` `saveReminder`, about lines 316–336; "Remove reminder" about line 870), which edits one entry's `remindAt` (`src/store/journal.ts:222`). A rule's own reminder (`Recurrence.remindTime`, "HH:MM", `src/lib/types.ts:110`) can be set only while creating the repeat (`saveRepeat`, about lines 262–314). The "Repeat this entry…" row is hidden once the entry has a `recurrenceId` (about line 1211). `RuleActionsSheet.tsx` (the repeating item's own settings, opened from a Scheduled-ahead preview row's ⋯ in `App.tsx` about line 1292) offers only skip, ends and stop, with no reminder control. `materialiseRecurrences` (`src/store/recurrence.ts`) copies `remindTime` into `remindAt` only when an occurrence is first created, for day-scope rules, and materialises nothing beyond today. So "the whole repeating item from this occurrence onward" needs: a new rule mutator for `remindTime` (Yjs per-key last-writer-wins, synced encrypted like every rule field); a pass that updates already-materialised occurrences of that rule from the chosen page onward, leaving past pages and entries with their own different `remindAt` untouched; and new UI on both the entry reminder step and `RuleActionsSheet`.
- **Risks / follow-up**:
  - Existing data and sync: rules and entries are Y.Maps in one encrypted Yjs doc synced through Supabase. A new rule field or edit must decode safely on older clients (`toRecurrence` in `journal.ts` repairs or rejects unknown values), and concurrent edits on two devices resolve per key.
  - "Keeps its own reminder" needs a way to tell an occurrence's own `remindAt` from one inherited from the rule. Today nothing records that; comparing against the rule-derived time (`remindAtFor`) is the only signal.
  - "This occurrence onward" without changing past ones conflicts with a single rule-level `remindTime` that applies to every future materialisation. Splitting the rule, or recording an effective-from boundary, is a design decision for later stages.
  - The dedupe pass (`carriesItsOwn` in `recurrence.ts`) treats a differing `remindAt` between twins as user content and keeps both. A bulk reminder update applied on one device while another materialises the same day could produce visible duplicates.
  - Fired tracking is per occurrence and per time, so a changed series time re-fires once per occurrence, which is the intended behaviour.
  - Reminders on week, month and year rules are not supported today; the intent does not say whether the series choice should extend to them.
  - Test baseline: run `npm test` under Node 22 (`nvm use`). Node 26 currently fails 297 tests, including every reminder test.
