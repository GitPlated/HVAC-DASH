/*
 * app.js — renders the floor plan / roof panel / daily log / findings pages
 * from ROOMS + EQUIPMENT_GROUPS and manages checklist + findings state backed
 * by Supabase (via window.ChecklistStore, defined in js/supabase-client.js).
 * Plain script, no modules, no build step — relies on rooms.js, data.js, and
 * supabase-client.js having already defined their globals before this file
 * runs.
 *
 * Data model (mirrors supabase/schema.sql):
 *   - checklist_log is APPEND-ONLY. Every status change or reading is a new
 *     row. "Current" value for a (checkpoint_id, item_key) pair is always
 *     the latest row for that pair, computed client-side after one bulk
 *     fetch (see ingestLog / recomputeCacheFromLog below).
 *   - findings is one row per tracked issue (opened when "Attention" is
 *     selected on a groupChecklist item and saved via the in-panel update
 *     form). finding_updates is an append-only, immutable timeline of
 *     status+message entries within a finding.
 *   - Rack subsections (oil level) are logged the same way as group items
 *     but never get the findings workflow.
 *
 * In-memory state, populated once on startup from ChecklistStore.loadAll()
 * and kept in sync optimistically on every user edit (the same edit also
 * fires an async write to Supabase in the background; a failed background
 * write is surfaced inline and logged to the console — it does not roll
 * back the optimistic UI, matching the app's existing philosophy that the
 * next full page load is the real source of truth):
 *
 *   LOG_ROWS            -> raw checklist_log rows (kept for the Daily Log feed)
 *   CACHE.group[cpId][itemKey] -> { state, notes }   (derived "latest" view)
 *   CACHE.sub[cpId][designation] -> { oilLevel, notes } (derived "latest" view)
 *   FINDINGS_LIST       -> raw findings rows
 *   FINDING_UPDATES_LIST-> raw finding_updates rows
 *   FINDINGS_BY_ID      -> finding.id -> finding
 *   UPDATES_BY_FINDING  -> finding.id -> [updates] (sorted newest first)
 *   FINDINGS_BY_ITEM    -> "cpId::itemKey" -> [findings] (sorted oldest first)
 */

// ---------------------------------------------------------------- vocabulary
// The 3-state control on group checklist rows only ever uses these three.
// Values match the checklist_log.status column exactly (no more hyphen/
// underscore translation layer).
const ITEM_STATES = ["not_checked", "ok", "attention"];

const ITEM_STATE_META = {
  "not_checked": { label: "Not checked", color: "#6b6a66", text: "#ffffff" },
  "ok": { label: "OK", color: "#0ca30c", text: "#ffffff" },
  "attention": { label: "Attention", color: "#fab219", text: "#1a1200" }
};

// Aggregate status for a checkpoint's marker / roof card / legend. Severity
// is tracked entirely through a finding's own in_progress/monitoring/resolved
// lifecycle now, not by counting flagged items, so the old graduated
// warning/serious/critical tiers are gone.
const AGGREGATE_STATUS_META = {
  "not_checked": { label: "Not checked", color: "#6b6a66", text: "#ffffff" },
  "ok": { label: "OK", color: "#0ca30c", text: "#ffffff" },
  "active_issue": { label: "Active issue", color: "#d03b3b", text: "#ffffff" },
  "resolved_issue": { label: "Resolved issue", color: "#2e8f8f", text: "#ffffff" }
};

// The 3-option status used inside a finding's "Log an update" form and shown
// on its immutable timeline entries.
const FINDING_STATE_META = {
  "in_progress": { label: "In Progress" },
  "monitoring": { label: "Monitoring" },
  "resolved": { label: "Resolved" }
};

// Distinct glyph shapes per status so color is never the only signal
// (dash / check / triangle / triangle-with-! / circle-check). currentColor
// is used throughout so callers can tint via the CSS `color` property (or
// element.style.color) whether the icon lives in HTML or in the SVG map.
const ICON_SHAPES = {
  "not_checked": '<line x1="5" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  "ok": '<path d="M4 10.5 L8.5 15 L16 5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  "attention": '<path d="M10 3 L18 17 L2 17 Z" fill="currentColor"/>',
  "active_issue": '<path d="M10 2 L18.5 17 L1.5 17 Z" fill="currentColor"/><rect x="9" y="7" width="2" height="5" fill="#fff"/><rect x="9" y="13.4" width="2" height="2" fill="#fff"/>',
  "resolved_issue": '<circle cx="10" cy="10" r="8.5" fill="currentColor"/><path d="M5.7 10.3 L8.7 13.3 L14.5 6.7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
};

function iconHTML(status, size) {
  return '<svg viewBox="0 0 20 20" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    ICON_SHAPES[status] + '</svg>';
}

const CATEGORY_COLORS = {
  raw: { fill: "#1b3a5c", stroke: "#3d6690", text: "#eef2f6" },
  cooked: { fill: "#f2f0e7", stroke: "rgba(20,20,15,0.35)", text: "#23231f" },
  admin: { fill: "#8a8d93", stroke: "rgba(255,255,255,0.25)", text: "#1a1a1a" },
  mechanical: { fill: "#46525c", stroke: "#6f7a84", text: "#eef2f6" }
};

// ---------------------------------------------------------------- identity
// "Acting as" identity gate — attribution + a visual "who am I" indicator by
// explicit design, NOT real authentication (anyone can pick any name; there
// is no password). Deliberately NOT persisted anywhere (no localStorage/
// sessionStorage) — every fresh page load, and every explicit "Switch",
// resets to no-actor-selected and shows the gate again.
//
// Admin is view-only: every edit affordance (segmented Not-checked/OK/
// Attention buttons, the oil-level <select>, every notes input + Save
// button, and the finding update form/"Add update") must be hidden or
// disabled and genuinely non-interactive under Admin — canEdit() below is
// the single source of truth every one of those call sites checks (both to
// disable at render time AND to early-return inside the click/change
// handler itself, so nothing is reachable through devtools DOM tampering
// either).
const IDENTITY_OPTIONS = [
  { id: "brett", name: "Brett Stone", themeClass: "identity-theme-brett" },
  { id: "jacolby", name: "Jacolby Moffett", themeClass: "identity-theme-jacolby" },
  { id: "john", name: "John Danhoff", themeClass: "identity-theme-john" },
  { id: "michael", name: "Michael Petersen", themeClass: "identity-theme-michael" },
  { id: "david", name: "David Haney", themeClass: "identity-theme-david" },
  { id: "ronald", name: "Ronald Vogel", themeClass: "identity-theme-ronald" },
  { id: "wilberth", name: "Wilberth Carrizal", themeClass: "identity-theme-wilberth" },
  { id: "tyler", name: "Tyler Christensen", themeClass: "identity-theme-tyler" },
  { id: "admin", name: "Admin", themeClass: null, isAdmin: true }
];
const IDENTITY_BY_ID = {};
IDENTITY_OPTIONS.forEach(function (o) { IDENTITY_BY_ID[o.id] = o; });

let CURRENT_IDENTITY = null; // null until a gate option is picked (or after Switch)
let CURRENT_PANEL_CHECKPOINT = null; // checkpoint behind the open slide-over, if any — lets a mid-session Switch rebuild it in place

// True only for a real named user — false for Admin AND for the
// no-identity-picked-yet state (the gate should be covering the screen in
// that case, but every write/edit path checks this too, belt-and-suspenders).
function canEdit() {
  return !!(CURRENT_IDENTITY && !CURRENT_IDENTITY.isAdmin);
}

function isAdminView() {
  return !!(CURRENT_IDENTITY && CURRENT_IDENTITY.isAdmin);
}

// Display name to stamp on writes — null when there's no real actor (Admin
// can't reach any write path anyway, since every edit affordance is disabled
// or hidden for it).
function currentActorName() {
  return canEdit() ? CURRENT_IDENTITY.name : null;
}

function applyIdentityTheme(identity) {
  IDENTITY_OPTIONS.forEach(function (o) {
    if (o.themeClass) document.body.classList.remove(o.themeClass);
  });
  if (identity && identity.themeClass) document.body.classList.add(identity.themeClass);
}

function updateActingAsUI() {
  const nameEl = document.getElementById("acting-as-name");
  const viewOnlyEl = document.getElementById("acting-as-viewonly");
  if (nameEl) nameEl.textContent = CURRENT_IDENTITY ? CURRENT_IDENTITY.name : "—";
  if (viewOnlyEl) viewOnlyEl.hidden = !isAdminView();
}

function showIdentityGate() {
  CURRENT_IDENTITY = null;
  applyIdentityTheme(null);
  updateActingAsUI();
  const gate = document.getElementById("identity-gate");
  if (gate) gate.hidden = false;
}

function hideIdentityGate() {
  const gate = document.getElementById("identity-gate");
  if (gate) gate.hidden = true;
}

function selectIdentity(identityId) {
  const identity = IDENTITY_BY_ID[identityId];
  if (!identity) return;
  CURRENT_IDENTITY = identity;
  applyIdentityTheme(identity);
  updateActingAsUI();
  hideIdentityGate();
  // Re-render anything whose edit-affordance/attribution state depends on
  // the actor so a mid-session Switch takes effect immediately, with no page
  // reload — including the currently-open slide-over panel, if any.
  refreshStatusesUI();
  if (CURRENT_PANEL_CHECKPOINT) buildPanelBody(CURRENT_PANEL_CHECKPOINT);
  renderFindingsView();
}

function wireIdentityGate() {
  document.querySelectorAll(".identity-card").forEach(function (card) {
    card.addEventListener("click", function () { selectIdentity(card.dataset.identity); });
  });
  const switchBtn = document.getElementById("btn-switch-identity");
  if (switchBtn) switchBtn.addEventListener("click", showIdentityGate);
}

// ---------------------------------------------------------------- storage
const CACHE = { group: {}, sub: {} };

let LOG_ROWS = [];
let FINDINGS_LIST = [];
let FINDING_UPDATES_LIST = [];
let FINDINGS_BY_ID = {};
let UPDATES_BY_FINDING = {};
let FINDINGS_BY_ITEM = {};

function getGroupEntries(checkpointId) {
  return CACHE.group[checkpointId] || {};
}

function getSubEntry(checkpointId, designation) {
  return (CACHE.sub[checkpointId] && CACHE.sub[checkpointId][designation]) || { oilLevel: "", notes: "" };
}

function setGroupEntryLocal(checkpointId, itemKey, state, notes) {
  if (!CACHE.group[checkpointId]) CACHE.group[checkpointId] = {};
  CACHE.group[checkpointId][itemKey] = { state: state, notes: notes || "" };
}

function setSubEntryLocal(checkpointId, designation, oilLevel, notes) {
  if (!CACHE.sub[checkpointId]) CACHE.sub[checkpointId] = {};
  CACHE.sub[checkpointId][designation] = { oilLevel: oilLevel || "", notes: notes || "" };
}

function oilDbToLocal(oilLevel) {
  return oilLevel ? String(oilLevel).replace("%", "") : "";
}
function oilLocalToDb(oilLevel) {
  return oilLevel ? oilLevel + "%" : null;
}

// Rebuilds CACHE (the "latest value per key" view) from the flat row list
// returned by ChecklistStore.loadLog() / kept in LOG_ROWS. Rows are folded in
// ascending timestamp order so the last write per key wins — no separate
// "find max" pass needed.
function recomputeCacheFromLog() {
  CACHE.group = {};
  CACHE.sub = {};
  const sorted = LOG_ROWS.slice().sort(function (a, b) {
    return (new Date(a.created_at) - new Date(b.created_at)) || ((a.id || 0) - (b.id || 0));
  });
  sorted.forEach(function (row) {
    if (!row || !row.checkpoint_id || !row.item_key) return;
    if (row.item_key.indexOf("sub:") === 0) {
      setSubEntryLocal(row.checkpoint_id, row.item_key.slice(4), oilDbToLocal(row.oil_level), row.notes);
    } else {
      setGroupEntryLocal(row.checkpoint_id, row.item_key, row.status || "not_checked", row.notes);
    }
  });
}

function ingestLog(rows) {
  LOG_ROWS = rows || [];
  recomputeCacheFromLog();
}

function rebuildFindingMaps() {
  FINDINGS_BY_ID = {};
  FINDINGS_LIST.forEach(function (f) { FINDINGS_BY_ID[f.id] = f; });

  UPDATES_BY_FINDING = {};
  FINDING_UPDATES_LIST.forEach(function (u) {
    if (!UPDATES_BY_FINDING[u.finding_id]) UPDATES_BY_FINDING[u.finding_id] = [];
    UPDATES_BY_FINDING[u.finding_id].push(u);
  });
  Object.keys(UPDATES_BY_FINDING).forEach(function (fid) {
    UPDATES_BY_FINDING[fid].sort(function (a, b) {
      return (new Date(b.created_at) - new Date(a.created_at)) || ((b.id || 0) - (a.id || 0));
    });
  });

  FINDINGS_BY_ITEM = {};
  FINDINGS_LIST.forEach(function (f) {
    const key = f.checkpoint_id + "::" + f.item_key;
    if (!FINDINGS_BY_ITEM[key]) FINDINGS_BY_ITEM[key] = [];
    FINDINGS_BY_ITEM[key].push(f);
  });
  Object.keys(FINDINGS_BY_ITEM).forEach(function (key) {
    FINDINGS_BY_ITEM[key].sort(function (a, b) {
      return (new Date(a.opened_at) - new Date(b.opened_at)) || ((a.id || 0) - (b.id || 0));
    });
  });
}

function ingestFindings(findingsRows, updateRows) {
  FINDINGS_LIST = findingsRows || [];
  FINDING_UPDATES_LIST = updateRows || [];
  rebuildFindingMaps();
}

// Merges a freshly-created/updated finding + update into local state without
// a re-fetch.
function applyFindingResult(finding, update) {
  if (finding) {
    const idx = FINDINGS_LIST.findIndex(function (f) { return f.id === finding.id; });
    if (idx >= 0) FINDINGS_LIST[idx] = finding;
    else FINDINGS_LIST.push(finding);
  }
  if (update) FINDING_UPDATES_LIST.push(update);
  rebuildFindingMaps();
}

// { unresolved: finding|null, mostRecent: finding|null } for a checkpoint+item.
// There should be at most one unresolved finding per pair at a time (the save
// flow below enforces that by re-using any existing unresolved finding).
function getItemFindingInfo(checkpointId, itemKey) {
  const list = FINDINGS_BY_ITEM[checkpointId + "::" + itemKey] || [];
  let unresolved = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].status !== "resolved") { unresolved = list[i]; break; }
  }
  return { unresolved: unresolved, mostRecent: list.length ? list[list.length - 1] : null, all: list };
}

function checkpointHasUnresolvedFinding(checkpointId) {
  return FINDINGS_LIST.some(function (f) { return f.checkpoint_id === checkpointId && f.status !== "resolved"; });
}

function checkpointHasResolvedFinding(checkpointId) {
  return FINDINGS_LIST.some(function (f) { return f.checkpoint_id === checkpointId && f.status === "resolved"; });
}

// -------------------------------------------------------------- aggregate
/*
 * Aggregate status for a checkpoint's marker / card color:
 *   - "active_issue" wins over everything else: at least one UNRESOLVED
 *     finding exists for any item on this checkpoint. This is independent of
 *     whatever the raw Not-checked/OK/Attention toggle currently shows.
 *   - "resolved_issue": no unresolved finding, but at least one finding on
 *     this checkpoint has been resolved — worth a calmer, distinct note that
 *     this equipment had a tracked issue.
 *   - "ok": nothing unresolved/resolved to flag, and at least one item has
 *     actually been recorded (group item != not_checked, or an oil level was
 *     entered).
 *   - "not_checked": nothing recorded at all yet.
 */
function computeAggregateStatus(checkpoint) {
  if (checkpointHasUnresolvedFinding(checkpoint.id)) return "active_issue";
  if (checkpointHasResolvedFinding(checkpoint.id)) return "resolved_issue";

  let recordedCount = 0;
  const groupData = getGroupEntries(checkpoint.id);
  (checkpoint.groupChecklist || []).forEach(function (ci) {
    const entry = groupData[ci.item];
    const state = entry ? entry.state : "not_checked";
    if (state !== "not_checked") recordedCount++;
  });
  (checkpoint.subsections || []).forEach(function (s) {
    const sub = getSubEntry(checkpoint.id, s.designation);
    if (sub.oilLevel) recordedCount++;
  });

  return recordedCount > 0 ? "ok" : "not_checked";
}

// -------------------------------------------------------------- lookups
const ROOMS_BY_ID = {};
ROOMS.forEach(function (r) { ROOMS_BY_ID[r.id] = r; });

const CHECKPOINTS_BY_ROOM = {};
const EQUIPMENT_BY_ID = {};
EQUIPMENT_GROUPS.forEach(function (cp) {
  EQUIPMENT_BY_ID[cp.id] = cp;
  if (cp.roomKey === "roof") return;
  if (!CHECKPOINTS_BY_ROOM[cp.roomKey]) CHECKPOINTS_BY_ROOM[cp.roomKey] = [];
  CHECKPOINTS_BY_ROOM[cp.roomKey].push(cp);
});

function roomHasActiveIssue(roomId) {
  const cps = CHECKPOINTS_BY_ROOM[roomId] || [];
  return cps.some(function (cp) { return checkpointHasUnresolvedFinding(cp.id); });
}

function itemDisplayName(checkpoint, itemKey) {
  if (itemKey && itemKey.indexOf("sub:") === 0) return "Compressor " + itemKey.slice(4);
  return itemKey;
}

// -------------------------------------------------------------- SVG helpers
function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
  }
  return el;
}

function layoutMarkers(room, count) {
  const pad = 18;
  const spacing = 20;
  const usableW = Math.max(room.w - pad * 2, spacing);
  const perRow = Math.max(1, Math.floor(usableW / spacing) + 1);
  const positions = [];
  for (let i = 0; i < count; i++) {
    const rowIdx = Math.floor(i / perRow);
    const colIdx = i % perRow;
    const rowCount = Math.min(perRow, count - rowIdx * perRow);
    const rowWidth = (rowCount - 1) * spacing;
    const startX = room.x + room.w / 2 - rowWidth / 2;
    const x = startX + colIdx * spacing;
    const y = Math.min(room.y + pad + rowIdx * spacing, room.y + room.h - pad);
    positions.push({ x: x, y: y });
  }
  return positions;
}

function buildMarker(checkpoint, cx, cy) {
  const status = computeAggregateStatus(checkpoint);
  const meta = AGGREGATE_STATUS_META[status];
  const g = svgEl("g", { "class": "marker", tabindex: "0", role: "button" });

  const title = svgEl("title");
  let titleText = checkpoint.equipment +
    (checkpoint.designation ? " (" + checkpoint.designation + ")" : "") +
    " — " + meta.label;
  if (checkpoint.roomConfidence === "assumed") {
    titleText += " · Assumed placement — confirm on-site";
  }
  title.textContent = titleText;
  g.appendChild(title);

  if (checkpoint.roomConfidence === "assumed") {
    g.appendChild(svgEl("circle", {
      cx: cx, cy: cy, r: 11, fill: "none", stroke: "#9d9b93",
      "stroke-width": 1.4, "stroke-dasharray": "2,2", "class": "marker-assumed-ring"
    }));
  }

  if (status === "active_issue") {
    const pulseWrap = svgEl("g", { "class": "marker-pulse-wrap", transform: "translate(" + cx + "," + cy + ")" });
    pulseWrap.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 7, "class": "marker-pulse-ring" }));
    g.appendChild(pulseWrap);
  }

  g.appendChild(svgEl("circle", {
    cx: cx, cy: cy, r: 7, fill: meta.color,
    stroke: "rgba(0,0,0,0.35)", "stroke-width": 1,
    "class": "marker-ring" + (status === "active_issue" ? " marker-ring-alert" : "")
  }));

  const glyph = svgEl("g", { transform: "translate(" + (cx - 5) + "," + (cy - 5) + ") scale(0.5)" });
  glyph.style.color = "#ffffff";
  glyph.innerHTML = ICON_SHAPES[status];
  g.appendChild(glyph);

  g.addEventListener("click", function () { openPanel(checkpoint); });
  g.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPanel(checkpoint);
    }
  });

  return g;
}

function buildCompass() {
  const g = svgEl("g", { "class": "compass", transform: "translate(1150,30)" });
  g.appendChild(svgEl("line", { x1: 14, y1: 34, x2: 14, y2: 4, stroke: "#9d9b93", "stroke-width": 2 }));
  g.appendChild(svgEl("path", { d: "M14 0 L20 11 L8 11 Z", fill: "#9d9b93" }));
  const label = svgEl("text", { x: 14, y: 49, "text-anchor": "middle", "class": "compass-label" });
  label.setAttribute("fill", "#9d9b93");
  label.textContent = "N";
  g.appendChild(label);
  return g;
}

function renderFloorSVG() {
  const svg = document.getElementById("floor-svg");
  svg.innerHTML = "";
  svg.setAttribute("viewBox", "0 0 " + VIEWBOX.w + " " + VIEWBOX.h);

  const roomsG = svgEl("g", { "class": "rooms-layer" });
  ROOMS.forEach(function (room) {
    const tokens = CATEGORY_COLORS[room.category];
    const rect = svgEl("rect", {
      x: room.x, y: room.y, width: room.w, height: room.h, rx: 4, ry: 4,
      fill: tokens.fill, stroke: tokens.stroke, "stroke-width": 1.5, "class": "room-rect"
    });
    const title = svgEl("title");
    title.textContent = room.label;
    rect.appendChild(title);
    roomsG.appendChild(rect);

    const text = svgEl("text", {
      x: room.x + room.w / 2, y: room.y + room.h / 2,
      "text-anchor": "middle", "dominant-baseline": "middle", "class": "room-label"
    });
    text.setAttribute("fill", tokens.text);
    text.textContent = room.label;
    roomsG.appendChild(text);

    if (roomHasActiveIssue(room.id)) {
      const alertRect = svgEl("rect", {
        x: room.x, y: room.y, width: room.w, height: room.h, rx: 4, ry: 4,
        "class": "room-alert-ring"
      });
      const alertTitle = svgEl("title");
      alertTitle.textContent = "Active issue in this room";
      alertRect.appendChild(alertTitle);
      roomsG.appendChild(alertRect);

      const badge = svgEl("g", {
        "class": "room-alert-badge",
        transform: "translate(" + (room.x + room.w - 20) + "," + (room.y + 6) + ")"
      });
      badge.innerHTML = ICON_SHAPES.active_issue;
      badge.style.color = AGGREGATE_STATUS_META.active_issue.color;
      const badgeTitle = svgEl("title");
      badgeTitle.textContent = "Active issue";
      badge.appendChild(badgeTitle);
      roomsG.appendChild(badge);
    }
  });
  svg.appendChild(roomsG);

  const markersG = svgEl("g", { "class": "markers-layer" });
  ROOMS.forEach(function (room) {
    const cps = CHECKPOINTS_BY_ROOM[room.id];
    if (!cps || !cps.length) return;
    const positions = layoutMarkers(room, cps.length);
    cps.forEach(function (cp, i) {
      markersG.appendChild(buildMarker(cp, positions[i].x, positions[i].y));
    });
  });
  svg.appendChild(markersG);

  svg.appendChild(buildCompass());
}

// -------------------------------------------------------------- legend
function renderLegend() {
  const catWrap = document.getElementById("legend-category");
  catWrap.innerHTML = "";
  ROOM_LEGEND.forEach(function (entry) {
    const tokens = CATEGORY_COLORS[entry.category];
    const item = document.createElement("span");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = tokens.fill;
    sw.style.border = "1px solid " + tokens.stroke;
    const lbl = document.createElement("span");
    lbl.textContent = entry.label;
    item.appendChild(sw);
    item.appendChild(lbl);
    catWrap.appendChild(item);
  });

  const statusWrap = document.getElementById("legend-status");
  statusWrap.innerHTML = "";
  Object.keys(AGGREGATE_STATUS_META).forEach(function (status) {
    const meta = AGGREGATE_STATUS_META[status];
    const item = document.createElement("span");
    item.className = "legend-item";
    const iconWrap = document.createElement("span");
    iconWrap.className = "legend-icon";
    iconWrap.style.color = meta.color;
    iconWrap.innerHTML = iconHTML(status, 16);
    const lbl = document.createElement("span");
    lbl.textContent = meta.label;
    item.appendChild(iconWrap);
    item.appendChild(lbl);
    statusWrap.appendChild(item);
  });
}

// -------------------------------------------------------------- badges
function buildStatusBadge(status) {
  const meta = AGGREGATE_STATUS_META[status];
  const span = document.createElement("span");
  span.className = "status-badge";
  span.style.background = meta.color;
  span.style.color = meta.text;
  span.innerHTML = iconHTML(status, 14);
  const lbl = document.createElement("span");
  lbl.textContent = meta.label;
  span.appendChild(lbl);
  return span;
}

function buildFindingStatusBadge(status) {
  const meta = FINDING_STATE_META[status] || { label: status };
  const span = document.createElement("span");
  span.className = "finding-status-badge finding-status-" + status;
  span.textContent = meta.label;
  return span;
}

// -------------------------------------------------------------- roof grid
function renderRoofGrid() {
  const grid = document.getElementById("roof-grid");
  grid.innerHTML = "";
  EQUIPMENT_GROUPS.filter(function (cp) { return cp.roomKey === "roof"; }).forEach(function (cp) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "roof-card";
    if (checkpointHasUnresolvedFinding(cp.id)) card.classList.add("roof-card-alert");

    const title = document.createElement("div");
    title.className = "roof-card-title";
    title.textContent = cp.equipment;
    card.appendChild(title);

    if (cp.designation) {
      const meta = document.createElement("div");
      meta.className = "roof-card-meta";
      meta.textContent = cp.designation;
      card.appendChild(meta);
    }

    const locLine = document.createElement("div");
    locLine.className = "roof-card-meta";
    locLine.textContent = cp.location;
    card.appendChild(locLine);

    if (cp.manufacturer) {
      const model = document.createElement("div");
      model.className = "roof-card-model";
      model.textContent = cp.manufacturer;
      card.appendChild(model);
    }

    card.appendChild(buildStatusBadge(computeAggregateStatus(cp)));

    if (checkpointHasUnresolvedFinding(cp.id)) {
      const alertRow = document.createElement("span");
      alertRow.className = "finding-indicator finding-indicator-active";
      alertRow.innerHTML = iconHTML("active_issue", 14) + "<span>Active issue</span>";
      card.appendChild(alertRow);
    }

    card.addEventListener("click", function () { openPanel(cp); });
    grid.appendChild(card);
  });
}

function refreshStatusesUI() {
  renderFloorSVG();
  renderRoofGrid();
}

// -------------------------------------------------------------- update form
// Shared "Log an update" form used both when the raw toggle is switched to
// Attention (creating or re-using a finding) and when "Add update" is used on
// an already-open finding. Saving is the only way the caller's promise
// resolves; cancelling never mutates anything.
function buildUpdateForm(opts) {
  const wrap = document.createElement("div");
  wrap.className = "update-form";

  const title = document.createElement("div");
  title.className = "update-form-title";
  title.textContent = "Log an update";
  wrap.appendChild(title);

  const statusGroup = document.createElement("div");
  statusGroup.className = "segmented update-status-group";
  let chosen = opts.defaultStatus || "in_progress";
  const buttons = [];
  Object.keys(FINDING_STATE_META).forEach(function (val) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = FINDING_STATE_META[val].label;
    if (val === chosen) b.classList.add("is-active");
    b.addEventListener("click", function () {
      chosen = val;
      buttons.forEach(function (x) { x.el.classList.toggle("is-active", x.val === val); });
    });
    buttons.push({ val: val, el: b });
    statusGroup.appendChild(b);
  });
  wrap.appendChild(statusGroup);

  const textarea = document.createElement("textarea");
  textarea.className = "notes-input update-message-input";
  textarea.rows = 3;
  textarea.placeholder = "What's happening with this issue? (required)";
  wrap.appendChild(textarea);

  const err = document.createElement("div");
  err.className = "save-error-note";
  err.hidden = true;
  wrap.appendChild(err);

  const actions = document.createElement("div");
  actions.className = "update-form-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn";
  saveBtn.textContent = "Save";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";

  // View-only (Admin, or no identity picked yet) never gets a live form —
  // callers below only open this form when canEdit() already passed — but
  // disable + early-return here too, defense in depth against any future
  // call site that forgets the check.
  if (!canEdit()) {
    textarea.disabled = true;
    saveBtn.disabled = true;
    buttons.forEach(function (x) { x.el.disabled = true; });
  }

  saveBtn.addEventListener("click", function () {
    if (!canEdit()) return;
    const msg = textarea.value.trim();
    if (!msg) {
      err.textContent = "A message is required.";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    Promise.resolve(opts.onSave(chosen, msg)).catch(function (e) {
      console.error("Failed to save finding update:", e);
      err.textContent = "Couldn't save — check your connection and try again.";
      err.hidden = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    });
  });
  cancelBtn.addEventListener("click", function () { opts.onCancel(); });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);

  return wrap;
}

// Read-only, newest-first rendering of a finding's update history. Reused by
// the in-panel indicator and the Findings page.
function renderFindingTimeline(container, findingId) {
  container.innerHTML = "";
  const updates = UPDATES_BY_FINDING[findingId] || [];
  const list = document.createElement("div");
  list.className = "finding-timeline";
  updates.forEach(function (u) {
    const entry = document.createElement("div");
    entry.className = "finding-timeline-entry";
    const meta = document.createElement("div");
    meta.className = "finding-timeline-meta";
    const ts = document.createElement("span");
    ts.className = "finding-timeline-time";
    ts.textContent = new Date(u.created_at).toLocaleString();
    meta.appendChild(ts);
    const actorSpan = document.createElement("span");
    actorSpan.className = "finding-timeline-actor";
    actorSpan.textContent = u.actor || "Unknown";
    meta.appendChild(actorSpan);
    meta.appendChild(buildFindingStatusBadge(u.status));
    entry.appendChild(meta);
    const msg = document.createElement("div");
    msg.className = "finding-timeline-message";
    msg.textContent = u.message;
    entry.appendChild(msg);
    list.appendChild(entry);
  });
  container.appendChild(list);
}

// Saves a finding update (creating a new finding if none is unresolved yet)
// and, when alsoLogToggle is true, also appends a checklist_log row so the
// raw toggle reflects "Attention" and the change shows up in the Daily Log.
// Resolves with { logRow } (logRow is null when alsoLogToggle is false) so
// callers can track that inserted row as the item's new "pending" row — see
// the pendingRowId comment in buildCheckRow — consistent with the raw
// status-toggle path, so a note saved right after going to Attention
// consolidates into this same row instead of inserting a second one.
function saveFindingUpdate(checkpointId, itemKey, existingFinding, status, message, alsoLogToggle, notes, actor) {
  const findingPromise = existingFinding
    ? ChecklistStore.addFindingUpdate(existingFinding.id, status, message, actor)
    : ChecklistStore.createFinding(checkpointId, itemKey, status, message, actor);

  return findingPromise.then(function (result) {
    applyFindingResult(result.finding, result.update);
    if (!alsoLogToggle) return { logRow: null };
    return ChecklistStore.appendLogEntry(checkpointId, itemKey, "attention", null, notes || "", actor)
      .then(function (logRow) {
        if (logRow) LOG_ROWS.push(logRow);
        return { logRow: logRow || null };
      });
  });
}

// -------------------------------------------------------------- panel content
function buildSegmented(currentState, onClick) {
  const wrap = document.createElement("div");
  wrap.className = "segmented";
  const buttons = {};
  ITEM_STATES.forEach(function (state) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.state = state;
    if (state === currentState) btn.classList.add("is-active");
    btn.innerHTML = iconHTML(state, 13);
    const lbl = document.createElement("span");
    lbl.textContent = ITEM_STATE_META[state].label;
    btn.appendChild(lbl);
    btn.addEventListener("click", function () { onClick(state); });
    buttons[state] = btn;
    wrap.appendChild(btn);
  });
  wrap.setActive = function (state) {
    Object.keys(buttons).forEach(function (s) { buttons[s].classList.toggle("is-active", s === state); });
  };
  return wrap;
}

function buildCheckRow(checkpoint, checklistItem) {
  const itemKey = checklistItem.item;
  const current = getGroupEntries(checkpoint.id)[itemKey] || { state: "not_checked", notes: "" };

  const row = document.createElement("div");
  row.className = "check-row";

  const head = document.createElement("div");
  head.className = "check-row-head";

  const nameWrap = document.createElement("div");
  const name = document.createElement("div");
  name.className = "check-row-name";
  name.textContent = checklistItem.item;
  const expected = document.createElement("div");
  expected.className = "check-row-expected";
  expected.textContent = "Expected: " + checklistItem.expected;
  nameWrap.appendChild(name);
  nameWrap.appendChild(expected);
  head.appendChild(nameWrap);

  // Visible failure indicator for this row's saves — a rejected write must
  // never look like it silently succeeded just because the optimistic UI
  // (button highlight / marker color) already updated.
  const saveError = document.createElement("div");
  saveError.className = "save-error-note";
  saveError.textContent = "Couldn't save — check your connection and try again.";
  saveError.hidden = true;

  // formMode: null (no form open) | { kind: "new" } (opening via the raw
  // Attention click when no unresolved finding exists yet — will create a
  // finding) | { kind: "append", finding, alsoLogToggle } (opening via the
  // raw Attention click while an unresolved finding ALREADY exists — must
  // append to that SAME finding, never create a second one — or via the
  // "Add update" button on an already-open finding).
  let formMode = null;
  let expanded = false;

  // Tracks the checklist_log row id just inserted by a status/oil-level
  // change (or an Attention save, see below) DURING THIS VISIT to this row,
  // so a subsequent notes Save consolidates into that same row (UPDATE)
  // instead of inserting a second row for what's really one atomic "I
  // checked this, here's a note" action. Reset to null before every new
  // status-change request so a failed write never leaves a stale id around
  // for notes to silently attach to — a fresh insert is the safe fallback.
  // A standalone notes save with no pending row (null) still inserts, same
  // as before this fix. A NEW status change always starts a fresh pending
  // row, so a genuinely new check event still gets its own history row.
  let pendingRowId = null;

  const segmented = buildSegmented(current.state, function (newState) {
    // Admin (and the no-identity-yet state) never gets a live control — the
    // buttons are disabled below too, but a disabled button shouldn't ever
    // fire this handler; this is belt-and-suspenders.
    if (!canEdit()) return;
    if (newState === "attention") {
      // Selecting Attention never half-applies — it only opens the form.
      // The toggle's active class is NOT changed until Save succeeds. If
      // this item already has an unresolved finding, re-use it (append)
      // instead of opening a brand-new one — there is at most one
      // unresolved finding per checkpoint+item at a time.
      const info = getItemFindingInfo(checkpoint.id, itemKey);
      formMode = info.unresolved
        ? { kind: "append", finding: info.unresolved, alsoLogToggle: true }
        : { kind: "new" };
      expanded = true;
      renderFindingArea();
      return;
    }
    segmented.setActive(newState);
    const prevNotes = (getGroupEntries(checkpoint.id)[itemKey] || {}).notes || "";
    setGroupEntryLocal(checkpoint.id, itemKey, newState, prevNotes);
    refreshStatusesUI();
    saveError.hidden = true;
    pendingRowId = null;
    ChecklistStore.appendLogEntry(checkpoint.id, itemKey, newState, null, prevNotes, currentActorName())
      .then(function (logRow) { if (logRow) { LOG_ROWS.push(logRow); pendingRowId = logRow.id; } })
      .catch(function (err) {
        console.error("Failed to save checklist item to Supabase:", checkpoint.id, itemKey, err);
        saveError.hidden = false;
      });
  });
  if (!canEdit()) {
    segmented.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
  }
  head.appendChild(segmented);
  row.appendChild(head);

  const notesRow = document.createElement("div");
  notesRow.className = "notes-row";

  const notesInput = document.createElement("input");
  notesInput.type = "text";
  notesInput.className = "notes-input";
  notesInput.placeholder = "Notes / actual reading";
  notesInput.value = current.notes || "";
  notesInput.disabled = !canEdit();

  // Notes only persist on an explicit Save click now (no more debounce-on-
  // input) — lastSavedNotes tracks what's actually in the database so the
  // button is only enabled when there's something new to save, and reopening
  // this row later always shows the last SAVED value, never an abandoned draft.
  let lastSavedNotes = current.notes || "";

  const notesSaveBtn = document.createElement("button");
  notesSaveBtn.type = "button";
  notesSaveBtn.className = "btn notes-save-btn";
  notesSaveBtn.textContent = "Save";
  notesSaveBtn.disabled = true;

  notesInput.addEventListener("input", function () {
    notesSaveBtn.disabled = !canEdit() || (notesInput.value === lastSavedNotes);
  });

  notesSaveBtn.addEventListener("click", function () {
    if (!canEdit()) return;
    const stateNow = (getGroupEntries(checkpoint.id)[itemKey] || {}).state || "not_checked";
    const notesVal = notesInput.value;
    saveError.hidden = true;
    notesSaveBtn.disabled = true;
    if (pendingRowId) {
      // A status change (or an Attention save) already inserted a row for
      // this visit — attach this note to THAT row instead of inserting a
      // second one for the same atomic check.
      const rowId = pendingRowId;
      ChecklistStore.updateLogEntryNotes(rowId, notesVal, currentActorName())
        .then(function (logRow) {
          setGroupEntryLocal(checkpoint.id, itemKey, stateNow, notesVal);
          lastSavedNotes = notesVal;
          const idx = LOG_ROWS.findIndex(function (r) { return r.id === rowId; });
          if (idx >= 0) {
            LOG_ROWS[idx].notes = notesVal;
            LOG_ROWS[idx].actor = (logRow && logRow.actor !== undefined) ? logRow.actor : currentActorName();
          }
        })
        .catch(function (err) {
          console.error("Failed to update checklist notes in Supabase:", checkpoint.id, itemKey, err);
          saveError.hidden = false;
          notesSaveBtn.disabled = !canEdit() || (notesInput.value === lastSavedNotes);
        });
      return;
    }
    ChecklistStore.appendLogEntry(checkpoint.id, itemKey, stateNow, null, notesVal, currentActorName())
      .then(function (logRow) {
        if (logRow) LOG_ROWS.push(logRow);
        setGroupEntryLocal(checkpoint.id, itemKey, stateNow, notesVal);
        lastSavedNotes = notesVal;
      })
      .catch(function (err) {
        console.error("Failed to save checklist notes to Supabase:", checkpoint.id, itemKey, err);
        saveError.hidden = false;
        notesSaveBtn.disabled = !canEdit() || (notesInput.value === lastSavedNotes);
      });
  });

  notesRow.appendChild(notesInput);
  notesRow.appendChild(notesSaveBtn);
  row.appendChild(notesRow);
  row.appendChild(saveError);

  const findingArea = document.createElement("div");
  findingArea.className = "finding-area";
  row.appendChild(findingArea);

  function renderFindingArea() {
    findingArea.innerHTML = "";
    const info = getItemFindingInfo(checkpoint.id, itemKey);

    if (formMode !== null) {
      const isNew = formMode.kind === "new";
      const targetFinding = isNew ? null : formMode.finding;
      const alsoLogToggle = isNew ? true : !!formMode.alsoLogToggle;
      const formEl = buildUpdateForm({
        defaultStatus: "in_progress",
        onSave: function (status, message) {
          return saveFindingUpdate(checkpoint.id, itemKey, targetFinding, status, message, alsoLogToggle, notesInput.value, currentActorName())
            .then(function (res) {
              formMode = null;
              expanded = true;
              if (alsoLogToggle) {
                segmented.setActive("attention");
                setGroupEntryLocal(checkpoint.id, itemKey, "attention", notesInput.value);
                // This path also just persisted notesInput.value to the log
                // (see saveFindingUpdate) — keep the Save button's notion of
                // "last saved" in sync so it doesn't stay wrongly enabled.
                lastSavedNotes = notesInput.value;
                notesSaveBtn.disabled = true;
                // That checklist_log insert becomes this item's pending row
                // too, same as a plain status click — a note saved right
                // after going to Attention consolidates into it rather than
                // inserting a second row.
                pendingRowId = (res && res.logRow) ? res.logRow.id : null;
              }
              // Always refresh markers/roof cards — a finding's resolution
              // status (and thus the pulsating active-issue indicator) can
              // change here even when alsoLogToggle is false (e.g. adding a
              // second update, or resolving via "Add update").
              refreshStatusesUI();
              renderFindingArea();
            });
        },
        onCancel: function () {
          formMode = null;
          renderFindingArea();
        }
      });
      findingArea.appendChild(formEl);
      return;
    }

    const finding = info.unresolved || info.mostRecent;
    if (!finding) return;
    const isUnresolved = !!info.unresolved;
    const count = (UPDATES_BY_FINDING[finding.id] || []).length;

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "finding-indicator " + (isUnresolved ? "finding-indicator-active" : "finding-indicator-resolved");
    badge.innerHTML = (isUnresolved ? iconHTML("active_issue", 14) : iconHTML("resolved_issue", 14)) +
      "<span>" + (isUnresolved ? "Active issue" : "Resolved") + " — " + count + " update" + (count === 1 ? "" : "s") + "</span>";
    badge.addEventListener("click", function () {
      expanded = !expanded;
      renderFindingArea();
    });
    findingArea.appendChild(badge);

    if (expanded) {
      const timelineWrap = document.createElement("div");
      timelineWrap.className = "finding-timeline-wrap";
      renderFindingTimeline(timelineWrap, finding.id);
      findingArea.appendChild(timelineWrap);

      if (isUnresolved && canEdit()) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn finding-add-update-btn";
        addBtn.textContent = "Add update";
        addBtn.addEventListener("click", function () {
          if (!canEdit()) return;
          formMode = { kind: "append", finding: finding, alsoLogToggle: false };
          renderFindingArea();
        });
        findingArea.appendChild(addBtn);
      }
    }
  }

  renderFindingArea();

  return row;
}

function buildUnitsSection(units) {
  const wrap = document.createElement("div");
  wrap.className = "units-list";
  units.forEach(function (u) {
    const r = document.createElement("div");
    r.className = "unit-row";
    r.textContent = u.model;
    wrap.appendChild(r);
  });
  return wrap;
}

function buildSubRow(checkpoint, sub) {
  const stored = getSubEntry(checkpoint.id, sub.designation);
  const itemKey = "sub:" + sub.designation;

  const row = document.createElement("div");
  row.className = "sub-row";

  const head = document.createElement("div");
  head.className = "sub-row-head";
  const left = document.createElement("div");

  const desigLine = document.createElement("div");
  desigLine.className = "sub-row-designation";
  desigLine.textContent = "Compressor " + sub.designation;
  left.appendChild(desigLine);

  const modelLine = document.createElement("div");
  modelLine.className = "sub-row-model";
  modelLine.textContent = sub.model;
  left.appendChild(modelLine);

  head.appendChild(left);
  row.appendChild(head);

  const expectedLine = document.createElement("div");
  expectedLine.className = "check-row-expected";
  expectedLine.textContent = "Expected: " + checkpoint.subsectionItem.expected + " (" + checkpoint.subsectionItem.item + ")";
  row.appendChild(expectedLine);

  const controls = document.createElement("div");
  controls.className = "sub-row-controls";

  // Visible failure indicator — see the matching comment in buildCheckRow().
  const saveError = document.createElement("div");
  saveError.className = "save-error-note";
  saveError.textContent = "Couldn't save — check your connection and try again.";
  saveError.hidden = true;

  // See the matching pendingRowId comment in buildCheckRow() — same
  // insert-then-consolidate behavior for the oil-level select + its notes.
  let pendingRowId = null;

  const select = document.createElement("select");
  select.className = "oil-select";
  [["", "— Select —"], ["0", "0%"], ["25", "25%"], ["50", "50%"], ["75", "75%"], ["100", "100%"]].forEach(function (pair) {
    const opt = document.createElement("option");
    opt.value = pair[0];
    opt.textContent = pair[1];
    if (stored.oilLevel === pair[0]) opt.selected = true;
    select.appendChild(opt);
  });
  select.disabled = !canEdit();
  select.addEventListener("change", function () {
    if (!canEdit()) return;
    const existingNotes = getSubEntry(checkpoint.id, sub.designation).notes;
    setSubEntryLocal(checkpoint.id, sub.designation, select.value, existingNotes);
    refreshStatusesUI();
    saveError.hidden = true;
    pendingRowId = null;
    ChecklistStore.appendLogEntry(checkpoint.id, itemKey, null, oilLocalToDb(select.value), existingNotes, currentActorName())
      .then(function (logRow) { if (logRow) { LOG_ROWS.push(logRow); pendingRowId = logRow.id; } })
      .catch(function (err) {
        console.error("Failed to save oil level to Supabase:", checkpoint.id, sub.designation, err);
        saveError.hidden = false;
      });
  });
  controls.appendChild(select);

  const notesInput = document.createElement("input");
  notesInput.type = "text";
  notesInput.className = "notes-input sub-notes-input";
  notesInput.placeholder = "Notes";
  notesInput.value = stored.notes || "";
  notesInput.disabled = !canEdit();

  // See the matching comment in buildCheckRow() — notes only persist on an
  // explicit Save click now.
  let lastSavedNotes = stored.notes || "";

  const notesSaveBtn = document.createElement("button");
  notesSaveBtn.type = "button";
  notesSaveBtn.className = "btn notes-save-btn";
  notesSaveBtn.textContent = "Save";
  notesSaveBtn.disabled = true;

  notesInput.addEventListener("input", function () {
    notesSaveBtn.disabled = !canEdit() || (notesInput.value === lastSavedNotes);
  });

  notesSaveBtn.addEventListener("click", function () {
    if (!canEdit()) return;
    const existingOil = getSubEntry(checkpoint.id, sub.designation).oilLevel;
    const notesVal = notesInput.value;
    saveError.hidden = true;
    notesSaveBtn.disabled = true;
    if (pendingRowId) {
      // An oil-level change already inserted a row for this visit — attach
      // this note to THAT row instead of inserting a second one.
      const rowId = pendingRowId;
      ChecklistStore.updateLogEntryNotes(rowId, notesVal, currentActorName())
        .then(function (logRow) {
          setSubEntryLocal(checkpoint.id, sub.designation, existingOil, notesVal);
          lastSavedNotes = notesVal;
          const idx = LOG_ROWS.findIndex(function (r) { return r.id === rowId; });
          if (idx >= 0) {
            LOG_ROWS[idx].notes = notesVal;
            LOG_ROWS[idx].actor = (logRow && logRow.actor !== undefined) ? logRow.actor : currentActorName();
          }
        })
        .catch(function (err) {
          console.error("Failed to update compressor notes in Supabase:", checkpoint.id, sub.designation, err);
          saveError.hidden = false;
          notesSaveBtn.disabled = !canEdit() || (notesInput.value === lastSavedNotes);
        });
      return;
    }
    ChecklistStore.appendLogEntry(checkpoint.id, itemKey, null, oilLocalToDb(existingOil), notesVal, currentActorName())
      .then(function (logRow) {
        if (logRow) LOG_ROWS.push(logRow);
        setSubEntryLocal(checkpoint.id, sub.designation, existingOil, notesVal);
        lastSavedNotes = notesVal;
      })
      .catch(function (err) {
        console.error("Failed to save compressor notes to Supabase:", checkpoint.id, sub.designation, err);
        saveError.hidden = false;
        notesSaveBtn.disabled = !canEdit() || (notesInput.value === lastSavedNotes);
      });
  });

  controls.appendChild(notesInput);
  controls.appendChild(notesSaveBtn);

  row.appendChild(controls);
  row.appendChild(saveError);

  return row;
}

function infoRow(container, label, value) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "info-row";
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "info-value";
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  container.appendChild(row);
}

function sectionTitle(container, text) {
  const t = document.createElement("div");
  t.className = "panel-section-title";
  t.textContent = text;
  container.appendChild(t);
  return t;
}

function buildPanelBody(checkpoint) {
  const body = document.getElementById("panel-body");
  body.innerHTML = "";

  sectionTitle(body, "Equipment Info");
  infoRow(body, "Location", checkpoint.location);
  const room = ROOMS_BY_ID[checkpoint.roomKey];
  infoRow(body, "Room", checkpoint.roomKey === "roof" ? "Roof" : (room ? room.label : checkpoint.roomKey));
  infoRow(body, "Manufacturer", checkpoint.manufacturer);
  if (checkpoint.roomConfidence === "assumed") {
    const note = document.createElement("div");
    note.className = "assumed-note";
    note.innerHTML = iconHTML("attention", 13) + "<span>Assumed placement — confirm on-site</span>";
    body.appendChild(note);
  }

  if (checkpoint.groupChecklist && checkpoint.groupChecklist.length) {
    sectionTitle(body, "Checklist");
    checkpoint.groupChecklist.forEach(function (ci) {
      body.appendChild(buildCheckRow(checkpoint, ci));
    });
  }

  if (checkpoint.units && checkpoint.units.length) {
    sectionTitle(body, "Units (reference only)");
    body.appendChild(buildUnitsSection(checkpoint.units));
  }

  if (checkpoint.subsections && checkpoint.subsections.length) {
    sectionTitle(body, checkpoint.subsectionItem ? checkpoint.subsectionItem.item : "Compressors");
    checkpoint.subsections.forEach(function (s) {
      body.appendChild(buildSubRow(checkpoint, s));
    });
  }
}

// -------------------------------------------------------------- slide-over
function openPanel(checkpoint) {
  CURRENT_PANEL_CHECKPOINT = checkpoint;
  document.getElementById("panel-title").textContent = checkpoint.equipment;
  const subtitleParts = [];
  if (checkpoint.designation) subtitleParts.push(checkpoint.designation);
  subtitleParts.push(checkpoint.location);
  document.getElementById("panel-subtitle").textContent = subtitleParts.join(" · ");

  buildPanelBody(checkpoint);

  document.getElementById("slide-over").classList.add("is-open");
  document.getElementById("slide-over").setAttribute("aria-hidden", "false");
  document.getElementById("backdrop").classList.add("is-open");
}

function closePanel() {
  CURRENT_PANEL_CHECKPOINT = null;
  document.getElementById("slide-over").classList.remove("is-open");
  document.getElementById("slide-over").setAttribute("aria-hidden", "true");
  document.getElementById("backdrop").classList.remove("is-open");
}

// -------------------------------------------------------------- daily log page
function localDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function buildMergedDailyEntries() {
  const entries = [];
  LOG_ROWS.forEach(function (row) {
    if (!row || !row.created_at) return;
    entries.push({
      ts: new Date(row.created_at),
      checkpointId: row.checkpoint_id,
      itemKey: row.item_key,
      kind: "log",
      status: row.status,
      oilLevel: row.oil_level,
      notes: row.notes,
      actor: row.actor
    });
  });
  FINDING_UPDATES_LIST.forEach(function (u) {
    const finding = FINDINGS_BY_ID[u.finding_id];
    if (!finding || !u.created_at) return;
    entries.push({
      ts: new Date(u.created_at),
      checkpointId: finding.checkpoint_id,
      itemKey: finding.item_key,
      kind: "finding_update",
      status: u.status,
      notes: u.message,
      actor: u.actor
    });
  });
  return entries;
}

// An entry "pops out" of the daily feed when it represents an issue: a raw
// "Attention" reading, or ANY finding_update (even a "resolved" one — it's
// still part of an issue's history, unlike a plain OK/not_checked/oil-level
// row). Returns null for routine entries, which keep the plain row style.
function issueMetaForLogEntry(entry) {
  if (entry.kind === "log" && entry.status === "attention") {
    return { level: "active", icon: "attention" };
  }
  if (entry.kind === "finding_update") {
    return entry.status === "resolved"
      ? { level: "resolved", icon: "resolved_issue" }
      : { level: "active", icon: "active_issue" };
  }
  return null;
}

function buildDailyLogRow(entry) {
  const cp = EQUIPMENT_BY_ID[entry.checkpointId];
  const issueMeta = issueMetaForLogEntry(entry);

  const row = document.createElement("div");
  row.className = "log-row";
  if (issueMeta) row.classList.add("log-row-issue-" + issueMeta.level);

  const timeEl = document.createElement("div");
  timeEl.className = "log-row-time";
  const timeText = document.createElement("div");
  timeText.textContent = entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  timeEl.appendChild(timeText);
  const actorText = document.createElement("div");
  actorText.className = "log-row-actor";
  actorText.textContent = entry.actor || "Unknown";
  timeEl.appendChild(actorText);
  row.appendChild(timeEl);

  const mainEl = document.createElement("div");
  mainEl.className = "log-row-main";

  const eqLine = document.createElement("div");
  eqLine.className = "log-row-equipment";
  if (issueMeta) {
    // Color is never the only signal — pair the accent with the same status
    // icon glyph used elsewhere in the app (finding badges, markers, legend).
    const iconWrap = document.createElement("span");
    iconWrap.className = "log-row-issue-icon";
    iconWrap.style.color = issueMeta.level === "resolved" ? "var(--status-resolved)" : "var(--status-critical)";
    iconWrap.innerHTML = iconHTML(issueMeta.icon, 14);
    eqLine.appendChild(iconWrap);
  }
  eqLine.appendChild(document.createTextNode(cp
    ? (cp.equipment + (cp.designation ? " (" + cp.designation + ")" : "") + " — " + cp.location)
    : entry.checkpointId));
  mainEl.appendChild(eqLine);

  const itemLine = document.createElement("div");
  itemLine.className = "log-row-item";
  itemLine.textContent = itemDisplayName(cp, entry.itemKey);
  mainEl.appendChild(itemLine);

  const valueLine = document.createElement("div");
  valueLine.className = "log-row-value";
  if (entry.kind === "log") {
    if (entry.itemKey && entry.itemKey.indexOf("sub:") === 0) {
      valueLine.textContent = "Oil level: " + (entry.oilLevel || "—");
    } else {
      const meta = ITEM_STATE_META[entry.status || "not_checked"] || { label: entry.status };
      valueLine.textContent = "Status: " + meta.label;
    }
  } else {
    const meta = FINDING_STATE_META[entry.status] || { label: entry.status };
    valueLine.textContent = "Finding update: " + meta.label;
  }
  mainEl.appendChild(valueLine);

  if (entry.notes) {
    const notesLine = document.createElement("div");
    notesLine.className = "log-row-notes";
    notesLine.textContent = entry.notes;
    mainEl.appendChild(notesLine);
  }

  row.appendChild(mainEl);
  return row;
}

function renderDailyLogView() {
  const feed = document.getElementById("daily-log-feed");
  const dateInput = document.getElementById("log-date-input");
  if (!feed || !dateInput) return;
  const dateVal = dateInput.value;
  feed.innerHTML = "";
  if (!dateVal) return;

  const entries = buildMergedDailyEntries().filter(function (e) {
    return localDateInputValue(e.ts) === dateVal;
  });
  entries.sort(function (a, b) { return b.ts - a.ts; });

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No activity logged for this day.";
    feed.appendChild(empty);
    return;
  }

  entries.forEach(function (e) { feed.appendChild(buildDailyLogRow(e)); });
}

// Earliest/latest local-calendar-day date strings (same "YYYY-MM-DD" shape
// as localDateInputValue) across every currently-loaded checklist_log +
// finding_updates entry — computed live from buildMergedDailyEntries() every
// time, never hardcoded. Plain string min/max works because
// localDateInputValue's zero-padded "YYYY-MM-DD" shape sorts identically to
// chronological order. Returns null when there's no data loaded yet (e.g.
// the initial Supabase load failed) so the caller can fall back sensibly.
function computeMergedEntriesDateRange() {
  const entries = buildMergedDailyEntries();
  if (!entries.length) return null;
  let min = null, max = null;
  entries.forEach(function (e) {
    const dv = localDateInputValue(e.ts);
    if (min === null || dv < min) min = dv;
    if (max === null || dv > max) max = dv;
  });
  return { from: min, to: max };
}

function getExportRangeInputs() {
  return {
    fromEl: document.getElementById("log-export-from"),
    toEl: document.getElementById("log-export-to")
  };
}

// True once the user has touched either range input by hand — after that,
// a later data (re)load must never clobber their explicit choice.
let exportRangeUserEdited = false;

// Defaults both range inputs to the true earliest/latest dates currently in
// the loaded data, so leaving them untouched and clicking Export still
// exports the entire history exactly as before. Falls back to today's date
// for both ends when no data is loaded yet, rather than leaving the inputs
// blank or disabling the Export button.
function setExportRangeDefaults() {
  const { fromEl, toEl } = getExportRangeInputs();
  if (!fromEl || !toEl) return;
  const range = computeMergedEntriesDateRange();
  const today = localDateInputValue(new Date());
  fromEl.value = range ? range.from : today;
  toEl.value = range ? range.to : today;
}

function wireDailyLogControls() {
  const input = document.getElementById("log-date-input");
  if (input) {
    input.value = localDateInputValue(new Date());
    input.addEventListener("change", renderDailyLogView);
  }

  setExportRangeDefaults();
  const { fromEl, toEl } = getExportRangeInputs();
  [fromEl, toEl].forEach(function (el) {
    if (el) el.addEventListener("change", function () { exportRangeUserEdited = true; });
  });

  const exportBtn = document.getElementById("btn-export-log");
  if (exportBtn) exportBtn.addEventListener("click", exportDailyLogToExcel);
}

// -------------------------------------------------------------- excel export
// One row per entry across the app's merged log history — every
// checklist_log row and every finding_updates row currently loaded in
// memory — reusing buildMergedDailyEntries() (the exact same merge already
// powering the Daily Log feed) rather than re-deriving the merge logic here.
// fromDate/toDate are optional "YYYY-MM-DD" strings (the same shape
// localDateInputValue produces); when both are omitted every entry is
// included, preserving the export's original "everything" default. Filtering
// compares each entry's OWN local calendar day (via localDateInputValue) —
// the same local-day convention used throughout this app — against the
// range, inclusive on both ends. Sorted chronologically (oldest first).
function buildDailyLogExportRows(fromDate, toDate) {
  const entries = buildMergedDailyEntries().filter(function (entry) {
    if (!fromDate && !toDate) return true;
    const d = localDateInputValue(entry.ts);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
  entries.sort(function (a, b) { return a.ts - b.ts; });

  return entries.map(function (entry) {
    const cp = EQUIPMENT_BY_ID[entry.checkpointId];
    const equipment = cp
      ? (cp.equipment + (cp.designation ? " (" + cp.designation + ")" : ""))
      : entry.checkpointId;
    const location = cp ? cp.location : "";
    const item = itemDisplayName(cp, entry.itemKey);

    let type, value, notes;
    if (entry.kind === "log") {
      if (entry.itemKey && entry.itemKey.indexOf("sub:") === 0) {
        type = "Oil reading";
        value = "Oil level: " + (entry.oilLevel || "—");
      } else {
        type = "Status change";
        const stateMeta = ITEM_STATE_META[entry.status || "not_checked"] || { label: entry.status };
        value = stateMeta.label;
      }
      notes = entry.notes || "";
    } else {
      // finding_update: no separate freeform-notes field distinct from its
      // message, so the status + message both live in Value (per spec) and
      // Notes is left blank for these rows rather than duplicating it.
      type = "Finding update";
      const findingMeta = FINDING_STATE_META[entry.status] || { label: entry.status };
      value = findingMeta.label + (entry.notes ? " — " + entry.notes : "");
      notes = "";
    }

    return {
      Date: localDateInputValue(entry.ts),
      Time: entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      Equipment: equipment,
      Location: location,
      Item: item,
      Type: type,
      Value: value,
      Notes: notes,
      // Consistent with every other actor display in this app (Daily Log
      // rows, finding timeline entries): fall back to "Unknown" for null.
      Actor: entry.actor || "Unknown"
    };
  });
}

const DAILY_LOG_EXPORT_COLUMNS = ["Date", "Time", "Equipment", "Location", "Item", "Type", "Value", "Notes", "Actor"];

function exportDailyLogToExcel() {
  if (typeof XLSX === "undefined") {
    console.error("Export to Excel failed: the xlsx (SheetJS) library did not load.");
    alert("Couldn't export — the Excel export library failed to load. Check your connection and try again.");
    return;
  }

  const { fromEl, toEl } = getExportRangeInputs();
  let fromVal = fromEl ? fromEl.value : "";
  let toVal = toEl ? toEl.value : "";

  // From-after-To is handled by swapping rather than blocking export or
  // silently exporting the wrong slice — and the swap is reflected back into
  // the visible inputs so what's on screen always matches what got exported.
  if (fromVal && toVal && fromVal > toVal) {
    const tmp = fromVal;
    fromVal = toVal;
    toVal = tmp;
    if (fromEl) fromEl.value = fromVal;
    if (toEl) toEl.value = toVal;
  }

  try {
    const rows = buildDailyLogExportRows(fromVal || null, toVal || null);
    const aoa = [DAILY_LOG_EXPORT_COLUMNS];
    rows.forEach(function (r) {
      aoa.push(DAILY_LOG_EXPORT_COLUMNS.map(function (col) { return r[col]; }));
    });
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Log");

    // Filename reflects the actual selected range: a single date when From
    // equals To (matching the pre-existing single-date format), a range
    // otherwise. Falls back to today's date only if the range inputs are
    // missing entirely (shouldn't happen — defensive only).
    let filenameDatePart;
    if (fromVal && toVal) {
      filenameDatePart = fromVal === toVal ? fromVal : (fromVal + "_to_" + toVal);
    } else {
      filenameDatePart = localDateInputValue(new Date());
    }
    XLSX.writeFile(workbook, "hvac-daily-log-" + filenameDatePart + ".xlsx");
  } catch (err) {
    console.error("Failed to export daily log to Excel:", err);
    alert("Couldn't export the log — see the browser console for details.");
  }
}

// -------------------------------------------------------------- findings page
let findingsFilter = "active";

function buildFindingCard(finding) {
  const cp = EQUIPMENT_BY_ID[finding.checkpoint_id];
  const card = document.createElement("div");
  card.className = "finding-card";

  const head = document.createElement("div");
  head.className = "finding-card-head";
  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "finding-card-title";
  title.textContent = cp ? (cp.equipment + (cp.designation ? " (" + cp.designation + ")" : "")) : finding.checkpoint_id;
  titleWrap.appendChild(title);
  const loc = document.createElement("div");
  loc.className = "finding-card-meta";
  loc.textContent = cp ? cp.location : "";
  titleWrap.appendChild(loc);
  const item = document.createElement("div");
  item.className = "finding-card-meta";
  item.textContent = itemDisplayName(cp, finding.item_key);
  titleWrap.appendChild(item);
  head.appendChild(titleWrap);
  head.appendChild(buildFindingStatusBadge(finding.status));
  card.appendChild(head);

  const opened = document.createElement("div");
  opened.className = "finding-card-meta";
  opened.textContent = "Opened " + new Date(finding.opened_at).toLocaleString() +
    " · Opened by " + (finding.opened_by || "Unknown");
  card.appendChild(opened);

  if (finding.resolved_at) {
    const resolved = document.createElement("div");
    resolved.className = "finding-card-meta";
    resolved.textContent = "Resolved " + new Date(finding.resolved_at).toLocaleString();
    card.appendChild(resolved);
  }

  const timelineWrap = document.createElement("div");
  timelineWrap.className = "finding-timeline-wrap";
  renderFindingTimeline(timelineWrap, finding.id);
  card.appendChild(timelineWrap);

  return card;
}

function renderFindingsView() {
  const list = document.getElementById("findings-list");
  if (!list) return;
  list.innerHTML = "";

  let items = FINDINGS_LIST.slice();
  if (findingsFilter === "active") items = items.filter(function (f) { return f.status !== "resolved"; });
  else if (findingsFilter === "resolved") items = items.filter(function (f) { return f.status === "resolved"; });
  items.sort(function (a, b) { return new Date(b.opened_at) - new Date(a.opened_at); });

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = findingsFilter === "active"
      ? "No active findings — nothing currently being tracked."
      : "No findings match this filter.";
    list.appendChild(empty);
    return;
  }

  items.forEach(function (f) { list.appendChild(buildFindingCard(f)); });
}

function wireFindingsControls() {
  const wrap = document.getElementById("findings-filter");
  if (!wrap) return;
  wrap.querySelectorAll("button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      findingsFilter = btn.dataset.filter;
      wrap.querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      renderFindingsView();
    });
  });
}

// -------------------------------------------------------------- overview page
// Per-day stacked bar chart: one bar per local-calendar day (last 7 days,
// ending today), each bar a cumulative-as-of-end-of-that-day snapshot across
// every checkable item in the whole facility — every groupChecklist entry
// across every EQUIPMENT_GROUPS checkpoint (floor + roof), plus every rack
// compressor subsection (oil level). Classified into exactly 3 buckets per
// day — see classifyItemAsOf() below — so every bar's three segments sum to
// the same total (currently 67) even on the earliest day. Always recomputed
// live from LOG_ROWS/FINDINGS_BY_ITEM, never hardcoded.

const OVERVIEW_DAY_COUNT = 7;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Reuses the same local-calendar-day convention as the Daily Log's
// localDateInputValue() (getFullYear/getMonth/getDate — local, not UTC) —
// just formatted for a short axis label instead of a <input type=date> value.
function shortDayLabel(d) {
  return WEEKDAY_SHORT[d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate();
}

// Midnight, local time, for the given Date (day-only, time stripped).
function localDayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The last N local-calendar days ending today (today last, oldest first).
function lastNLocalDays(n) {
  const today = localDayStart(new Date());
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
  }
  return days;
}

// End-of-day cutoff (23:59:59.999 local) as an epoch ms number — "on or
// before day D" for a given local calendar day D.
function localDayEndMs(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

// checkpoint_id::item_key -> checklist_log rows for that pair, sorted
// ascending by created_at. Built once per render and reused across all 7
// day-cutoffs instead of re-filtering LOG_ROWS from scratch each time.
function buildLogRowsByItem() {
  const idx = {};
  LOG_ROWS.forEach(function (row) {
    if (!row || !row.checkpoint_id || !row.item_key) return;
    const key = row.checkpoint_id + "::" + row.item_key;
    if (!idx[key]) idx[key] = [];
    idx[key].push(row);
  });
  Object.keys(idx).forEach(function (key) {
    idx[key].sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
  });
  return idx;
}

// Classifies a single checkable item as of the END of local day D (cutoffMs
// = localDayEndMs(D)) — see the task's exact rules:
//   - rack subsection ("sub:" item_key): green if ANY log row by cutoff,
//     else grey. Never red (no findings concept for subsections).
//   - group checklist item: red if ANY finding opened_at <= cutoff (counts
//     forever, even once resolved). Else green if the latest log row by
//     cutoff has status "ok". Else grey (not_checked, or never logged yet).
function classifyItemAsOf(logIndex, checkpointId, itemKey, cutoffMs, isSub) {
  const rows = logIndex[checkpointId + "::" + itemKey] || [];
  if (isSub) {
    const hasAny = rows.some(function (r) { return new Date(r.created_at).getTime() <= cutoffMs; });
    return hasAny ? "green" : "grey";
  }

  const findings = FINDINGS_BY_ITEM[checkpointId + "::" + itemKey] || [];
  const hasFindingByCutoff = findings.some(function (f) { return new Date(f.opened_at).getTime() <= cutoffMs; });
  if (hasFindingByCutoff) return "red";

  // rows is ascending by created_at — the last one at or before the cutoff
  // is the latest-as-of-that-day value.
  let latest = null;
  for (let i = 0; i < rows.length; i++) {
    const t = new Date(rows[i].created_at).getTime();
    if (t <= cutoffMs) latest = rows[i]; else break;
  }
  if (latest && latest.status === "ok") return "green";
  return "grey";
}

function computeOverviewCountsAsOf(logIndex, cutoffMs) {
  let grey = 0, green = 0, red = 0;

  EQUIPMENT_GROUPS.forEach(function (cp) {
    (cp.groupChecklist || []).forEach(function (ci) {
      const bucket = classifyItemAsOf(logIndex, cp.id, ci.item, cutoffMs, false);
      if (bucket === "red") red++;
      else if (bucket === "green") green++;
      else grey++;
    });
    (cp.subsections || []).forEach(function (s) {
      const bucket = classifyItemAsOf(logIndex, cp.id, "sub:" + s.designation, cutoffMs, true);
      if (bucket === "green") green++;
      else grey++;
    });
  });

  return { grey: grey, green: green, red: red, total: grey + green + red };
}

// One entry per day: { day: Date, label: "Wed 7/8", counts: {grey,green,red,total} }.
function computeOverviewSeries() {
  const logIndex = buildLogRowsByItem();
  return lastNLocalDays(OVERVIEW_DAY_COUNT).map(function (day) {
    return {
      day: day,
      label: shortDayLabel(day),
      counts: computeOverviewCountsAsOf(logIndex, localDayEndMs(day))
    };
  });
}

// Round, clean axis ceiling — a multiple of a "nice" step (5/10/20/50) at or
// just above the total item count, so gridlines land on 0/10/20/... rather
// than raw fractions. For the current 67-item facility this yields ticks at
// 0/10/20/30/40/50/60/70.
function niceAxisStep(total) {
  if (total <= 20) return 2;
  if (total <= 40) return 5;
  if (total <= 70) return 10;
  if (total <= 150) return 20;
  return 50;
}

// labelTextColor: computed (not assumed) per-segment WCAG contrast winner for
// the small on-segment count label — white vs. each fill:
//   red    (--status-critical  #d03b3b) vs #fff -> ~4.8:1
//   grey   (--status-notchecked #6b6a66) vs #fff -> ~5.4:1 (vs. ~3.9:1 for dark ink)
//   green  (--status-good      #0ca30c) vs #fff -> ~3.4:1 (matches the white-on-green
//     text this app already commits to elsewhere, e.g. ITEM_STATE_META.ok/
//     AGGREGATE_STATUS_META.ok's badge text)
// White wins (or ties the app's existing convention) in all three cases.
const OVERVIEW_SEGMENT_ORDER = [
  { key: "red", label: "Resulted in a finding", colorVar: "var(--status-critical)", iconStatus: "active_issue", labelTextColor: "#ffffff" },
  { key: "grey", label: "Not checked", colorVar: "var(--status-notchecked)", iconStatus: "not_checked", labelTextColor: "#ffffff" },
  { key: "green", label: "Checked — OK", colorVar: "var(--status-good)", iconStatus: "ok", labelTextColor: "#ffffff" }
];

// Minimum rendered segment height (px) for the on-segment count label to have
// comfortable padding above and below a ~11px numeral — below this, the label
// is skipped entirely (never clipped/overflowing); the count stays reachable
// via the segment's existing hover/focus tooltip and <title> either way.
const OVERVIEW_SEGMENT_LABEL_MIN_HEIGHT = 18;

let overviewTooltipHideTimer = null;

// Gap (px) kept between the hovered segment's edge and the tooltip — used
// both as the visual offset (added/subtracted when computing the tooltip's
// exact top pixel in showOverviewTooltip) and as the margin required in the
// "does this side actually fit" collision math, so the two can never drift
// out of sync with each other.
const OVERVIEW_TOOLTIP_GAP = 8;

function showOverviewTooltip(targetEl, dayLabel, catLabel, count) {
  const wrap = document.getElementById("overview-chart-wrap");
  const tip = document.getElementById("overview-chart-tooltip");
  if (!wrap || !tip) return;
  clearTimeout(overviewTooltipHideTimer);

  tip.innerHTML = "";
  const valueEl = document.createElement("div");
  valueEl.className = "tooltip-value";
  valueEl.textContent = count + (count === 1 ? " item" : " items");
  const catEl = document.createElement("div");
  catEl.className = "tooltip-cat";
  catEl.textContent = catLabel;
  const dayEl = document.createElement("div");
  dayEl.className = "tooltip-day";
  dayEl.textContent = dayLabel;
  tip.appendChild(valueEl);
  tip.appendChild(catEl);
  tip.appendChild(dayEl);

  // Must be visible BEFORE measuring, or its rendered size reads as 0
  // (display:none).
  tip.hidden = false;

  const wrapRect = wrap.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  // Positioned entirely in JS as one exact top-left pixel (no CSS anchor
  // transform/margin trickery on the Y axis) so every case — comfortably
  // above, flipped below, AND the neither-fits fallback — goes through the
  // same single clamp, instead of separate code paths that could each
  // independently drift out of sync with each other.
  //
  // Collision is measured against the WRAP's own box, NOT the viewport:
  // #overview-chart-wrap sets overflow-x:auto so the chart can scroll
  // horizontally on narrow screens, and per the CSS overflow spec that
  // forces its overflow-y to compute as "auto" too (an axis can't stay
  // "visible" once the other is scrollable) — so this element clips ANY
  // child that renders outside its own box, including this absolutely-
  // positioned tooltip, no matter how much room exists elsewhere on the
  // page. Comparing against the viewport's top edge (as an earlier version
  // of this function did) looked reasonable but was exactly backwards: the
  // page header/legend/hint-text above the chart panel gives the viewport
  // plenty of room, but none of that room is inside the wrap's own
  // clipping box — so every bar's topmost "Checked — OK" segment (flush
  // against the wrap's own top edge) rendered its tooltip fully invisible,
  // clipped away above the wrap, even though "space above" looked huge
  // from the viewport's point of view.
  const tipH = tipRect.height;
  const anchorTopLocal = targetRect.top - wrapRect.top + wrap.scrollTop;
  const anchorBottomLocal = targetRect.bottom - wrapRect.top + wrap.scrollTop;
  const spaceAbove = targetRect.top - wrapRect.top;
  const spaceBelow = wrapRect.bottom - targetRect.bottom;
  const neededV = tipH + OVERVIEW_TOOLTIP_GAP;

  let topLocal, flipBelow;
  if (spaceAbove >= neededV) {
    flipBelow = false;
    topLocal = anchorTopLocal - OVERVIEW_TOOLTIP_GAP - tipH;
  } else if (spaceBelow >= neededV) {
    flipBelow = true;
    topLocal = anchorBottomLocal + OVERVIEW_TOOLTIP_GAP;
  } else {
    // Neither side has the full ~76px this needs — an extremely short
    // chart, or (as happens for real, today) a short segment sandwiched
    // between an even-shorter one above it and the wrap's own top edge.
    // Use whichever side has more room, then clamp below so the tooltip
    // stays fully inside the wrap's own box regardless — sitting flush
    // against its edge, rather than floating the usual gap off the
    // segment, beats being invisible.
    flipBelow = spaceBelow > spaceAbove;
    topLocal = flipBelow ? (anchorBottomLocal + OVERVIEW_TOOLTIP_GAP) : (anchorTopLocal - OVERVIEW_TOOLTIP_GAP - tipH);
  }
  // Clamp within the wrap's own box, intersected with the actual browser
  // viewport — the wrap is the usual constraint (see above), but if the
  // wrap itself is taller than the viewport (a very short window, or one
  // scrolled so only part of the chart panel shows), no position inside the
  // wrap alone can guarantee on-screen; intersecting with the viewport too
  // means we only ever promise what's actually achievable, and still do the
  // best possible job otherwise.
  const minTopLocal = Math.max(wrap.scrollTop, wrap.scrollTop - wrapRect.top);
  const maxTopLocal = Math.max(minTopLocal,
    Math.min(wrap.scrollTop + wrap.clientHeight, wrap.scrollTop + (window.innerHeight - wrapRect.top)) - tipH);
  topLocal = Math.min(Math.max(topLocal, minTopLocal), maxTopLocal);
  tip.classList.toggle("overview-chart-tooltip-below", flipBelow);

  // Horizontal placement is centered on the segment by default, but clamped
  // so the tooltip's full (just-measured) width never renders outside the
  // wrap's own box either — the same clipping container, just the other
  // axis (this is what let the rightmost bar's widest tooltip — "Resulted
  // in a finding", the longest category label — overflow past the wrap's
  // right edge even on an ample desktop window) — intersected with the
  // viewport for the same reason as the vertical clamp above. wrap.scrollLeft
  // converts between the wrap's un-scrolled local coordinate space (which
  // `left` is set in) and its currently visible scrolled-into-view window.
  const halfW = tipRect.width / 2;
  const idealCenterX = targetRect.left - wrapRect.left + targetRect.width / 2 + wrap.scrollLeft;
  const minCenterX = Math.max(wrap.scrollLeft, wrap.scrollLeft - wrapRect.left) + halfW + OVERVIEW_TOOLTIP_GAP;
  const maxCenterX = Math.max(minCenterX,
    Math.min(wrap.scrollLeft + wrap.clientWidth, wrap.scrollLeft + (window.innerWidth - wrapRect.left)) - halfW - OVERVIEW_TOOLTIP_GAP);
  const centerX = Math.min(Math.max(idealCenterX, minCenterX), maxCenterX);

  tip.style.left = centerX + "px";
  tip.style.top = topLocal + "px";
}

function hideOverviewTooltip() {
  const tip = document.getElementById("overview-chart-tooltip");
  if (!tip) return;
  // Tiny delay avoids a flash-hide when focus/hover moves directly from one
  // segment to its immediate neighbor.
  overviewTooltipHideTimer = setTimeout(function () { tip.hidden = true; }, 40);
}

// Builds the hand-rolled SVG stacked bar chart (no chart library). Y axis is
// item count with hairline gridlines at round-number ticks; X axis is the
// last 7 local days, oldest on the left. Stacking order is identical on
// every bar — red anchored at the baseline (easiest to compare day to day),
// grey in the middle, green on top — with a 2px surface-color gap (i.e. just
// unpainted space showing the panel background) separating segments within
// a bar, and air between neighboring bars so they never touch.
function renderOverviewChart(series) {
  const svg = document.getElementById("overview-chart-svg");
  if (!svg) return;
  svg.innerHTML = "";

  const total = series[0].counts.total || 1;
  const axisStep = niceAxisStep(total);
  const axisMax = Math.ceil(total / axisStep) * axisStep;

  const W = 760, H = 360;
  const marginLeft = 40, marginRight = 14, marginTop = 14, marginBottom = 38;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const plotBottom = marginTop + plotH;
  const unitPx = plotH / axisMax;
  const gapPx = 2;

  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");

  const titleEl = svgEl("title");
  titleEl.textContent = "Checklist item status, last " + series.length + " days, by day.";
  svg.appendChild(titleEl);

  // ---- gridlines + y-axis tick labels
  const gridG = svgEl("g", { "class": "chart-grid-layer" });
  for (let tick = 0; tick <= axisMax; tick += axisStep) {
    const y = plotBottom - tick * unitPx;
    gridG.appendChild(svgEl("line", {
      x1: marginLeft, x2: marginLeft + plotW, y1: y, y2: y,
      "class": "chart-gridline", "vector-effect": "non-scaling-stroke"
    }));
    const label = svgEl("text", {
      x: marginLeft - 8, y: y, "text-anchor": "end", "dominant-baseline": "middle",
      "class": "chart-axis-label"
    });
    label.textContent = String(tick);
    gridG.appendChild(label);
  }
  svg.appendChild(gridG);

  // ---- bars
  const barsG = svgEl("g", { "class": "chart-bars-layer" });
  const slot = plotW / series.length;
  const barWidth = Math.min(56, slot * 0.5);

  series.forEach(function (entry, i) {
    const xCenter = marginLeft + slot * i + slot / 2;
    const barX = xCenter - barWidth / 2;

    let cursorY = plotBottom;
    let drawnAny = false;
    OVERVIEW_SEGMENT_ORDER.forEach(function (seg) {
      const count = entry.counts[seg.key] || 0;
      if (count <= 0) return;
      if (drawnAny) cursorY -= gapPx;
      const segH = count * unitPx;
      const rectTop = cursorY - segH;

      const rect = svgEl("rect", {
        x: barX, y: rectTop, width: barWidth, height: Math.max(segH, 0.01),
        rx: 1.5, ry: 1.5,
        tabindex: "0", role: "img", "class": "chart-segment",
        "aria-label": entry.label + " — " + seg.label + ": " + count + (count === 1 ? " item" : " items")
      });
      // Set via inline style (not the `fill` presentation attribute) so the
      // CSS custom property reliably resolves — these are the exact same
      // --status-good/--status-notchecked/--status-critical tokens used by
      // the map markers, roof cards, and legend elsewhere in this app.
      rect.style.fill = seg.colorVar;
      const segTitle = svgEl("title");
      segTitle.textContent = entry.label + " — " + seg.label + ": " + count;
      rect.appendChild(segTitle);

      rect.addEventListener("mouseenter", function () { showOverviewTooltip(rect, entry.label, seg.label, count); });
      rect.addEventListener("mouseleave", hideOverviewTooltip);
      rect.addEventListener("focus", function () { showOverviewTooltip(rect, entry.label, seg.label, count); });
      rect.addEventListener("blur", hideOverviewTooltip);

      barsG.appendChild(rect);

      // Visible on-segment count label — only when the segment is tall
      // enough to hold it with comfortable padding on both sides; too-short
      // segments skip the inline label entirely rather than clipping/
      // overflowing (the count is still always reachable via the rect's own
      // hover/focus tooltip + <title> above, unconditionally).
      if (segH >= OVERVIEW_SEGMENT_LABEL_MIN_HEIGHT) {
        const label = svgEl("text", {
          x: xCenter, y: rectTop + segH / 2,
          "text-anchor": "middle", "dominant-baseline": "central",
          "class": "chart-segment-label", "aria-hidden": "true"
        });
        label.style.fill = seg.labelTextColor;
        label.textContent = String(count);
        barsG.appendChild(label);
      }

      cursorY = rectTop;
      drawnAny = true;
    });

    const dayLabel = svgEl("text", {
      x: xCenter, y: plotBottom + 18, "text-anchor": "middle", "class": "chart-day-label"
    });
    dayLabel.textContent = entry.label;
    barsG.appendChild(dayLabel);
  });
  svg.appendChild(barsG);
}

function renderOverviewView() {
  const countsEl = document.getElementById("overview-counts");
  const legendEl = document.getElementById("overview-legend");
  if (!countsEl || !legendEl) return;

  const series = computeOverviewSeries();
  renderOverviewChart(series);

  const today = series[series.length - 1].counts;
  countsEl.textContent = "Today: " + today.green + " OK · " + today.grey + " not checked · " +
    today.red + " finding" + (today.red === 1 ? "" : "s") + " — " + today.total + " total";

  legendEl.innerHTML = "";
  [
    { status: "active_issue", color: "var(--status-critical)", label: "Resulted in a finding" },
    { status: "not_checked", color: "var(--status-notchecked)", label: "Not checked" },
    { status: "ok", color: "var(--status-good)", label: "Checked — OK" }
  ].forEach(function (row) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const iconWrap = document.createElement("span");
    iconWrap.className = "legend-icon";
    iconWrap.style.color = row.color;
    iconWrap.innerHTML = iconHTML(row.status, 16);
    const lbl = document.createElement("span");
    lbl.textContent = row.label;
    item.appendChild(iconWrap);
    item.appendChild(lbl);
    legendEl.appendChild(item);
  });
}

// -------------------------------------------------------------- header / tabs
const TAB_IDS = ["floor", "roof", "log", "findings", "overview"];

function switchTab(which) {
  TAB_IDS.forEach(function (id) {
    const isActive = id === which;
    document.getElementById("tab-" + id).classList.toggle("is-active", isActive);
    document.getElementById("tab-" + id).setAttribute("aria-selected", String(isActive));
    document.getElementById("view-" + id).classList.toggle("is-active", isActive);
  });
  if (which === "log") renderDailyLogView();
  if (which === "findings") renderFindingsView();
  if (which === "overview") renderOverviewView();
}

function wireHeaderControls() {
  TAB_IDS.forEach(function (id) {
    document.getElementById("tab-" + id).addEventListener("click", function () { switchTab(id); });
  });
}

function wirePanelControls() {
  document.getElementById("panel-close").addEventListener("click", closePanel);
  document.getElementById("backdrop").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePanel();
  });
}

// -------------------------------------------------------------- load status UI
function wireLoadBanner() {
  const dismissBtn = document.getElementById("load-error-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", function () {
      document.getElementById("load-error-banner").hidden = true;
    });
  }
}

function setLoadingIndicator(isLoading) {
  const el = document.getElementById("load-status");
  if (el) el.hidden = !isLoading;
}

function showLoadErrorBanner() {
  const el = document.getElementById("load-error-banner");
  if (el) el.hidden = false;
}

async function init() {
  renderLegend();
  wireHeaderControls();
  wirePanelControls();
  wireLoadBanner();
  wireDailyLogControls();
  wireFindingsControls();
  wireIdentityGate();
  // Gate is visible by default in the HTML (no page-load flash of an
  // editable dashboard) — this just syncs the "Acting as" header UI (name
  // placeholder, hidden view-only badge) to the no-identity-selected-yet
  // state.
  updateActingAsUI();

  // Render immediately against an empty cache (-> everything "not_checked")
  // so the UI is never blank/broken while the initial Supabase load is in
  // flight — this doubles as the "loading" state for the map/roof grid.
  renderFloorSVG();
  renderRoofGrid();

  // Kicked off in parallel with the identity gate being shown (rather than
  // waiting for a name to be picked first) so data is already loaded by the
  // time someone picks who they are.
  setLoadingIndicator(true);
  try {
    const bundle = await ChecklistStore.loadAll();
    ingestLog(bundle.log);
    ingestFindings(bundle.findings, bundle.findingUpdates);
  } catch (err) {
    console.error("ChecklistStore.loadAll failed:", err);
    showLoadErrorBanner();
  } finally {
    setLoadingIndicator(false);
    refreshStatusesUI();
    // The initial defaults (set in wireDailyLogControls, before this load
    // finished) fell back to today's date since LOG_ROWS/FINDING_UPDATES_LIST
    // were still empty — recompute now against the real loaded data, but only
    // if the user hasn't already touched the inputs during the brief loading
    // window.
    if (!exportRangeUserEdited) setExportRangeDefaults();
    renderDailyLogView();
    renderFindingsView();
    renderOverviewView();
  }
}

document.addEventListener("DOMContentLoaded", init);
