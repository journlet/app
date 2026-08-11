-- Journlet: delete one user and everything the server holds for them.
--
-- Account deletion left the app on 11 August 2026 (assessment Finding 24), so
-- this file is the whole mechanism. There is no code path that deletes an
-- account any more, which means a mistake here is the only way it can happen by
-- accident, and that has gone wrong once: on 11 August an account was deleted
-- from this editor that nobody had asked to be deleted.
--
-- Everything below exists to make that harder rather than to make it quicker.
--
-- HOW TO USE IT
--
--   Run each part on its own, in order, and read the output before moving on.
--   Do not paste the whole file in one go: part 3 is written to refuse unless
--   you have read part 1, and running them together defeats that.
--
--   1. Inventory. Confirm the address is the one you mean and note the
--      journal_updates count.
--   2. Copy of the ciphertext, if you want one. Optional, and read what it does
--      and does not give you.
--   3. The deletion. Fill in three values at the top and run.
--   4. Verify.
--
-- WHAT PART 3 REFUSES TO DO
--
--   Nothing at all unless the address matches exactly one user. Not zero, and
--   not more than one.
--   Nothing if the address resolves to an account in the protected list. Your own
--   is in there. Removing it from that list should feel like a deliberate act,
--   because it is. The list holds ids rather than addresses because this file is
--   in a public repository, where an email address is personal data and an id is
--   an opaque identifier. It compares the account the address resolved to rather
--   than the string you typed, which is the sturdier thing to compare even while
--   one account has exactly one address.
--   Nothing if the journal_updates count you saw in part 1 no longer matches.
--   That is the interlock: it means you cannot delete an account you have not
--   looked at, and if the person wrote something between your reading and your
--   deleting, it stops and makes you look again.
--
--   It is one DO block, so it is one transaction. A refusal at any point leaves
--   the account exactly as it was. No explicit BEGIN or COMMIT, because the
--   Supabase editor manages its own transaction and an explicit COMMIT inside it
--   leaves the connection out of step and loses the tab.
--
-- WHAT IT DOES NOT DO
--
--   It does not notify anyone. The privacy page promises the account holder is
--   written to before anything is removed, and that the removal waits. That is
--   on you, not on this file, and it is the part that protects a person whose
--   mailbox someone else has reached.


-- ===========================================================================
-- PART 1. Inventory. Read-only. Substitute the address and run.
--
-- created_at is confirmed present on this project. last_sign_in_at comes from
-- GoTrue's standard schema and has not been observed here, so if this errors on
-- a column, delete that line rather than assuming the query is wrong. It is
-- only there to tell a dormant account from a live one.
-- ===========================================================================

select u.id,
       u.email,
       u.created_at,
       u.last_sign_in_at,
       (select count(*) from public.journals             x where x.user_id = u.id) as journals,
       (select count(*) from public.journal_updates      x where x.user_id = u.id) as updates,
       (select count(*) from public.journal_keys         x where x.user_id = u.id) as journal_keys,
       (select count(*) from public.device_keys          x where x.user_id = u.id) as device_keys,
       (select count(*) from public.device_wrapped_keys  x where x.user_id = u.id) as wrapped_keys,
       (select count(*) from public.device_link_requests x where x.user_id = u.id) as link_requests,
       (select count(*) from public.user_usage           x where x.user_id = u.id) as usage_rows,
       (select count(*) from public.keeper_wraps         x where x.user_id = u.id) as keeper_wraps,
       (select count(*) from auth.audit_log_entries      a
         where a.payload ->> 'actor_id' = u.id::text)                             as sign_in_records
from auth.users u
where u.email = 'PASTE THE ADDRESS HERE';


-- ===========================================================================
-- PART 2. Optional: a copy of what you are about to destroy.
--
-- One JSON document holding every row for that user. Save the result to a file
-- before running part 3.
--
-- Be clear about what this is worth. The journal content is ciphertext and the
-- keys are on the user's devices, so this is not something you can read, and it
-- is not a backup in the sense the app's own export is. What it is good for is
-- one thing: if you delete the wrong account, these rows are the part that
-- cannot be regenerated, and the user's devices still hold the keys that open
-- them. Restoring is not a paste-back, because a new auth user gets a new id
-- and every row would have to be re-pointed at it, but with this file that is
-- possible and without it nothing is.
-- ===========================================================================

select jsonb_pretty(jsonb_build_object(
  'exported_at',          now(),
  'email',                u.email,
  'user_id',              u.id,
  'journals',             (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.journals             x where x.user_id = u.id),
  'journal_updates',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.journal_updates      x where x.user_id = u.id),
  'journal_keys',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.journal_keys         x where x.user_id = u.id),
  'device_keys',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.device_keys          x where x.user_id = u.id),
  'device_wrapped_keys',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.device_wrapped_keys  x where x.user_id = u.id),
  'device_link_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.device_link_requests x where x.user_id = u.id),
  'user_usage',           (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.user_usage           x where x.user_id = u.id),
  -- Ciphertext, like the key tables above it. Dumped so the export is the whole
  -- account rather than most of it: without these rows a restored dump would have
  -- a journal nobody could unlock except by the journal key code.
  'keeper_wraps',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.keeper_wraps         x where x.user_id = u.id)
)) as backup
from auth.users u
where u.email = 'PASTE THE ADDRESS HERE';


-- ===========================================================================
-- PART 3. The deletion. Fill in all three values, then run.
-- ===========================================================================

do $$
declare
  -- 1. The address, from part 1.
  target_email    text := 'PASTE THE ADDRESS HERE';

  -- 2. The journal_updates count you saw in part 1. Leave it at -1 and this
  --    refuses, which is the point: an unset value is not a confirmation.
  expect_updates  int  := -1;

  -- 3. Accounts this file will never delete, by id rather than by address.
  --    Yours is here on purpose. By id because this file lives in a public
  --    repository and an email address there is personal data and scraper-food,
  --    where a uuid is an opaque identifier. Get an id from part 1.
  protected       uuid[] := array['2aed0c62-3a0c-4ade-b0f6-77fef3bc1f69']::uuid[];

  uid            uuid;
  matches        int;
  actual_updates int;
  removed        record;
begin
  if target_email is null or target_email = 'PASTE THE ADDRESS HERE' then
    raise exception 'No address set. Nothing done.';
  end if;

  select count(*) into matches from auth.users where email = target_email;
  if matches = 0 then
    raise exception 'No user with address %. Nothing done.', target_email;
  end if;
  if matches > 1 then
    raise exception
      'Refusing: % matches % users. Delete them one at a time by id instead.',
      target_email, matches;
  end if;

  select id into uid from auth.users where email = target_email;

  -- Checked after the lookup, because the list is ids. What is compared is the
  -- account the address resolved to rather than the string typed above.
  if uid = any (protected) then
    raise exception
      'Refusing: % resolves to a protected account (%). Edit the list above if you really mean it.',
      target_email, uid;
  end if;

  select count(*) into actual_updates
    from public.journal_updates where user_id = uid;
  if expect_updates < 0 then
    raise exception
      'Set expect_updates to the count part 1 showed (this account has % now). Nothing done.',
      actual_updates;
  end if;
  if actual_updates <> expect_updates then
    raise exception
      'Refusing: you expected % journal_updates and this account has %. Re-run part 1 and look again. Nothing done.',
      expect_updates, actual_updates;
  end if;

  -- Same order the app's own deletion function used, so a foreign key added
  -- later cannot make this fail halfway. It is one transaction regardless.
  delete from public.user_usage           where user_id = uid;
  delete from public.journal_updates      where user_id = uid;
  delete from public.journals             where user_id = uid;
  delete from public.device_link_requests where user_id = uid;
  delete from public.journal_keys         where user_id = uid;
  delete from public.device_wrapped_keys  where user_id = uid;
  delete from public.device_keys          where user_id = uid;
  delete from public.keeper_wraps         where user_id = uid;

  -- Sign-in records do not cascade from auth.users, and the privacy page says
  -- they are cleared on request, so they go here rather than being left behind.
  delete from auth.audit_log_entries where payload ->> 'actor_id' = uid::text;

  delete from auth.users where id = uid;

  raise notice 'Deleted % (%), including % journal_updates.',
    target_email, uid, actual_updates;
end $$;


-- ===========================================================================
-- PART 4. Verify. Read-only.
--
-- First result: no user with that address. Second: no rows anywhere whose owner
-- has gone, which also catches anything an earlier deletion left behind.
-- ===========================================================================

select count(*) as user_should_be_zero
from auth.users where email = 'PASTE THE ADDRESS HERE';

select 'journals' as t, count(*) as orphan_rows from public.journals x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'journal_updates', count(*) from public.journal_updates x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'journal_keys', count(*) from public.journal_keys x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'device_keys', count(*) from public.device_keys x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'device_wrapped_keys', count(*) from public.device_wrapped_keys x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'device_link_requests', count(*) from public.device_link_requests x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'user_usage', count(*) from public.user_usage x
  where not exists (select 1 from auth.users u where u.id = x.user_id)
union all select 'keeper_wraps', count(*) from public.keeper_wraps x
  where not exists (select 1 from auth.users u where u.id = x.user_id);
