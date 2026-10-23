> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# API Documentation — Journlet app

The app exposes no HTTP API of its own. Its surfaces are an external backend contract (Supabase), browser platform APIs, and the internal store API used by the UI.

## External: Supabase (skimmed)

| Surface | Use |
|---|---|
| Auth | Sign-in by emailed one-time code; session drives `auth.uid()` |
| PostgREST tables | `journals`, `journal_updates` (encrypted Yjs updates), `journal_keys`, `keeper_wraps`, `user_usage` |
| Realtime | Channel `journal-updates` streams inserts from other devices |
| Security | RLS on `auth.uid()` for every table; quota trigger in `supabase/schema.sql`; payloads are ciphertext |

Client configuration (URL and publishable anon key) lives in `src/lib/supabaseConfig.ts`; see `dependencies.md`.

## Browser Platform APIs

- **Notification API** — `reg.showNotification` through the service worker, falling back to `new Notification` in page context. Tag `journlet-<entryId>-<remindAt>` with `renotify: true`.
- **Service worker** — `notificationclick` focuses an existing window or opens `/`; no deep link to the entry.
- **IndexedDB** — through y-indexeddb (document name per volume).
- **localStorage** — fired-reminder map under `FIRED_REMINDERS_KEY`.

## Internal Store API (intent-relevant subset)

### `src/store/journal.ts`

| Function | Contract |
|---|---|
| `readAll(): Entry[]` | Decoded entries (malformed ones repaired or dropped) |
| `insertEntry(e: Entry)` | Inserts a fully formed entry; used by the materialiser |
| `setReminder(id, remindAt: number \| null)` | Sets or deletes `remindAt` on ONE entry; no-op if the id is unknown |
| `tagEntryRecurrence(id, ruleId)` | Sets `recurrenceId` on an entry |
| `readRecurrences(): Recurrence[]` | Decoded rules; rules with unreadable cadence, anchor, `materialisedThrough` or `createdAt` are rejected |
| `addRecurrence(r): Recurrence` | Creates a rule; the ONLY place `remindTime` is written |
| `setRecurrenceEnd(id, {on} \| {after} \| null)` | Sets or clears the planned end (one form at a time) |
| `endRecurrence(id)` | One-way stop (`endedAt`) |
| `advanceRecurrence(id, through)` | Moves `materialisedThrough` forward only |

There is no mutator that changes a rule's `remindTime` after creation.

### `src/store/recurrence.ts`

| Function | Contract |
|---|---|
| `materialiseRecurrences()` | Creates missing occurrences up to today's period and the rule's planned end; copies `remindTime` to `remindAt` for day rules; then dedupes twins |
| `startRecurrenceLoop()` | Runs once, then on day rollover (60 s poll), remote updates (debounced 800 ms) and visibility |
| `nextOccurrence`, `occurrenceKey`, `occurrencesThrough`, `lastOccurrence`, `isSpent` | Cadence maths on period keys |
| `skipOccurrence(rule, occKey)` | Skips one future occurrence |
| `ruleSentence`, `repeatCaption`, `endClause`, `cadenceLabel`, `matchingRule` | Display and matching helpers |
| `recentDedupes()` | Last 50 dedupe decisions (also `window.__journletDedupeLog`) |

### `src/store/reminders.ts`

| Function | Contract |
|---|---|
| `checkReminders()` | Fires due, open, not-yet-fired reminders; marks stale recurring ones (earlier day) seen without firing; one-off reminders still fire late |
| `startReminderLoop()` | Runs once, then every 30 s and on visibility |
| `notificationsSupported`, `notificationPermission`, `requestNotificationPermission` | Permission helpers |

## Data Contracts

- `Entry.remindAt?: number` — absolute epoch milliseconds.
- `Recurrence.remindTime?: string` — `"HH:MM"`, local clock; parsed by `remindAtFor` with `^(\d{2}):(\d{2})$`.
- Fired record: `{ [key]: remindAt }`, key `rec:<ruleId>:<pageKey>` for occurrences or the entry id for one-off entries.
