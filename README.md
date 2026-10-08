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

On every page load, a gate asks who's using the dashboard. The cards are the
people on the **network roster**, not a list in this repo: no roster person's name is written
anywhere in the code. Each person gets their own accent color (computed
from a hash of their card and nudged apart from the other cards' colors, applied to the header/tabs/buttons while
they're active). **Admin** (view-only — every edit control is hidden) is app
config, not a person. A **Sandbox** card (full access, nothing it does is
saved) is the one deliberate exception that is not on the roster.
It resets every time the page loads — nobody inherits the last person's
identity on a shared device.

### How the cards work

In Network Roster, a row gets an Aurora identity card when it is **IL01**,
has **HVAC dashboard card** switched on (the `mm_roster.hvac_dash` column),
is **active**, and has an **email**. Everything follows from that, with no
code edit, no SQL and no CSV step:

- **A person leaves, or their seat is marked open** (email cleared): their
  card disappears by itself (the flag is also cleared by a trigger when the
  seat is vacated, so whoever fills it next does not inherit it).
- **A new person is flagged** in Network Roster: their card appears by itself.
- A person **with an MM Dashboard role** gets a card that opens the real
  MM Dashboard sign-in (password, the roster-active check below, then MFA)
  using the email the roster holds. A flagged person **without a role** gets
  an attribution-only card, exactly like the lightweight cards before.
- The page asks the roster on load and again on every **Switch**, so a card
  for someone who left mid-shift cannot be picked after the next Switch.

The page gets the list from one narrow database function,
`hvac_dash_identities('IL01')`, which returns `{ name, email, needs_login }`
and only returns an email for people who need to sign in (the page cannot read
the roster table itself). **There is no hardcoded fallback list.** If the
function is missing, errors, stalls (8 seconds) or returns nothing usable, the
gate says "Roster unavailable - reload or ask a manager" and only the Admin
(view-only) card works, so the floor can still look at the dashboard but
nobody can record anything without a roster identity.

Names stamped on past checks, findings and updates are historical records and
are not rewritten when a roster name changes.

**Deploy order.** The database function must exist before this version of the
page goes live (an older page does not call it, but this one shows Admin only
until it does). So: 1) the owner runs the SQL that adds `mm_roster.hvac_dash`,
the trigger and `hvac_dash_identities`, 2) checks it (the site's flagged people
come back, an anon call works, a direct anon read of `mm_roster` still does
not), 3) flags the Aurora people in Network Roster, 4) only then is this page
pushed. Rolling back is a revert of the page; the SQL is additive.

### Passwords and the roster check

Every checklist change and finding update is signed with whoever was
selected at the time, shown in the Daily Log and Findings tabs. Rows from
before this feature existed show "Unknown."

An attribution-only card can optionally be password-protected — a locked card
prompts for that person's password before letting you select them. Passwords
are keyed by the person's display name and managed from the "Manage passwords"
link on the gate, itself gated behind a separate master password. Passwords
are bcrypt-hashed and verified entirely inside Postgres functions (see
`supabase/schema.sql`) — a hash never reaches the browser, only a true/false
answer — so this is real protection against casual impersonation, not just a
UI nicety. It's still not full authentication: there's no login-attempt
throttling, so it won't stop someone determined to script repeated guesses
against it. Reasonable for a small trusted team; know that limit going in.

The cards that sign in with a real MM Dashboard account also get a roster
check: right after the password
passes, and before any MFA prompt, the page asks the database whether that
account's email is still on an **active** `mm_roster` row that has an MM
Dashboard Role (the same test Sync Login Access uses, so clearing someone's
role in Network Roster locks their card too). A departed person's MM
Dashboard password otherwise keeps working here (Sync Login Access clears
their role but never disables the account). Only a definite "no" blocks the
card; if the check can't run (network error, no answer within 5 seconds, odd
response, or the migration not run yet) the sign-in goes ahead and a warning
is logged to the console, so the shop floor is never locked out by an outage
or a deploy-order slip. Cancelling, or picking another card, while a sign-in
is still in progress abandons it instead of letting it finish and grant the
card. The Sandbox account is exempt because it is
deliberately kept off the roster. Unlike `supabase/schema.sql`,
[`supabase/2026-10-07_hvac_aurora_roster_active_check.sql`](supabase/2026-10-07_hvac_aurora_roster_active_check.sql)
is **not** a historical record: it is a live migration that has to be run by
hand in MM_Dashboard's Supabase project (preflight query first; the same file
has the one-line `drop function` that turns the check back off). Goodyear is a
separate deployment (`MM_Dashboard/hvac-goodyear/`) and is not covered here.

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

Every submitted report is browsable on the **EOS Reports** tab, newest first:
the checklist tally and justification, the finding updates logged with it
(matched by author and time, since updates carry no report id), and its
photos. A From/To date filter narrows the list (pick one date for a single
day); it filters on the local date shown on each card, not the `shift_date`
column, which runs a day ahead for evening reports. The report posted to
Slack links straight to it: `#reports` opens
the tab, `#reports/<id>` also scrolls to and highlights that one report.

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
