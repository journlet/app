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

-- Account deletion (remediation item 16). Deleting an auth user normally needs
-- the service role key, which cannot ship in a client-only app. A security
-- definer function is the way round it that keeps the "no server-side code"
-- constraint intact: this is a database function living beside the RLS, not an
-- Edge Function.
--
-- The function takes no arguments on purpose. It deletes auth.uid() and nothing
-- else, so a caller cannot name a victim — the only account any session can
-- destroy is its own.
--
-- The data rows are deleted explicitly even though both tables cascade from
-- auth.users (see the `on delete cascade` above). The cascade would cover it on
-- a database built from this file, but this schema is also meant to converge an
-- older project, and a table created before the cascade existed would silently
-- leave its ciphertext behind. Deleting outright costs nothing and does not
-- depend on how the database got here. It all runs in one transaction, so a
-- failure at any point leaves the account exactly as it was.
--
-- search_path is pinned empty and every name fully qualified, which is the
-- standard hardening for security definer: without it a caller could put a
-- malicious `auth` or `public` schema ahead on the path and have it run with
-- the owner's rights.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.journal_updates where user_id = uid;
  delete from public.journals where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to anon,
-- authenticated and service_role, so the revoke is load-bearing rather than
-- decorative: without it an unauthenticated caller could invoke this. service_role
-- keeps its grant, which is harmless — that key never ships in the client, and
-- anyone holding it can delete users directly anyway. Re-running emits a
-- "no privileges could be revoked" warning once the default grant is gone; that
-- is cosmetic and the file stays idempotent.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- Realtime: broadcast inserts so other devices pick changes up live. Guarded so
-- re-running doesn't error on the table already being a publication member.
--
-- `journals` is published too (28 Jul) so that reporting a lost device reaches
-- the surviving devices at once. Rotating the keeper key is already an UPDATE
-- to journals.wrapped_key, so the event that matters is one the devices can be
-- pushed directly — no revocation table, no extra column, and no Realtime
-- broadcast channel, which would have been a channel any session holder could
-- write to. RLS still limits both the row and the event to its owner.
--
-- The published row carries the wrapped key blob, which is ciphertext, and the
-- user id, which the recipient already knows. Nothing readable is added to the
-- wire that was not already there.
do $$
declare
  t text;
begin
  foreach t in array array['journal_updates', 'journals'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I', t
      );
    end if;
  end loop;
end $$;
