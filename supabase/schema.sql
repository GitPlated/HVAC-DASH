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

-- v3: change attribution — the three named users (Brett Stone, Jacolby
-- Moffett, John Danhoff) each sign their writes with their display name;
-- "Admin" is view-only and never appears as an actor. These ALTER statements
-- are what actually apply to an already-existing database (the CREATE TABLE
-- blocks above are no-ops once the tables exist) — run this file again after
-- an update, it's safe either way.
alter table public.checklist_log add column if not exists actor text;
alter table public.finding_updates add column if not exists actor text;
alter table public.findings add column if not exists opened_by text;
