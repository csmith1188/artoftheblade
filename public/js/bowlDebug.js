import {
  getBowlPoints,
  setBowlPoints,
  resetBowlPoints,
  sampleBowl,
  clampEase,
} from "./shared/bowl.js";

const DEFAULT_GAME_SPEED = 1;
let gameSpeed = DEFAULT_GAME_SPEED;

export function getGameSpeed() {
  return gameSpeed;
}

/**
 * Interactive bowl-curve editor. Call when ?debug=true.
 * Physics reads the same bowlPoints live via bowlAcceleration → sampleBowl.
 * @param {HTMLElement} root
 * @param {() => void} [onChange]
 */
export function initBowlDebug(root, onChange) {
  root.hidden = false;

  const canvas = root.querySelector("#bowl-curve");
  const resetBtn = root.querySelector("#bowl-reset");
  const easeReadout = root.querySelector("#bowl-ease-readout");
  const speedInput = root.querySelector("#debug-speed");
  const speedOut = root.querySelector("#debug-speed-val");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  function syncSpeedUI() {
    if (speedInput instanceof HTMLInputElement) {
      speedInput.value = String(gameSpeed);
    }
    if (speedOut) {
      speedOut.textContent = `${gameSpeed.toFixed(2)}×`;
    }
  }

  if (speedInput instanceof HTMLInputElement) {
    speedInput.addEventListener("input", () => {
      const v = Number(speedInput.value);
      if (Number.isFinite(v) && v > 0) {
        gameSpeed = v;
        syncSpeedUI();
      }
    });
  }
  syncSpeedUI();

  const ctx = canvas.getContext("2d");
  const pad = { l: 40, r: 16, t: 16, b: 28 };
  let dragIndex = -1;
  let hoverIndex = -1;

  function plotRect() {
    const w = canvas.width;
    const h = canvas.height;
    return {
      x: pad.l,
      y: pad.t,
      w: w - pad.l - pad.r,
      h: h - pad.t - pad.b,
    };
  }

  function toCanvas(pt, rect) {
    return {
      x: rect.x + pt.x * rect.w,
      y: rect.y + (1 - pt.y) * rect.h,
    };
  }

  function fromCanvas(mx, my, rect) {
    return {
      x: (mx - rect.x) / rect.w,
      y: 1 - (my - rect.y) / rect.h,
    };
  }

  function updateReadout() {
    if (!easeReadout) return;
    const idx = dragIndex >= 0 ? dragIndex : hoverIndex;
    if (idx < 0) {
      easeReadout.textContent = "Wheel on a handle to set easing angle";
      return;
    }
    const pts = getBowlPoints();
    const p = pts[idx];
    easeReadout.textContent = `Point ${idx + 1}: ease ${p.ease.toFixed(0)}°`;
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    const rect = plotRect();
    const pts = getBowlPoints();

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0e1620";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(143,163,181,0.15)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = rect.x + (rect.w * i) / 4;
      const gy = rect.y + (rect.h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, rect.y);
      ctx.lineTo(gx, rect.y + rect.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rect.x, gy);
      ctx.lineTo(rect.x + rect.w, gy);
      ctx.stroke();
    }

    ctx.fillStyle = "#9aadc0";
    ctx.font = '11px "Shippori Mincho", Georgia, serif';
    ctx.textAlign = "center";
    ctx.fillText("center", rect.x, h - 8);
    ctx.fillText("rim", rect.x + rect.w, h - 8);
    ctx.save();
    ctx.translate(12, rect.y + rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("bowl height", 0, 0);
    ctx.restore();

    // Live Hermite curve (same sampler physics uses)
    ctx.strokeStyle = "#f4d35e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = toCanvas({ x: t, y: sampleBowl(t) }, rect);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Easing tangent ticks
    for (let i = 0; i < pts.length; i++) {
      const p = toCanvas(pts[i], rect);
      const ang = (pts[i].ease * Math.PI) / 180;
      // plot (+cos, +sin) → canvas (+cos, −sin)
      const len = 26;
      const tx = Math.cos(ang) * len;
      const ty = -Math.sin(ang) * len;
      ctx.strokeStyle =
        i === hoverIndex || i === dragIndex
          ? "rgba(244,211,94,0.95)"
          : "rgba(143,163,181,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - tx, p.y - ty);
      ctx.lineTo(p.x + tx, p.y + ty);
      ctx.stroke();
    }

    // Handles
    for (let i = 0; i < pts.length; i++) {
      const p = toCanvas(pts[i], rect);
      const hot = i === dragIndex || i === hoverIndex;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hot ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 || i === pts.length - 1 ? "#00b4d8" : "#e85d04";
      ctx.fill();
      ctx.strokeStyle = "#e8eef4";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    updateReadout();
  }

  function hitTest(mx, my) {
    const rect = plotRect();
    const pts = getBowlPoints();
    for (let i = 0; i < pts.length; i++) {
      const p = toCanvas(pts[i], rect);
      if (Math.hypot(mx - p.x, my - p.y) <= 14) return i;
    }
    return -1;
  }

  function pointerPos(e) {
    const bounds = canvas.getBoundingClientRect();
    const sx = canvas.width / bounds.width;
    const sy = canvas.height / bounds.height;
    return {
      x: (e.clientX - bounds.left) * sx,
      y: (e.clientY - bounds.top) * sy,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = pointerPos(e);
    dragIndex = hitTest(x, y);
    if (dragIndex >= 0) {
      canvas.setPointerCapture(e.pointerId);
      draw();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = pointerPos(e);
    const hit = hitTest(x, y);
    if (dragIndex < 0) {
      if (hit !== hoverIndex) {
        hoverIndex = hit;
        canvas.style.cursor = hit >= 0 ? "ns-resize" : "crosshair";
        draw();
      }
      return;
    }

    const rect = plotRect();
    const pts = getBowlPoints();
    const prev = pts[dragIndex];
    const next = fromCanvas(x, y, rect);
    next.y = Math.max(0, Math.min(1, next.y));
    next.ease = prev.ease;

    if (dragIndex === 0) {
      next.x = 0;
    } else if (dragIndex === pts.length - 1) {
      next.x = 1;
    } else {
      const lo = pts[dragIndex - 1].x + 0.02;
      const hi = pts[dragIndex + 1].x - 0.02;
      next.x = Math.max(lo, Math.min(hi, next.x));
    }

    pts[dragIndex] = next;
    setBowlPoints(pts); // live → physics bowlAcceleration
    draw();
    onChange?.();
  });

  canvas.addEventListener("pointerup", () => {
    dragIndex = -1;
    draw();
  });

  canvas.addEventListener("pointercancel", () => {
    dragIndex = -1;
    draw();
  });

  canvas.addEventListener("pointerleave", () => {
    if (dragIndex < 0) {
      hoverIndex = -1;
      draw();
    }
  });

  // Wheel over a point → change easing angle (applies immediately to gameplay)
  canvas.addEventListener(
    "wheel",
    (e) => {
      const { x, y } = pointerPos(e);
      const hit = hitTest(x, y);
      if (hit < 0) return;
      e.preventDefault();
      const pts = getBowlPoints();
      const step = e.shiftKey ? 1 : 5;
      const delta = Math.sign(-e.deltaY) * step;
      pts[hit] = {
        ...pts[hit],
        ease: clampEase(pts[hit].ease + delta),
      };
      setBowlPoints(pts);
      hoverIndex = hit;
      draw();
      onChange?.();
    },
    { passive: false }
  );

  canvas.addEventListener("dblclick", (e) => {
    const { x, y } = pointerPos(e);
    const hit = hitTest(x, y);
    const pts = getBowlPoints();
    if (hit > 0 && hit < pts.length - 1) {
      pts.splice(hit, 1);
      setBowlPoints(pts);
      draw();
      onChange?.();
      return;
    }
    if (hit < 0 && pts.length < 10) {
      const rect = plotRect();
      const p = fromCanvas(x, y, rect);
      if (p.x > 0.05 && p.x < 0.95) {
        pts.push({
          x: p.x,
          y: Math.max(0, Math.min(1, p.y)),
          ease: 0,
        });
        setBowlPoints(pts);
        draw();
        onChange?.();
      }
    }
  });

  resetBtn?.addEventListener("click", () => {
    resetBowlPoints();
    gameSpeed = DEFAULT_GAME_SPEED;
    syncSpeedUI();
    draw();
    onChange?.();
  });

  draw();
}

export function isDebugEnabled() {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("debug");
  return v === "1" || v === "true" || v === "yes";
}
