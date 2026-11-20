import { ARENA_RADIUS, TOP_RADIUS, polarToCartesian } from "./shared/physics.js";
import { sampleBowl } from "./shared/bowl.js";

const COLORS = ["#e85d04", "#00b4d8"];
const RING_COLORS = ["rgba(143,163,181,0.12)", "rgba(143,163,181,0.08)", "rgba(143,163,181,0.05)"];
const FLOOR_LOW = [42, 61, 82];   // #2a3d52 (center / h=0)
const FLOOR_HIGH = [13, 20, 28];  // #0d141c (rim / h=1)

function bowlFloorColor(h) {
  const t = Math.max(0, Math.min(1, h));
  const r = Math.round(FLOOR_LOW[0] + (FLOOR_HIGH[0] - FLOOR_LOW[0]) * t);
  const g = Math.round(FLOOR_LOW[1] + (FLOOR_HIGH[1] - FLOOR_LOW[1]) * t);
  const b = Math.round(FLOOR_LOW[2] + (FLOOR_HIGH[2] - FLOOR_LOW[2]) * t);
  return `rgb(${r},${g},${b})`;
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  /** @type {{ x: number, y: number, color: string }[][]} */
  const trails = [[], []];
  const TRAIL_MAX = 14;

  function clearTrails() {
    trails[0] = [];
    trails[1] = [];
  }

  /**
   * @param {import('./physics.js').Top[]} tops
   * @param {{ fighting: boolean }} opts
   */
  function draw(tops, opts = { fighting: false }) {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Stadium floor — radial gradient follows the arena bowl curve
    const outerR = ARENA_RADIUS + 18;
    const floor = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    const stops = 16;
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      const stopPos = (t * ARENA_RADIUS) / outerR;
      floor.addColorStop(stopPos, bowlFloorColor(sampleBowl(t)));
    }
    floor.addColorStop(1, bowlFloorColor(sampleBowl(1)));
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();

    // Battlezone rim
    ctx.strokeStyle = "rgba(244, 211, 94, 0.55)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, ARENA_RADIUS + 8, 0, Math.PI * 2);
    ctx.stroke();

    // Concentric rings
    for (let i = 1; i <= 3; i++) {
      ctx.strokeStyle = RING_COLORS[i - 1];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, (ARENA_RADIUS * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Center mark
    ctx.fillStyle = "rgba(244, 211, 94, 0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244, 211, 94, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx, cy + 16);
    ctx.stroke();

    tops.forEach((top, i) => {
      const { x, y } = polarToCartesian(top.r, top.theta, cx, cy);
      const color = COLORS[i];

      if (opts.fighting && top.alive) {
        trails[i].push({ x, y, color });
        if (trails[i].length > TRAIL_MAX) trails[i].shift();
      }

      // Trail
      const trail = trails[i];
      for (let t = 0; t < trail.length; t++) {
        const p = trail[t];
        const alpha = ((t + 1) / trail.length) * 0.35;
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, TOP_RADIUS * 0.35 * ((t + 1) / trail.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      drawTop(ctx, x, y, top, color);
    });
  }

  return { draw, clearTrails };
}

/**
 * Live bowl cross-section graph showing each player's radial position on the curve.
 * @param {HTMLCanvasElement} canvas
 */
export function createBowlProfileRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const pad = { l: 16, r: 16, t: 14, b: 20 };

  /**
   * @param {import('./physics.js').Top[]} tops
   */
  function draw(tops) {
    const w = canvas.width;
    const h = canvas.height;
    const rect = {
      x: pad.l,
      y: pad.t,
      w: w - pad.l - pad.r,
      h: h - pad.t - pad.b,
    };

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0e1620";
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = "rgba(143,163,181,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = rect.x + (rect.w * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, rect.y);
      ctx.lineTo(gx, rect.y + rect.h);
      ctx.stroke();
    }

    // Bowl curve fill + stroke
    const steps = 64;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = rect.x + t * rect.w;
      const py = rect.y + (1 - sampleBowl(t)) * rect.h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = "rgba(244, 211, 94, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
    ctx.lineTo(rect.x, rect.y + rect.h);
    ctx.closePath();
    ctx.fillStyle = "rgba(244, 211, 94, 0.08)";
    ctx.fill();

    // Axis labels
    ctx.fillStyle = "#9aadc0";
    ctx.font = '10px "Shippori Mincho", Georgia, serif';
    ctx.textAlign = "left";
    ctx.fillText("center", rect.x, h - 5);
    ctx.textAlign = "right";
    ctx.fillText("rim", rect.x + rect.w, h - 5);

    // Player polar radial markers on the bowl curve
    tops.forEach((top, i) => {
      if (!top) return;
      const normR = Math.max(0, Math.min(1, top.r / ARENA_RADIUS));
      const px = rect.x + normR * rect.w;
      const py = rect.y + (1 - sampleBowl(normR)) * rect.h;
      const color = COLORS[i];

      ctx.save();
      ctx.globalAlpha = top.alive ? 1 : 0.35;

      // Vertical drop line to floor axis
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, rect.y + rect.h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Marker dot
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#e8eef4";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    });
  }

  return { draw };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {import('./physics.js').Top} top
 * @param {string} color
 */
function drawTop(ctx, x, y, top, color) {
  const alpha = top.alive ? 1 : 0.35;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(top.angle);
  ctx.globalAlpha = alpha;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(3, TOP_RADIUS * 0.55, TOP_RADIUS * 0.85, TOP_RADIUS * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer disc
  const grad = ctx.createRadialGradient(-6, -8, 4, 0, 0, TOP_RADIUS);
  grad.addColorStop(0, "#fff6");
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, shade(color, -40));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, TOP_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = shade(color, -60);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Layer blades
  ctx.fillStyle = shade(color, 30);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.lineTo(Math.cos(a - 0.35) * TOP_RADIUS * 0.92, Math.sin(a - 0.35) * TOP_RADIUS * 0.92);
    ctx.lineTo(Math.cos(a + 0.35) * TOP_RADIUS * 0.92, Math.sin(a + 0.35) * TOP_RADIUS * 0.92);
    ctx.closePath();
    ctx.fill();
  }

  // Hub
  ctx.fillStyle = "#1a222c";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function shade(hex, amount) {
  const n = hex.replace("#", "");
  const num = parseInt(n.length === 3 ? n.split("").map((c) => c + c).join("") : n, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0xff) + amount;
  let b = (num & 0xff) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
