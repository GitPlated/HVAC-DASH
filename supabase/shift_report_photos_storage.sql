-- SUPERSEDED as of 2026-09-22 — see supabase/schema.sql's own header note.
-- The live bucket is hvac-aurora-shift-report-photos, created by
-- MM_Dashboard/hvac_aurora_shift_report_photos_storage.sql. Do not run this
-- file; it targets a project this app no longer uses.
-- ============================================================================
-- shift_report_photos_storage.sql
-- Creates the Supabase Storage bucket End of Shift Report photos upload
-- into, and the RLS policy on storage.objects gating who can upload to it.
-- Run in the Supabase SQL editor for THIS project (the one js/supabase-
-- client.js points at, https://tlclamhggixfhqhsobgq.supabase.co) — separate
-- from schema.sql because Storage buckets/policies live outside the
-- public schema this app's other tables use.
--
-- Modeled on MM_Dashboard's eos_report_photos_storage.sql (same size cap,
-- same public-bucket-no-select-policy reasoning), but upload access is
-- anon rather than role/site-scoped `authenticated` — this app has no login
-- at all (see README's "Who's on shift" section: the identity gate is
-- attribution, not authentication), so there is no auth.jwt() to check
-- against. Matches every other table's RLS in schema.sql, which is already
-- fully open to anon by design.
--
-- Public read — these are internal equipment photos, not sensitive, and a
-- public bucket serves objects directly via
-- /storage/v1/object/public/<bucket>/<path> with no RLS check on the read
-- side at all, so no select policy is needed here.
--
-- file_size_limit is set at the BUCKET level too, not just in js/app.js's
-- own client-side check — the client check is real UX (an immediate,
-- specific error before ever uploading anything) but isn't itself a
-- security boundary; a raw request could bypass it. allowed_mime_types is
-- deliberately NOT set at the bucket level, same reasoning as the AMM
-- version: HEIC/HEIF (default iPhone camera format) is reported
-- inconsistently across browsers/OSes, sometimes as a generic
-- application/octet-stream — a bucket-level MIME allowlist would reject
-- exactly the photos this feature exists for on some devices. js/app.js's
-- own client-side EXTENSION check is the real file-type gate.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('shift-report-photos', 'shift-report-photos', true, 15728640) -- 15MB, matches js/app.js's own SHIFT_REPORT_PHOTO_MAX_BYTES
on conflict (id) do update set
  public = true,
  file_size_limit = 15728640;

-- storage.objects already has RLS enabled by default on every Supabase
-- project — no `alter table ... enable row level security` needed here.

drop policy if exists "shift_report_photos_anon_upload" on storage.objects;
create policy "shift_report_photos_anon_upload" on storage.objects
  for insert
  to anon
  with check (bucket_id = 'shift-report-photos');

-- ============================================================================
-- VERIFY AFTER RUNNING
-- ============================================================================
-- select id, public, file_size_limit from storage.buckets where id = 'shift-report-photos';
--
-- select policyname, cmd from pg_policies where tablename = 'objects' and policyname = 'shift_report_photos_anon_upload';
--   -- should show exactly 1 row, "insert".
--
-- In the app: open the End of Shift Report, attach at least one photo, and
-- submit. Confirm it appears in Storage (Supabase dashboard -> Storage ->
-- shift-report-photos), and that its public URL loads the image directly
-- in a browser tab.
-- ============================================================================
