/*
 * Facility floor plan — Goodyear, AZ. First-pass layout drawn from the
 * facility's own production floor-plan graphic (workstation-code map, not an
 * architectural drawing), on the same 1240 x 1000 SVG grid Aurora's rooms.js
 * uses, north-up. Every room referenced by a checkpoint in data.js is placed
 * here; a handful of additional rooms visible on the source graphic but not
 * tied to any refrigeration/HVAC equipment are included too, for a floor
 * plan that reads as a real building rather than 19 isolated boxes.
 *
 * roomConfidence on each data.js checkpoint (not tracked here) says how
 * confident that equipment-to-room mapping is -- but even the "confirmed"
 * ones only mean the equipment list's own location text matched a labeled
 * room by name. Nothing here has been walked/verified on-site yet. Treat
 * every x/y/w/h below as a rough, proportional placement to redraw once a
 * real CAD/architectural floor plan exists (see onboarding.html Section 01
 * on Aurora's dashboard) -- same caveat Aurora's own file carries for its
 * "assumed" rooms.
 *
 * category drives fill color, same convention as Aurora's file:
 *   raw         -> navy blue   (cold storage, docks, debox/holding areas)
 *   cooked      -> white/light (production: plating, sleeving, blast, kitchen)
 *   admin       -> neutral gray (office/break/bathroom/non-production)
 *   mechanical  -> slate        (refrigeration/electrical/mechanical rooms)
 *
 * Roof-mounted equipment has roomKey "roof" and is intentionally NOT drawn
 * here, same as Aurora -- see js/app.js's Roof Level tab / Rooftop Snapshot.
 * Nothing in Goodyear's current equipment list is roof-mounted (no RTU/DOAS/
 * MAU rows were provided), so "roof" isn't used by any checkpoint yet.
 */

const VIEWBOX = { w: 1240, h: 1000 };

const ROOMS = [
  // ── Top strip: dry/receiving/dock areas ──────────────────────────────
  { id: "fulfillment-dry-storage", label: "Fulfillment Dry Storage", x: 20,   y: 20,  w: 220, h: 160, category: "raw" },
  { id: "add-on-holding",          label: "Add On Holding",         x: 260,  y: 20,  w: 160, h: 70,  category: "raw" },
  { id: "outbound-dock",           label: "Outbound Dock",          x: 440,  y: 20,  w: 400, h: 70,  category: "raw" },
  { id: "printing-room",           label: "Printing Room",          x: 860,  y: 20,  w: 140, h: 70,  category: "admin" },
  { id: "raw-trash",               label: "Raw Trash",              x: 1020, y: 20,  w: 90,  h: 70,  category: "admin" },
  { id: "inbound-dock",            label: "Inbound Dock",           x: 1130, y: 20,  w: 90,  h: 130, category: "raw" },

  // ── Second strip ──────────────────────────────────────────────────────
  { id: "z-chamber",         label: "Z-Chamber",         x: 260, y: 100, w: 90,  h: 90,  category: "raw" },
  { id: "veggie-holding",    label: "Veggie Holding",    x: 370, y: 100, w: 150, h: 90,  category: "raw" },
  { id: "dry-storage",       label: "Dry Storage",       x: 540, y: 100, w: 150, h: 90,  category: "raw" },
  { id: "protein-holding",   label: "Protein Holding",   x: 710, y: 100, w: 150, h: 90,  category: "raw" },
  { id: "bulk-sanitation",   label: "Bulk Sanitation",   x: 1020, y: 100, w: 100, h: 50,  category: "admin" },

  // ── Middle: freezer / debox / IQF strip ──────────────────────────────
  { id: "fulfillment",       label: "Fulfillment",       x: 20,  y: 200, w: 240, h: 300, category: "raw" },
  { id: "fulfillment-freezer", label: "Fulfillment Freezer", x: 280, y: 200, w: 130, h: 300, category: "raw" },
  { id: "veggie-freezer",    label: "Veggie Freezer",    x: 420, y: 200, w: 100, h: 90,  category: "raw" },
  { id: "iqf",               label: "IQF",               x: 530, y: 200, w: 90,  h: 90,  category: "raw" },
  { id: "veggie-debox",      label: "Veggie Debox",      x: 530, y: 300, w: 90,  h: 100, category: "raw" },
  { id: "protein-debox",     label: "Protein Debox",     x: 630, y: 300, w: 100, h: 100, category: "raw" },
  { id: "large-dish",        label: "Large Dish",        x: 630, y: 200, w: 130, h: 90,  category: "admin" },

  // ── Sleeving / plating / freezer-debox / trash ───────────────────────
  { id: "sleeving",          label: "Sleeving P2",       x: 420, y: 300, w: 100, h: 200, category: "cooked" },
  { id: "protein-prep",      label: "Protein Prep",      x: 630, y: 610, w: 30,  h: 140, category: "cooked" },
  { id: "plating",           label: "Plating P1",        x: 530, y: 410, w: 200, h: 190, category: "cooked" },
  { id: "freezer-debox",     label: "Freezer Debox",     x: 20,  y: 510, w: 130, h: 90,  category: "raw" },
  { id: "trash-room",        label: "Trash Room",        x: 160, y: 510, w: 110, h: 90,  category: "admin" },

  // ── Right-of-center: dish/whip/chef/QC/clean cart ────────────────────
  { id: "small-dish",         label: "Small Dish",         x: 900,  y: 200, w: 100, h: 90,  category: "admin" },
  { id: "whip-room",          label: "Whip Room",          x: 1010, y: 200, w: 110, h: 60,  category: "raw" },
  { id: "chef-office",        label: "Chef Office",        x: 1010, y: 270, w: 110, h: 60,  category: "admin" },
  { id: "clean-cart-storage", label: "Clean Cart Storage", x: 770,  y: 300, w: 120, h: 90,  category: "admin" },
  { id: "qc-office",          label: "QC Office",          x: 420,  y: 510, w: 100, h: 60,  category: "admin" },

  // ── Lower-middle: blast / kitchen / fulfillment holding ──────────────
  { id: "blast-holding",      label: "Blast Holding",      x: 300,  y: 610, w: 150, h: 140, category: "cooked" },
  { id: "blast-chill",        label: "Blast Chill",        x: 460,  y: 610, w: 100, h: 140, category: "cooked" },
  { id: "chiller-room",       label: "Chiller Room",       x: 570,  y: 610, w: 80,  h: 70,  category: "mechanical" },
  { id: "oven-room",          label: "Oven Room",          x: 660,  y: 610, w: 90,  h: 70,  category: "cooked" },
  { id: "platters-room",      label: "Platters Room",      x: 760,  y: 610, w: 90,  h: 70,  category: "cooked" },
  { id: "acl",                label: "ACL",                x: 660,  y: 690, w: 190, h: 60,  category: "raw" },
  { id: "kitchen",            label: "Kitchen",            x: 860,  y: 400, w: 260, h: 350, category: "cooked" },
  { id: "fulfillment-holding", label: "Fulfillment Holding", x: 20,  y: 700, w: 260, h: 190, category: "raw" },

  // ── Bottom strip: bathrooms/lockers/break/refrigeration/mechanical ──
  { id: "bathrooms",         label: "Bathrooms",         x: 20,   y: 900, w: 150, h: 80,  category: "admin" },
  { id: "f5-lockers",        label: "F5 Lockers",        x: 180,  y: 900, w: 100, h: 80,  category: "admin" },
  { id: "break-room",        label: "Break Room",        x: 300,  y: 900, w: 340, h: 80,  category: "admin" },
  { id: "storage",           label: "Storage",           x: 660,  y: 900, w: 90,  h: 80,  category: "admin" },
  { id: "electrical-room",   label: "Electrical Room",   x: 760,  y: 900, w: 100, h: 80,  category: "mechanical" },
  { id: "refrigeration-room",label: "Refrigeration Room",x: 870,  y: 900, w: 160, h: 80,  category: "mechanical" },
  { id: "mechanical-room",   label: "Mechanical Room",   x: 1040, y: 900, w: 90,  h: 80,  category: "mechanical" },
  { id: "exit-corridor",     label: "Exit Corridor",     x: 1140, y: 900, w: 45,  h: 80,  category: "admin" },
  { id: "maintenance-room",  label: "Maintenance Room",  x: 1195, y: 900, w: 40,  h: 80,  category: "mechanical" },

  // ── Referenced by data.js but not confidently placeable on the source
  // graphic at all -- given a small placeholder slot near the room its
  // Area number's neighbors suggest, rather than guessed onto real square
  // footage that likely belongs to something else. roomConfidence on
  // their checkpoint entries is "assumed" for exactly this reason.
  { id: "wip-holding",  label: "WIP Holding",  x: 300, y: 760, w: 100, h: 90, category: "raw" },
  { id: "spiral-room",  label: "Spiral Room",  x: 410, y: 760, w: 100, h: 90, category: "cooked" },
];

const ROOM_LEGEND = [
  { category: "raw", label: "Raw Area" },
  { category: "cooked", label: "Cooked Area" },
  { category: "mechanical", label: "Mechanical Room" },
  { category: "admin", label: "Office / Admin" }
];

if (typeof module !== "undefined") module.exports = { VIEWBOX, ROOMS, ROOM_LEGEND };
