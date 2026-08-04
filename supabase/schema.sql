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
-- permanent 'shared' volume; see spec/volume-schema-design.md.
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

-- Per-device keys (spec/device-identity-design.md, steps 2 and 3). These exist
-- so that one device can be signed out without locking out the rest: with a
-- single shared keeper key the only lever is rotating it, which hits everything
-- at once.
--
-- All three tables are readable and writable by any device signed in to the
-- account, because RLS can only see auth.uid() — there is no device identity in
-- the JWT to narrow it with. That is not the weakness it looks like. Public keys
-- are public by construction, and a device can read every wrapped blob but can
-- only *unwrap* the one bound to its own device id.

-- One row per device: its public ECDH key, raw P-256 point, base64.
create table if not exists public.device_keys (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id  text not null,
  public_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.device_keys enable row level security;

drop policy if exists "read own device keys" on public.device_keys;
create policy "read own device keys" on public.device_keys
  for select using (auth.uid() = user_id);
drop policy if exists "write own device keys" on public.device_keys;
create policy "write own device keys" on public.device_keys
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own device keys" on public.device_keys;
create policy "update own device keys" on public.device_keys
  for update using (auth.uid() = user_id);
drop policy if exists "delete own device keys" on public.device_keys;
create policy "delete own device keys" on public.device_keys
  for delete using (auth.uid() = user_id);

-- The data key, wrapped so that exactly one device can open it. Ciphertext
-- only: { v, epk, salt, iv, blob }, all base64.
create table if not exists public.device_wrapped_keys (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id  text not null,
  wrapped    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.device_wrapped_keys enable row level security;

drop policy if exists "read own wrapped keys" on public.device_wrapped_keys;
create policy "read own wrapped keys" on public.device_wrapped_keys
  for select using (auth.uid() = user_id);
drop policy if exists "write own wrapped keys" on public.device_wrapped_keys;
create policy "write own wrapped keys" on public.device_wrapped_keys
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own wrapped keys" on public.device_wrapped_keys;
create policy "update own wrapped keys" on public.device_wrapped_keys
  for update using (auth.uid() = user_id);
drop policy if exists "delete own wrapped keys" on public.device_wrapped_keys;
create policy "delete own wrapped keys" on public.device_wrapped_keys
  for delete using (auth.uid() = user_id);

-- Data key epochs (spec/device-identity-design.md, steps 4 and 5). Rotating the
-- data key is what makes removing a device mean anything: without it a removed
-- device keeps the only key there is and carries on reading everything.
--
-- Epoch 0 is not stored here. It lives in journals.wrapped_key, where it already
-- is, so nothing existing has to move and an account that has never rotated has
-- no rows in this table at all. The current epoch is therefore the highest epoch
-- here, or 0 when it is empty.
create table if not exists public.journal_keys (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  epoch       int not null,
  wrapped_key jsonb not null,       -- the data key wrapped by the keeper key
  created_at  timestamptz not null default now(),
  primary key (user_id, epoch)
);

alter table public.journal_keys enable row level security;

drop policy if exists "read own journal keys" on public.journal_keys;
create policy "read own journal keys" on public.journal_keys
  for select using (auth.uid() = user_id);
drop policy if exists "write own journal keys" on public.journal_keys;
create policy "write own journal keys" on public.journal_keys
  for insert with check (auth.uid() = user_id);

-- No update and no delete policy, deliberately. An epoch's wrapped key is
-- write-once: changing one would make every row written under it unreadable, and
-- deleting one would strip the recovery code of its access to that stretch of the
-- journal. Retention is the decision recorded in the design doc.

-- A device holds one wrapped key per epoch it is entitled to, not just the
-- newest, because history has to stay readable. Existing rows are epoch 0, which
-- the default supplies.
alter table public.device_wrapped_keys
  add column if not exists epoch int not null default 0;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'device_wrapped_keys_pkey'
      and conrelid = 'public.device_wrapped_keys'::regclass
      and array_length(conkey, 1) = 2
  ) then
    alter table public.device_wrapped_keys
      drop constraint device_wrapped_keys_pkey,
      add primary key (user_id, device_id, epoch);
  end if;
end $$;

-- A device asking to be let in, pending approval on a device already trusted.
--
-- `client` is plaintext, and is the one deliberate metadata addition in the
-- whole design: an approval prompt that cannot say what is asking is a prompt
-- nobody can judge, and the asking device has no key yet so it cannot write into
-- the encrypted journal. Mitigated by being ephemeral — the client enforces a
-- thirty minute expiry and deletes the row on approval or rejection — so the
-- server learns "something calling itself Safari on iOS asked to link at 14:32"
-- for half an hour, and nothing about content.
create table if not exists public.device_link_requests (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id    text not null,
  public_key   text not null,
  client       text,
  requested_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.device_link_requests enable row level security;

drop policy if exists "read own link requests" on public.device_link_requests;
create policy "read own link requests" on public.device_link_requests
  for select using (auth.uid() = user_id);
drop policy if exists "write own link requests" on public.device_link_requests;
create policy "write own link requests" on public.device_link_requests
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own link requests" on public.device_link_requests;
create policy "update own link requests" on public.device_link_requests
  for update using (auth.uid() = user_id);
drop policy if exists "delete own link requests" on public.device_link_requests;
create policy "delete own link requests" on public.device_link_requests
  for delete using (auth.uid() = user_id);

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
  delete from public.device_link_requests where user_id = uid;
  delete from public.journal_keys where user_id = uid;
  delete from public.device_wrapped_keys where user_id = uid;
  delete from public.device_keys where user_id = uid;
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
-- Only journal_updates is published. `journals` was briefly published too, to
-- push key changes at surviving devices, and that went with the machinery it
-- served (28 Jul, see spec §6.1b). If a project already has it published, that
-- is harmless: nothing subscribes to it. To tidy it up:
--   alter publication supabase_realtime drop table public.journals;
--
-- device_link_requests and device_wrapped_keys are published too, and both are
-- load-bearing rather than a nicety: an approval prompt that only appears when
-- the trusted device happens to relaunch would leave someone holding a phone
-- that says "waiting" with nothing to wait for, and the new device needs to
-- notice its wrapped key the moment it is granted. Foreground polling remains
-- the floor under both, since a backgrounded PWA misses realtime entirely and
-- there is no replay (spec §6.1a).
do $$
declare
  t text;
begin
  foreach t in array array[
    'journal_updates', 'device_link_requests', 'device_wrapped_keys'
  ] loop
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
