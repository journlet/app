> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Code Structure — Journlet app

One npm package (`app`), no workspaces. About 233 tracked files outside `aidlc/` and `.claude/`; about 26,500 lines across `src/` and `supabase/` (about 20,200 in `src/`).

## Directory Layout

| Path | Classification | Contents |
|---|---|---|
| `src/lib/` | Pure helpers and domain model | `types.ts` (Entry, Recurrence, Collection, Habit), `dates.ts` (period keys, reminder formatting), `crypto.ts`, `keyring.ts`, `keystore.ts`, `prf.ts`, `search.ts`, `storageKeys.ts` (every `journlet-` storage name), `supabaseConfig.ts`, and similar |
| `src/store/` | State, mutators and background loops | `journal.ts` (Yjs document and mutators), `recurrence.ts` (materialiser, dedupe, rule maths), `reminders.ts` (notification loop), `sync.ts` (encrypted sync), `decode.ts` (repair/reject readers), `devices.ts`, `credentials.ts`, `keeperWraps.ts`, `deviceLink.ts`, `metrics.ts`, `usage.ts`, `pageOrder.ts`, `syncStatus.ts`, `appUpdate.ts`, `supabaseClient.ts`, `useJournal.ts` |
| `src/ui/` | Presentational components and sheets | `EntryActionsSheet.tsx`, `RuleActionsSheet.tsx`, `EndsForm.tsx`, `EarlierOccurrencesSheet.tsx`, `SpreadView.tsx`, `spreadData.ts`, forms, banners, passkey and onboarding views |
| `src/*.tsx` | Top-level views | `App.tsx` (composition root, 1,855 lines), `CollectionView`, `IndexView`, `MenuView`, `SyncView` |
| `src/main.tsx` | Bootstrap | Theme, gesture guards, service-worker registration and update checks, starts sync, reminder and recurrence loops |
| `src/sw.ts` | Service worker | Workbox precaching/routing; `notificationclick` focuses or opens the app |
| `supabase/` | Backend schema | `schema.sql` (tables, RLS, quota trigger), `verify.sql`, `delete-user.sql`, `scratch-scaffold.sql` |
| `tests/`, `tests/ui/` | Tests | 96 files; store/lib in Node, UI in jsdom via per-file docblock; `tests/setup.ts` |
| `build/` | Build helpers | `csp.ts` substitutes CSP `connect-src` at build |
| `scripts/`, `public/` | Assets | Icon generation, static assets |
| Root | Config and packaging | `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `.nvmrc`, `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `Makefile`, `README.md`, `.github/` |

## Code Patterns

- **Single CRDT document**: top-level `Y.Array`s (`entries`, `collections`, `habits`, `recurrences`) and `Y.Map`s (`devices`, `credentials`); each record is a `Y.Map` so concurrent edits to different fields merge.
- **Mutators as plain functions**: each wraps one `doc.transact`, looks the record up by id and returns silently if absent (for example `setReminder`, `setRecurrenceEnd`).
- **Decode with repair or reject**: `toEntry` / `toRecurrence` read through `decode.ts`; a missing cadence or anchor rejects the rule (stops the future, destroys nothing), cosmetic fields are repaired.
- **Idempotent background loops**: materialiser guarded by a `running` flag, debounced on remote updates; reminder loop on a 30 s interval plus visibility.
- **Sheets as step machines**: `EntryActionsSheet` switches on a `Step` union (`text`, `sig`, `type`, `repeat`, `ends`, `remind`, `migrate`, `move`, `schedule`, `thread`, `nest`); the root menu builds rows conditionally (for example "Repeat this entry…" only when the entry has no `recurrenceId`).
- **Dated rationale comments**: source carries dated design notes and spec references (`spec §4.6`, `§11 Q17`).

## Files Central to the Active Intent

| File | Role (details in `component-inventory.md`) |
|---|---|
| `src/lib/types.ts` | `Entry.remindAt`, `Recurrence.remindTime` (line ~110), `pageScope` |
| `src/store/journal.ts` | `setReminder` (~222), `addRecurrence` (~754), `setRecurrenceEnd` (~791), `toRecurrence` (~701) |
| `src/store/recurrence.ts` | `remindAtFor` (~265, private), `carriesItsOwn` (~353), `materialiseRecurrences` (~448) |
| `src/store/reminders.ts` | `checkReminders`, `startReminderLoop`, fired-key scheme |
| `src/ui/EntryActionsSheet.tsx` | `saveRepeat` (~262), `saveReminder` (~316), remind step (~842), "Remove reminder" (~874), repeat row guard (~1211) |
| `src/ui/RuleActionsSheet.tsx` | Skip, ends and stop for a rule |
| `src/App.tsx` | Reminder caption on rows (~1055), mounts `RuleActionsSheet` (~1662) and `EntryActionsSheet` (~1829) |
| `src/ui/spreadData.ts` | Due list (~200), rule previews |
