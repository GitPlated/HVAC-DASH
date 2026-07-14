-- HVAC-DASH: refrigeration daily rounds checklist entries
--
-- One row per recorded item. checkpoint_id matches an EQUIPMENT_GROUPS.id
-- from js/data.js. item_key is either a groupChecklist item's exact name
-- (e.g. "Suction and Discharge Pressure"), or "sub:<designation>" for a rack
-- compressor subsection's oil-level reading (e.g. "sub:5").
--
-- RLS is intentionally fully open to the anon role: this tool has no login
-- system, so anyone with the dashboard's URL can read/write entries. That
-- was a deliberate choice for this internal tool, not an oversight.

create table if not exists public.checklist_entries (
  checkpoint_id text not null,
  item_key text not null,
  status text,                 -- 'not_checked' | 'good' | 'warning' (group checklist items)
  oil_level text,               -- '0%' | '25%' | '50%' | '75%' | '100%' (rack subsections only)
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (checkpoint_id, item_key)
);

alter table public.checklist_entries enable row level security;

drop policy if exists "Allow anon read" on public.checklist_entries;
create policy "Allow anon read" on public.checklist_entries
  for select to anon using (true);

drop policy if exists "Allow anon insert" on public.checklist_entries;
create policy "Allow anon insert" on public.checklist_entries
  for insert to anon with check (true);

drop policy if exists "Allow anon update" on public.checklist_entries;
create policy "Allow anon update" on public.checklist_entries
  for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete" on public.checklist_entries;
create policy "Allow anon delete" on public.checklist_entries
  for delete to anon using (true);
