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
-- RULE (the same criterion Sync Login Access uses to decide who keeps access:
-- MM_Dashboard api/sync-app-metadata.js reads mm_roster rows with active = true
-- AND a non-null mm_dashboard_role): an account counts as active while ANY
-- mm_roster row, at any site, carries its lower-cased email, is active, AND has
-- an MM Dashboard Role. The role matters because clearing it in Network Roster
-- > Edit is how a manager removes someone's access WITHOUT deleting or
-- deactivating the row (the Adam Peterson case Sync's own header describes);
-- an active but role-less row does not count. mm_roster has no email
-- uniqueness (a transferred person can have several rows). The email compare is
-- lower(btrim()) on both sides -- a touch looser than Sync's lower() -- so it
-- can only ever mean fewer false denials, never more.
--   true  = an active row with a role carries the email
--   false = none does (row deleted, active = false, role cleared, or the email
--           moved)
--   null  = the JWT carries no email, so we cannot tell (the client treats
--           null like any other non-answer and lets the sign-in proceed)
--
-- HOW THE CLIENT USES IT (js/app.js submitMmDashboardLogin): only a LITERAL
-- false blocks. A missing function (this file not run yet), a network error, a
-- stall (the client gives up after 5 s) or a malformed answer all proceed with
-- a console warning, so deploy order can never lock the shop floor out.
-- andrew.wu@hellofresh.com is exempted in the client on purpose: a real Auth
-- account deliberately kept OFF mm_roster (see $PermanentlyExcludedEmails in
-- MM_Dashboard's supabase_auth_app_metadata_backfill.ps1), so this rule would
-- lock him out.
--
-- RUN ORDER:  1) STEP 1 (read-only)   2) STEP 2 (the switch)   3) VERIFY.
-- ============================================================================


-- ============================================================================
-- STEP 1 -- LOCK-OUT PREFLIGHT (read-only, run this FIRST)
-- One row per card that signs in with a real MM_Dashboard account (Andrew Wu is
-- exempt, so he is not listed). would_pass applies the SAME rule as the
-- function below, so it is exactly what STEP 2 will answer for that person.
--
-- Expect exactly 4 rows, ALL with would_pass = true.
-- A would_pass = false row is someone who is blocked the moment STEP 2 commits
-- (their card refuses them, with no fallback). Fix the cause BEFORE STEP 2:
--   roster_rows = 0  -> no roster row carries that email (blank or different
--                       email on their row). Correct the row's email.
--   a row shows active=false -> reactivate it if that is a mistake.
--   a row shows role=NULL    -> their MM Dashboard Role was cleared. Sync Login
--                       Access has already revoked their dashboard login, so
--                       blocking them here is intended; if it is NOT, set the
--                       role back in Network Roster > Edit first.
-- Match is on email, never name (the roster says "Ron Vogel", the card says
-- "Ronald Vogel"). A person with several rows (a transfer) shows all of them;
-- one active row with a role is enough.
-- ============================================================================
select e.email,
       coalesce(bool_or(r.active and r.mm_dashboard_role is not null), false) as would_pass,
       count(r.email) as roster_rows,
       string_agg(format('%s / %s [active=%s, role=%s]', r.site, r.name, r.active::text,
                         coalesce(r.mm_dashboard_role, 'NULL')),
                  ' | ' order by r.site, r.name) as matching_rows
from (values ('michael.petersen@factor75.com'),
             ('david.haney@factor75.com'),
             ('ronald.vogel@factor75.com'),
             ('wilberth.carrizal@factor75.com')) as e(email)
left join public.mm_roster r on lower(btrim(r.email)) = e.email
group by e.email
order by e.email;


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
                   and r.mm_dashboard_role is not null
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
-- Everything here is read-only: nothing changes mm_roster, so nothing another
-- app reads live (PM-AUDITS caches the roster for 5 minutes; the booked-labor
-- cron reads it too) is ever disturbed. Run each query on its own.
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
-- The function's real answers, WITHOUT touching a roster row: each row below
-- impersonates one email by setting the JWT claim for this one statement only
-- (set_config's third argument, true, makes it transaction-local), then calls
-- the function the way the app does.
-- select t.email,
--        (select public.hvac_aurora_caller_is_active_on_roster()
--           from (select set_config('request.jwt.claims',
--                                   json_build_object('email', t.email)::text, true)) as s) as answer
-- from (values ('michael.petersen@factor75.com'), ('david.haney@factor75.com'),
--              ('ronald.vogel@factor75.com'), ('wilberth.carrizal@factor75.com'),
--              ('nobody.at.all@factor75.com'), ('')) as t(email);
--   -- the four leaders = true, the made-up address = false, the blank one = null.
--
-- In the app: pick Michael Petersen (or David / Ronald / Wilberth), enter the
-- MM Dashboard password -> the card opens as before (MFA prompt first if the
-- account has one). Andrew Wu's card must keep working. Do NOT deactivate a
-- real leader's roster row just to watch the "no longer active" refusal: the
-- query above already proves the function's answer for every case, and a
-- blanket UPDATE ... WHERE email = ... would also flip any older inactive row
-- that shares the email (mm_roster has no email uniqueness).
-- ============================================================================
