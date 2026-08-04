-- Journlet: verify the live Supabase project matches this repo.
-- Remediation item 17. Read-only: this file changes nothing.
--
-- Run order for the whole of item 17. Do (b) first or (a) cannot work.
--
--   (b) Paste supabase/schema.sql into the SQL Editor and run it.
--       public.delete_account() does not exist until you do, and the delete
--       button fails with a missing-function error. Safe to re-run: verified
--       idempotent on 4 Aug by applying it twice to a scratch Postgres 16.
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
--   (a) Account deletion, in the app rather than here. Checklist at the foot.
--
-- What was already verified off-project on 4 Aug, so you are not checking it
-- again: schema.sql applied twice to a scratch Postgres 16 (idempotent, clean
-- both times), all 34 checks below green against it (35 now, see the note below), and each check confirmed
-- to fail when the thing it checks is deliberately broken (publishing
-- journals, dropping a policy, granting anon execute, unpinning search_path,
-- disabling RLS, recreating the old index) and to recover when undone.
-- delete_account() was also run end to end there: it cleared all six tables
-- and the auth user, and raised "Not signed in" with no claim set.
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
--                            account via delete_account().
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

with tables(t) as (
  values ('journals'), ('journal_updates'), ('device_keys'),
         ('device_wrapped_keys'), ('journal_keys'), ('device_link_requests')
),
expected_policies(t, n) as (
  values ('journals', 2), ('journal_updates', 2), ('device_keys', 4),
         ('device_wrapped_keys', 4), ('journal_keys', 2),
         ('device_link_requests', 4)
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

  -- (c) delete_account exists and is hardened
  union all
  select 5, '(c) delete_account() exists',
         'present',
         coalesce((select 'present' from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'delete_account'),
                  'MISSING')

  union all
  select 6, '(c) delete_account() is security definer',
         'true',
         coalesce((select prosecdef::text from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'delete_account'),
                  'no such function')

  union all
  select 7, '(c) delete_account() search_path pinned empty',
         'search_path=""',   -- Postgres normalises set search_path = '' to this
         coalesce((select array_to_string(proconfig, ',') from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'delete_account'),
                  'NOT PINNED')

  -- (c) who may execute it. anon covers PUBLIC too, since PUBLIC is inherited.
  union all
  select 8, '(c) delete_account() executable by authenticated',
         'true',
         case when to_regprocedure('public.delete_account()') is null
              then 'no such function'
              else has_function_privilege('authenticated',
                     'public.delete_account()', 'execute')::text end

  union all
  select 9, '(c) delete_account() NOT executable by anon',
         'false',
         case when to_regprocedure('public.delete_account()') is null
              then 'no such function'
              else has_function_privilege('anon',
                     'public.delete_account()', 'execute')::text end

  -- (c) item 15's volume column, backfilled by its default
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
-- (a) Account deletion, in the app. Do this last, after (b) and (c) pass.
--
--   1. Private window, app.journlet.com, sign in as gary.rutland+del1@dae.mn
--      (a plus address reaches the same mailbox and is a distinct account).
--   2. Complete first run: save the journal key, log one entry.
--   3. Confirm the account exists on the server, as a before-shot:
--        select count(*) from public.journals      where user_id = '<uid>';
--        select count(*) from public.journal_updates where user_id = '<uid>';
--      Get <uid> from Auth -> Users, or run: select auth.uid();
--   4. In the app: Sync -> delete account. Type the account email to confirm.
--   5. Confirm all of it is gone:
--        select count(*) from public.journals            where user_id = '<uid>'; -- 0
--        select count(*) from public.journal_updates     where user_id = '<uid>'; -- 0
--        select count(*) from public.device_keys         where user_id = '<uid>'; -- 0
--        select count(*) from public.device_wrapped_keys where user_id = '<uid>'; -- 0
--        select count(*) from public.journal_keys        where user_id = '<uid>'; -- 0
--        select count(*) from auth.users                 where id = '<uid>';      -- 0
--      And Auth -> Users no longer lists the address.
--
-- If step 4 fails with a permission error: that is the thing this was checking
-- for. It means the function owner cannot delete from auth.users on this
-- project, which newer Supabase projects cause by not making postgres the
-- owner of that table. The failure is safe by design: the whole function is
-- one transaction, so nothing is deleted and the app says so rather than
-- half-deleting. Fix is to change the function's owner to a role that can.
--
-- Known limit, expected and not a failure: auth.audit_log_entries does not
-- cascade from auth.users, so sign-in records survive. Disclosed on the
-- privacy page (remediation item 16).
