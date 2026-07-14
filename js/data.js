/*
 * Equipment data model — transcribed verbatim from the "Refrigeration Daily
 * Rounds" checklist (Google Sheet), forward-filling merged cells.
 *
 * Source is a blank/unfilled template: every "Actual Value" cell was empty
 * except the Oil Level dropdown's default state and one real deficiency note
 * (Rack B Compressor 5). No pass/fail status was recorded as of the source
 * snapshot, so `actual` fields all start null — the dashboard is a checklist
 * + facility map, not a claim about today's readings.
 *
 * roomConfidence: "confirmed" = location text matches a labeled room on the
 * floor plan directly. "assumed" = no exact label existed on the floor plan;
 * placed at the closest logical room. Edit ROOM_KEY below to correct any of
 * these once confirmed on-site — nothing else needs to change.
 */

const EQUIPMENT_GROUPS = [
  // ---------------------------------------------------------------- RACK A
  {
    id: "rack-a",
    equipment: "Rack A",
    location: "South Compressor Room (Behind Large Dish)",
    roomKey: "compressor-room-south",
    roomConfidence: "assumed",
    manufacturer: "Rack A: Hussman - CS0208SMM / 1040618201347410",
    groupChecklist: [
      { item: "Suction and Discharge Pressure", expected: "At or near setpoint" },
      { item: "Receiver Level", expected: "40-60%, Should not exceed 80%" },
      { item: "Alarms", expected: "No Alarms" },
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots." }
    ],
    subsectionItem: { item: "Oil Levels at Compressors", expected: "50%" },
    subsections: [
      { designation: "1", model: "Rack A Compressor - Hussmann IR6B54D6PB / 2584164375" },
      { designation: "2", model: "Rack A Compressor - Hussmann IR4B2702PB / 2584570452" },
      { designation: "3", model: "Rack A Compressor - Hussmann IR4C2067SB / 258470008" },
      { designation: "4", model: "Rack A Compressor - Hussmann IR4C2067SB / 2584570458" },
      { designation: "5", model: "Rack A Compressor - Hussmann IR6B4709PB / 2584570289" },
      { designation: "6", model: "Rack A Compressor - Hussmann IR6B4709PB / 2584570291" },
      { designation: "7", model: "Rack A Compressor - Hussmann IR6B4709PB / 2584570290" },
      { designation: "8", model: "Rack A Compressor - Hussmann IR64B4709PB / 2548570292" }
    ]
  },
  // ---------------------------------------------------------------- RACK B
  {
    id: "rack-b",
    equipment: "Rack B",
    location: "North Compressor Room (Next to MRE Shop)",
    roomKey: "compressor-room-north",
    roomConfidence: "assumed",
    manufacturer: "Rack B: Zero Zone - R-10703MA-151-448A / 2056939NA-0921",
    groupChecklist: [
      { item: "Suction and Discharge Pressure", expected: "At or near setpoint" },
      { item: "Receiver Level", expected: "40-60%, Should not exceed 80%" },
      { item: "Alarms", expected: "No Alarms" },
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots." }
    ],
    subsectionItem: { item: "Oil Levels at Compressors", expected: "50%" },
    subsections: [
      { designation: "1", model: "Rack B Compressor - 4FE28" },
      { designation: "2", model: "Rack B Compressor - 4FE28" },
      { designation: "3", model: "Rack B Compressor - 4FE28" },
      { designation: "4", model: "Rack B Compressor - 4FE28" },
      { designation: "5", model: "Rack B Compressor - 4FE-28-2NU / 2500695626" },
      { designation: "6", model: "Rack B Compressor - 4FE28" },
      { designation: "7", model: "Rack B Compressor - 4FE28" },
      { designation: "8", model: "Rack B Compressor - 4FE28" }
    ]
  },
  // ------------------------------------------------------- RACK CONDENSERS
  {
    id: "rack-condenser-a",
    equipment: "Rack Condenser A",
    location: "Rooftop South",
    roomKey: "roof",
    roomConfidence: "confirmed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust, leaks" },
      { item: "Cleanliness", expected: "Clean coils, with good airflow" },
      { item: "Fans", expected: "All functioning properly" }
    ]
  },
  {
    id: "rack-condenser-b",
    equipment: "Rack Condenser B",
    location: "Rooftop North",
    roomKey: "roof",
    roomConfidence: "confirmed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust, leaks" },
      { item: "Cleanliness", expected: "Clean coils, with good airflow" },
      { item: "Fans", expected: "All functioning properly" }
    ]
  },
  // -------------------------------------------------------- EVAPORATORS (13 zones)
  {
    id: "evap-veg-cooler",
    equipment: "Evaporators",
    designation: "EV 24 - 29",
    location: "Vegetable Cooler",
    roomKey: "veggie-holding",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ],
    units: [
      { model: "HEM0370C56MAB0000 / T22A07475" },
      { model: "HEM0370C56MAB0000 / T22A07479" },
      { model: "HEM0370C56MAB0000 / T22A07479" },
      { model: "HEM0370C56MAB0000 / T22A07467" },
      { model: "HEM0370C56MAB0000 / T22A07457" },
      { model: "HEM0370C56MAB0000 / T22A07468" }
    ]
  },
  {
    id: "evap-veggie-staging",
    equipment: "Evaporators",
    designation: "EV 1 & 2 (split system)",
    location: "Veggie Stagng",
    roomKey: "veggie-staging",
    roomConfidence: "confirmed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ],
    units: [
      { model: "Heatcraft - BEM0850M56EPAD4541 / T22H12673" },
      { model: "Heatcraft - BEM0850M56EPAD4541 / T22H12674" }
    ]
  },
  {
    id: "evap-veggie-debox",
    equipment: "Evaporators",
    designation: "B07, B08, B09",
    location: "Veggie Debox",
    roomKey: "veggie-debox",
    roomConfidence: "confirmed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ],
    units: [
      { model: "KMP495MA-S4D / T2663.212301003" },
      { model: "KMP495MA-S4D / T2663.212301004" },
      { model: "SMA24E-079RCMM / MY22A001280" }
    ]
  },
  {
    id: "evap-veggie-corridor",
    equipment: "Evaporators",
    designation: "AM3",
    location: "Veggie Corridor",
    roomKey: "wip-room",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ],
    units: [
      { model: "MK36A-354-EA / MY13H154559" },
      { model: "MK36A-354-EA / MY13H154560" }
    ]
  },
  {
    id: "evap-receiving",
    equipment: "Evaporators",
    designation: "AH7 North & South, AH1 west, Bohn Split systems (x3)",
    location: "Receiving",
    roomKey: "receiving",
    roomConfidence: "confirmed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-protein-holding",
    equipment: "Evaporators",
    designation: "AM 8-1, 8-3",
    location: "Protein Holding",
    roomKey: "protein-storage",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-protein-debox",
    equipment: "Evaporators",
    designation: "AM 9-1, 9-3",
    location: "Protein Debox",
    roomKey: "protein-debox",
    roomConfidence: "confirmed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-protein-prep",
    equipment: "Evaporators",
    designation: "AM 7-1, AM 7-2, AH1 East",
    location: "Protein Prep",
    roomKey: "burger-room",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-blast-holding",
    equipment: "Evaporators",
    designation: "AM1 North and South, AM2, AH2-1, AH2-2, AH4NW, AH4NE, AH4N, AH4S, AH4SE",
    location: "Blast Holding",
    roomKey: "holding-cooler",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-production-2",
    equipment: "Evaporators",
    designation: "EV10-15 & AH6-1, AH6-2, AH6-3, AH6-5",
    location: "Production 2",
    roomKey: "production-plating",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-production-3",
    equipment: "Evaporators",
    designation: "EV16-19 & AM5-1, AM5-2, AM5-3, AM5-5",
    location: "Production 3",
    roomKey: "production-sleeving",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-shipping-staging",
    equipment: "Evaporators",
    designation: "North, Middle, South",
    location: "Shippng Staging",
    roomKey: "shipping",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  {
    id: "evap-shipping-dock",
    equipment: "Evaporators",
    designation: "EV1 & 2",
    location: "Shipping (East Dock Room)",
    roomKey: "shipping",
    roomConfidence: "assumed",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust leaks or ice buildup, cleanliness, check for hot spots, confirm fans operational" }
    ]
  },
  // --------------------------------------------------------------- RTU
  {
    id: "rtu",
    equipment: "RTU",
    designation: "RTU 1-20",
    location: "Roof",
    roomKey: "roof",
    roomConfidence: "confirmed",
    manufacturer: "Carrier",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise" },
      { item: "Coil", expected: "Clean coils with good airflow" },
      { item: "Fans", expected: "Operational" },
      { item: "Drain Lines", expected: "Clean and flowing clear" }
    ]
  },
  // --------------------------------------------------------------- DOAS
  {
    id: "doas",
    equipment: "DOAS",
    designation: "1 & 2",
    location: "Roof",
    roomKey: "roof",
    roomConfidence: "confirmed",
    manufacturer: "CaptiveAire",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust, cleanliness" },
      { item: "Fans", expected: "Operating normally" },
      { item: "Coil", expected: "Clean, can see light through coil" },
      { item: "Alarms", expected: "None" },
      { item: "Damper Operation", expected: "Operating normally" }
    ],
    units: [
      { model: "1 - CASRTU3-I-200-15-15T-DOAS / 4513551" },
      { model: "2 - CASRTU3-I-250-15-15T-DOAS / 4864097" }
    ]
  },
  // --------------------------------------------------------------- MAU
  {
    id: "mau",
    equipment: "MAU",
    designation: "MAU1, MAU 2, MAU21-29",
    location: "Roof",
    roomKey: "roof",
    roomConfidence: "confirmed",
    manufacturer: "CaptiveAire",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust, cleanliness" },
      { item: "Fans", expected: "Operating normally" },
      { item: "Coil", expected: "Clean, can see light through coil" },
      { item: "Alarms", expected: "None" },
      { item: "Damper Operation", expected: "Operating normally" }
    ],
    units: [
      { model: "1 - A5-D_2000-36D / 4513551" },
      { model: "2 - A5-D_2000-36D / 4513551" },
      { model: "3 - A2-D_500-20D / 4513551" },
      { model: "21 - A5-D_2000-36D / 4864097" },
      { model: "22 - A5-D_2000-36D / 4864097" },
      { model: "23 - A5-D_2000-36D / 4864097" },
      { model: "24 - A5-D_2000-36D / 4864097" },
      { model: "25 - A5-D_2000-36D / 4864097" },
      { model: "26 - A3-D_500-24D / 4864097" },
      { model: "27 - A2-D_500-20D / 5292658" },
      { model: "28 - A2-D_2000-20D / 5331729" },
      { model: "29 - A2-D_500-20D / 5362404" }
    ]
  },
  // --------------------------------------------------- BLAST CHILLER CABINETS
  {
    id: "blast-chillers-cabinets",
    equipment: "Blast Chillers Cabinets",
    designation: "1-10",
    location: "Blast",
    roomKey: "blast-chill",
    roomConfidence: "confirmed",
    manufacturer: "Irinox",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust, cleanliness" },
      { item: "Fans", expected: "Operating normally" },
      { item: "Coil", expected: "Clean, can see light through coil" },
      { item: "Alarms", expected: "None" },
      { item: "Damper Operation", expected: "Operating normally" }
    ],
    units: [
      { model: "1 - MF750.2 4TL / 210500244M" },
      { model: "2 - MF750.2 4TL / 210500416M" },
      { model: "3 - MF750.2 4TL / 201000336M" },
      { model: "4 - MF750.2 4TL / 201000295M" },
      { model: "5 - MF750.2 4TL / 201000269M" },
      { model: "6 - MF750.2 4TL / 211000292M" },
      { model: "7 - MF750.2 4TL / 211000294M" },
      { model: "8 - MF750.2 4TL / 211000293M" },
      { model: "9 - MF750.2 4TL / 211000295M" },
      { model: "10 - MF750.2 4TL / 211000291M" }
    ]
  },
  // -------------------------------------------- BLAST CHILLER CONDENSING UNITS
  {
    id: "blast-chiller-condensing",
    equipment: "Blast Chiller Condensing Units",
    designation: "1-10",
    location: "Roof",
    roomKey: "roof",
    roomConfidence: "confirmed",
    manufacturer: "Irinox",
    groupChecklist: [
      { item: "Visual Inspection", expected: "No abnormal noise, rust, cleanliness" },
      { item: "Fans", expected: "Operating normally" },
      { item: "Coil", expected: "Clean, can see light through coil" },
      { item: "Alarms", expected: "None" },
      { item: "Damper Operation", expected: "Operating normally" }
    ],
    units: [
      { model: "1 - UC750 - AST / 210500244U" },
      { model: "2 - UC750 - AST / 210500416U" },
      { model: "3 - UC750 - AST / 201000336U" },
      { model: "4 - UC750 - AST / 201000295U" },
      { model: "5 - UC750 - AST / 201000296U" },
      { model: "6 - UC750 - AST / 211000292U" },
      { model: "7 - UC750 - AST / 211000294U" },
      { model: "8 - UC750 - AST / 211000293U" },
      { model: "9 - UC750 - AST / 211000295U" },
      { model: "10 - UC750 - AST / 211000291U" }
    ]
  }
];

if (typeof module !== "undefined") module.exports = { EQUIPMENT_GROUPS };
