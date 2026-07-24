-- Journlet Supabase schema. Paste the whole file into the SQL Editor and run.
-- Safe to run on a fresh project or an existing one: every statement is
-- idempotent (guarded creates, drop-and-recreate policies, conditional
-- publication add), so re-running only ever converges the schema.
-- Server stores ciphertext only: the wrapped journal key and encrypted CRDT
-- update blobs. Every table has RLS restricting rows to their owner.

-- One row per user: the data key wrapped by the keeper (journal) key.
create table if not exists public.journals (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  wrapped_key jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.journals enable row level security;

drop policy if exists "select own journal" on public.journals;
create policy "select own journal" on public.journals
  for select using (auth.uid() = user_id);
drop policy if exists "insert own journal" on public.journals;
create policy "insert own journal" on public.journals
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own journal" on public.journals;
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

-- Add `volume` on databases created before item 15 (backfills via the default),
-- then swap the old (user_id, id) index for the volume-aware one. Ordered before
-- the index create below so the column always exists first.
alter table public.journal_updates
  add column if not exists volume text not null default 'v1';
drop index if exists public.journal_updates_user_idx;

create index if not exists journal_updates_user_volume_idx
  on public.journal_updates (user_id, volume, id);

alter table public.journal_updates enable row level security;

drop policy if exists "select own updates" on public.journal_updates;
create policy "select own updates" on public.journal_updates
  for select using (auth.uid() = user_id);
drop policy if exists "insert own updates" on public.journal_updates;
create policy "insert own updates" on public.journal_updates
  for insert with check (auth.uid() = user_id);

-- Realtime: broadcast inserts so other devices pick changes up live. Guarded so
-- re-running doesn't error on the table already being a publication member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'journal_updates'
  ) then
    alter publication supabase_realtime add table public.journal_updates;
  end if;
end $$;
