/** Nine underlying stats (3 per category) + derived Attack / Defense / Mobility */

export const STAT_KEYS = [
  "burst",
  "edge",
  "maxSpin",
  "armor",
  "stability",
  "mass",
  "launch",
  "grip",
  "bank",
];

export const STAT_CATEGORIES = {
  attack: ["burst", "edge", "maxSpin"],
  defense: ["armor", "stability", "mass"],
  mobility: ["launch", "grip", "bank"],
};

export const SLOT_KEYS = ["layer", "disk", "driver"];
export const CATEGORY_KEYS = ["attack", "defense", "mobility", "balanced"];
export const FOCUS_KEYS = ["col0", "col1", "col2", "balanced"];
export const GRADE_KEYS = ["low", "medium", "high"];

export const SLOT_META = {
  layer: { label: "Layer", noun: "Crown" },
  disk: { label: "Disk", noun: "Ring" },
  driver: { label: "Driver", noun: "Tip" },
};

export const CATEGORY_META = {
  attack: { label: "Attack", short: "ATK" },
  defense: { label: "Defense", short: "DEF" },
  mobility: { label: "Mobility", short: "MOB" },
  balanced: { label: "Balanced", short: "BAL" },
};

export const GRADE_META = {
  low: { label: "Low", short: "I", order: 0 },
  medium: { label: "Medium", short: "II", order: 1 },
  high: { label: "High", short: "III", order: 2 },
};

const COLUMNS = [
  ["burst", "armor", "launch"],
  ["edge", "stability", "grip"],
  ["maxSpin", "mass", "bank"],
];

/** Reusable 4x4 motif names & focus labels (16 archetypes reused across 3 slots x 3 grades) */
const ARCHETYPES = {
  attack: {
    col0: { motif: "Strike", focusLabel: "Burst" },
    col1: { motif: "Fang", focusLabel: "Edge" },
    col2: { motif: "Vortex", focusLabel: "Max Spin" },
    balanced: { motif: "Fury", focusLabel: "Attack Bal." },
  },
  defense: {
    col0: { motif: "Aegis", focusLabel: "Armor" },
    col1: { motif: "Anchor", focusLabel: "Stability" },
    col2: { motif: "Titan", focusLabel: "Mass" },
    balanced: { motif: "Bastion", focusLabel: "Defense Bal." },
  },
  mobility: {
    col0: { motif: "Surge", focusLabel: "Launch" },
    col1: { motif: "Claw", focusLabel: "Grip" },
    col2: { motif: "Orbit", focusLabel: "Bank" },
    balanced: { motif: "Zephyr", focusLabel: "Mobility Bal." },
  },
  balanced: {
    col0: { motif: "Vanguard", focusLabel: "Burst / Armor / Launch" },
    col1: { motif: "Pulse", focusLabel: "Edge / Stab / Grip" },
    col2: { motif: "Apex", focusLabel: "Spin / Mass / Bank" },
    balanced: { motif: "Equilibrium", focusLabel: "All Stats" },
  },
};

/**
 * Mixed grade scaling: strong stat spread per archetype and substantial
 * total Power gains from Low -> Medium -> High.
 */
const GRADE_PROFILES = {
  low: {
    singlePrimary: 12,
    singleSibling: 3,
    lineBoost: 6,
    penalty: -4,
    allBoost: 1,
  },
  medium: {
    singlePrimary: 19,
    singleSibling: 10,
    lineBoost: 14,
    penalty: -2,
    allBoost: 4,
  },
  high: {
    singlePrimary: 25,
    singleSibling: 17,
    lineBoost: 21,
    penalty: 0,
    allBoost: 7,
  },
};

export const BASE_STATS = {
  burst: 30,
  edge: 30,
  maxSpin: 90,
  armor: 30,
  stability: 30,
  mass: 30,
  launch: 30,
  grip: 30,
  bank: 30,
};

function scaleMaxSpin(delta) {
  if (delta === 0) return 0;
  const scaled = Math.round(delta * 0.65);
  return delta > 0 ? Math.max(1, scaled) : Math.min(-1, scaled);
}

function buildPartStats(category, focus, grade) {
  const prof = GRADE_PROFILES[grade];
  const focusIdx = FOCUS_KEYS.indexOf(focus);
  /** @type {Record<string, number>} */
  const stats = {};

  if (category === "balanced" && focus === "balanced") {
    for (const key of STAT_KEYS) {
      stats[key] = prof.allBoost;
    }
  } else if (category === "balanced") {
    const colStats = new Set(COLUMNS[focusIdx]);
    for (const key of STAT_KEYS) {
      stats[key] = colStats.has(key) ? prof.lineBoost : prof.penalty;
    }
  } else if (focus === "balanced") {
    const rowStats = new Set(STAT_CATEGORIES[category]);
    for (const key of STAT_KEYS) {
      stats[key] = rowStats.has(key) ? prof.lineBoost : prof.penalty;
    }
  } else {
    const rowStats = STAT_CATEGORIES[category];
    const primaryStat = rowStats[focusIdx];
    const rowSet = new Set(rowStats);
    for (const key of STAT_KEYS) {
      if (key === primaryStat) {
        stats[key] = prof.singlePrimary;
      } else if (rowSet.has(key)) {
        stats[key] = prof.singleSibling;
      } else {
        stats[key] = prof.penalty;
      }
    }
  }

  stats.maxSpin = scaleMaxSpin(stats.maxSpin);
  return stats;
}

function generateSlotParts(slot) {
  const slotInfo = SLOT_META[slot];
  const parts = [];

  for (const category of CATEGORY_KEYS) {
    for (const grade of GRADE_KEYS) {
      const gradeInfo = GRADE_META[grade];
      for (let colIdx = 0; colIdx < FOCUS_KEYS.length; colIdx++) {
        const focus = FOCUS_KEYS[colIdx];
        const arch = ARCHETYPES[category][focus];
        const stats = buildPartStats(category, focus, grade);

        parts.push({
          id: `${slot}-${category}-${focus}-${grade}`,
          name: `${arch.motif} ${slotInfo.noun} ${gradeInfo.short}`,
          slot,
          category,
          focus,
          focusIndex: colIdx,
          focusLabel: arch.focusLabel,
          grade,
          gradeOrder: gradeInfo.order,
          gradeLabel: gradeInfo.label,
          gradeShort: gradeInfo.short,
          ...stats,
        });
      }
    }
  }

  return parts;
}

export const LAYERS = generateSlotParts("layer");
export const DISKS = generateSlotParts("disk");
export const DRIVERS = generateSlotParts("driver");

export const CATALOG = {
  layer: LAYERS,
  disk: DISKS,
  driver: DRIVERS,
};

export const ALL_PARTS = [...LAYERS, ...DISKS, ...DRIVERS];

const PART_BY_ID = new Map(ALL_PARTS.map((p) => [p.id, p]));

export function getPartById(id) {
  return PART_BY_ID.get(id) ?? null;
}

const STAT_MIN = 10;
const STAT_MAX = 100;
const MAX_SPIN_MIN = 75;
const MAX_SPIN_MAX = 130;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * @typedef {object} TopStats
 * @property {number} burst
 * @property {number} edge
 * @property {number} maxSpin
 * @property {number} armor
 * @property {number} stability
 * @property {number} mass
 * @property {number} launch
 * @property {number} grip
 * @property {number} bank
 * @property {number} attack   derived
 * @property {number} defense  derived
 * @property {number} mobility derived
 */

export function summarizeStats(s) {
  const spinNorm = ((s.maxSpin - MAX_SPIN_MIN) / (MAX_SPIN_MAX - MAX_SPIN_MIN)) * 100;
  const attack = clamp(
    Math.round(0.45 * s.burst + 0.4 * s.edge + 0.15 * spinNorm),
    STAT_MIN,
    STAT_MAX
  );
  const defense = clamp(
    Math.round(0.35 * s.armor + 0.25 * s.stability + 0.25 * s.mass + 0.15 * spinNorm),
    STAT_MIN,
    STAT_MAX
  );
  const mobility = clamp(
    Math.round(0.45 * s.launch + 0.3 * s.grip + 0.25 * s.bank),
    STAT_MIN,
    STAT_MAX
  );
  return { attack, defense, mobility };
}

/**
 * @param {{ layer: string, disk: string, driver: string }} loadout
 * @returns {TopStats}
 */
export function deriveStats(loadout) {
  const layer = getPartById(loadout.layer) ?? LAYERS[0];
  const disk = getPartById(loadout.disk) ?? DISKS[0];
  const driver = getPartById(loadout.driver) ?? DRIVERS[0];
  const parts = [layer, disk, driver];

  /** @type {Record<string, number>} */
  const raw = { ...BASE_STATS };
  for (const key of STAT_KEYS) {
    for (const part of parts) {
      raw[key] += part[key] ?? 0;
    }
  }

  const baseNine = {
    burst: clamp(Math.round(raw.burst), STAT_MIN, STAT_MAX),
    edge: clamp(Math.round(raw.edge), STAT_MIN, STAT_MAX),
    maxSpin: clamp(Math.round(raw.maxSpin), MAX_SPIN_MIN, MAX_SPIN_MAX),
    armor: clamp(Math.round(raw.armor), STAT_MIN, STAT_MAX),
    stability: clamp(Math.round(raw.stability), STAT_MIN, STAT_MAX),
    mass: clamp(Math.round(raw.mass), STAT_MIN, STAT_MAX),
    launch: clamp(Math.round(raw.launch), STAT_MIN, STAT_MAX),
    grip: clamp(Math.round(raw.grip), STAT_MIN, STAT_MAX),
    bank: clamp(Math.round(raw.bank), STAT_MIN, STAT_MAX),
  };

  return {
    ...baseNine,
    ...summarizeStats(baseNine),
  };
}

export const STARTER_LOADOUT = {
  layer: "layer-balanced-balanced-low",
  disk: "disk-balanced-balanced-low",
  driver: "driver-balanced-balanced-low",
};

export const STARTER_PART_IDS = Object.values(STARTER_LOADOUT);

export function starterLoadout() {
  return { ...STARTER_LOADOUT };
}

export function defaultLoadouts() {
  return [
    { ...STARTER_LOADOUT },
    { ...STARTER_LOADOUT },
  ];
}
