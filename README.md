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
item starts as "Not checked." The one exception is Rack B Compressor 5,
which the sheet already flags as `BAD COMPRESSOR / NOT IN SERVICE — Working
with AMS for replacement` — that shows up pre-loaded as a critical fault.

The sheet's Location column didn't always match a labeled room on the floor
plan exactly. Where a checkpoint's room was inferred rather than confirmed,
its marker shows an "assumed placement" badge. To correct one:

1. Open [`js/data.js`](js/data.js) and find the checkpoint by its `id`.
2. Change its `roomKey` to the correct id from [`js/rooms.js`](js/rooms.js),
   and set `roomConfidence: "confirmed"`.

The raw exported CSV this was built from is kept at
[`source/sheet_raw.csv`](source/sheet_raw.csv) for provenance.

## Persistence

Entries are saved to **localStorage in your own browser only** — there's no
backend or shared database yet. Readings won't sync between devices, and
clearing browser data clears them. A "Reset all entries" button in the
header wipes everything after a confirmation prompt.

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
