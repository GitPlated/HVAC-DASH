/*
 * Equipment data model — Goodyear, AZ. Transcribed verbatim from two real
 * facility documents: Refrigeration_HVAC_Equipment_List_Alphabetical.xlsx
 * (81 rows: 76 evaporator coils tagged AL/AM/BL/BM/CL/CM/DM + 4 CO2
 * refrigeration racks) and IRT_Expanded_Refrigeration_Checklist_Standards.xlsx
 * (77 checklist items across 5 equipment types). Serial numbers are blank
 * throughout the evaporator coil rows -- the source spreadsheet's own
 * footnote says they "were not shown in the provided equipment schedules;
 * complete during field verification," not omitted by transcription here.
 *
 * Per Jacob (2026-09-08): RTUs/OAUs, Blast Chillers, and Spiral Chiller
 * Racks are excluded from both source documents ("intentionally excluded"
 * per the checklist doc's own header) and are NOT added here from Aurora's
 * own model -- pending real equipment/checklist data for them, to follow
 * retroactively. This means nothing in Goodyear's data is roof-mounted yet
 * (no checkpoint uses roomKey "roof"), unlike Aurora's.
 *
 * The checklist's other 3 equipment types -- MicroThermo/EMS Controls, Gas
 * Coolers/Fluid Coolers, Water Towers/Filtration -- have no equipment-list
 * row of their own (no unit tag, room, manufacturer, or serial given for
 * any of them). Per Jacob, folded into each Rack A-D checkpoint's own
 * groupChecklist as shared systems rather than invented as separate
 * checkpoints with no real equipment identity -- see RACK_CHECKLIST below,
 * where each folded-in item's `item` text is prefixed with its source
 * section so the origin stays traceable.
 *
 * Rack naming: the equipment list itself tags these "Rack 1"-"Rack 4", but
 * both the checklist doc ("CO2 Refrigeration Racks A-D") and the facility's
 * own floor-plan graphic (Refrigeration Room, labeled Rack A/B/C/D) agree
 * on letters -- used here as canonical, mapped in the source's own row
 * order (Rack 1->A, 2->B, 3->C, 4->D).
 *
 * roomConfidence: "confirmed" = the equipment list's own location text
 * matched a named room on the facility's floor-plan graphic directly.
 * "assumed" = no confident match existed; placed at the closest logical
 * room (see js/rooms.js's own header for which). Edit roomKey below to
 * correct any of these once confirmed on-site -- nothing else needs to
 * change. None of this has been walked/verified on-site yet.
 *
 * No compressor-level oil-level tracking (Aurora's Rack A/B `subsections`
 * pattern) for any of these 4 racks -- the equipment list gives one serial
 * per rack, not a per-compressor breakdown, so there's no real per-unit
 * data to track individually yet. "Compressor oil levels" is still a real,
 * checkable item in RACK_CHECKLIST below, just as one shared item rather
 * than N individually-tracked compressors.
 */

// Shared by all 18 evaporator-coil checkpoints below -- one real checklist
// standard applies to every evaporator group regardless of room, per the
// source doc's own "Equipment Type" column (it's one type, not one row per
// room). A room's own `units` array is where that room's real, individually
// tagged coils live.
const EVAPORATOR_CHECKLIST = [
  { item: "Visual inspection", expected: "No abnormal noise, rust, leaks, excessive ice buildup, debris, or hot spots." },
  { item: "Coil cleanliness", expected: "Coil face and back are clean and unobstructed." },
  { item: "Ice / frost pattern", expected: "No excessive or abnormal ice buildup; frost pattern consistent with normal operation." },
  { item: "Refrigerant / oil leak check", expected: "No visible oil staining or signs of refrigerant leakage." },
  { item: "Fan operation", expected: "All fans operating in correct direction without abnormal noise or vibration." },
  { item: "Fan blades", expected: "Blades secure, clean, undamaged, and centered." },
  { item: "Fan guards", expected: "Guards secure, clean, and undamaged." },
  { item: "Fan motors / bearings", expected: "No abnormal noise, vibration, overheating, or bearing condition." },
  { item: "Drain pan", expected: "Clean and free of debris; no standing water or overflow." },
  { item: "Drain line", expected: "Clear and flowing freely with no backup or leakage." },
  { item: "Drain heat / heat trace (where installed)", expected: "Heat trace intact and operating; drain remains free of ice." },
  { item: "Defrost operation", expected: "Defrost initiates/terminates correctly and removes ice without abnormal water carryover." },
  { item: "Electrical wiring / connections", expected: "Wiring intact and secure; no damaged insulation, loose connections, or overheating." },
  { item: "Contactor / control components", expected: "Components operate normally with no visible overheating or damage." },
  { item: "Piping / insulation", expected: "Piping supported and insulation intact; no rubbing, condensation, or damaged vapor barrier." },
  { item: "Airflow / obstructions", expected: "Air inlet and discharge are unobstructed with good airflow." },
  { item: "Unit mounting / hardware", expected: "Unit, panels, fasteners, and supports secure." },
  { item: "General condition", expected: "Equipment is clean, serviceable, and safe with no condition that could contaminate product." },
];

// Shared by all 4 Rack A-D checkpoints. 20 rack items + 3 folded-in
// equipment types (10 + 12 + 12 = 34 items), 54 total -- see the header
// comment above for why MicroThermo/Gas Coolers/Water Towers live here
// instead of as their own checkpoints.
const RACK_CHECKLIST = [
  { item: "Visual inspection", expected: "No abnormal noise, rust, leaks, ice buildup, debris, or hot spots." },
  { item: "Active alarms", expected: "No active or unresolved alarms." },
  { item: "VFD 1", expected: "No active alarms; operating normally." },
  { item: "VFD 2", expected: "No active alarms; operating normally." },
  { item: "Suction pressure", expected: "Verify and record; pressure should be consistent with system operating conditions/setpoint." },
  { item: "Discharge pressure", expected: "Verify and record; pressure should be consistent with system operating conditions/setpoint." },
  { item: "Suction tank level", expected: "Verify and record level." },
  { item: "Discharge tank level", expected: "Verify and record level." },
  { item: "Receiver level", expected: "Verify and record level; no abnormal high/low condition." },
  { item: "Compressor oil levels", expected: "Oil visible at acceptable level; no abnormal loss or overfill." },
  { item: "Oil regulator", expected: "No leaks; regulator and associated piping appear to be operating normally." },
  { item: "Compressor operation", expected: "Compressors run without abnormal noise, vibration, overheating, or oil/refrigerant leaks." },
  { item: "Compressor amperage", expected: "Amperage is stable and appropriate for operating condition." },
  { item: "Compressor electrical connections", expected: "Connections secure; no discoloration, overheating, or damaged wiring." },
  { item: "Compressor safeties / controls", expected: "Safeties and controls are in service with no bypasses or active faults." },
  { item: "Refrigerant / oil leak inspection", expected: "No visible refrigerant/oil leakage." },
  { item: "Piping / insulation condition", expected: "Piping supported; insulation intact; no rubbing, damage, or excessive frost/condensation." },
  { item: "Electrical panels / components", expected: "Clean, secure, and free of overheating, damaged components, or loose wiring." },
  { item: "General cleanliness", expected: "Rack area and equipment are clean and accessible." },
  { item: "System operating condition", expected: "Rack is stable with no abnormal cycling, pressure swings, or unexplained shutdowns." },
  // Folded in from "MicroThermo / EMS Controls" (no separate equipment tag given)
  { item: "[EMS] Active alarms", expected: "None." },
  { item: "[EMS] Communication errors", expected: "No communication errors." },
  { item: "[EMS] Superheat", expected: "Verify and record; no abnormal reading/alarm." },
  { item: "[EMS] High pressure", expected: "No high-pressure alarm; reading within normal operating condition." },
  { item: "[EMS] Low pressure", expected: "No low-pressure alarm; reading within normal operating condition." },
  { item: "[EMS] Evaporator pressure", expected: "Verify and record; stable for current operating condition." },
  { item: "[EMS] Condenser pressure", expected: "Verify and record; stable for current operating condition." },
  { item: "[EMS] Ambient temperature", expected: "Verify and record." },
  { item: "[EMS] Dew point", expected: "Verify and record." },
  { item: "[EMS] Setpoints / control status", expected: "No unauthorized changes; control points match approved operating strategy." },
  { item: "[EMS] Sensor plausibility", expected: "Displayed readings are reasonable and consistent with field conditions." },
  // Folded in from "Gas Coolers / Fluid Coolers" (no separate equipment tag given)
  { item: "[Gas Cooler] Visual inspection", expected: "No abnormal noise, rust, leaks, debris, damage, or hot spots." },
  { item: "[Gas Cooler] Coil cleanliness", expected: "Coils clean and unobstructed." },
  { item: "[Gas Cooler] Coil condition", expected: "Fins/coils not significantly damaged; no visible leakage." },
  { item: "[Gas Cooler] Fan operation", expected: "All required fans operate correctly." },
  { item: "[Gas Cooler] Fan blades", expected: "Blades secure, clean, undamaged, and balanced." },
  { item: "[Gas Cooler] Fan guards", expected: "Guards secure and undamaged." },
  { item: "[Gas Cooler] Fan motors", expected: "Motors run without abnormal noise, overheating, or vibration." },
  { item: "[Gas Cooler] Motor / bearing condition", expected: "No excessive bearing noise, play, or vibration." },
  { item: "[Gas Cooler] Electrical connections", expected: "Connections secure with no visible overheating or damaged wiring." },
  { item: "[Gas Cooler] Contactor / control operation", expected: "Controls sequence equipment correctly; no damaged or overheated components." },
  { item: "[Gas Cooler] Leak inspection", expected: "No visible refrigerant/fluid leaks." },
  { item: "[Gas Cooler] Piping / supports", expected: "Piping and supports secure with no rubbing, damage, or abnormal vibration." },
  // Folded in from "Water Towers / Filtration" (no separate equipment tag given)
  { item: "[Water Tower] Visual inspection", expected: "No abnormal noise, rust, leaks, buildup, debris, or hot spots." },
  { item: "[Water Tower] Condenser makeup water tank level", expected: "Verify and record appropriate level." },
  { item: "[Water Tower] Conductivity / chemical control", expected: "Conductivity control operating and reading is reasonable for site treatment program." },
  { item: "[Water Tower] Dosing pump operation", expected: "Operating normally." },
  { item: "[Water Tower] Bromax chemical tank level", expected: "Verify and record level; sufficient chemical available." },
  { item: "[Water Tower] Alco chemical tank level", expected: "Verify and record level; sufficient chemical available." },
  { item: "[Water Tower] Chemical feed tubing / connections", expected: "Tubing and fittings secure with no leaks, cracks, or blockage." },
  { item: "[Water Tower] Water leaks", expected: "No uncontrolled water leakage from pumps, piping, valves, basins, or connections." },
  { item: "[Water Tower] Pump operation", expected: "Pumps operate without abnormal noise, vibration, overheating, or leakage." },
  { item: "[Water Tower] Strainers / filtration", expected: "Clean and free-flowing; no excessive restriction." },
];

const EQUIPMENT_GROUPS = [
  // ------------------------------------------------------- EVAPORATOR COILS
  {
    id: "fulfillment-freezer", equipment: "Evaporator Coils", location: "Area 5 Fulfillment Freezer",
    roomKey: "fulfillment-freezer", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AL 1 - Larkin LHL4890SA" }, { model: "AL 2 - Larkin LHL4890SA" },
      { model: "AL 3 - Larkin LHL4890SA" }, { model: "AL 4 - Larkin LHL4890SA" },
      { model: "BL 1 - Larkin LHL4890SA" }, { model: "BL 2 - Larkin LHL4890SA" },
      { model: "CL 1 - Larkin LHL4890SA" }, { model: "CL 2 - Larkin LHL4890SA" },
    ],
  },
  {
    id: "fulfillment-cooler", equipment: "Evaporator Coils", location: "Q11 Fulfillment Cooler",
    roomKey: "fulfillment", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AM 1 - Guntner S-CXMDN 066D/47-AL/14P" }, { model: "AM 2 - Guntner S-CXMDN 066D/47-AL/14P" },
      { model: "BM 1 - Guntner S-CXMDN 066D/47-AL/14P" }, { model: "BM 2 - Guntner S-CXMDN 066D/47-AL/14P" },
      { model: "BM 3 - Guntner S-CXMDN 066D/47-AL/14P" }, { model: "BM 4 - Guntner S-CXMDN 066D/47-AL/14P" },
      { model: "CM 3 - Guntner S-CXMDN 066D/47-AL/14P" }, { model: "CM 4 - Guntner S-CXMDN 066D/47-AL/14P" },
      { model: "CM 5 - Guntner S-CXMDN 066D/47-AL/14P" },
    ],
  },
  {
    id: "outbound-dock", equipment: "Evaporator Coils", location: "Area 8 Out Bound Dock",
    roomKey: "outbound-dock", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AM 3 - Larkin LHA61900SA" }, { model: "AM 4 - Larkin LHA61900SA" },
      { model: "BM 8 - Larkin LHA61900SA" }, { model: "BM 9 - Larkin LHA61900SA" },
      { model: "CM 6 - Larkin LHA61900SA" }, { model: "CM 7 - Larkin LHA61900SA" },
      { model: "CM 8 - Larkin LHA61900SA" },
    ],
  },
  {
    id: "inbound-dock", equipment: "Evaporator Coils", location: "Area 9 In Bound Dock",
    roomKey: "inbound-dock", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AM 5 - Larkin LHA61900SA" }, { model: "AM 6 - Larkin LHA61900SA" },
      { model: "AM 7 - Larkin LHA61900SA" }, { model: "DM 9 - Larkin LHA61900SA" },
      { model: "DM 10 - Larkin LHA61900SA" }, { model: "DM 11 - Larkin LHA61900SA" },
    ],
  },
  {
    id: "freezer-debox", equipment: "Evaporator Coils", location: "Area 10 Freezer Debox",
    roomKey: "freezer-debox", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AM 8 - Larkin LEH0553DS6AYA" }, { model: "AM 9 - Larkin LEH0553DS6AYA" },
    ],
  },
  {
    id: "protein-holding", equipment: "Evaporator Coils", location: "Area 12 Protein Holding",
    roomKey: "protein-holding", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AM 10 - Larkin LHA61610SA" }, { model: "BM 7 - Larkin LHA61610SA" },
    ],
  },
  {
    id: "trash-room", equipment: "Evaporator Coils", location: "Area 13 Trash Room",
    roomKey: "trash-room", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [ { model: "AM 11 - Larkin LEH1053DS6AYA" } ],
  },
  {
    id: "blast-holding", equipment: "Evaporator Coils", location: "Area 15 Blast Holding",
    roomKey: "blast-holding", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "AM 12 - Larkin LHA61170SA" }, { model: "AM 13 - Larkin LHA61170SA" },
      { model: "DM 1 - Larkin LHA61170SA" }, { model: "DM 2 - Larkin LHA61170SA" },
    ],
  },
  {
    id: "spiral-room", equipment: "Evaporator Coils", location: "Area 21 Spiral Room",
    roomKey: "spiral-room", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [ { model: "AM 16 - Larkin LEH1053DS6AYA" } ],
  },
  {
    id: "veggie-freezer", equipment: "Evaporator Coils", location: "Area 6 Veggie Freezer",
    roomKey: "veggie-freezer", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "BL 3 - Larkin LHL41860SB" }, { model: "CL 3 - Larkin LHL41860SB" },
    ],
  },
  {
    id: "add-on-holding", equipment: "Evaporator Coils", location: "Area 7 Add on Holding",
    roomKey: "add-on-holding", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "BM 5 - Larkin LEH1053DS6AYA" }, { model: "BM 6 - Larkin LEH1053DS6AYA" },
      { model: "CM 1 - Larkin LEH1053DS6AYA" }, { model: "CM 2 - Larkin LEH1053DS6AYA" },
    ],
  },
  {
    id: "fulfillment-holding-cooler", equipment: "Evaporator Coils", location: "Q12 Fulfillment Holding Cooler",
    roomKey: "fulfillment-holding", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "BM 10 - Guntner S-CXGHN 071.2H/26-A4L/24P.M" }, { model: "BM 11 - Guntner S-CXGHN 071.2H/26-A4L/24P.M" },
      { model: "BM 12 - Guntner S-CXGHN 071.2H/26-A4L/24P.M" }, { model: "CM 9 - Guntner S-CXGHN 071.2H/26-A4L/24P.M" },
      { model: "CM 10 - Guntner S-CXGHN 071.2H/26-A4L/24P.M" }, { model: "CM 11 - Guntner S-CXGHN 071.2H/26-A4L/24P.M" },
    ],
  },
  {
    id: "plating", equipment: "Evaporator Coils", location: "Q11 Plating",
    roomKey: "plating", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "BM 13 - Guntner S-CXMDN 066C/27-AL/32P" }, { model: "BM 14 - Guntner S-CXMDN 066C/27-AL/32P" },
      { model: "BM 15 - Guntner S-CXMDN 066C/27-AL/32P" }, { model: "BM 16 - Guntner S-CXMDN 066C/27-AL/32P" },
      { model: "DM 3 - Guntner S-CXMDN 066C/27-AL/32P" }, { model: "DM 4 - Guntner S-CXMDN 066C/27-AL/32P" },
      { model: "DM 5 - Guntner S-CXMDN 066C/27-AL/32P" }, { model: "DM 6 - Guntner S-CXMDN 066C/27-AL/32P" },
    ],
  },
  {
    id: "protein-prep", equipment: "Evaporator Coils", location: "Q11 Protein Prep",
    roomKey: "protein-prep", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "BM 17 - Guntner S-CXMDN 066C/26-AL/20P" }, { model: "BM 18 - Guntner S-CXMDN 066C/26-AL/20P" },
      { model: "DM 18 - Guntner S-CXMDN 066C/26-AL/20P" }, { model: "DM 19 - Guntner S-CXMDN 066C/26-AL/20P" },
    ],
  },
  {
    id: "sleeving", equipment: "Evaporator Coils", location: "Q11 Sleeving",
    roomKey: "sleeving", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "CM 12 - Guntner S-CXMDN 066C/36-AL/16P" }, { model: "CM 13 - Guntner S-CXMDN 066C/36-AL/16P" },
      { model: "CM 14 - Guntner S-CXMDN 066C/36-AL/16P" }, { model: "DM 12 - Guntner S-CXMDN 066C/36-AL/16P" },
      { model: "DM 13 - Guntner S-CXMDN 066C/36-AL/16P" }, { model: "DM 14 - Guntner S-CXMDN 066C/36-AL/16P" },
    ],
  },
  {
    id: "veggie-holding", equipment: "Evaporator Coils", location: "Area 16 Veggie Holding",
    roomKey: "veggie-holding", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "DM 7 - Larkin LHA61400SA" }, { model: "DM 8 - Larkin LHA61400SA" },
    ],
  },
  {
    id: "veggie-debox", equipment: "Evaporator Coils", location: "Area 11 Veggie Debox",
    roomKey: "veggie-debox", roomConfidence: "confirmed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [
      { model: "DM 15 - Larkin LEH0723DS6AYA" }, { model: "DM 16 - Larkin LEH0723DS6AYA" },
      { model: "DM 17 - Larkin LEH0723DS6AYA" },
    ],
  },
  {
    id: "wip-holding", equipment: "Evaporator Coils", location: "Area 17 WIP Holding",
    roomKey: "wip-holding", roomConfidence: "assumed", groupChecklist: EVAPORATOR_CHECKLIST,
    units: [ { model: "DM 20 - Larkin LEH1053DS6AYA" } ],
  },

  // -------------------------------------------------- CO2 REFRIGERATION RACKS
  {
    id: "rack-a", equipment: "Rack A", location: "Machine Room", roomKey: "refrigeration-room",
    roomConfidence: "confirmed", manufacturer: "Carnot (Air Treatment Corp) / E001192-101",
    groupChecklist: RACK_CHECKLIST,
  },
  {
    id: "rack-b", equipment: "Rack B", location: "Machine Room", roomKey: "refrigeration-room",
    roomConfidence: "confirmed", manufacturer: "Carnot (Air Treatment Corp) / E001192-102",
    groupChecklist: RACK_CHECKLIST,
  },
  {
    id: "rack-c", equipment: "Rack C", location: "Machine Room", roomKey: "refrigeration-room",
    roomConfidence: "confirmed", manufacturer: "Carnot (Air Treatment Corp) / E001192-103",
    groupChecklist: RACK_CHECKLIST,
  },
  {
    id: "rack-d", equipment: "Rack D", location: "Machine Room", roomKey: "refrigeration-room",
    roomConfidence: "confirmed", manufacturer: "Carnot (Air Treatment Corp) / E001192-104",
    groupChecklist: RACK_CHECKLIST,
  },
];

if (typeof module !== "undefined") module.exports = { EQUIPMENT_GROUPS };
