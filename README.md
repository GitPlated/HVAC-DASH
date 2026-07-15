# Refrigeration Daily Rounds — Facility Dashboard

A SCADA/HMI-style interactive dashboard for the facility's refrigeration & HVAC
daily rounds checklist. Built from the "Refrigeration Daily Rounds" Google
Sheet and a hand-drawn facility floor plan.

## What this is

- A clickable floor plan of the facility with every rack, compressor,
  evaporator, RTU, DOAS, MAU, and blast chiller placed in its checklist
  location.
- Roof-mounted equipment (condensers, RTU, DOAS, MAU, blast chiller
  condensing units) isn't on the interior floor plan — it lives in the
  **Roof Level** panel instead.
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

Entries are saved to a **shared Supabase database** (see
[`js/supabase-client.js`](js/supabase-client.js) and
[`supabase/schema.sql`](supabase/schema.sql)) — every reading is visible to
anyone with this dashboard's link, and syncs across devices immediately.
There's no login: access control is enforced by Postgres Row Level Security
policies, deliberately left open to match this tool's no-login internal use.
If the dashboard can't reach the database on load, it shows an error banner
and falls back to displaying everything as "Not checked" rather than
crashing.

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
This is attribution,
not authentication: there's no password, and nothing stops someone from
picking a different name than their own. It resets every time the page
loads — nobody inherits the last person's identity on a shared device.

Every checklist change and finding update is signed with whoever was
selected at the time, shown in the Daily Log and Findings tabs. Rows from
before this feature existed show "Unknown."

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
