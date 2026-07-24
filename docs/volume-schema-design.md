**Confidentiality: Internal | Status: APPROVED**

# Yearly volumes — schema design (remediation item 15)

A design for splitting the journal into "volumes" (notebooks that fill and are replaced), written to be decided now while it is cheap and built (the volume-close ritual) later, before the current volume grows heavy. Grounded in the current code: one `Y.Doc` (`journlet-journal-v1`) with four Y.Arrays (`entries`, `collections`, `habits`, `recurrences`), persisted to IndexedDB, synced as an append-only `journal_updates` log keyed only by `user_id`, plus a one-row-per-user `journals` table holding the wrapped data key.

**Decisions locked (24 Jul 2026, Gary).** Recorded in the "Decisions" section below. This section supersedes the earlier calendar-year proposal.

## Why decide now

The only real cost of item 15 is the one-time split of accumulated data, and that cost is at its floor today. The app launched in July 2026, so **all current data belongs to a single volume.** Retrofitting the volume axis now is just relabelling: no data moves, nothing is re-encrypted. If we wait, one doc accumulates more and more, and eventually splitting it means a client-side decrypt-rebuild-re-encrypt pass (the server holds ciphertext only and cannot help), coordinated across a user's devices. The plumbing is cheap now and expensive later, even though the feature itself has no urgency until the volume grows large.

## The model in one paragraph

A **volume** is a notebook: an opaque sequential id (`v1`, `v2`, …) with a human label the user can set ("2026", "Volume 1"). Each volume is its own `Y.Doc` with its own IndexedDB name and its own stream of encrypted updates, all decrypted with the same per-user data key. One volume is **active**; past volumes are **archived, read-only**. A volume is not tied to the calendar: the user closes the current one and starts a fresh one whenever they choose (the migration ritual), and the app nudges them to do so once the volume grows large (the growth cap). Collections and habits do not live in any volume: they sit in a single permanent store that never closes, so lists span notebooks and habit streaks survive a close. Closing a volume carries open tasks, future-dated entries and active recurrence rules forward into the new one and leaves the old one intact (honest history, per spec §4.3).

## Decisions

1. **Boundary — user-triggered close, nudged by size.** No calendar boundary. The user deliberately closes the active volume and opens a fresh one; the app prompts when the volume (entry count / update-log size) grows large enough to be worth closing. Faithful to filling a physical notebook, and caps growth by actual usage rather than an arbitrary date. Volume identity is an opaque id plus a user-editable label.

2. **Open tasks — carry forward, originals stay.** On close, open tasks are copied into the new volume as fresh open entries; the originals stay in the closed volume marked `>` (`<` if future-dated). Reuses the shipped `migrateEntry` logic. Honest history preserved.

3. **Collections and habits — permanent cross-volume store.** They live in an always-open store alongside the active volume, never closing. Lists span volumes and habit streaks survive a close. (Rejected: binding them to a volume, which would reset streaks; and carry-forward-on-close, which would duplicate history and complicate mark continuity.)

4. **Recurrence rules — carry forward and re-anchor.** On close, active rules are copied into the new volume with their anchor moved forward; ended rules stay behind. A daily recurrence keeps going across a close.

5. **Future-dated entries — fold into carry-forward.** With no automatic calendar cutover, future-dated entries simply carry into the new volume alongside open tasks when the user closes a volume. No separate rule needed.

## Schema change to make now (minimal)

The smallest delta that stops the model assuming a single doc:

- **`journal_updates` gains a `volume` column** (text, e.g. `'v1'` or `'shared'`), with the index becoming `(user_id, volume, id)`. Backfill every existing row to `'v1'`. RLS is unchanged (still `auth.uid() = user_id`); Realtime is unchanged, the client simply filters its subscription to the active volume plus the permanent `shared` store (archived volumes rarely emit updates).
- **`journals` stays one row per user.** The data key is shared across a user's volumes, so QR/link key-sharing and the lost-device flow are untouched. Only the update stream is partitioned.
- **Client:** doc name becomes `journlet-journal-<volume>`; a small `activeVolume` pointer and the volume label live in `localStorage` (alongside the sticky-capture prefs); the `collections` and `habits` arrays move to the permanent `shared` volume doc, leaving `entries` and `recurrences` per-volume. Existing local data is adopted under `'v1'` on first run.

Because all current data is one volume, this migration is a relabel with no data movement. That is the whole reason to do it now.

## What we build later (before the volume grows heavy)

The **close-volume ritual**, as a deliberate, user-triggered action (never automatic, to avoid a multi-device race): create the next volume, carry open tasks, future-dated entries and active rules forward (decisions 2, 4, 5), write a `closed` marker into the old volume so re-running is a no-op and the old volume renders read-only, and switch `activeVolume`. Plus the size nudge, an archive browser (open a past volume read-only), volume labelling, and the index/menu affordances to move between volumes.

## Effort and risks

- **Schema + client plumbing (now):** small–medium. Additive migration, no data movement, no key changes.
- **Close-volume ritual + archive UI (later):** medium. Idempotency (the `closed` marker) and the carry-forward set are the fiddly parts; single-device triggering keeps the CRDT clean.
- **Ordering:** land this before shared journals (item 14). Sharing also touches every table, so doing volumes first means the schema is partitioned once, not twice.

## Recommended sequence

Decisions approved → land the additive `volume` schema change and client doc-naming now (cheap, all data is one volume) → resume items 7 and 9 as normal backlog → build the close-volume ritual, size nudge and archive UI later, before the active volume grows heavy.
