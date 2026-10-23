> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Component Inventory — Journlet app

Health: **healthy** (clear responsibility, tested), **at-risk** (works, but a known gap or size concern touches the active intent), **degraded** (known failing or unsafe). Depth: **deep** = analysed in this scan; **skimmed** = API and headers only.

## Deeply Analysed Components

### Domain Model
- **Path**: `src/lib/types.ts`
- **Responsibility**: `Entry`, `Recurrence`, `Collection`, `Habit`, state/type glyphs, `Scope ⊆ RecurrenceUnit` invariant.
- **Depends on**: nothing internal of note.
- **Health**: healthy. `Recurrence.remindTime` is optional "HH:MM"; no field records reminder provenance on an `Entry`.

### Journal Store
- **Path**: `src/store/journal.ts`
- **Responsibility**: owns the single Yjs document, IndexedDB persistence, decode (repair/reject) and every mutator for entries, collections, habits and rules.
- **Depends on**: Domain Model, `store/decode`, `lib/dates`, `store/pageOrder`, yjs, y-indexeddb.
- **Health**: at-risk for the intent — `remindTime` is write-once (set only in `addRecurrence`); `setReminder` edits one entry only.

### Recurrence Engine
- **Path**: `src/store/recurrence.ts`
- **Responsibility**: cadence maths, materialising occurrences up to today's period, dedupe of twins, rule captions, skip.
- **Depends on**: Journal Store, `lib/dates`.
- **Health**: at-risk for the intent — `remindTime` reaches an occurrence only at creation and only for day rules; `remindAtFor` is private; `carriesItsOwn` keeps twins whose `remindAt` differs.

### Reminder Loop
- **Path**: `src/store/reminders.ts`
- **Responsibility**: local notification scheduling while the app is open; per-device fired tracking; permission helpers.
- **Depends on**: Journal Store (`readAll`), `lib/storageKeys`, Notification API, service worker.
- **Health**: healthy in code; its tests fail locally on Node 26 (see `code-quality-assessment.md`).

### Entry Actions Sheet
- **Path**: `src/ui/EntryActionsSheet.tsx` (1,442 lines)
- **Responsibility**: every action on one entry, including the remind, repeat and ends steps and the rule rows for an occurrence.
- **Depends on**: Journal Store, Recurrence Engine, Reminder Loop (permissions), `lib/dates`.
- **Health**: at-risk — large; reminder writes go to one entry only; "Repeat this entry…" is hidden once `recurrenceId` is set; `saveRepeat` duplicates the `remindAtFor` arithmetic.

### Rule Actions Sheet
- **Path**: `src/ui/RuleActionsSheet.tsx`
- **Responsibility**: a repeating item's own settings, opened from a Scheduled-ahead preview row: skip this one, change ends, stop.
- **Depends on**: Journal Store (`setRecurrenceEnd`, `endRecurrence`), Recurrence Engine (`skipOccurrence`, captions).
- **Health**: healthy; no reminder control exists.

### App Shell
- **Path**: `src/App.tsx` (1,855 lines; deep only for reminder captions, preview rows and sheet mounting)
- **Responsibility**: composition root, routing between views, row rendering, sheet mounting.
- **Depends on**: almost every UI and store module.
- **Health**: at-risk (size and fan-out).

### Spread Data
- **Path**: `src/ui/spreadData.ts`
- **Responsibility**: derives page rows, the Due list (overdue and due-today reminders on open entries) and rule preview rows.
- **Depends on**: Journal Store, Recurrence Engine, `lib/dates`.
- **Health**: healthy.

### App Bootstrap
- **Path**: `src/main.tsx`
- **Responsibility**: theme, gesture guards, service-worker registration and update polling, starts sync, reminder and recurrence loops.
- **Depends on**: Sync Engine, Reminder Loop, Recurrence Engine, Journal Store.
- **Health**: healthy.

## Skimmed Components

### Sync Engine
- **Path**: `src/store/sync.ts` (1,882 lines)
- **Responsibility**: encrypt/decrypt Yjs updates, reconcile and push diffs, Realtime stream, key and device lifecycle.
- **Health**: at-risk (size); behaviour relevant to the intent is per-key Yjs merge, recorded in `architecture.md`.

### Service Worker
- **Path**: `src/sw.ts`
- **Responsibility**: precaching and routing; notification click focuses or opens the app.
- **Health**: healthy.

### Device and Credential Registers
- **Path**: `src/store/devices.ts`, `credentials.ts`, `keeperWraps.ts`, `deviceLink.ts`, `src/lib/crypto.ts`, `keyring.ts`, `keystore.ts`, `prf.ts`
- **Responsibility**: passkeys, key wrapping, device list, journal-key transfer.
- **Health**: not assessed.

### Other Views
- **Path**: `src/CollectionView.tsx`, `IndexView.tsx`, `MenuView.tsx`, `SyncView.tsx`, remaining `src/ui/`
- **Health**: not assessed (`SyncView.tsx` is 1,224 lines).

### Supabase Backend
- **Path**: `supabase/`
- **Responsibility**: tables, RLS on `auth.uid()`, quota trigger, operator scripts.
- **Health**: not assessed beyond declarations.
