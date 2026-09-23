# Refrigeration Daily Rounds — Facility Dashboard

A SCADA/HMI-style interactive dashboard for the facility's refrigeration & HVAC
daily rounds checklist. Built from the "Refrigeration Daily Rounds" Google
Sheet and a hand-drawn facility floor plan.

## What this is

- A clickable floor plan of the facility with every rack, compressor,
  evaporator, RTU, DOAS, MAU, and blast chiller placed in its checklist
  location.
- Roof-mounted equipment (condensers, RTU, DOAS, MAU, blast chiller
  condensing units) isn't on the interior floor plan itself — it has its own
  card grid in the **Roof Level** tab. A compact **Rooftop Snapshot** tile in
  the map's corner shows one status cell per roof checkpoint and jumps to
  that tab on click.
- Clicking any equipment marker opens a checklist panel with the expected
  standard for each item and a place to record what you actually observed.

## Data source & known assumptions

The source sheet was an **unfilled template** — no round had been logged
(the Date field was blank), so nothing here defaults to "passing." Every
item starts as "Not checked."

The sheet's Location column didn't always match a labeled room on the floor
plan exactly. Where a checkpoint's room was inferred rather than confirmed,
its marker shows an "assumed placement" badge. To correct one:

1. Open [`js/data.js`](js/data.js) and find the checkpoint by its `id`.
2. Change its `roomKey` to the correct id from [`js/rooms.js`](js/rooms.js),
   and set `roomConfidence: "confirmed"`.

The raw exported CSV this was built from is kept at
[`source/sheet_raw.csv`](source/sheet_raw.csv) for provenance.

## Persistence

Entries are saved to a **shared Supabase database** — every reading is
visible to anyone with this dashboard's link, and syncs across devices
immediately. There's no login: access control is enforced by Postgres Row
Level Security policies, deliberately left open to match this tool's
no-login internal use. If the dashboard can't reach the database on load,
it shows an error banner and falls back to displaying everything as "Not
checked" rather than crashing.

As of 2026-09-22 this runs on **MM_Dashboard's own Supabase project**
(consolidating with Goodyear's own deployment, `MM_Dashboard/hvac-goodyear/`,
onto the same infrastructure) under `hvac_aurora_`-prefixed tables/
functions/storage bucket — see [`js/supabase-client.js`](js/supabase-client.js)
for the exact names, and MM_Dashboard's own repo (`hvac_aurora_tables.sql`,
`hvac_aurora_data_migration.sql`, `hvac_aurora_shift_report_photos_storage.sql`)
for the live schema. `supabase/schema.sql` and
`supabase/shift_report_photos_storage.sql` in this repo are kept only as a
historical record of the schema up to this point — see their own header
notes.

Every status change and reading is appended to an activity log rather than
overwritten — browsable on the **Daily Log** tab, filterable by day.
Selecting "Attention" on a checklist item opens an "update" form (In
Progress / Monitoring / Resolved + a message) and starts a **finding**: an
issue tracked through an immutable, timestamped log of updates until it's
marked resolved. Any equipment with an unresolved finding shows a
pulsating red indicator on the map and its Roof Level card, and shows up
on the **Findings** tab, which lists every tracked issue and its full
update history.

## Who's on shift

On every page load, a gate asks who's using the dashboard: **Brett Stone**,
**Jacolby Moffett**, **John Danhoff**, **Michael Petersen**, **David Haney**,
**Ronald Vogel**, **Wilberth Carrizal**, **Tyler Christensen** (each with
their own accent color theme, applied to the header/tabs/buttons while
they're active), or **Admin** (view-only — every edit control is hidden).
It resets every time the page loads — nobody inherits the last person's
identity on a shared device.

Every checklist change and finding update is signed with whoever was
selected at the time, shown in the Daily Log and Findings tabs. Rows from
before this feature existed show "Unknown."

A named user can optionally be password-protected — a locked card prompts
for that person's password before letting you select them. Passwords are
managed from the "Manage passwords" link on the gate, itself gated behind
a separate master password. Passwords are bcrypt-hashed and verified
entirely inside Postgres functions (see `supabase/schema.sql`) — a hash
never reaches the browser, only a true/false answer — so this is real
protection against casual impersonation, not just a UI nicety. It's still
not full authentication: there's no login-attempt throttling, so it won't
stop someone determined to script repeated guesses against it. Reasonable
for a small trusted team; know that limit going in.

## End of Shift Report

A button in the header, between the title and "Acting as," opens a form
that auto-generates everything a shift needs to hand off:

- **Open Findings** — every currently unresolved finding, pulled live. An
  update is required on each one before the report can be submitted —
  every shift, even if the answer is "No change." A finding with a run of
  consecutive "No change" updates shows a streak badge (e.g. "No change
  ×3 days") so a stalled issue doesn't quietly disappear into the
  background.
- **Walkthrough Checklist Completion** — how many of the facility's
  checklist items were touched today, color-coded (33% or less: red,
  33-66%: orange, 66% or more: green), with a required text box to justify
  the number.
- **Photos (optional)** — attach photos in whatever format a phone
  actually produces (JPG, PNG, HEIC/HEIF, WEBP, GIF), up to 15MB each and
  8 photos per report, uploaded to Supabase Storage at submit time. Mirrors
  the size cap and HEIC-to-JPEG conversion MM_Dashboard's own AMM End of
  Shift Report uses for the same reason: HEIC (the default iPhone camera
  format) doesn't render in any browser but Safari.

Nothing here saves incrementally — the whole report submits as one action.
Each finding's update is an ordinary `finding_updates` row (the same table
the Findings tab's own "Log an update" form writes to); the checklist tally
and photos are stored in their own `shift_reports` row. See
`supabase/schema.sql`'s "v6" block and `supabase/shift_report_photos_storage.sql`.

## Expanding to a new site

[`onboarding.html`](onboarding.html) is a self-contained requirements doc for
standing up this dashboard at another facility — what map, equipment list,
checklist standards, and staff info we need from them. It's linked from a
button on the landing (identity) gate and has its own "Print / Save as PDF"
button, so a site manager can open it and export a PDF without any help.

## Running locally

No build step, no dependencies. Just open `index.html` in a browser, or
serve the folder with any static file server.

## Deploying

This is a zero-config static site — import the repo into Vercel and deploy
as-is (Framework Preset: **Other**, no build command, output directory:
root).

## Updating the data

If the sheet changes, re-export it as CSV (File → Download → Comma
Separated Values) and update `js/data.js` to match — there's no live
connection to the Google Sheet.
