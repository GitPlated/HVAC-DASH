/*
 * app.js — renders the floor plan / roof panel from ROOMS + EQUIPMENT_GROUPS
 * and manages checklist state backed by Supabase (via window.ChecklistStore,
 * defined in js/supabase-client.js). Plain script, no modules, no build
 * step — relies on rooms.js, data.js, and supabase-client.js having already
 * defined their globals before this file runs.
 *
 * All checklist reads/writes go through an in-memory CACHE that mirrors the
 * shape this file used to reconstruct from localStorage, so the
 * rendering/status-computation functions below barely had to change:
 *   CACHE.group[checkpointId][itemName]  -> { state, notes }
 *   CACHE.sub[checkpointId][designation] -> { oilLevel, notes }
 * CACHE is populated once on startup from ChecklistStore.loadAll(), and kept
 * in sync optimistically on every user edit — the same edit also fires an
 * async write to Supabase in the background. A failed background write is
 * logged to the console; it does not roll back the optimistic UI state (the
 * next full page load's loadAll() is the real source of truth).
 */

// Fixed, non-themed colors. Kept in sync by hand with the CSS custom
// properties of the same name in css/style.css — these never change between
// light/dark, so hardcoding hex here (rather than reading CSS vars back out
// of the DOM) is simplest and avoids var()-in-SVG-attribute edge cases.
const STATUS_COLORS = {
  "not-checked": "#6b6a66",
  "good": "#0ca30c",
  "warning": "#fab219",
  "serious": "#ec835a",
  "critical": "#d03b3b"
};

const STATUS_META = {
  "not-checked": { label: "Not checked", color: STATUS_COLORS["not-checked"], text: "#ffffff" },
  "good": { label: "OK", color: STATUS_COLORS.good, text: "#ffffff" },
  "warning": { label: "Attention", color: STATUS_COLORS.warning, text: "#1a1200" },
  "serious": { label: "Serious", color: STATUS_COLORS.serious, text: "#1a1200" },
  "critical": { label: "Fault", color: STATUS_COLORS.critical, text: "#ffffff" }
};

// The 3-state control on group checklist rows only ever uses these three.
const ITEM_STATES = ["not-checked", "good", "warning"];

const CATEGORY_COLORS = {
  raw: { fill: "#1b3a5c", stroke: "#3d6690", text: "#eef2f6" },
  cooked: { fill: "#f2f0e7", stroke: "rgba(20,20,15,0.35)", text: "#23231f" },
  admin: { fill: "#8a8d93", stroke: "rgba(255,255,255,0.25)", text: "#1a1a1a" },
  mechanical: { fill: "#46525c", stroke: "#6f7a84", text: "#eef2f6" }
};

// Distinct glyph shapes per status so color is never the only signal
// (dash / check / solid triangle / solid diamond / X-cross). currentColor
// is used throughout so callers can tint via the CSS `color` property (or
// element.style.color) whether the icon lives in HTML or in the SVG map.
const ICON_SHAPES = {
  "not-checked": '<line x1="5" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  "good": '<path d="M4 10.5 L8.5 15 L16 5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  "warning": '<path d="M10 3 L18 17 L2 17 Z" fill="currentColor"/>',
  "serious": '<path d="M10 2 L18 10 L10 18 L2 10 Z" fill="currentColor"/>',
  "critical": '<path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
};

function iconHTML(status, size) {
  return '<svg viewBox="0 0 20 20" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    ICON_SHAPES[status] + '</svg>';
}

// ---------------------------------------------------------------- storage
// In-memory cache of checklist entries. Populated by ingestRows() after
// ChecklistStore.loadAll() resolves, and updated optimistically by the
// setGroupEntryLocal/setSubEntryLocal helpers whenever the user edits
// something (see buildCheckRow / buildSubRow below).
const CACHE = { group: {}, sub: {} };

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

// The DB uses 'not_checked' (underscore) for status and '50%' (with percent
// sign) for oil_level. Everything else in this file keeps using
// 'not-checked' (hyphen) and '50' (bare number), matching what the old
// localStorage-era code expected, to minimize changes elsewhere in this file.
function dbStatusToState(status) {
  if (status === "good" || status === "warning") return status;
  return "not-checked";
}
function stateToDbStatus(state) {
  if (state === "good" || state === "warning") return state;
  return "not_checked";
}
function oilDbToLocal(oilLevel) {
  return oilLevel ? String(oilLevel).replace("%", "") : "";
}
function oilLocalToDb(oilLevel) {
  return oilLevel ? oilLevel + "%" : null;
}

// Rebuilds CACHE from the flat row list returned by ChecklistStore.loadAll().
function ingestRows(rows) {
  CACHE.group = {};
  CACHE.sub = {};
  (rows || []).forEach(function (row) {
    if (!row || !row.checkpoint_id || !row.item_key) return;
    if (row.item_key.indexOf("sub:") === 0) {
      setSubEntryLocal(row.checkpoint_id, row.item_key.slice(4), oilDbToLocal(row.oil_level), row.notes);
    } else {
      setGroupEntryLocal(row.checkpoint_id, row.item_key, dbStatusToState(row.status), row.notes);
    }
  });
}

function debounce(fn, delay) {
  let t;
  return function () {
    const args = arguments;
    const ctx = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, delay);
  };
}

// -------------------------------------------------------------- aggregate
/*
 * Aggregate status for a checkpoint's marker / card color.
 *  - A static deficiency note (subsections[].override, baked into data.js)
 *    always forces "critical" — it's a known fault already documented on the
 *    real sheet, not something a technician has to trigger by checking a box.
 *  - Otherwise, count "Attention" flags across the group checklist items and
 *    across rack subsections whose recorded oil level isn't the expected
 *    50%. Thresholds below are a documented judgment call (the spec leaves
 *    exact tuning open):
 *      0 flags, nothing recorded  -> "not-checked"
 *      0 flags, something recorded -> "good"
 *      1 flag                      -> "warning"
 *      2+ flags                    -> "serious"
 *  A checkpoint NEVER shows "good" unless at least one item has actually
 *  been recorded, and a deficiency note always wins regardless of anything
 *  else recorded.
 */
function computeAggregateStatus(checkpoint) {
  const hasOverride = (checkpoint.subsections || []).some(function (s) { return !!s.override; });
  if (hasOverride) return "critical";

  let attentionFlags = 0;
  let recordedCount = 0;

  const groupData = getGroupEntries(checkpoint.id);
  (checkpoint.groupChecklist || []).forEach(function (ci) {
    const entry = groupData[ci.item];
    const state = entry ? entry.state : "not-checked";
    if (state !== "not-checked") recordedCount++;
    if (state === "warning") attentionFlags++;
  });

  (checkpoint.subsections || []).forEach(function (s) {
    const sub = getSubEntry(checkpoint.id, s.designation);
    if (sub.oilLevel) {
      recordedCount++;
      if (sub.oilLevel !== "50") attentionFlags++;
    }
  });

  if (attentionFlags >= 2) return "serious";
  if (attentionFlags === 1) return "warning";
  if (recordedCount > 0) return "good";
  return "not-checked";
}

// -------------------------------------------------------------- lookups
const ROOMS_BY_ID = {};
ROOMS.forEach(function (r) { ROOMS_BY_ID[r.id] = r; });

const CHECKPOINTS_BY_ROOM = {};
EQUIPMENT_GROUPS.forEach(function (cp) {
  if (cp.roomKey === "roof") return;
  if (!CHECKPOINTS_BY_ROOM[cp.roomKey]) CHECKPOINTS_BY_ROOM[cp.roomKey] = [];
  CHECKPOINTS_BY_ROOM[cp.roomKey].push(cp);
});

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
  const g = svgEl("g", { "class": "marker", tabindex: "0", role: "button" });

  const title = svgEl("title");
  let titleText = checkpoint.equipment +
    (checkpoint.designation ? " (" + checkpoint.designation + ")" : "") +
    " — " + STATUS_META[status].label;
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

  g.appendChild(svgEl("circle", {
    cx: cx, cy: cy, r: 7, fill: STATUS_COLORS[status],
    stroke: "rgba(0,0,0,0.35)", "stroke-width": 1, "class": "marker-ring"
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
  Object.keys(STATUS_META).forEach(function (status) {
    const meta = STATUS_META[status];
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
  const meta = STATUS_META[status];
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

// -------------------------------------------------------------- roof grid
function renderRoofGrid() {
  const grid = document.getElementById("roof-grid");
  grid.innerHTML = "";
  EQUIPMENT_GROUPS.filter(function (cp) { return cp.roomKey === "roof"; }).forEach(function (cp) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "roof-card";

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
    card.addEventListener("click", function () { openPanel(cp); });
    grid.appendChild(card);
  });
}

function refreshStatusesUI() {
  renderFloorSVG();
  renderRoofGrid();
}

// -------------------------------------------------------------- panel content
function buildSegmented(currentState, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "segmented";
  ITEM_STATES.forEach(function (state) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.state = state;
    if (state === currentState) btn.classList.add("is-active");
    btn.innerHTML = iconHTML(state, 13);
    const lbl = document.createElement("span");
    lbl.textContent = STATUS_META[state].label;
    btn.appendChild(lbl);
    btn.addEventListener("click", function () {
      wrap.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      onChange(state);
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

function buildCheckRow(checkpoint, checklistItem) {
  const groupData = getGroupEntries(checkpoint.id);
  const current = groupData[checklistItem.item] || { state: "not-checked", notes: "" };

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

  const segmented = buildSegmented(current.state, function (newState) {
    const prevNotes = (getGroupEntries(checkpoint.id)[checklistItem.item] || {}).notes || "";
    setGroupEntryLocal(checkpoint.id, checklistItem.item, newState, prevNotes);
    refreshStatusesUI();
    saveError.hidden = true;
    ChecklistStore.saveGroupItem(checkpoint.id, checklistItem.item, stateToDbStatus(newState), prevNotes)
      .catch(function (err) {
        console.error("Failed to save checklist item to Supabase:", checkpoint.id, checklistItem.item, err);
        saveError.hidden = false;
      });
  });
  head.appendChild(segmented);
  row.appendChild(head);

  const notesInput = document.createElement("input");
  notesInput.type = "text";
  notesInput.className = "notes-input";
  notesInput.placeholder = "Notes / actual reading";
  notesInput.value = current.notes || "";
  const saveNotes = debounce(function () {
    const stateNow = (getGroupEntries(checkpoint.id)[checklistItem.item] || {}).state || "not-checked";
    setGroupEntryLocal(checkpoint.id, checklistItem.item, stateNow, notesInput.value);
    saveError.hidden = true;
    ChecklistStore.saveGroupItem(checkpoint.id, checklistItem.item, stateToDbStatus(stateNow), notesInput.value)
      .catch(function (err) {
        console.error("Failed to save checklist notes to Supabase:", checkpoint.id, checklistItem.item, err);
        saveError.hidden = false;
      });
  }, 400);
  notesInput.addEventListener("input", saveNotes);
  row.appendChild(notesInput);
  row.appendChild(saveError);

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

  const row = document.createElement("div");
  row.className = "sub-row";

  const head = document.createElement("div");
  head.className = "sub-row-head";
  const left = document.createElement("div");

  const desigLine = document.createElement("div");
  desigLine.className = "sub-row-designation";
  desigLine.textContent = "Compressor " + sub.designation;
  if (sub.override) {
    const fault = document.createElement("span");
    fault.className = "sub-row-fault";
    fault.textContent = "  ⚠ FAULT: " + sub.override;
    desigLine.appendChild(fault);
  }
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

  const select = document.createElement("select");
  select.className = "oil-select";
  [["", "— Select —"], ["0", "0%"], ["25", "25%"], ["50", "50%"], ["75", "75%"], ["100", "100%"]].forEach(function (pair) {
    const opt = document.createElement("option");
    opt.value = pair[0];
    opt.textContent = pair[1];
    if (stored.oilLevel === pair[0]) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", function () {
    const existingNotes = getSubEntry(checkpoint.id, sub.designation).notes;
    setSubEntryLocal(checkpoint.id, sub.designation, select.value, existingNotes);
    refreshStatusesUI();
    saveError.hidden = true;
    ChecklistStore.saveSubsection(checkpoint.id, sub.designation, oilLocalToDb(select.value), existingNotes)
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
  const saveSubNotes = debounce(function () {
    const existingOil = getSubEntry(checkpoint.id, sub.designation).oilLevel;
    setSubEntryLocal(checkpoint.id, sub.designation, existingOil, notesInput.value);
    saveError.hidden = true;
    ChecklistStore.saveSubsection(checkpoint.id, sub.designation, oilLocalToDb(existingOil), notesInput.value)
      .catch(function (err) {
        console.error("Failed to save compressor notes to Supabase:", checkpoint.id, sub.designation, err);
        saveError.hidden = false;
      });
  }, 400);
  notesInput.addEventListener("input", saveSubNotes);
  controls.appendChild(notesInput);

  row.appendChild(controls);
  row.appendChild(saveError);

  if (sub.override && sub.notes) {
    const staticNote = document.createElement("div");
    staticNote.className = "check-row-expected";
    staticNote.textContent = "Sheet note: " + sub.notes;
    row.appendChild(staticNote);
  }

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

  const overrideSub = (checkpoint.subsections || []).find(function (s) { return !!s.override; });
  if (overrideSub) {
    const banner = document.createElement("div");
    banner.className = "deficiency-banner";
    banner.innerHTML = iconHTML("critical", 20);
    const bodyWrap = document.createElement("div");
    bodyWrap.className = "db-body";
    const titleEl = document.createElement("div");
    titleEl.textContent = "Known deficiency — Compressor " + overrideSub.designation + ": " + overrideSub.override;
    bodyWrap.appendChild(titleEl);
    if (overrideSub.notes) {
      const notesEl = document.createElement("div");
      notesEl.className = "db-notes";
      notesEl.textContent = overrideSub.notes;
      bodyWrap.appendChild(notesEl);
    }
    banner.appendChild(bodyWrap);
    body.appendChild(banner);
  }

  sectionTitle(body, "Equipment Info");
  infoRow(body, "Location", checkpoint.location);
  const room = ROOMS_BY_ID[checkpoint.roomKey];
  infoRow(body, "Room", checkpoint.roomKey === "roof" ? "Roof" : (room ? room.label : checkpoint.roomKey));
  infoRow(body, "Manufacturer", checkpoint.manufacturer);
  if (checkpoint.roomConfidence === "assumed") {
    const note = document.createElement("div");
    note.className = "assumed-note";
    note.innerHTML = iconHTML("warning", 13) + "<span>Assumed placement — confirm on-site</span>";
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
  document.getElementById("slide-over").classList.remove("is-open");
  document.getElementById("slide-over").setAttribute("aria-hidden", "true");
  document.getElementById("backdrop").classList.remove("is-open");
}

// -------------------------------------------------------------- header / tabs
function switchTab(which) {
  const isFloor = which === "floor";
  document.getElementById("tab-floor").classList.toggle("is-active", isFloor);
  document.getElementById("tab-roof").classList.toggle("is-active", !isFloor);
  document.getElementById("tab-floor").setAttribute("aria-selected", String(isFloor));
  document.getElementById("tab-roof").setAttribute("aria-selected", String(!isFloor));
  document.getElementById("view-floor").classList.toggle("is-active", isFloor);
  document.getElementById("view-roof").classList.toggle("is-active", !isFloor);
}

function wireHeaderControls() {
  document.getElementById("tab-floor").addEventListener("click", function () { switchTab("floor"); });
  document.getElementById("tab-roof").addEventListener("click", function () { switchTab("roof"); });
  document.getElementById("btn-reset").addEventListener("click", function () {
    const ok = confirm("Reset ALL recorded checklist entries for everyone using this dashboard? This cannot be undone.");
    if (!ok) return;
    ChecklistStore.resetAll()
      .then(function () {
        CACHE.group = {};
        CACHE.sub = {};
        closePanel();
        refreshStatusesUI();
      })
      .catch(function (err) {
        console.error("ChecklistStore.resetAll failed:", err);
        alert("Couldn't reset entries — the database delete failed. Check your connection and try again.");
      });
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

  // Render immediately against an empty cache (-> everything "not-checked")
  // so the UI is never blank/broken while the initial Supabase load is in
  // flight — this doubles as the "loading" state for the map/roof grid.
  renderFloorSVG();
  renderRoofGrid();

  setLoadingIndicator(true);
  try {
    const rows = await ChecklistStore.loadAll();
    ingestRows(rows);
  } catch (err) {
    console.error("ChecklistStore.loadAll failed:", err);
    showLoadErrorBanner();
  } finally {
    setLoadingIndicator(false);
    refreshStatusesUI();
  }
}

document.addEventListener("DOMContentLoaded", init);
