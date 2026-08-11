-- The minimum Supabase-shaped database that schema.sql, verify.sql and
-- delete-user.sql can be run against, so all three can be proved before they are
-- pointed at the live project.
--
-- Kept this time. The equivalent harness existed on 4 August 2026, proved the
-- quota work, and was then deleted rather than committed — schema.sql still
-- carries the note admitting that, and the next person who wanted it had to
-- rebuild it from scratch on 11 August. It is thirty lines.
--
-- Usage, with a local PostgreSQL 16:
--
--   initdb -D /tmp/pgdata -U you --auth=trust
--   pg_ctl -D /tmp/pgdata -o "-k /tmp/pgsock -h ''" start
--   psql -h /tmp/pgsock -d postgres -v ON_ERROR_STOP=1 -f supabase/scratch-scaffold.sql
--   psql -h /tmp/pgsock -d postgres -v ON_ERROR_STOP=1 -f supabase/schema.sql   # twice
--   psql -h /tmp/pgsock -d postgres -f supabase/verify.sql                      # every row ok = true
--
-- One thing to set or three checks fail for a reason that is not about this
-- repository: realtime publication membership needs logical decoding, which a
-- fresh initdb does not have.
--
--   alter system set wal_level = 'logical';   -- then restart, then re-run schema.sql
--
-- What this is not: Supabase. There is no GoTrue, no PostgREST, no realtime
-- server, and auth.uid() below reads a session setting rather than a JWT. So it
-- proves the schema, the policies, the trigger and the operator's scripts, and it
-- says nothing about how the platform behaves around them. Item 28 in the
-- remediation log is still open for that reason.

create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text,
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- delete-user.sql clears these, and the privacy page says they are cleared, so
-- the harness has to have them for that path to be exercised at all.
create table if not exists auth.audit_log_entries (
  id      uuid primary key default gen_random_uuid(),
  payload jsonb
);

-- Stands in for the JWT claim. Set it per session to act as a given user:
--   select set_config('request.jwt.claim.sub', '<uuid>', false);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

-- schema.sql adds tables to this and verify.sql checks the membership.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
  then
    create publication supabase_realtime;
  end if;
end $$;
