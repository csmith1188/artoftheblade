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

export const BASE_STATS = {
  burst: 40,
  edge: 40,
  maxSpin: 100,
  armor: 40,
  stability: 40,
  mass: 40,
  launch: 40,
  grip: 40,
  bank: 40,
};

/** Layer biases offense: burst / edge / maxSpin tradeoffs */
export const LAYERS = [
  {
    id: "strike",
    name: "Strike Edge",
    burst: 28,
    edge: 16,
    maxSpin: -10,
    armor: -10,
    stability: -8,
    mass: -4,
    launch: 8,
    grip: -6,
    bank: -6,
  },
  {
    id: "vortex",
    name: "Vortex Fang",
    burst: 14,
    edge: 18,
    maxSpin: -2,
    armor: -2,
    stability: 0,
    mass: 2,
    launch: 4,
    grip: 0,
    bank: -2,
  },
  {
    id: "shield",
    name: "Shield Crown",
    burst: -8,
    edge: 0,
    maxSpin: 10,
    armor: 22,
    stability: 14,
    mass: 8,
    launch: -8,
    grip: 6,
    bank: 10,
  },
];

/** Disk biases mass / stamina / tempo */
export const DISKS = [
  {
    id: "heavy",
    name: "Heavy Ring",
    burst: -8,
    edge: -6,
    maxSpin: 10,
    armor: 8,
    stability: 6,
    mass: 26,
    launch: -12,
    grip: 4,
    bank: 6,
  },
  {
    id: "balance",
    name: "Balance Disk",
    burst: 4,
    edge: 4,
    maxSpin: 4,
    armor: 4,
    stability: 4,
    mass: 12,
    launch: 2,
    grip: 2,
    bank: 2,
  },
  {
    id: "light",
    name: "Light Wing",
    burst: 14,
    edge: 10,
    maxSpin: -6,
    armor: -6,
    stability: -4,
    mass: -8,
    launch: 18,
    grip: -8,
    bank: -6,
  },
];

/** Driver biases stadium feel: launch / grip / bank */
export const DRIVERS = [
  {
    id: "grip",
    name: "Grip Tip",
    burst: -8,
    edge: 0,
    maxSpin: 8,
    armor: 8,
    stability: 18,
    mass: 4,
    launch: -10,
    grip: 24,
    bank: 14,
  },
  {
    id: "accel",
    name: "Accel Point",
    burst: 16,
    edge: 8,
    maxSpin: -6,
    armor: -6,
    stability: -10,
    mass: -4,
    launch: 24,
    grip: -12,
    bank: -10,
  },
  {
    id: "orbit",
    name: "Orbit Ball",
    burst: 2,
    edge: 4,
    maxSpin: 6,
    armor: 4,
    stability: 8,
    mass: 6,
    launch: 4,
    grip: 8,
    bank: 16,
  },
];

export const CATALOG = {
  layer: LAYERS,
  disk: DISKS,
  driver: DRIVERS,
};

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
  const layer = LAYERS.find((p) => p.id === loadout.layer) ?? LAYERS[0];
  const disk = DISKS.find((p) => p.id === loadout.disk) ?? DISKS[0];
  const driver = DRIVERS.find((p) => p.id === loadout.driver) ?? DRIVERS[0];
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

export function defaultLoadouts() {
  return [
    { layer: "strike", disk: "light", driver: "accel" },
    { layer: "shield", disk: "heavy", driver: "grip" },
  ];
}

export function fillPartSelects(selectEls, loadouts) {
  for (const select of selectEls) {
    const slot = select.dataset.slot;
    const player = Number(select.dataset.player);
    const options = CATALOG[slot];
    select.innerHTML = "";
    for (const part of options) {
      const opt = document.createElement("option");
      opt.value = part.id;
      opt.textContent = part.name;
      select.appendChild(opt);
    }
    select.value = loadouts[player][slot];
  }
}
