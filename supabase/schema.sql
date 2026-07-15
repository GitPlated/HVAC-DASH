-- HVAC-DASH v2 schema: append-only activity log + issue tracking
--
-- Replaces the old public.checklist_entries table (which stored a single
-- overwritten row per checkpoint+item) with three tables:
--   checklist_log   — append-only history of every status/reading entered.
--                      "Current" status for the map/panel is always derived
--                      client-side from the LATEST row per
--                      (checkpoint_id, item_key) — there's no separate
--                      "current state" table to keep in sync.
--   findings        — one row per tracked issue, opened when "Attention" is
--                      selected on a group checklist item.
--   finding_updates — append-only, immutable timestamped updates within a
--                      finding (status + message), logged until the finding
--                      is marked resolved.
--
-- RLS stays fully open to the anon role, matching this no-login tool's
-- existing model (see the original schema.sql history / README for why).

drop table if exists public.checklist_entries;

create table if not exists public.checklist_log (
  id bigint generated always as identity primary key,
  checkpoint_id text not null,
  item_key text not null,
  status text,                 -- 'not_checked' | 'ok' | 'attention' (group checklist items only)
  oil_level text,                -- '0%' | '25%' | '50%' | '75%' | '100%' (rack subsections only)
  notes text not null default '',
  actor text,                    -- display name of the selected user at time of write; null for pre-attribution rows
  created_at timestamptz not null default now()
);

create index if not exists checklist_log_lookup on public.checklist_log (checkpoint_id, item_key, created_at desc);
create index if not exists checklist_log_created_at on public.checklist_log (created_at desc);

create table if not exists public.findings (
  id bigint generated always as identity primary key,
  checkpoint_id text not null,
  item_key text not null,
  status text not null default 'in_progress',  -- 'in_progress' | 'monitoring' | 'resolved'
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  opened_by text                -- display name of the user who opened it; cached from the first finding_updates.actor
);

create index if not exists findings_checkpoint on public.findings (checkpoint_id, item_key);
create index if not exists findings_status on public.findings (status);

create table if not exists public.finding_updates (
  id bigint generated always as identity primary key,
  finding_id bigint not null references public.findings (id) on delete cascade,
  status text not null,        -- 'in_progress' | 'monitoring' | 'resolved' — status as of THIS update
  message text not null,
  actor text,                    -- display name of the user who logged this update; null for pre-attribution rows
  created_at timestamptz not null default now()
);

create index if not exists finding_updates_finding on public.finding_updates (finding_id, created_at);

alter table public.checklist_log enable row level security;
alter table public.findings enable row level security;
alter table public.finding_updates enable row level security;

drop policy if exists "Allow anon read" on public.checklist_log;
create policy "Allow anon read" on public.checklist_log for select to anon using (true);
drop policy if exists "Allow anon insert" on public.checklist_log;
create policy "Allow anon insert" on public.checklist_log for insert to anon with check (true);
drop policy if exists "Allow anon update" on public.checklist_log;
create policy "Allow anon update" on public.checklist_log for update to anon using (true) with check (true); -- lets a note be attached to the row a status click just created, instead of a second row
drop policy if exists "Allow anon delete" on public.checklist_log;
create policy "Allow anon delete" on public.checklist_log for delete to anon using (true); -- Reset all entries only

drop policy if exists "Allow anon read" on public.findings;
create policy "Allow anon read" on public.findings for select to anon using (true);
drop policy if exists "Allow anon insert" on public.findings;
create policy "Allow anon insert" on public.findings for insert to anon with check (true);
drop policy if exists "Allow anon update" on public.findings;
create policy "Allow anon update" on public.findings for update to anon using (true) with check (true);
drop policy if exists "Allow anon delete" on public.findings;
create policy "Allow anon delete" on public.findings for delete to anon using (true); -- Reset all entries only

drop policy if exists "Allow anon read" on public.finding_updates;
create policy "Allow anon read" on public.finding_updates for select to anon using (true);
drop policy if exists "Allow anon insert" on public.finding_updates;
create policy "Allow anon insert" on public.finding_updates for insert to anon with check (true);
drop policy if exists "Allow anon delete" on public.finding_updates;
create policy "Allow anon delete" on public.finding_updates for delete to anon using (true); -- Reset all entries only

-- v4: password-gated identities. Per-user passwords and the management
-- module's master password are bcrypt-hashed (pgcrypto) and checked entirely
-- inside SECURITY DEFINER functions — the anon role has NO select/insert/
-- update policy on either table below, so a password hash can never be
-- fetched directly by the client, only asked "does this password match?"
-- and told true/false. This is real protection given a static frontend
-- with no backend server of its own: hashes never leave the database.
--
-- The master password itself is NOT set here on purpose, so its plaintext
-- never enters git history — see the separate one-off seeding snippet,
-- meant to be run directly in the Supabase SQL Editor and never committed.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_passwords (
  user_name text primary key,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_secrets (
  key text primary key,
  value_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_passwords enable row level security;
alter table public.app_secrets enable row level security;
-- Deliberately no policies for anon on either table — every access path
-- goes through the functions below.

create or replace function public.list_protected_user_names()
returns setof text
language sql
security definer
set search_path = public, extensions
as $$
  select user_name from public.user_passwords;
$$;
grant execute on function public.list_protected_user_names() to anon;

create or replace function public.verify_master_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored text;
begin
  select value_hash into stored from public.app_secrets where key = 'master_password';
  if stored is null then
    return false;
  end if;
  return crypt(p_password, stored) = stored;
end;
$$;
grant execute on function public.verify_master_password(text) to anon;

create or replace function public.verify_user_password(p_user_name text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored text;
begin
  select password_hash into stored from public.user_passwords where user_name = p_user_name;
  if stored is null then
    return true; -- no password configured for this user yet: open access
  end if;
  return crypt(p_password, stored) = stored;
end;
$$;
grant execute on function public.verify_user_password(text, text) to anon;

create or replace function public.set_user_password(p_master_password text, p_user_name text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_master_password(p_master_password) then
    return false;
  end if;
  insert into public.user_passwords (user_name, password_hash, updated_at)
  values (p_user_name, crypt(p_new_password, gen_salt('bf')), now())
  on conflict (user_name) do update
    set password_hash = excluded.password_hash, updated_at = now();
  return true;
end;
$$;
grant execute on function public.set_user_password(text, text, text) to anon;

create or replace function public.remove_user_password(p_master_password text, p_user_name text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_master_password(p_master_password) then
    return false;
  end if;
  delete from public.user_passwords where user_name = p_user_name;
  return true;
end;
$$;
grant execute on function public.remove_user_password(text, text) to anon;

-- v3: change attribution — the three named users (Brett Stone, Jacolby
-- Moffett, John Danhoff) each sign their writes with their display name;
-- "Admin" is view-only and never appears as an actor. These ALTER statements
-- are what actually apply to an already-existing database (the CREATE TABLE
-- blocks above are no-ops once the tables exist) — run this file again after
-- an update, it's safe either way.
alter table public.checklist_log add column if not exists actor text;
alter table public.finding_updates add column if not exists actor text;
alter table public.findings add column if not exists opened_by text;
