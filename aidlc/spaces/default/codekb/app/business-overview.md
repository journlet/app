> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Business Overview — Journlet app

## Purpose

Journlet is an offline-first, end-to-end-encrypted bullet journal (Ryder Carroll method) delivered as a single-page progressive web app. People capture tasks, events and notes on day, week, month and year pages, migrate and schedule them, keep collections (lists and habit trackers), and sync one journal across their own devices. The server (Supabase) only authenticates and relays ciphertext; it can never read the journal.

## Key Functionality

| Capability | What the person gets | Owning component (see `component-inventory.md`) |
|---|---|---|
| Rapid logging | Entries with a type glyph (task, event, note), state (open, done, struck, migrated, scheduled), priority and details | Journal Store, Entry Actions Sheet |
| Pages and spreads | Day/week/month/year pages, future log, collections, index | App Shell, Spread Data |
| Repeating items | A rule ("every N days/weeks/months/years", optional planned end) that places one occurrence per period, never ahead of today | Recurrence Engine, Rule Actions Sheet |
| Reminders | A clock time on an entry; a local notification while the app is open; a "Due" section listing overdue and due-today items as the dependable fallback | Reminder Loop, Spread Data |
| Encrypted sync | One Yjs document, encrypted per update, relayed through Supabase, merged on every device | Sync Engine (skimmed) |
| Device and key management | Passkeys, journal-key transfer by QR, recovery code, device list | Device and Credential Registers (skimmed) |

## Business Domain Terms

- **Entry** — one logged line on a page (`Entry` in `src/lib/types.ts`).
- **Repeating item / rule** — a `Recurrence`; its materialised entries are **occurrences**, each tagged with `recurrenceId`.
- **Reminder** — on an entry, an absolute timestamp `remindAt`; on a rule, a clock time `remindTime` ("HH:MM") that is copied onto day-page occurrences when they are created.
- **Due** — overdue and due-today reminders on open entries, shown on the spread.

## Business Context for the Active Intent (`261023-series-reminders`)

The intent is to let a person choose, when adding, changing or removing a reminder on an entry of a repeating item, between "this entry only" and "the whole repeating item from this occurrence onward", from the entry and from the repeating item's own settings. Today the code supports only the first: the entry reminder path writes one entry, and a rule's own reminder can be set only when the repeat is created. The gap and its constraints are recorded once in `architecture.md` (Interaction Diagrams and Key Design Decisions) and `code-quality-assessment.md` (Technical Debt).

## Users and Data Sensitivity

Personal journal content, encrypted on the device before it leaves. No server-side processing of content. Personal data is present on devices and as ciphertext at rest in Supabase.
