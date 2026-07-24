-- Journlet Supabase schema. Paste the whole file into the SQL Editor and run.
-- Server stores ciphertext only: the wrapped journal key and encrypted CRDT
-- update blobs. Every table has RLS restricting rows to their owner.

-- One row per user: the data key wrapped by the keeper (journal) key.
create table if not exists public.journals (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  wrapped_key jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.journals enable row level security;

create policy "select own journal" on public.journals
  for select using (auth.uid() = user_id);
create policy "insert own journal" on public.journals
  for insert with check (auth.uid() = user_id);
create policy "update own journal" on public.journals
  for update using (auth.uid() = user_id);

-- Append-only log of encrypted CRDT updates (base64 text payloads).
-- `volume` partitions the log into notebooks (remediation item 15): entries and
-- recurrences belong to a volume, so opening a new volume never re-encrypts an
-- old one. All current data is volume 'v1' (the default keeps existing rows and
-- the local IndexedDB doc name unchanged). Collections/habits will later use a
-- permanent 'shared' volume; see docs/volume-schema-design.md.
create table if not exists public.journal_updates (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  volume text not null default 'v1',
  payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists journal_updates_user_volume_idx
  on public.journal_updates (user_id, volume, id);

-- Migration for an existing database (safe to run repeatedly): add the column,
-- backfill via its default, and swap the index. RLS and Realtime are unchanged.
alter table public.journal_updates
  add column if not exists volume text not null default 'v1';
drop index if exists public.journal_updates_user_idx;

alter table public.journal_updates enable row level security;

create policy "select own updates" on public.journal_updates
  for select using (auth.uid() = user_id);
create policy "insert own updates" on public.journal_updates
  for insert with check (auth.uid() = user_id);

-- Realtime: broadcast inserts so other devices pick changes up live.
alter publication supabase_realtime add table public.journal_updates;
