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

-- delete_code is dropped, along with delete_account() and set_delete_code()
-- further down (assessment Finding 24, settled 11 August 2026).
--
-- The column held SHA-256 of a label and the keeper key, and delete_account()
-- compared what a caller presented against it. The idea was that reaching the
-- mailbox should not be enough to destroy the server copy, since no backup sits
-- behind it. It did not work: the select policy on this table lets a device read
-- its own row, and Supabase's default grants cover every column, so the caller
-- could read the very value it was supposed to prove it knew and hand it back.
-- Two API calls.
--
-- Rather than store a verifier and defend it, account deletion left the app. It
-- is a request to the operator, with notice to the registered address and a wait
-- before anything is removed, and there is no longer any function for a mailbox
-- to call. Signing out still clears a device, and export still produces a
-- readable copy.
--
-- Dropped rather than left unused, because a definer granted to authenticated
-- that destroys an account is not made safe by nothing calling it.
alter table public.journals
  drop column if exists delete_code;

alter table public.journals enable row level security;

drop policy if exists "select own journal" on public.journals;
create policy "select own journal" on public.journals
  for select using (auth.uid() = user_id);
drop policy if exists "insert own journal" on public.journals;
create policy "insert own journal" on public.journals
  for insert with check (auth.uid() = user_id);
-- No update policy, and no delete policy. journals.wrapped_key is the data key
-- for epoch 0, which is where an account that has never rotated keeps
-- everything. Overwriting it destroys access to that stretch of the journal
-- irrecoverably, and nothing in the client ever wanted to: the only statements
-- against this table are two selects and one insert. journal_keys is already
-- write-once for exactly this reason (see below); this makes the table holding
-- epoch 0 match the rule rather than sit outside it.
--
-- Re-running this file on a project created before 4 Aug 2026 drops the old
-- policy, which is the point.
drop policy if exists "update own journal" on public.journals;

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

-- Per-account storage quota.
--
-- journal_updates is append-only and unbounded, and registration is open, so one
-- account can consume the whole 500 MB of a free-tier project and every other
-- account's writes start failing. Rate limits do not help: they slow how fast an
-- account can be created, not how much a patient one can store.
--
-- 5 MB, chosen from measurement and then from what the number is for.
--
-- Six weeks of real daily use on this project is 407 updates and 127 kB, about
-- 311 bytes an update and roughly 1.1 MB a year. A finished notebook becomes
-- another volume rather than disappearing, so that accrues indefinitely. 5 MB is
-- therefore about four and a half years at that rate, eighteen months for someone
-- writing three times as much, and it takes a hundred accounts to threaten the
-- database rather than twenty-five at 20 MB.
--
-- The reason not to be more generous is that a cap nobody reaches protects
-- nothing and reports nothing. An account that reaches this one after eighteen
-- months of heavy use is the moment to talk about paying for the app, and the
-- aggregate forces that conversation anyway: fifty accounts at 5 MB is 250 MB of
-- a 500 MB project regardless of who is heavy.
--
-- Low is also the safer of the two mistakes. quota_bytes is a column, so raising
-- one account is an UPDATE. Lowering is not: an account already holding 15 MB
-- would sit permanently over a smaller cap, unable to write and unable to prune,
-- since the log has no delete policy. Too low costs a message and one row; too
-- high costs an account that cannot be repaired.
--
-- What makes 5 MB humane rather than mean is the runway. 80% of it is 4 MB and
-- the last megabyte is nearly a year of writing, so a warning at 80% gives months
-- of notice, which the Menu now shows. verify.sql's check only tells the operator.
--
-- What was proven before this shipped, recorded here because the harness that
-- proved it has been removed rather than kept as a file nobody could easily run.
-- Against PostgreSQL 16.13 with an auth schema scaffolded to match Supabase: this
-- file applies twice cleanly; the counter accumulates across inserts; an insert
-- over the cap raises 53100 and the row does not land; an insert that still fits
-- is allowed; another account is unaffected; a user updating their own
-- quota_bytes changes no rows; the seed repairs a counter set to the wrong value;
-- deleting an account removed the usage row, back when a function did that; and
-- the refusal message carries both
-- the contact address and the reassurance. Each was confirmed to fail when the
-- thing it checked was disabled, including replacing the comparison below with
-- `if false`. Reproduce by pointing a scratch Postgres at this file.
--
-- One wrinkle to expect near the cap, because it does not look like a limit.
-- Payloads are not uniform: the average is 311 bytes and the largest so far is
-- 25 kB, a full-journal push from a re-link or a format migration, and that grows
-- with the document. So an account at 9.98 MB can keep typing and still fail to
-- re-link a device. verify.sql's 80% check and the Menu's readout exist so that
-- is seen coming rather than met.
--
-- Honest about what this is not: the log cannot be pruned, by design, since
-- journal_updates has no delete policy. So a quota on it is a countdown and not
-- a limit, and the thing that would make it permanent is server-side compaction,
-- which means building exactly what the append-only design exists to prevent.
-- Worth designing when there are users, not before.
create table if not exists public.user_usage (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  bytes       bigint not null default 0,
  quota_bytes bigint not null default 5242880,
  updated_at  timestamptz not null default now()
);

alter table public.user_usage enable row level security;

-- Readable by its owner so the app can show how full a journal is, and writable
-- by nobody: the only writer is the trigger below, which runs as definer. A user
-- who could update this row could raise their own quota.
drop policy if exists "select own usage" on public.user_usage;
create policy "select own usage" on public.user_usage
  for select using (auth.uid() = user_id);

create or replace function public.account_for_journal_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used bigint;
  cap  bigint;
  size bigint := octet_length(new.payload);
begin
  insert into public.user_usage (user_id) values (new.user_id)
  on conflict (user_id) do nothing;

  -- for update, so two devices pushing at once cannot both read the old total
  -- and both be allowed through it.
  select bytes, quota_bytes into used, cap
    from public.user_usage where user_id = new.user_id for update;

  if used + size > cap then
    -- pg_size_pretty rather than arithmetic, and qualified because search_path
    -- is empty here. A hand-rolled MB conversion reads "0.0 of 0.0 MB" for any
    -- cap under a megabyte, which is what a test with a small cap surfaced.
    raise exception
      'Journal storage limit reached: % of % used on the server. Nothing has been lost and this device still holds your journal, but new writing is not reaching the server. Email hello@journlet.com to have your limit raised.',
      pg_catalog.pg_size_pretty(used), pg_catalog.pg_size_pretty(cap)
      using errcode = '53100';
  end if;

  update public.user_usage
     set bytes = bytes + size, updated_at = now()
   where user_id = new.user_id;

  return new;
end;
$$;

-- Deliberately no revoke on this function, unlike the account-deletion function
-- that used to sit below. PostgreSQL
-- checks EXECUTE on a trigger function against the table owner rather than the
-- inserting user, and PL/pgSQL refuses to run a trigger function called
-- directly, so a revoke would buy nothing and risks breaking every insert.
drop trigger if exists journal_updates_quota on public.journal_updates;
create trigger journal_updates_quota
  before insert on public.journal_updates
  for each row execute function public.account_for_journal_update();

-- Seed, and self-heal. Recomputed from the log on every apply, so the counter
-- cannot drift permanently: if it is ever wrong, running this file fixes it.
insert into public.user_usage (user_id, bytes)
select user_id, sum(octet_length(payload)) from public.journal_updates group by user_id
on conflict (user_id) do update set bytes = excluded.bytes, updated_at = now();

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


-- Data key epochs (spec/device-identity-design.md, steps 4 and 5).
--
-- Written to make removing a device mean something: rotating the data key was what
-- denied a removed device future content. §12.1 phase 7 ended that on 14 August 2026,
-- because every device now holds the keeper key and can read any row here, so nothing
-- rotates any more and the client only reads this table. Existing rows stay readable
-- and are the reason it is not dropped with the other three.
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

-- The three tables approval needed are gone (§12.1 phase 7, 14 August 2026).
--
-- `device_keys` held a public key per device, `device_wrapped_keys` held the data key
-- wrapped to each of those, and `device_link_requests` held a device asking to be let
-- in. Together they were §6.1d's grants: the machinery that let a device read the
-- journal without ever holding the keeper key. Two routes remain, a passkey and the
-- journal key, and both hand the keeper key over — so a device either can open the
-- journal itself or cannot open it at all, and there is nothing left for a grant to
-- express.
--
-- Dropped rather than left empty. An unused table is a table something will eventually
-- write to, and §6.5's register would have to keep classifying its columns for ever.
-- `journal_keys` survives and is read by every device: an epoch's data key wrapped
-- under the keeper key needs no per-device copy.
--
-- Order matters on a live database: drop the dependent table first. Neither is
-- referenced by anything that remains, so this is safe to run twice.
drop table if exists public.device_wrapped_keys;
drop table if exists public.device_keys;
drop table if exists public.device_link_requests;

-- The keeper key, wrapped so that one passkey can open it (spec §6.1e).
--
-- The keeper key sits at the top of the hierarchy: it wraps the data key for
-- every epoch, so whoever holds it can read the whole journal and produce the
-- journal key code. Until this table there was exactly one way to hold it, which
-- was to have been shown that code once and kept it. A test account was lost that
-- way on 11 August 2026.
--
-- The WebAuthn PRF extension returns the same 32 bytes from a passkey on every
-- device it syncs to, and never leaves the device. Those bytes wrap the keeper
-- key, so it stops being something a person keeps and becomes something a device
-- obtains after a biometric check.
--
-- One row per enrolled credential, plus the journal key code, and any single one
-- of them opens the journal. Not one, and not all: there is no main device and no
-- root device. Deleting a row withdraws a route and locks nobody out.
--
-- wrap_id has no default on purpose. It goes inside the AES-GCM additional
-- authenticated data, so it has to exist before the ciphertext does; a
-- gen_random_uuid() default would mean encrypting against an id the server had
-- not chosen yet and then trusting what came back.
--
-- Nothing else is on the row. No credential id and no label, per §6.5: either
-- would tell the server which password manager somebody uses or what their
-- devices are called. So a device unlocking cannot look its wrap up and tries
-- each row instead, letting authentication pick. Which wrap belongs to which
-- device is recorded in the device register, inside the encrypted journal.
create table if not exists public.keeper_wraps (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  wrap_id    uuid not null,
  wrapped    jsonb not null,        -- { v, salt, iv, blob }, all base64
  created_at timestamptz not null default now(),
  primary key (user_id, wrap_id)
);

alter table public.keeper_wraps enable row level security;

drop policy if exists "read own keeper wraps" on public.keeper_wraps;
create policy "read own keeper wraps" on public.keeper_wraps
  for select using (auth.uid() = user_id);
drop policy if exists "write own keeper wraps" on public.keeper_wraps;
create policy "write own keeper wraps" on public.keeper_wraps
  for insert with check (auth.uid() = user_id);

-- No update policy, deliberately: a wrap is write-once. Overwriting one would
-- destroy a route into the journal, and nothing has any reason to, exactly as with
-- journal_keys above.
--
-- Delete arrived with §12.1 phase 6, once §11 Q13 was answered (12 August 2026).
-- The answer narrowed what a delete may claim rather than widening it. Removing a
-- row withdraws a stored route and does not take back a keeper key a credential has
-- already obtained, and per-credential removal cannot honestly be offered at all:
-- §6.5 keeps credential ids and labels off these rows, so the client can count them
-- and cannot tell one from another. What it can do is replace the lot — enrol a new
-- credential, then delete the rows that were there before it — which is what this
-- policy exists for and all it is used for.
drop policy if exists "delete own keeper wraps" on public.keeper_wraps;
create policy "delete own keeper wraps" on public.keeper_wraps
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
-- Both functions dropped. See the note on public.journals above for why.
--
-- Named in every signature they have ever had, because this file has to converge
-- a project that may be at any of them, and a form left behind would still be
-- granted to authenticated and would still delete an account.
drop function if exists public.delete_account();
drop function if exists public.delete_account(bytea);
drop function if exists public.delete_account(text);
drop function if exists public.set_delete_code(bytea);
drop function if exists public.set_delete_code(text);

-- Realtime: broadcast inserts so other devices pick changes up live. Guarded so
-- re-running doesn't error on the table already being a publication member.
--
-- Only journal_updates is published. `journals` was briefly published too, to
-- push key changes at surviving devices, and that went with the machinery it
-- served (28 Jul, see spec §6.1b). If a project already has it published, that
-- is harmless: nothing subscribes to it. To tidy it up:
--   alter publication supabase_realtime drop table public.journals;
--
-- device_link_requests and device_wrapped_keys were published too until §12.1 phase 7
-- dropped them, because an approval prompt that only appeared when the trusted device
-- happened to relaunch was no good to somebody holding a phone that said "waiting".
-- Dropping a table removes it from the publication, so nothing else is needed here.
do $$
declare
  t text;
begin
  foreach t in array array[
    'journal_updates'
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
