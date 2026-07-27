/*
 * Facility floor plan — redrawn/cleaned up from the reference sketch, on a
 * 1240 x 1000 (interior) SVG grid, north-up (matches the reference
 * orientation), plus a dedicated Roof Level band below the interior rooms.
 *
 * category drives fill color:
 *   raw         -> navy blue  (matches source legend: "Raw Area")
 *   cooked      -> white/light (matches source legend: "Cooked Area")
 *   admin       -> neutral gray (office/entrance/hallway, non-production)
 *   mechanical  -> slate (compressor rooms — not on the source sketch; placed
 *                 by name logic: "next to MRE" / "behind Large Dishroom")
 *   roof        -> warm tan/brown (the "roof" pseudo-room below — every
 *                 checkpoint with roomKey "roof" gets a marker here, exactly
 *                 like any other room; see CHECKPOINTS_BY_ROOM in js/app.js)
 *
 * Roof-mounted equipment (Rack Condensers, room condensers, RTU, DOAS, MAU,
 * Blast Chiller Condensing Units) also still gets its own card grid in the
 * separate Roof Level tab — the map marker and that card are two views onto
 * the exact same checkpoint, not a duplicate/competing data source.
 */

const VIEWBOX = { w: 1240, h: 1190 };

const ROOMS = [
  // ---- admin / non-production (context only, no equipment) ----
  { id: "entrance",        label: "Entrance Area",        x: 300,  y: 20,  w: 620, h: 64,  category: "admin" },
  { id: "office-area",     label: "Office Area",          x: 300,  y: 94,  w: 300, h: 100, category: "admin" },
  { id: "cafeteria",       label: "Cafeteria",            x: 610,  y: 94,  w: 310, h: 100, category: "admin" },
  { id: "mre",             label: "MRE",                  x: 300,  y: 210, w: 140, h: 40,  category: "admin" },
  { id: "main-hallway",    label: "Main Hallway",         x: 450,  y: 210, w: 460, h: 40,  category: "admin" },
  { id: "gowning-area",    label: "Gowning / Office",     x: 920,  y: 210, w: 100, h: 40,  category: "cooked" },
  { id: "printing-area",   label: "Printing Area",        x: 1030, y: 94,  w: 90,  h: 228, category: "cooked" },
  { id: "warehouse",       label: "Warehouse",            x: 1126, y: 94,  w: 94,  h: 228, category: "cooked" },
  { id: "large-kitchen",   label: "Large Kitchen",        x: 560,  y: 254, w: 300, h: 40,  category: "raw" },
  { id: "small-kitchen",   label: "Small Kitchen",        x: 410,  y: 772, w: 100, h: 200, category: "raw" },
  { id: "small-dishroom",  label: "Small Dishroom",       x: 300,  y: 772, w: 100, h: 200, category: "raw" },
  { id: "scrubbing-room",  label: "Scrubbing Room",       x: 850,  y: 772, w: 100, h: 200, category: "raw" },
  { id: "chemical-room",   label: "Chemical Room",        x: 960,  y: 772, w: 90,  h: 130, category: "raw" },
  { id: "electrical-closet", label: "Electrical Closet",  x: 960,  y: 910, w: 90,  h: 62,  category: "raw" },
  { id: "large-dishroom",  label: "Large Dishroom",       x: 636,  y: 580, w: 250, h: 80,  category: "raw" },

  // ---- mechanical rooms (inferred placement, not on the source sketch) ----
  { id: "compressor-room-north", label: "North Compressor Room", x: 20,  y: 94,  w: 270, h: 140, category: "mechanical" },
  { id: "compressor-room-south", label: "South Compressor Room", x: 636, y: 672, w: 250, h: 90,  category: "mechanical" },

  // ---- raw-side production rooms (equipment lives here) ----
  { id: "veggie-holding",    label: "Veggie Holding",     x: 20,  y: 250, w: 260, h: 280, category: "raw" },
  { id: "veggie-staging",    label: "Veggie Staging",     x: 300, y: 300, w: 210, h: 130, category: "raw" },
  { id: "veggie-debox",      label: "Veggie Debox",       x: 520, y: 300, w: 105, h: 180, category: "raw" },
  { id: "wip-room",          label: "Veggie Corridor",    x: 520, y: 490, w: 105, h: 110, category: "raw" },
  { id: "freezer",           label: "Freezer",            x: 20,  y: 546, w: 170, h: 210, category: "raw" },
  { id: "dry-veggie-storage",label: "Dry Veggie Storage", x: 200, y: 546, w: 210, h: 210, category: "raw" },
  { id: "receiving",         label: "Receiving",          x: 20,  y: 772, w: 270, h: 200, category: "raw" },
  { id: "burger-room",       label: "Burger Room",        x: 520, y: 772, w: 100, h: 200, category: "raw" },
  { id: "protein-debox",     label: "Protein Debox",      x: 630, y: 772, w: 100, h: 200, category: "raw" },
  { id: "protein-storage",   label: "Protein Storage",    x: 740, y: 772, w: 100, h: 200, category: "raw" },

  // ---- cooked-side production rooms (equipment lives here) ----
  { id: "blast-chill",         label: "Blast Chill",          x: 636,  y: 300, w: 120, h: 270, category: "cooked" },
  { id: "holding-cooler",      label: "Holding Cooler",       x: 766,  y: 300, w: 110, h: 270, category: "cooked" },
  { id: "production-plating",  label: "Production Plating",   x: 890,  y: 254, w: 132, h: 406, category: "cooked" },
  { id: "production-sleeving", label: "Production Sleeving",  x: 1030, y: 330, w: 90,  h: 330, category: "cooked" },
  { id: "shipping",             label: "Shipping",            x: 1126, y: 330, w: 94,  h: 330, category: "cooked" },

  // ---- roof level (see the file-header comment above) ----
  { id: "roof", label: "Roof Level", x: 20, y: 1010, w: 1200, h: 150, category: "roof" }
];

const ROOM_LEGEND = [
  { category: "raw", label: "Raw Area" },
  { category: "cooked", label: "Cooked Area" },
  { category: "mechanical", label: "Mechanical Room" },
  { category: "admin", label: "Office / Admin" },
  { category: "roof", label: "Roof Level" }
];

if (typeof module !== "undefined") module.exports = { VIEWBOX, ROOMS, ROOM_LEGEND };
