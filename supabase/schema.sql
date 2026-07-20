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
create table if not exists public.journal_updates (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists journal_updates_user_idx
  on public.journal_updates (user_id, id);

alter table public.journal_updates enable row level security;

create policy "select own updates" on public.journal_updates
  for select using (auth.uid() = user_id);
create policy "insert own updates" on public.journal_updates
  for insert with check (auth.uid() = user_id);

-- Realtime: broadcast inserts so other devices pick changes up live.
alter publication supabase_realtime add table public.journal_updates;
