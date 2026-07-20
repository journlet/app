CONFIDENTIALITY: INTERNAL
STATUS: DRAFT - UNREVIEWED

# Journlet

A bullet journal PWA that faithfully implements the Ryder Carroll method. Offline-first, CRDT-backed, and (eventually) end-to-end encrypted. Built against `bullet-journal-app-spec.md` v0.9; UI ported from the validated prototype v17.

## Current state (build order step 1)

PWA shell plus the Now Spread with quick capture: entry types (• task, ○ event, — note), priority signifier (*), scope row (today / week / month / year / date…), sticky capture state, tap-bullet-to-complete, bottom-sheet entry actions (edit, complete/reopen, move, strike out, delete with six-second undo), migration review for open tasks on past pages, and the Scheduled ahead section.

Persistence is local-only: a Yjs CRDT document stored in IndexedDB via y-indexeddb. This is the same document that will later be encrypted client-side and synced through Supabase Realtime, so no data migration will be needed. No Supabase, no accounts, no server code yet.

## Stack

React 19 + TypeScript + Vite, vite-plugin-pwa (Workbox, auto-update service worker), Yjs + y-indexeddb.

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
- Google Fonts (Fraunces, Public Sans) are loaded from fonts.googleapis.com for now; self-hosting them is a candidate for the CSP-hardening pass (spec build step 8).
