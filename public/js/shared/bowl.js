/**
 * Arena bowl profile (cross-section).
 * x = 0 at center, x = 1 at rim.
 * y = floor height (0..1).
 * ease = surface tangent angle in degrees — this IS the local slope.
 *
 * Physics uses the slope (dy/dx), not the height: positive slope
 * (higher toward the rim) pulls inward. Editing ease/height updates
 * shared bowlPoints that bowlAcceleration reads every frame.
 */

export const BOWL_FORCE_MAX = 220;
export const EASE_MIN = -80;
export const EASE_MAX = 80;
const FORCE_CLAMP = 420;

/**
 * @typedef {object} BowlPoint
 * @property {number} x
 * @property {number} y
 * @property {number} ease  tangent angle in degrees
 */

/** Default bowl: flat pocket rising into a steep rim wall. */
export const DEFAULT_BOWL_POINTS = Object.freeze([
  { x: 0, y: 0, ease: 0 },
  { x: 1, y: 1, ease: 62 },
]);

/** @type {BowlPoint[]} */
let bowlPoints = cloneDefaults();

function cloneDefaults() {
  return DEFAULT_BOWL_POINTS.map((p) => ({ ...p }));
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function clampEase(n) {
  return Math.max(EASE_MIN, Math.min(EASE_MAX, n));
}

/**
 * @param {Partial<BowlPoint>} p
 * @returns {BowlPoint}
 */
function normalizePoint(p) {
  return {
    x: clamp01(Number(p.x) || 0),
    y: clamp01(Number(p.y) || 0),
    ease: clampEase(p.ease == null ? 0 : Number(p.ease)),
  };
}

export function getBowlPoints() {
  return bowlPoints.map((p) => ({ ...p }));
}

/**
 * @param {BowlPoint[]} points
 */
export function setBowlPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return;
  bowlPoints = points.map(normalizePoint).sort((a, b) => a.x - b.x);
  bowlPoints[0].x = 0;
  bowlPoints[bowlPoints.length - 1].x = 1;
}

export function resetBowlPoints() {
  bowlPoints = cloneDefaults();
}

/**
 * Slope dy/dx from ease angle (plot space: +y = higher floor).
 * @param {number} easeDeg
 */
export function easeToSlope(easeDeg) {
  return Math.tan((clampEase(easeDeg) * Math.PI) / 180);
}

/**
 * @param {BowlPoint} a
 * @param {BowlPoint} b
 * @param {number} x
 */
function hermiteY(a, b, x) {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return a.y;
  const t = (x - a.x) / dx;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const m0 = easeToSlope(a.ease);
  const m1 = easeToSlope(b.ease);
  return h00 * a.y + h10 * dx * m0 + h01 * b.y + h11 * dx * m1;
}

/**
 * Analytic Hermite derivative dy/dx — matches ease at endpoints.
 * @param {BowlPoint} a
 * @param {BowlPoint} b
 * @param {number} x
 */
function hermiteSlope(a, b, x) {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return easeToSlope(a.ease);
  const t = (x - a.x) / dx;
  const t2 = t * t;
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  const m0 = easeToSlope(a.ease);
  const m1 = easeToSlope(b.ease);
  const dydt = d00 * a.y + d10 * dx * m0 + d01 * b.y + d11 * dx * m1;
  return dydt / dx;
}

function segmentAt(x) {
  const pts = bowlPoints;
  const t = clamp01(x);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.x && t <= b.x) return { a, b, t };
  }
  const last = pts.length - 1;
  return { a: pts[last - 1], b: pts[last], t };
}

/**
 * Sample bowl height (0..1) at normalized radius — for the debug graph.
 * @param {number} t
 */
export function sampleBowl(t) {
  const { a, b, t: x } = segmentAt(t);
  return clamp01(hermiteY(a, b, x));
}

/**
 * Sample bowl slope dy/dx at normalized radius — used by physics.
 * @param {number} t
 */
export function sampleBowlSlope(t) {
  const { a, b, t: x } = segmentAt(t);
  return hermiteSlope(a, b, x);
}

/**
 * Inward acceleration at radius r (positive = toward center).
 * Driven by floor slope: uphill toward the rim → pull inward.
 * @param {number} r
 * @param {number} arenaRadius
 * @param {number} [bankScale=1]
 */
export function bowlAcceleration(r, arenaRadius, bankScale = 1) {
  const t = arenaRadius > 0 ? r / arenaRadius : 0;
  const slope = sampleBowlSlope(t);
  // slope > 0 (higher at rim) → positive inward accel
  return clamp(BOWL_FORCE_MAX * slope * bankScale, -FORCE_CLAMP, FORCE_CLAMP);
}
