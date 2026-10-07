-- ============================================================================
-- 2026-10-07_hvac_aurora_roster_active_check.sql
-- NOT a historical record (unlike schema.sql / shift_report_photos_storage.sql):
-- this is a LIVE migration and must be RUN BY HAND by the owner in the SQL
-- editor of the MM_Dashboard Supabase project (jwdxzbusibvffqtacrib), the same
-- project js/supabase-client.js points at. Nothing in this repo applies it.
--
-- WHY: the Aurora identity cards that pair to a real MM_Dashboard account
-- (michael / david / ronald / wilberth) are gated by signInWithPassword. A
-- departed person's roster row is usually DELETED (rmm-network-roster.html's
-- deleteRosterRow) or marked inactive, and MM_Dashboard's Sync Login Access
-- then clears their app_metadata.role -- but it never disables the Auth user,
-- so their password still signs in here. This function lets js/app.js ask,
-- right after a successful password check, "is the person who just signed in
-- still an ACTIVE row on the network roster?" and refuse the card if not.
--
-- WHY AN RPC and not a plain select on mm_roster: every mm_roster SELECT
-- policy keys on app_metadata.role (or an EOS delegate grant), never on "my own
-- row by JWT email". A signed-in user with no role (exactly the departed
-- person this exists to catch) gets "200 []" from a direct select, which is
-- indistinguishable from "inactive", and a direct select would also pull every
-- site's names/emails/titles into the browser. So: SECURITY DEFINER, boolean
-- only, no arguments -- it can only ever answer about the caller's own JWT
-- email, so it cannot be used to probe whether anybody else is on the roster
-- (same `auth.jwt() ->> 'email'` precedent as mm_roster_eos_delegate_read.sql).
--
-- RULE (matches Sync Login Access): an account counts as active while ANY
-- ACTIVE mm_roster row, at any site, carries its lower-cased email. mm_roster
-- has no email uniqueness (a transferred person can have several rows).
--   true  = an active row carries the email
--   false = none does (row deleted, active = false, or the email moved)
--   null  = the JWT carries no email, so we cannot tell (the client treats
--           null like any other non-answer and lets the sign-in proceed)
--
-- HOW THE CLIENT USES IT (js/app.js submitMmDashboardLogin): only a LITERAL
-- false blocks. A missing function (this file not run yet), a network error or
-- a malformed answer all proceed with a console warning, so deploy order can
-- never lock the shop floor out. andrew.wu@hellofresh.com is exempted in the
-- client on purpose: a real Auth account deliberately kept OFF mm_roster
-- (see $PermanentlyExcludedEmails in MM_Dashboard's
-- supabase_auth_app_metadata_backfill.ps1), so this rule would lock him out.
--
-- RUN ORDER:  1) STEP 1 (read-only)   2) STEP 2 (the switch)   3) VERIFY.
-- ============================================================================


-- ============================================================================
-- STEP 1 -- LOCK-OUT PREFLIGHT (read-only, run this FIRST)
-- Expect exactly 4 rows, all with active = true -- one per card that signs in
-- with a real MM_Dashboard account (Andrew Wu is exempt, so he is not listed).
-- If anyone is missing or inactive, fix THEIR roster row (the email) BEFORE
-- running STEP 2, or that person is blocked the moment STEP 2 is live. Match
-- is on email, never name (the roster says "Ron Vogel", the card says
-- "Ronald Vogel"). A person with several rows (a transfer) shows several rows;
-- one active row is enough.
-- ============================================================================
select r.site, r.name, r.email, r.active
from mm_roster r
where lower(btrim(r.email)) in ('michael.petersen@factor75.com', 'david.haney@factor75.com',
                                'ronald.vogel@factor75.com', 'wilberth.carrizal@factor75.com');


-- ============================================================================
-- STEP 2 -- THE SWITCH (run only after STEP 1 looks right)
-- Enforcement begins the instant this commits; no client redeploy is needed.
-- ============================================================================
create or replace function public.hvac_aurora_caller_is_active_on_roster()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when nullif(lower(btrim(auth.jwt() ->> 'email')), '') is null then null   -- cannot tell
    else exists (select 1 from public.mm_roster r
                 where r.active
                   and lower(btrim(r.email)) = lower(btrim(auth.jwt() ->> 'email')))
  end;
$$;

-- Called only AFTER signInWithPassword, so a signed-in (authenticated) caller
-- is all it needs; anon and the implicit PUBLIC grant are removed.
revoke all on function public.hvac_aurora_caller_is_active_on_roster() from public, anon;
grant execute on function public.hvac_aurora_caller_is_active_on_roster() to authenticated;


-- ============================================================================
-- KILL SWITCH / ROLLBACK (run if anyone is wrongly blocked)
-- With the function gone PostgREST answers PGRST202 and the client logs a
-- console warning and goes back to today's behaviour (password + MFA only).
-- ============================================================================
-- drop function if exists public.hvac_aurora_caller_is_active_on_roster();


-- ============================================================================
-- VERIFY AFTER RUNNING STEP 2
-- ============================================================================
-- select proname, prosecdef, proconfig
-- from pg_proc
-- where proname = 'hvac_aurora_caller_is_active_on_roster';
--   -- 1 row, prosecdef = true, proconfig includes search_path=public, pg_temp.
--
-- select has_function_privilege('anon',
--          'public.hvac_aurora_caller_is_active_on_roster()', 'execute') as anon_can,
--        has_function_privilege('authenticated',
--          'public.hvac_aurora_caller_is_active_on_roster()', 'execute') as authed_can;
--   -- anon_can = false, authed_can = true.
--
-- In the app: pick Michael Petersen (or David / Ronald / Wilberth), enter the
-- MM Dashboard password -> the card opens as before. To see a block, run in
-- the SQL editor:  update mm_roster set active = false where email = '...';
-- try the card (expect "no longer active on the network roster"), then set
-- active = true again. Andrew Wu's card must keep working throughout.
-- ============================================================================
