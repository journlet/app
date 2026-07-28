CONFIDENTIALITY: INTERNAL
STATUS: DRAFT - UNREVIEWED

# Journlet

A bullet journal PWA that faithfully implements the Ryder Carroll method. Offline-first, CRDT-backed, and (eventually) end-to-end encrypted. Built against `bullet-journal-app-spec.md` v0.9; UI ported from the validated prototype v17.

## Current state

The app is well past the initial shell. What works today:

**Capture and notation.** Quick capture with the core bullet types (• task, ○ event, — note), the priority signifier (*), a scope row (today / week / month / year / specific date), and sticky capture state for adding several entries in a row. Notation is purist Ryder Carroll: symbols are never substituted, visibility is handled with weight and contrast only. Entries support an optional details field (longer notes / read-later links) opened full-screen, nested parent/child items, and inline link detection.

**The spread.** The Now Spread with a Scheduled-ahead section, tap-bullet-to-complete, and a bottom-sheet of entry actions (edit, complete/reopen, move, cycle type, strike out, delete). Delete is undoable via a six-second toast, no confirmation dialogue. A migration-review sheet prompts to migrate or drop open tasks left on past pages.

**Collections and navigation.** Index view, custom collection creation, a Collection view, the Future Log, and a back-stack for moving between views.

**Threading.** An entry can carry references to other pages — any collection or period page — from the ⋯ sheet's "Thread to a page" group. This is the Carroll method's margin page number, not a move: the entry stays where it happened, keeps its glyph, and nothing is copied. The reference reads as plain words on the entry's line, and the target page lists what points at it under "Threaded here from other pages". References are inherited by a migrated copy and survive Markdown export.

**Recurrence and reminders.** Recurrence rules that materialise occurrences (with single-occurrence skip and next-occurrence logic), plus local notification reminders fired once per occurrence with permission handling.

**Sync and encryption.** End-to-end encryption — a data key wrapped by a keeper key, encrypted Yjs updates, and an exportable/importable journal key code. Supabase auth is email magic links (no passwords), with multi-device key sharing via the journal key or QR code. The app tracks sync status, shows a "not syncing" banner when signed out, supports lost-device recovery, and wipes the local journal and keys on sign-out. Everything works fully offline before any account exists.

**PWA and platform.** Installable PWA with an add-to-home-screen prompt, an auto-updating service worker with a "new version available" banner and a manual update check, Markdown export of the journal, and storage/volume metrics in the menu (entries, doc KB, sync updates).

Persistence is a Yjs CRDT document stored in IndexedDB via y-indexeddb — the same document that is encrypted client-side and synced through Supabase, so the server only ever holds ciphertext.

## Stack

React 19 + TypeScript + Vite, vite-plugin-pwa (Workbox, auto-update service worker), Yjs + y-indexeddb for the offline-first CRDT store, and @supabase/supabase-js for auth and the encrypted sync relay.

## Develop

```
npm install
npm run dev      # local dev server
npm run build    # type-check + production build into dist/ (adds 404.html fallback)
npm run icons    # regenerate PWA icons from the SVG mark
```

## Enable sync (Supabase)

One-time setup, all in the Supabase dashboard:

1. SQL Editor → paste and run `supabase/schema.sql` (tables + RLS + realtime).
2. Authentication → Sign In / Up: enable Email with magic links (no passwords).
3. Authentication → URL Configuration: set Site URL to `https://app.journlet.com`.
4. Project Settings → API: copy the project URL and anon key into `src/lib/supabaseConfig.ts`, commit and push. Both values are safe to publish — RLS and E2EE do the guarding.

In the app: Sync → enter your email → tap the emailed link. First device publishes its wrapped journal key; on any new device, sign in and paste the journal key (Sync → show journal key on the old device). Save that key somewhere safe — losing every device and the key means the journal is unrecoverable, by design.

## Run with Docker

```
docker compose up dev            # hot-reload dev server → http://localhost:5173
docker compose --profile web up --build   # production build via nginx → http://localhost:8080
```

The dev service mounts the source and keeps its own `node_modules` volume, so host and container installs never clash. The web service is a multi-stage build (Node builds `dist/`, nginx serves it with SPA fallback and sensible caching: `index.html` and `sw.js` uncached, hashed assets immutable).

Note: the service worker registers on localhost, but installability and full PWA behaviour need HTTPS — use the journlet.com deployment for phone installs.

## Deploy (GitHub Pages at journlet.com)

The repo deploys via `.github/workflows/deploy.yml`: every push to `main` builds and publishes `dist/` to GitHub Pages. One-time setup:

1. Create the repo and push: `git remote add origin git@github.com:journlet/app.git && git push -u origin main`
2. In the repo, Settings → Pages → Source: **GitHub Actions**.
3. DNS at your registrar: a CNAME record for `app` pointing to `journlet.github.io`. (The apex journlet.com is reserved for a future landing page — four A records to 185.199.108.153 / .109 / .110 / .111.153 when needed.)
4. Settings → Pages → Custom domain: enter `app.journlet.com` (the `public/CNAME` file keeps it set across deploys) and tick **Enforce HTTPS** once the certificate is issued.

Then install on your phone: open https://app.journlet.com in Safari (iOS) → Share → Add to Home Screen, or Chrome (Android) → Install app.

## Notes

- Purist notation rule: symbols are never substituted; visibility is handled with weight, size and contrast only.
- Every action is plainly labelled; destructive delete is undoable via toast, no confirmation dialogue.
- Fraunces and Public Sans are self-hosted from `public/fonts` (SIL Open Font License, copies alongside). No third-party origin appears anywhere in the CSP: the Supabase project is the only external host the app can reach, and it only ever receives ciphertext.
