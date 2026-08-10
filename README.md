CONFIDENTIALITY: INTERNAL
STATUS: DRAFT - UNREVIEWED

# Journlet

A bullet journal PWA that faithfully implements the Ryder Carroll method. Offline-first, CRDT-backed and end-to-end encrypted. Built against `bullet-journal-app-spec.md` v0.9; UI ported from the validated prototype v17.

## Current state

The app is well past the initial shell. What works today:

**Capture and notation.** Quick capture with the core bullet types (• task, ○ event, — note), the priority signifier (*), a scope row (today / week / month / year / specific date), and sticky capture state for adding several entries in a row. Notation is purist Ryder Carroll: symbols are never substituted, visibility is handled with weight and contrast only. Entries support an optional details field (longer notes / read-later links) opened full-screen, nested parent/child items, and inline link detection.

**The spread.** The Now Spread with a Scheduled-ahead section, tap-bullet-to-complete, and a full-screen entry view of the actions (edit, complete/reopen, move, migrate, schedule, thread, strike out, delete). That was a bottom sheet until 6 August 2026, when it was rebuilt: the sheet had grown past a phone screen without scrolling and become unscannable, so move, migrate and schedule each became a step of their own through one page picker. Delete is undoable via a six-second toast, no confirmation dialogue. A migration-review sheet prompts to migrate or drop open tasks left on past pages.

**Collections and navigation.** Index view, custom collection creation, a Collection view, the Future Log, and a back-stack for moving between views.

**Threading.** An entry can carry references to other pages — any collection or period page — added from the ⋯ entry view's "Thread to a page…" picker and listed, removably, in the view itself. This is the Carroll method's margin page number, not a move: the entry stays where it happened, keeps its glyph, and nothing is copied. The reference reads as plain words on the entry's line, and the target page lists what points at it under "Threaded here from other pages". References are inherited by a migrated copy and survive Markdown export.

**Recurrence and reminders.** Recurrence rules that materialise occurrences (with single-occurrence skip and next-occurrence logic), plus local notification reminders fired once per occurrence with permission handling.

**Sync and encryption.** End-to-end encryption — a data key wrapped by a keeper key, encrypted Yjs updates, and an exportable/importable journal key code. Supabase auth is an emailed one-time code, no passwords and no link: the templates carry the code alone, so there is nothing to tap into the wrong browser. Multi-device key sharing is by journal key or QR code, and a device is only given the data key once it has proved it can already read the journal. The app publishes sync status and the last server error as one observable value, shows a "not syncing" banner that distinguishes being signed out from having been refused by the server, supports lost-device recovery, and wipes the local journal and keys on sign-out. Everything works locally before any account exists, though an account is required to get started.

**PWA and platform.** Installable PWA with an add-to-home-screen prompt, a service worker that prompts rather than reloading under you, with a "new version available" banner and a manual update check. Markdown export of the journal, which is a rendering and not a backup, and a separate `.journlet` snapshot which is: it round-trips through the same CRDT and refuses a file that is not one. Storage metrics in the menu: entries, document size and sync updates on this device, and the space used on the server against the account's limit.

**Server-side storage quota.** Each account is capped, 5 MB by default and held per row in `public.user_usage` so one account can be raised without a migration. A trigger on `journal_updates` accumulates payload sizes and refuses past the cap; the total is recomputed from the log every time `schema.sql` is applied, so it cannot drift permanently. This exists because registration is open and the update log is append-only: without it one account could consume a free-tier project and every other account's writes would start failing. The Menu warns past 80%, which is roughly a year of writing before the cap at observed rates.

Persistence is a Yjs CRDT document stored in IndexedDB via y-indexeddb — the same document that is encrypted client-side and synced through Supabase, so the server only ever holds ciphertext.

## Stack

React 19 + TypeScript + Vite, vite-plugin-pwa (Workbox, prompt-to-update service worker), Yjs + y-indexeddb for the offline-first CRDT store, and @supabase/supabase-js for auth and the encrypted sync relay.

## Develop

```
npm install
npm run dev      # local dev server
npm run build    # type-check + production build into dist/ (adds 404.html fallback)
npm run icons    # regenerate PWA icons from the SVG mark
```

## Enable sync (Supabase)

One-time setup, all in the Supabase dashboard:

1. SQL Editor → paste and run `supabase/schema.sql` (tables, RLS, realtime, storage quota). Then paste `supabase/verify.sql`, which changes nothing and should report every row `ok = true`. Re-running `schema.sql` is safe and is also how a drifted usage total is repaired.
2. Authentication → Sign In / Up: enable Email. Both templates must carry `{{ .Token }}` and no link, which is a control rather than a preference: a link cannot be tapped into the wrong browser if the email does not contain one.
3. Authentication → URL Configuration: set Site URL to `https://app.journlet.com`.
4. Authentication → Rate Limits: sign-ups and sign-ins at 5 per 5 minutes per IP, emails at 25 an hour. The ratio matters more than either number. Left at the defaults the per-IP limit is looser than the project-wide email budget it feeds, so one address can spend an hour of email in five minutes.
5. Project Settings → API: copy the project URL and anon key into `src/lib/supabaseConfig.ts`, **and the same host into the `connect-src` directive of the CSP meta tag in `index.html`**, then commit and push. Both files, or sync fails silently: the CSP blocks the request before Supabase sees it, so there is no server error to report and the not-syncing banner cannot say why. Both values are safe to publish, RLS and E2EE do the guarding.

In the app: Sync → enter your email → type the emailed code. First device publishes its wrapped journal key; on any new device, sign in and paste the journal key (Sync → show journal key on the old device). Save that key somewhere safe — losing every device and the key means the journal is unrecoverable, by design.

## Run with Docker

```
docker compose up dev            # hot-reload dev server → http://localhost:5173
docker compose --profile web up --build   # production build via nginx → http://localhost:8080
```

The dev service mounts the source and keeps its own `node_modules` volume, so host and container installs never clash. The web service is a multi-stage build (Node builds `dist/`, nginx serves it with SPA fallback and sensible caching: `index.html` and `sw.js` uncached, hashed assets immutable).

Note: the service worker registers on localhost, but installability and full PWA behaviour need HTTPS — use the journlet.com deployment for phone installs.

## Deploy (GitHub Pages at app.journlet.com)

The repo deploys via `.github/workflows/deploy.yaml`: every push to `main` builds and publishes `dist/` to GitHub Pages. One-time setup:

1. Create the repo and push: `git remote add origin git@github.com:journlet/app.git && git push -u origin main`
2. In the repo, Settings → Pages → Source: **GitHub Actions**.
3. DNS at your registrar: a CNAME record for `app` pointing to `journlet.github.io`. (The apex journlet.com serves the landing page from journlet/site — four A records to 185.199.108.153 / .109 / .110 / .111.153 when needed.)
4. Settings → Pages → Custom domain: enter `app.journlet.com` (the `public/CNAME` file keeps it set across deploys) and tick **Enforce HTTPS** once the certificate is issued.

Then install on your phone: open https://app.journlet.com in Safari (iOS) → Share → Add to Home Screen, or Chrome (Android) → Install app.

## Notes

- Purist notation rule: symbols are never substituted; visibility is handled with weight, size and contrast only.
- Every action is plainly labelled; destructive delete is undoable via toast, no confirmation dialogue.
- Fraunces and Public Sans are self-hosted from `public/fonts` (SIL Open Font License, copies alongside). No third-party origin appears anywhere in the CSP: the Supabase project is the only external host the app can reach, and it only ever receives ciphertext.
