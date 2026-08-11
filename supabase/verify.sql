-- Journlet: verify the live Supabase project matches this repo.
-- Remediation item 17. Read-only: this file changes nothing.
--
-- Run order for the whole of item 17. Do (b) first or (a) cannot work.
--
--   (b) Paste supabase/schema.sql into the SQL Editor and run it. Safe to
--       re-run: verified idempotent by applying it twice to a scratch Postgres
--       16, including over a project that still had the deletion function and
--       column this file now expects to be absent.
--
--   (c) Paste THIS file and run it. Every row should read ok = true.
--       Failures sort to the top. Each row names what it expected.
--
--   (e) If the last check (journals not published) fails, run:
--         alter publication supabase_realtime drop table public.journals;
--       Then re-run this file. Cosmetic: nothing subscribes to journals.
--
--   (d) Client behaviour, not SQL. See the note at the foot of this file.
--
--   (a) Account deletion. No longer an app action, so no longer a checklist
--       here. Note at the foot of this file.
--
--   Note, 11 Aug 2026 (assessment Finding 24): account deletion is no longer in
--   the app at all. delete_account(), set_delete_code() and journals.delete_code
--   are dropped, and checks 5 and 6 now assert their absence. Re-run schema.sql
--   on the live project before this file, or those two will report on the state
--   this repository has just left behind.
--
-- Run against the LIVE project on 11 Aug 2026, after keeper_wraps was applied:
-- all 45 rows ok = true, which is the first time check (c) has been run there
-- since the account-deletion removal and the new table. Note that the three
-- publication rows pass on the live project and fail on a fresh scratch instance,
-- because logical decoding is off by default there; see scratch-scaffold.sql.
--
-- Re-verified off-project on 11 Aug 2026, against PostgreSQL 16.13 on the
-- scaffold now kept in supabase/scratch-scaffold.sql (rebuilt because the 4 Aug
-- harness had been deleted). schema.sql applied twice, clean both times; this
-- file returned 45 rows and every one ok = true, up from 40 before keeper_wraps
-- and its two checks; checks 23 and 24 were each confirmed to fail when the thing
-- they check was broken (a DELETE policy added, a default put on wrap_id) and to
-- recover when undone; and delete-user.sql was run end to end against a seeded
-- account, which cleared its keeper_wraps row and left no orphans.
--
-- The count above is rows returned, not checks written: checks 1, 2, 3 and 16 fan
-- out per table, which is why adding one table added three rows.
--
-- What was already verified off-project on 4 Aug, so you are not checking it
-- again: schema.sql applied twice to a scratch Postgres 16 (idempotent, clean
-- both times), every check below green against it, and each check confirmed
-- to fail when the thing it checks is deliberately broken (publishing
-- journals, dropping a policy, granting anon execute, unpinning search_path,
-- disabling RLS, recreating the old index) and to recover when undone.
-- The deletion function was also run end to end there while it existed, and
-- against the live project on 11 August, before being removed altogether.
--
-- Note, 4 Aug 2026: the journals UPDATE policy was dropped, so check 1's
-- expected count for that table went from 3 to 2. Re-run schema.sql on the live
-- project before this file, or check 1 will fail on the old policy still being
-- there. That is the failure doing its job.
--
-- So the function body is not in question. The single thing (a) can still
-- tell you is whether the function's OWNER may delete from auth.users on this
-- specific project, which is exactly what item 17 was raised about and the one
-- thing no amount of off-project testing can answer.
--
-- Expected policy counts, and why each is what it is:
--   journals              2  select, insert only. No update and no delete.
--                            wrapped_key holds the epoch 0 data key, so an
--                            update destroys access to everything written
--                            before the first rotation; the client only ever
--                            selects and inserts here. The row goes with the
--                            account, back when the app could.
--   journal_updates       2  select, insert only. Append-only by design, which
--                            is what stops a client rewriting history
--                            (remediation item 23).
--   device_keys           4  full CRUD: a device can be removed.
--   device_wrapped_keys   4  full CRUD: keys are re-wrapped on rotation.
--   journal_keys          2  select, insert only, deliberately. An epoch's
--                            wrapped key is write-once; changing one would
--                            orphan every row written under it, deleting one
--                            would cut the recovery code out of that stretch.
--   device_link_requests  4  full CRUD: requests are approved or refused.
--   keeper_wraps          2  select, insert only (spec §6.1e, added 11 Aug
--                            2026). Write-once for the same reason as
--                            journal_keys: overwriting a wrap destroys a route
--                            into the journal. Delete arrives with credential
--                            removal (§12.1 phase 6), which waits on §11 Q13,
--                            so a DELETE policy here now would be a capability
--                            with no caller and no agreed wording.

with tables(t) as (
  values ('journals'), ('journal_updates'), ('device_keys'),
         ('device_wrapped_keys'), ('journal_keys'), ('device_link_requests'),
         ('user_usage'), ('keeper_wraps')
),
expected_policies(t, n) as (
  values ('journals', 2), ('journal_updates', 2), ('device_keys', 4),
         ('device_wrapped_keys', 4), ('journal_keys', 2),
         ('device_link_requests', 4), ('user_usage', 1), ('keeper_wraps', 2)
),
published(t) as (
  values ('journal_updates'), ('device_link_requests'), ('device_wrapped_keys')
),
checks as (

  -- (c) every table exists
  select 1 as seq, '(c) table exists: ' || t as check_name,
         'present' as expected,
         coalesce((select 'present' from pg_tables
                   where schemaname = 'public' and tablename = t), 'MISSING') as actual
  from tables

  -- (c) RLS is on. Without it the policies below are decoration.
  union all
  select 2, '(c) RLS enabled: ' || t,
         'true',
         coalesce((select relrowsecurity::text from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = t), 'no such table')
  from tables

  -- (c) policy count per table
  union all
  select 3, '(c) policy count: ' || e.t,
         e.n::text,
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = e.t)
  from expected_policies e

  -- (c) journal_keys is write-once: no UPDATE or DELETE policy
  union all
  select 4, '(c) journal_keys has no update/delete policy',
         '0',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'journal_keys'
            and cmd in ('UPDATE', 'DELETE'))

  -- (c) journals is write-once too, for the same reason: wrapped_key is the
  -- epoch 0 data key. Stated as its own check rather than left to the policy
  -- count above, so that re-adding an UPDATE policy fails by name.
  union all
  select 4, '(c) journals has no update/delete policy',
         '0',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'journals'
            and cmd in ('UPDATE', 'DELETE'))

  union all
  -- (c) Finding 24, settled 11 August 2026: account deletion left the app, so
  -- neither function should exist. Their absence is the control now. A form left
  -- behind would still be granted to authenticated and would still delete an
  -- account, and every signature either has ever had is covered because this
  -- project may be converging from any of them.
  select 5, '(c) no account-deletion function remains',
         '0',
         (select count(*)::text from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('delete_account', 'set_delete_code'))

  union all
  select 6, '(c) journals.delete_code is gone',
         'absent',
         coalesce((select 'present' from information_schema.columns
                   where table_schema = 'public' and table_name = 'journals'
                     and column_name = 'delete_code'), 'absent')

  union all
  select 10, '(c) journal_updates.volume default',
         '''v1''::text',
         coalesce((select pg_get_expr(d.adbin, d.adrelid)
                   from pg_attribute a
                   join pg_class c on c.oid = a.attrelid
                   join pg_namespace n on n.oid = c.relnamespace
                   left join pg_attrdef d
                     on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where n.nspname = 'public' and c.relname = 'journal_updates'
                     and a.attname = 'volume'), 'MISSING')

  union all
  select 11, '(c) journal_updates.volume is not null',
         'true',
         coalesce((select a.attnotnull::text
                   from pg_attribute a
                   join pg_class c on c.oid = a.attrelid
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'journal_updates'
                     and a.attname = 'volume'), 'MISSING')

  -- (c) the volume-aware index replaced the old one
  union all
  select 12, '(c) journal_updates_user_volume_idx exists',
         'present',
         coalesce((select 'present' from pg_indexes
                   where schemaname = 'public'
                     and indexname = 'journal_updates_user_volume_idx'), 'MISSING')

  union all
  select 13, '(c) old journal_updates_user_idx is gone',
         'absent',
         coalesce((select 'STILL PRESENT' from pg_indexes
                   where schemaname = 'public'
                     and indexname = 'journal_updates_user_idx'), 'absent')

  -- (c) epoch column and the widened primary key it needs
  union all
  select 14, '(c) device_wrapped_keys.epoch default',
         '0',
         coalesce((select pg_get_expr(d.adbin, d.adrelid)
                   from pg_attribute a
                   join pg_class c on c.oid = a.attrelid
                   join pg_namespace n on n.oid = c.relnamespace
                   left join pg_attrdef d
                     on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where n.nspname = 'public'
                     and c.relname = 'device_wrapped_keys'
                     and a.attname = 'epoch'), 'MISSING')

  union all
  select 15, '(c) device_wrapped_keys pkey is (user_id, device_id, epoch)',
         '3 columns',
         coalesce((select array_length(conkey, 1)::text || ' columns'
                   from pg_constraint
                   where conname = 'device_wrapped_keys_pkey'
                     and conrelid = 'public.device_wrapped_keys'::regclass),
                  'no such constraint')

  -- (e) realtime publication membership
  union all
  select 16, '(e) published to supabase_realtime: ' || t,
         'yes',
         coalesce((select 'yes' from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t), 'NO')
  from published

  union all
  select 17, '(e) journals NOT published (see (e) above if this fails)',
         'not published',
         coalesce((select 'STILL PUBLISHED' from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'journals'),
                  'not published')

  -- (c) user_usage is readable by its owner and writable by nobody. A user who
  -- could update this row could raise their own quota, so the absence of the
  -- other three policies is the control rather than an oversight. Named, like
  -- the journals check above, so that adding one fails by name.
  union all
  select 18, '(c) user_usage has select only, no insert/update/delete policy',
         '0',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'user_usage'
            and cmd in ('INSERT', 'UPDATE', 'DELETE'))

  -- (c) the quota trigger fires before the insert. After would count rows it had
  -- already allowed through, which is no quota at all.
  union all
  select 19, '(c) journal_updates_quota is a BEFORE INSERT row trigger',
         'before insert row',
         coalesce((select case
                     when t.tgtype & 2 = 2 and t.tgtype & 4 = 4 and t.tgtype & 1 = 1
                     then 'before insert row'
                     else 'wrong timing: ' || t.tgtype::text end
                   from pg_trigger t
                   join pg_class c on c.oid = t.tgrelid
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'journal_updates'
                     and t.tgname = 'journal_updates_quota'), 'MISSING')

  -- (c) the trigger function is definer with an empty search_path, like
  -- the deletion function that used to sit here. Invoker rights would fail,
  -- since user_usage has no write
  -- policy, so this is load-bearing rather than hygiene.
  union all
  select 20, '(c) account_for_journal_update() is definer, search_path empty',
         'definer, search_path=""',
         coalesce((select case when p.prosecdef
                       and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
                     then 'definer, search_path=""' else 'not hardened' end
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname = 'account_for_journal_update'), 'MISSING')

  -- (c) the running total agrees with the log it counts. Drift is the failure
  -- mode a counter has and a scan does not, so it is asserted rather than
  -- trusted. Re-running schema.sql repairs whatever this reports.
  union all
  select 21, '(c) user_usage.bytes matches sum(octet_length(payload))',
         '0 disagree',
         (select count(*)::text || ' disagree' from (
            select u.user_id from public.user_usage u
            left join (select user_id, sum(octet_length(payload)) as b
                       from public.journal_updates group by user_id) l
                   on l.user_id = u.user_id
            where u.bytes <> coalesce(l.b, 0)
          ) d)

  -- (c) nobody is near their cap. Informational, and the row that would have
  -- told you an account was quietly filling the project.
  union all
  select 22, '(c) no account is over 80% of its quota',
         '0 accounts',
         (select count(*)::text || ' accounts' from public.user_usage
          where bytes > quota_bytes * 0.8)

  -- (c) keeper_wraps is write-once, like journal_keys and journals. Named
  -- rather than left to the policy count, so re-adding one fails by name.
  union all
  select 23, '(c) keeper_wraps has no update/delete policy',
         '0',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'keeper_wraps'
            and cmd in ('UPDATE', 'DELETE'))

  -- (c) keeper_wraps.wrap_id must have no default.
  --
  -- Not tidiness. The wrap id goes inside the AES-GCM additional authenticated
  -- data, so the client has to choose it before the ciphertext exists. A
  -- gen_random_uuid() default added here by hand would mean a client encrypting
  -- against an id the server had not issued yet, and every wrap written that way
  -- would be unopenable. It would look like a working column.
  union all
  select 24, '(c) keeper_wraps.wrap_id has no default',
         'none',
         coalesce((select pg_get_expr(d.adbin, d.adrelid)
                   from pg_attribute a
                   join pg_class c on c.oid = a.attrelid
                   join pg_namespace n on n.oid = c.relnamespace
                   left join pg_attrdef d
                     on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where n.nspname = 'public'
                     and c.relname = 'keeper_wraps'
                     and a.attname = 'wrap_id'), 'none')

)
select check_name, expected, actual, (actual = expected) as ok
from checks
order by (actual = expected), seq, check_name;

-- ---------------------------------------------------------------------------
-- (d) What an update matching no rows reports. NOT answerable here.
--
-- Postgres reports "UPDATE 0" and PostgREST turns that into 204 No Content,
-- so the question is only ever about what the client sees. Run this in the
-- browser console on app.journlet.com while signed in:
--
--   const { data, error } = await supabase
--     .from('device_keys')
--     .update({ public_key: 'noop' })
--     .eq('device_id', 'definitely-not-a-real-device')
--     .select();
--   console.log({ rows: data?.length, error });
--
-- Expect rows: 0 and error: null. That is the point: a miss is NOT an error,
-- so any code treating "no error" as "the row was updated" is wrong. Without
-- .select() you get data: null and cannot tell a miss from a hit at all,
-- which is the assumption that cost the 28 July bug.
--
-- ---------------------------------------------------------------------------
-- (a) Account deletion, 11 August 2026. There is nothing to check here any more.
--
-- It was an in-app action calling public.delete_account(), and this file used to
-- carry a checklist for exercising it. Both are gone. Deletion is now a request
-- to the operator: notice to the registered address, a wait, then the rows are
-- removed by hand. See the privacy page for what is promised.
--
-- What that means for whoever runs it. There is no longer any code path that
-- deletes an account, so a mistyped statement in this editor is the only way it
-- can happen at all, and that has gone wrong once already. So: take a dump
-- first, key the statement on the email address rather than on a uid copied off
-- a screen, and make it refuse rather than proceed if the address matches a
-- number of users you did not expect. The eight tables to clear, in this order,
-- are user_usage, journal_updates, journals, device_link_requests, journal_keys,
-- device_wrapped_keys, device_keys, keeper_wraps, then auth.users. delete-user.sql
-- does all of this and refuses when the count is not what you expected.
--
-- Known limit, expected and not a failure: auth.audit_log_entries does not
-- cascade from auth.users, so sign-in records survive. Disclosed on the
-- privacy page (remediation item 16).
