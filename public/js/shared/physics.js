/** Polar battlezone physics — 9-stat tops with early smash / late grind curves */

import { bowlAcceleration, sampleBowl } from "./bowl.js";

export const ARENA_RADIUS = 280;
export const TOP_RADIUS = 28;
/** Below this radius, integrate in Cartesian so vt/r can't slingshot. */
const POCKET_RADIUS = TOP_RADIUS * 2.75;
const R_EPS = 1e-4;
const MOVE_FRICTION_BASE = 0.24;
const SPIN_FRICTION_BASE = 0.078;
const RESTITUTION = 0.88;
const SEPARATION_SLACK = 2.0;
const MIN_SEPARATION_SPEED = 110;
const HIT_KICK = 125;
const HIT_SCATTER = 80;
/** Base + burst-scaled outward radial shock on clashes (gives glancing hits rim pressure). */
const BASE_OUTWARD_KICK = 146;
const BURST_OUTWARD_KICK = 22;
/** Extra outward shock when two high-burst tops clash head-on. */
const BURST_CLASH_BONUS = 62;
/** Centrifugal factor in outer polar ring (high-vt Attack rides higher; low-vt Defense sinks). */
const CENTRIFUGAL_SCALE = 0.2;
/** Hard cap on outbound radial speed after a hit (arena units / sec). */
const MAX_OUTBOUND_VR = 440;

/**
 * @typedef {object} Top
 * @property {number} r
 * @property {number} theta
 * @property {number} vr
 * @property {number} vt
 * @property {number} spin
 * @property {number} maxSpin
 * @property {number} burst
 * @property {number} edge
 * @property {number} armor
 * @property {number} stability
 * @property {number} mass
 * @property {number} launch
 * @property {number} grip
 * @property {number} bank
 * @property {number} attack
 * @property {number} defense
 * @property {number} mobility
 * @property {number} angle
 * @property {boolean} alive
 */

/**
 * @param {import('./parts.js').TopStats} stats
 * @param {{ r: number, theta: number, vr: number, vt: number, spin: number }} pose
 * @returns {Top}
 */
export function createTop(stats, pose) {
  return {
    r: pose.r,
    theta: pose.theta,
    vr: pose.vr,
    vt: pose.vt,
    spin: pose.spin,
    maxSpin: stats.maxSpin,
    burst: stats.burst,
    edge: stats.edge,
    armor: stats.armor,
    stability: stats.stability,
    mass: stats.mass,
    launch: stats.launch,
    grip: stats.grip,
    bank: stats.bank,
    attack: stats.attack,
    defense: stats.defense,
    mobility: stats.mobility,
    angle: 0,
    alive: true,
  };
}

export function polarToCartesian(r, theta, cx, cy) {
  return {
    x: cx + r * Math.cos(theta),
    y: cy + r * Math.sin(theta),
  };
}

function massInertia(mass) {
  return 0.72 + mass / 135;
}

function spinRatio(top) {
  return top.spin / Math.max(1, top.maxSpin);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Early (high spin): knockback present but not nuke-tier.
 * Late: knockback weak, grind favored.
 * @param {number} ratio
 */
function knockbackPhase(ratio) {
  // Soften the early peak (was ratio^2 → ~1.0 at full spin)
  return 0.35 + 0.55 * ratio * ratio;
}

/**
 * Edge chip slightly stronger as the fight slows.
 * @param {number} ratio
 */
function edgePhase(ratio) {
  return lerp(1.15, 0.75, ratio);
}

function toCartVel(top) {
  const c = Math.cos(top.theta);
  const s = Math.sin(top.theta);
  return {
    vx: top.vr * c - top.vt * s,
    vy: top.vr * s + top.vt * c,
  };
}

function fromCartVel(top, vx, vy) {
  const c = Math.cos(top.theta);
  const s = Math.sin(top.theta);
  top.vr = vx * c + vy * s;
  top.vt = -vx * s + vy * c;
}

/**
 * Climbing the bowl should cost speed: compare floor height before/after.
 * Flat pocket (Δh≈0) → no fake energy; steep rim → strong bleed on outbound.
 * @param {Top} top
 * @param {number} r0
 * @param {number} r1
 */
function applyBowlPotential(top, r0, r1, idx = -1) {
  // Removed redundant double-braking: bowlAcceleration(r) already applies the
  // exact bowl floor slope (-g * dt). Keep hook for clean instrumentation.
  void top;
  void r0;
  void r1;
  void idx;
}

/**
 * @param {Top} top
 * @param {number} dt
 */
export function integrateTop(top, dt, idx = -1) {
  if (!top.alive) return;

  const ratio = spinRatio(top);
  const bankN = top.bank / 100;
  const gripN = top.grip / 100;
  const massN = top.mass / 100;
  const stabN = top.stability / 100;
  const bankScale = 0.82 + Math.pow(bankN, 1.2) * 0.56;

  // High grip preserves tangential drive while braking outward radial knockback
  const fr =
    MOVE_FRICTION_BASE *
    (1.02 - gripN * 0.42) *
    (1 - massN * 0.32);
  const frOut = fr * (1 + Math.pow(gripN, 1.3) * 1.35);

  // Low spin wobble → outward; stability resists ring-out death spiral
  let wobble = 0;
  if (ratio < 0.4) {
    wobble = (0.4 - ratio) * 85 * (1 - stabN * 0.78);
  }

  // Mass + stability (Defense) and grip (Mobility) conserve passive spin
  const spinLoss =
    SPIN_FRICTION_BASE *
    (1 - Math.pow(massN, 1.3) * 0.28 - Math.pow(stabN, 1.3) * 0.16) *
    (1 - Math.pow(gripN, 1.3) * 0.34) *
    (0.65 + (1 - ratio) * 0.55);
  top.spin = Math.max(0, top.spin - spinLoss * 12 * dt);

  const rBefore = top.r;
  let dTheta = 0;

  if (top.r < POCKET_RADIUS) {
    // --- Pocket: Cartesian pass-through (no vt/r singularity, no artificial flip) ---
    // Lateral speed is real XY velocity; bowl slope pulls toward center.
    // Flat center (slope≈0) ⇒ coast; rising walls climb against potential.
    const c0 = Math.cos(top.theta);
    const s0 = Math.sin(top.theta);
    let x = top.r * c0;
    let y = top.r * s0;
    let { vx, vy } = toCartVel(top);

    const rNow = Math.max(Math.hypot(x, y), R_EPS);
    const g = bowlAcceleration(rNow, ARENA_RADIUS, bankScale);
    // Central accel from bowl + wobble as outward radial boost
    const ar = -g + wobble;
    vx += (ar * x) / rNow * dt;
    vy += (ar * y) / rNow * dt;

    const damp = Math.max(0, 1 - fr * dt);
    vx *= damp;
    vy *= damp;

    x += vx * dt;
    y += vy * dt;

    const r1 = Math.hypot(x, y);
    if (r1 < R_EPS) {
      top.r = R_EPS;
      // Keep velocity; heading from velocity vector
      const spd = Math.hypot(vx, vy);
      top.theta = spd > R_EPS ? Math.atan2(vy, vx) : top.theta;
      fromCartVel(top, vx, vy);
    } else {
      top.r = r1;
      top.theta = Math.atan2(y, x);
      fromCartVel(top, vx, vy);
    }

    applyBowlPotential(top, rBefore, top.r, idx);
    dTheta = 0;
  } else {
    // --- Outer ring: polar orbit model (vt = lateral around the bowl) ---
    const g = bowlAcceleration(top.r, ARENA_RADIUS, bankScale);
    // Centrifugal lift from orbital speed: fast Attack tops ride higher; slow Defense sinks
    const centrifugal = (CENTRIFUGAL_SCALE * top.vt * top.vt) / Math.max(top.r, POCKET_RADIUS);
    top.vr += (-g + centrifugal + wobble) * dt;
    top.vr *= Math.max(0, 1 - (top.vr > 0 ? frOut : fr) * dt);
    top.vt *= Math.max(0, 1 - fr * dt);

    top.r += top.vr * dt;
    if (top.r < POCKET_RADIUS) {
      // Entering pocket mid-step — clamp into pocket band; next frame uses Cartesian
      top.r = Math.max(top.r, R_EPS);
    }

    applyBowlPotential(top, rBefore, top.r, idx);

    const safeR = Math.max(top.r, POCKET_RADIUS * 0.85);
    dTheta = (top.vt / safeR) * dt;
    const maxDTheta = 0.85 * dt * 60;
    top.theta += Math.max(-maxDTheta, Math.min(maxDTheta, dTheta));
  }

  const spinDir = top.vt >= 0 ? 1 : -1;
  top.angle += spinDir * ratio * 18 * dt + dTheta * 0.35;

  if (top.spin <= 0) {
    top.spin = 0;
    top.alive = false;
  }
  if (top.r > ARENA_RADIUS) {
    top.alive = false;
  }
}

/**
 * @param {Top} a
 * @param {Top} b
 */
export function resolveCollision(a, b) {
  if (!a.alive || !b.alive) return;

  const ax = a.r * Math.cos(a.theta);
  const ay = a.r * Math.sin(a.theta);
  const bx = b.r * Math.cos(b.theta);
  const by = b.r * Math.sin(b.theta);

  let dx = bx - ax;
  let dy = by - ay;
  let dist = Math.hypot(dx, dy);
  const minDist = TOP_RADIUS * 2;

  if (dist < 1e-6) {
    const nudge = 0.08;
    a.theta -= nudge;
    b.theta += nudge;
    dist = TOP_RADIUS * 0.5;
    dx = Math.cos(a.theta + Math.PI / 2);
    dy = Math.sin(a.theta + Math.PI / 2);
  }

  if (dist >= minDist) return 0;

  dx /= dist;
  dy /= dist;
  const tx = -dy;
  const ty = dx;

  const ma = massInertia(a.mass);
  const mb = massInertia(b.mass);
  const invSum = 1 / (ma + mb);

  const overlap = minDist - dist + SEPARATION_SLACK;
  const pushA = overlap * mb * invSum;
  const pushB = overlap * ma * invSum;

  const ax2 = ax - dx * pushA;
  const ay2 = ay - dy * pushA;
  const bx2 = bx + dx * pushB;
  const by2 = by + dy * pushB;

  a.r = Math.hypot(ax2, ay2);
  a.theta = Math.atan2(ay2, ax2);
  b.r = Math.hypot(bx2, by2);
  b.theta = Math.atan2(by2, bx2);

  const va = toCartVel(a);
  const vb = toCartVel(b);

  const closing = (va.vx - vb.vx) * dx + (va.vy - vb.vy) * dy;
  const ratioA = spinRatio(a);
  const ratioB = spinRatio(b);
  const phase = (knockbackPhase(ratioA) + knockbackPhase(ratioB)) * 0.5;

  const approach = Math.max(closing, 0);
  let j = ((1 + RESTITUTION) * approach) / (1 / ma + 1 / mb);

  // Min separation scales down in late game so light grind contacts can happen
  const minSep = lerp(45, MIN_SEPARATION_SPEED, phase);
  const sepAfter = -closing + j * (1 / ma + 1 / mb);
  if (sepAfter < minSep) {
    j += (minSep - sepAfter) / (1 / ma + 1 / mb);
  }

  // Convex stat curves so specialized builds (90+) outshine jack-of-all-trades (57) in their lane
  const spdA = Math.hypot(va.vx, va.vy);
  const spdB = Math.hypot(vb.vx, vb.vy);
  const velEdgeA = Math.max(0, Math.min(1, (spdA - spdB + 20) / 210));
  const velEdgeB = Math.max(0, Math.min(1, (spdB - spdA + 20) / 210));

  const burstA = Math.pow(a.burst / 100, 1.45);
  const burstB = Math.pow(b.burst / 100, 1.45);
  const edgeA = Math.pow(a.edge / 100, 1.45);
  const edgeB = Math.pow(b.edge / 100, 1.45);
  const armorA = Math.pow(a.armor / 100, 1.35);
  const armorB = Math.pow(b.armor / 100, 1.35);
  const stabA = Math.pow(a.stability / 100, 1.35);
  const stabB = Math.pow(b.stability / 100, 1.35);
  const massA = Math.pow(a.mass / 100, 1.3);
  const massB = Math.pow(b.mass / 100, 1.3);
  const launchA = Math.pow(a.launch / 100, 1.4);
  const launchB = Math.pow(b.launch / 100, 1.4);
  const gripA = Math.pow(a.grip / 100, 1.4);
  const gripB = Math.pow(b.grip / 100, 1.4);
  const bankA = Math.pow(a.bank / 100, 1.4);
  const bankB = Math.pow(b.bank / 100, 1.4);

  const mobDriveA = launchA * (0.4 + 0.65 * velEdgeA) + bankA * 0.35;
  const mobDriveB = launchB * (0.4 + 0.65 * velEdgeB) + bankB * 0.35;

  const approachFactor = 0.65 + Math.min(1.1, approach / 260);
  const kickOntoB =
    HIT_KICK * (burstA * 1.15 + mobDriveA * 0.65) * phase * approachFactor;
  const kickOntoA =
    HIT_KICK * (burstB * 1.15 + mobDriveB * 0.65) * phase * approachFactor;

  // High-burst or faster high-mobility attacker absorbs less rebound from its own strike
  const recoilA = Math.max(0.42, 1 - burstA * 0.45 * phase - mobDriveA * 0.26);
  const recoilB = Math.max(0.42, 1 - burstB * 0.45 * phase - mobDriveB * 0.26);

  // Armor, mass, and floor grip soften knockback taken
  const softA = Math.max(0.38, 1 - armorA * 0.32 - massA * 0.14 - gripA * 0.2);
  const softB = Math.max(0.38, 1 - armorB * 0.32 - massB * 0.14 - gripB * 0.2);

  const pushVelA = ((j / ma) * recoilA + kickOntoA / Math.sqrt(ma)) * softA;
  const pushVelB = ((j / mb) * recoilB + kickOntoB / Math.sqrt(mb)) * softB;

  let avx = va.vx - dx * pushVelA;
  let avy = va.vy - dy * pushVelA;
  let bvx = vb.vx + dx * pushVelB;
  let bvy = vb.vy + dy * pushVelB;

  // Scatter: early chaos; late quieter. Low grip = more scatter.
  const scatterSign = Math.random() < 0.5 ? -1 : 1;
  const scatter =
    scatterSign *
    HIT_SCATTER *
    phase *
    (0.55 + (1 - (a.grip + b.grip) / 200) * 0.55) *
    (0.5 + Math.random() * 0.5);
  const scatterA = scatter * (mb * invSum) * (0.65 + a.burst / 220);
  const scatterB = -scatter * (ma * invSum) * (0.65 + b.burst / 220);

  avx += tx * scatterA;
  avy += ty * scatterA;
  bvx += tx * scatterB;
  bvy += ty * scatterB;

  // Mass keeps more pre-hit tangential path
  const keepA = (a.mass / 100) * 0.14;
  const keepB = (b.mass / 100) * 0.14;
  const tangentA = va.vx * tx + va.vy * ty;
  const tangentB = vb.vx * tx + vb.vy * ty;
  const newTanA = avx * tx + avy * ty;
  const newTanB = bvx * tx + bvy * ty;
  const blendTanA = newTanA * (1 - keepA) + tangentA * keepA;
  const blendTanB = newTanB * (1 - keepB) + tangentB * keepB;
  const normalA = avx * dx + avy * dy;
  const normalB = bvx * dx + bvy * dy;

  avx = normalA * dx + blendTanA * tx;
  avy = normalA * dy + blendTanA * ty;
  bvx = normalB * dx + blendTanB * tx;
  bvy = normalB * dy + blendTanB * ty;

  fromCartVel(a, avx, avy);
  fromCartVel(b, bvx, bvy);

  // Clashes add an outward radial shock (base impact + attacker's burst + mutual burst clash)
  // so early glancing clashes threaten ring-outs, resisted by defender's defense stats.
  const impactJitterA = 0.12 + Math.pow(Math.random(), 1.65) * 2.02;
  const impactJitterB = 0.12 + Math.pow(Math.random(), 1.65) * 2.02;
  const burstClash = BURST_CLASH_BONUS * (a.burst / 100) * (b.burst / 100);
  const outShockOntoB =
    (BASE_OUTWARD_KICK * recoilB + BURST_OUTWARD_KICK * burstA * 1.4 + 52 * mobDriveA + burstClash) *
    phase *
    approachFactor *
    impactJitterB *
    Math.max(0.35, 1 - armorB * 0.28 - stabB * 0.18 - gripB * 0.16 - bankB * 0.18) /
    Math.pow(mb, 0.22);
  const outShockOntoA =
    (BASE_OUTWARD_KICK * recoilA + BURST_OUTWARD_KICK * burstB * 1.4 + 52 * mobDriveB + burstClash) *
    phase *
    approachFactor *
    impactJitterA *
    Math.max(0.35, 1 - armorA * 0.28 - stabA * 0.18 - gripA * 0.16 - bankA * 0.18) /
    Math.pow(ma, 0.22);
  a.vr += outShockOntoA;
  b.vr += outShockOntoB;

  // Keep post-hit radial exits from instantly clearing the stadium
  const outCap = MAX_OUTBOUND_VR * (0.7 + 0.3 * phase);
  const preCapVrA = a.vr;
  const preCapVrB = b.vr;
  const outCapA = a.vr > outCap;
  const outCapB = b.vr > outCap;
  if (outCapA) a.vr = outCap;
  if (outCapB) b.vr = outCap;

  // Dominant offensive channel (Attack vs Mobility momentum) + Defense wall counter-drain
  // Triangle: Attack > Mobility > Defense > Attack; Balanced ~50% vs all three.
  const impact = Math.min(2.2, Math.abs(j) / 150 + approach / 300);
  const rawAtkA = edgeA * edgePhase(ratioA) + burstA * phase * 0.32;
  const rawAtkB = edgeB * edgePhase(ratioB) + burstB * phase * 0.32;
  const mobAtkA = mobDriveA * 0.48 + gripA * 0.31 + bankA * 0.3;
  const mobAtkB = mobDriveB * 0.48 + gripB * 0.31 + bankB * 0.3;

  // Heavy armored/stable Defense walls reflect spin shock back onto attackers (Mobility evades via speed/grip)
  const wallCounterA = (armorA * 0.205 + massA * 0.2 + stabA * 0.2) * Math.max(0.38, 1 - velEdgeB * 0.34 - gripB * 0.28);
  const wallCounterB = (armorB * 0.205 + massB * 0.2 + stabB * 0.2) * Math.max(0.38, 1 - velEdgeA * 0.34 - gripA * 0.28);

  // Armor + stability + mass blunt raw Attack; Mobility's speed-driven hits pierce part of Defense
  const defVsRawB = Math.max(0.35, 1 - armorB * 0.31 - stabB * 0.19 - massB * 0.19 - gripB * 0.04);
  const defVsRawA = Math.max(0.35, 1 - armorA * 0.31 - stabA * 0.19 - massA * 0.19 - gripA * 0.04);
  const defVsMobB = Math.max(0.52, 1 - armorB * 0.19 - stabB * 0.115 - massB * 0.115 - gripB * 0.1);
  const defVsMobA = Math.max(0.52, 1 - armorA * 0.19 - stabA * 0.115 - massA * 0.115 - gripA * 0.1);

  const contactJitterA = 0.78 + Math.random() * 0.44;
  const contactJitterB = 0.78 + Math.random() * 0.44;
  const drainOnB = impact * (rawAtkA * defVsRawB + mobAtkA * defVsMobB + wallCounterA * defVsRawB) * contactJitterB * 14.5;
  const drainOnA = impact * (rawAtkB * defVsRawA + mobAtkB * defVsMobA + wallCounterB * defVsRawA) * contactJitterA * 14.5;

  a.spin = Math.max(0, a.spin - drainOnA);
  b.spin = Math.max(0, b.spin - drainOnB);

  if (a.spin <= 0) {
    a.spin = 0;
    a.alive = false;
  }
  if (b.spin <= 0) {
    b.spin = 0;
    b.alive = false;
  }

  return Math.min(1, Math.max(0.15, impact / 2.2));
}

/**
 * @param {Top[]} tops
 * @param {number} dt
 */
export function stepPhysics(tops, dt) {
  for (let i = 0; i < tops.length; i++) {
    integrateTop(tops[i], dt, i);
  }

  let collision = 0;
  if (tops.length >= 2) {
    collision = resolveCollision(tops[0], tops[1]) || 0;
  }

  return { ...checkWin(tops), collision };
}

/**
 * @param {Top[]} tops
 */
export function checkWin(tops) {
  const [a, b] = tops;
  const aOut = a.r > ARENA_RADIUS;
  const bOut = b.r > ARENA_RADIUS;
  const aSpin = a.spin <= 0;
  const bSpin = b.spin <= 0;

  if ((aOut || aSpin) && (bOut || bSpin)) {
    if (aOut && !bOut) return { winner: 1, reason: "ring out" };
    if (bOut && !aOut) return { winner: 0, reason: "ring out" };
    if (a.spin === b.spin) return { winner: a.r <= b.r ? 0 : 1, reason: "spin out" };
    return { winner: a.spin > b.spin ? 0 : 1, reason: "spin out" };
  }
  if (aOut) return { winner: 1, reason: "ring out" };
  if (bOut) return { winner: 0, reason: "ring out" };
  if (aSpin) return { winner: 1, reason: "spin out" };
  if (bSpin) return { winner: 0, reason: "spin out" };
  return { winner: null, reason: null };
}

/**
 * @param {number} playerIndex
 * @param {import('./parts.js').TopStats} [stats]
 */
export function deployPose(playerIndex, stats) {
  const side = playerIndex === 0 ? Math.PI : 0;
  const lane = (playerIndex === 0 ? 0.22 : -0.22) + (Math.random() - 0.5) * 0.44;
  const orbitDir = playerIndex === 0 ? 1 : -1;
  const launchN = (stats?.launch ?? 40) / 100;
  const bankN = (stats?.bank ?? 40) / 100;
  const maxSpin = stats?.maxSpin ?? 100;

  const speed = 250 + launchN * 185;
  const inward = 65 + launchN * 50 + (1 - bankN) * 30;

  return {
    r: ARENA_RADIUS * (0.64 + (1 - launchN) * 0.06 + (Math.random() - 0.5) * 0.10),
    theta: side + lane,
    vr: -(inward + Math.random() * 50),
    vt: orbitDir * (speed + Math.random() * 65),
    spin: maxSpin,
  };
}
