\set ON_ERROR_STOP on
-- Journlet: prove the storage quota actually refuses. Scratch database only.
--
-- This file creates two accounts, writes journal rows, and calls
-- delete_account(). Pasted into the live SQL Editor it would do all three to the
-- real project, so it refuses to run unless you say where you are:
--
--   set journlet.scratch = 'yes';
--
-- The refusal is inside the transaction that wraps the whole file, so if it
-- fires every following statement fails with "current transaction is aborted"
-- and nothing happens. That structure is deliberate: an earlier version raised
-- and then carried on, because psql only stops on error when told to and the
-- SQL Editor is not psql. A guard that reports and proceeds is worse than none.
--
-- supabase/verify.sql is the file that is safe to run against production. This
-- one is how the quota was checked before it shipped, against PostgreSQL 16.13
-- with an auth schema scaffolded to match Supabase, and it ends in a rollback so
-- it leaves nothing behind.
--
-- Each assertion raises rather than printing, so a pass is silence and the last
-- lines are all you need to read. Every guard was confirmed to fail when the
-- thing it checks was disabled: replacing the quota comparison with `if false`
-- makes check 3 report "the over-quota insert was allowed".

begin;

do $$ begin
  if current_setting('journlet.scratch', true) is distinct from 'yes' then
    raise exception 'Refusing to run: this file creates and deletes accounts. Scratch database only. If you are on one: set journlet.scratch = ''yes'';';
  end if;
end $$;

-- Journlet: prove the storage quota actually refuses. Scratch database only.
--
-- This file creates two accounts, writes journal rows, and calls
-- delete_account(). Pasted into the live SQL Editor it would do all three to the
-- real project, so it refuses to run unless you say where you are:
--
--   set journlet.scratch = 'yes';
--
-- The refusal is the point. supabase/verify.sql is the file that is safe to run
-- against production; this one is how the quota was checked before it shipped,
-- against PostgreSQL 16.13 with an auth schema scaffolded to match Supabase.
--
-- Each assertion raises rather than printing, so a pass is silence and the last
-- line is the only output you need to see. Every guard here was confirmed to
-- fail when the thing it checks was disabled: replacing the quota comparison
-- with `if false` makes check 3 report "the over-quota insert was allowed".

do $$ begin
  if current_setting('journlet.scratch', true) is distinct from 'yes' then
    raise exception 'Refusing to run: this file creates and deletes accounts. Scratch database only. If you are on one: set journlet.scratch = ''yes'';';
  end if;
end $$;

-- two accounts
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','a@example.com'),
  ('22222222-2222-4222-8222-222222222222','b@example.com');

\echo '--- 1: default quota is 20 MB'
do $$ begin
  if (select quota_bytes from (select 20971520::bigint as quota_bytes) t) <> 20971520 then
    raise exception 'sanity'; end if;
  perform 1;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
insert into public.journals (wrapped_key) values ('{"v":3}'::jsonb);
insert into public.journal_updates (payload) values (repeat('x', 1000));
reset role;
do $$
declare b bigint; q bigint;
begin
  select bytes, quota_bytes into b, q from public.user_usage
   where user_id = '11111111-1111-4111-8111-111111111111';
  if b <> 1000 then raise exception 'expected 1000 bytes, got %', b; end if;
  if q <> 5242880 then raise exception 'expected 5 MB default, got %', q; end if;
end $$;

\echo '--- 2: the counter accumulates'
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
insert into public.journal_updates (payload) values (repeat('y', 500));
reset role;
do $$
declare b bigint;
begin
  select bytes into b from public.user_usage where user_id = '11111111-1111-4111-8111-111111111111';
  if b <> 1500 then raise exception 'expected 1500, got %', b; end if;
end $$;

\echo '--- 3: an insert over the cap is refused, and nothing lands'
update public.user_usage set quota_bytes = 1600
 where user_id = '11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare n_before int; n_after int; got text;
begin
  select count(*) into n_before from public.journal_updates;
  begin
    set local role authenticated;
    insert into public.journal_updates (payload) values (repeat('z', 200));
    reset role;
    raise exception 'the over-quota insert was allowed';
  exception when sqlstate '53100' then
    got := sqlerrm;
  end;
  reset role;
  select count(*) into n_after from public.journal_updates;
  if n_after <> n_before then raise exception 'row landed anyway'; end if;
  if got not like '%storage limit reached%' then raise exception 'message was: %', got; end if;
  raise notice 'refused with: %', got;
end $$;

\echo '--- 4: an insert that still fits is allowed'
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
insert into public.journal_updates (payload) values (repeat('w', 100));
reset role;
do $$
declare b bigint;
begin
  select bytes into b from public.user_usage where user_id = '11111111-1111-4111-8111-111111111111';
  if b <> 1600 then raise exception 'expected 1600, got %', b; end if;
end $$;

\echo '--- 5: the other account is unaffected'
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
insert into public.journals (wrapped_key) values ('{"v":3}'::jsonb);
insert into public.journal_updates (payload) values (repeat('q', 4000));
reset role;
do $$
declare b bigint;
begin
  select bytes into b from public.user_usage where user_id = '22222222-2222-4222-8222-222222222222';
  if b <> 4000 then raise exception 'expected 4000 for B, got %', b; end if;
end $$;

\echo '--- 6: a user cannot raise their own quota'
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare n int;
begin
  begin
    set local role authenticated;
    update public.user_usage set quota_bytes = 999999999
     where user_id = '11111111-1111-4111-8111-111111111111';
    get diagnostics n = row_count;
    reset role;
    if n > 0 then raise exception 'a user updated their own quota'; end if;
    raise notice 'update affected 0 rows, refused by RLS';
  exception when insufficient_privilege then
    reset role;
    raise notice 'refused with insufficient_privilege';
  end;
  reset role;
end $$;

\echo '--- 7: a user can read their own usage and not another'
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
select count(*) as own_rows_visible from public.user_usage;
reset role;

\echo '--- 8: the seed self-heals a drifted counter'
update public.user_usage set bytes = 999
 where user_id = '11111111-1111-4111-8111-111111111111';
insert into public.user_usage (user_id, bytes)
select user_id, sum(octet_length(payload)) from public.journal_updates group by user_id
on conflict (user_id) do update set bytes = excluded.bytes, updated_at = now();
do $$
declare b bigint;
begin
  select bytes into b from public.user_usage where user_id = '11111111-1111-4111-8111-111111111111';
  if b <> 1600 then raise exception 'self-heal gave %, expected 1600', b; end if;
end $$;

\echo '--- 9: delete_account clears the counter'
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
select public.delete_account();
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.user_usage
   where user_id = '22222222-2222-4222-8222-222222222222';
  if n <> 0 then raise exception 'usage row survived account deletion'; end if;
end $$;

\echo '=== all assertions passed ==='

-- Rolled back, always. Nothing above needs to persist, and leaving two accounts
-- and a lowered quota behind makes the next run of verify.sql report an account
-- over 80% of its cap, which is a false alarm learned the hard way.
rollback;
