import {
  CATALOG,
  STAT_KEYS,
  defaultLoadouts,
  deriveStats,
  summarizeStats,
  fillPartSelects,
} from "./parts.js";
import {
  createTop,
  deployPose,
  stepPhysics,
  resetDebugMetrics,
  getDebugMetrics,
} from "./physics.js";
import { createRenderer, createBowlProfileRenderer } from "./render.js";
import { initBowlDebug, isDebugEnabled, getGameSpeed } from "./bowlDebug.js";
import {
  startBattleAudio,
  stopBattleAudio,
  updateBattleAudio,
  playCollisionSound,
} from "./audio.js";

const canvas = document.getElementById("arena");
const bowlLiveCanvas = document.getElementById("bowl-live");
const deployBtn = document.getElementById("deploy-btn");
const banner = document.getElementById("banner");
const roundLabel = document.getElementById("round-label");
const scoreLabel = document.getElementById("score-label");

const partSelects = [
  ...document.querySelectorAll("#parts-p1 select"),
  ...document.querySelectorAll("#parts-p2 select"),
];

const BASE_SIM_SPEED = 2;

const SUMMARY_KEYS = ["attack", "defense", "mobility"];

/** @type {'idle' | 'fighting' | 'roundOver'} */
let state = "idle";
let round = 1;
const wins = [0, 0];
let loadouts = defaultLoadouts();
/** @type {(Record<string, number> | null)[]} */
const statOverrides = [null, null];
let debugStatEditing = false;
/** @type {import('./physics.js').Top[]} */
let tops = [];
let lastTs = 0;
let resultFreeze = 0;

const renderer = createRenderer(canvas);
const bowlProfile = bowlLiveCanvas ? createBowlProfileRenderer(bowlLiveCanvas) : null;

function renderAll(opts) {
  renderer.draw(tops, opts);
  bowlProfile?.draw(tops);
}

function statsFor(player) {
  const base = deriveStats(loadouts[player]);
  const ov = statOverrides[player];
  if (!ov) return base;
  const merged = { ...base, ...ov };
  return { ...merged, ...summarizeStats(merged) };
}

function applyStatsToTop(top, s) {
  for (const key of STAT_KEYS) {
    top[key] = s[key];
  }
  top.attack = s.attack;
  top.defense = s.defense;
  top.mobility = s.mobility;
}

function updateStatHUD() {
  for (let p = 0; p < 2; p++) {
    const s = statsFor(p);
    const prefix = p === 0 ? "p1" : "p2";
    document.getElementById(`stat-${prefix}-power`).textContent = String(
      s.attack + s.defense + s.mobility
    );
    for (const key of SUMMARY_KEYS) {
      document.getElementById(`stat-${prefix}-${key}`).textContent = String(s[key]);
    }
    for (const key of STAT_KEYS) {
      const dd = document.getElementById(`stat-${prefix}-${key}`);
      if (debugStatEditing) {
        const input = dd?.querySelector("input");
        if (input instanceof HTMLInputElement && document.activeElement !== input) {
          input.value = String(s[key]);
        }
      } else if (dd) {
        dd.textContent = String(s[key]);
      }
    }
  }
}

function setupDebugStatInputs() {
  debugStatEditing = true;
  for (let p = 0; p < 2; p++) {
    const prefix = p === 0 ? "p1" : "p2";
    for (const key of STAT_KEYS) {
      const dd = document.getElementById(`stat-${prefix}-${key}`);
      if (!dd) continue;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "stat-edit";
      input.min = key === "maxSpin" ? "20" : "0";
      input.max = key === "maxSpin" ? "250" : "150";
      input.step = "1";
      input.setAttribute("aria-label", `Player ${p + 1} ${key}`);

      const applyEdit = (normalizeInput) => {
        if (input.value.trim() === "") {
          if (normalizeInput) input.value = String(statsFor(p)[key]);
          return;
        }
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        const lo = Number(input.min);
        const hi = Number(input.max);
        const clamped = Math.max(lo, Math.min(hi, Math.round(v)));
        if (normalizeInput) input.value = String(clamped);

        if (!statOverrides[p]) statOverrides[p] = {};
        statOverrides[p][key] = clamped;

        const s = statsFor(p);
        if (tops[p]) {
          const prevMax = tops[p].maxSpin;
          applyStatsToTop(tops[p], s);
          if (key === "maxSpin") {
            if (state === "idle") {
              tops[p].spin = s.maxSpin;
            } else if (prevMax > 0) {
              // Keep current spin ratio consistent when editing maxSpin live
              tops[p].spin = Math.min(s.maxSpin, (tops[p].spin / prevMax) * s.maxSpin);
            }
            updateSpinHUD();
          }
        }
        updateStatHUD();
        if (state === "idle") renderAll({ fighting: false });
      };

      input.addEventListener("input", () => applyEdit(false));
      input.addEventListener("change", () => applyEdit(true));
      input.addEventListener("blur", () => applyEdit(true));
      dd.textContent = "";
      dd.appendChild(input);
    }
  }
}

function updateSpinHUD() {
  for (let p = 0; p < 2; p++) {
    const el = document.getElementById(p === 0 ? "spin-p1" : "spin-p2");
    const top = tops[p];
    const maxSpin = top?.maxSpin ?? statsFor(p).maxSpin;
    const spin = top?.spin ?? maxSpin;
    const pct = Math.max(0, Math.min(100, (spin / maxSpin) * 100));
    el.style.width = `${pct}%`;
  }
}

function updateMatchMeta() {
  roundLabel.textContent = `Round ${round}`;
  scoreLabel.textContent = `${wins[0]} — ${wins[1]}`;
}

function setPartsEnabled(enabled) {
  for (const select of partSelects) {
    select.disabled = !enabled;
  }
}

function showBanner(text) {
  banner.hidden = false;
  banner.textContent = text;
}

function hideBanner() {
  banner.hidden = true;
  banner.textContent = "";
}

function placeIdleTops() {
  tops = [0, 1].map((i) => {
    const s = statsFor(i);
    const pose = deployPose(i, s);
    pose.vr = 0;
    pose.vt = 0;
    pose.spin = s.maxSpin;
    pose.r = 160;
    return createTop(s, pose);
  });
  updateSpinHUD();
  renderer.clearTrails();
  renderAll({ fighting: false });
}

function onPartChange(e) {
  const select = e.target;
  if (!(select instanceof HTMLSelectElement)) return;
  const player = Number(select.dataset.player);
  const slot = select.dataset.slot;
  if (!CATALOG[slot]) return;
  loadouts[player][slot] = select.value;
  statOverrides[player] = null;
  updateStatHUD();
  if (state === "idle") {
    for (let i = 0; i < 2; i++) {
      if (tops[i]) applyStatsToTop(tops[i], statsFor(i));
    }
    renderAll({ fighting: false });
  }
}

function deploy() {
  if (state === "fighting") return;

  hideBanner();
  state = "fighting";
  deployBtn.disabled = true;
  setPartsEnabled(false);
  renderer.clearTrails();

  tops = [0, 1].map((i) => {
    const s = statsFor(i);
    return createTop(s, deployPose(i, s));
  });
  // #region agent log
  resetDebugMetrics();
  fetch("http://127.0.0.1:7268/ingest/a04cf68a-ab33-4531-8136-543ff0f661d0", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c6244d" },
    body: JSON.stringify({
      sessionId: "c6244d",
      runId: "ko-post-fix-2",
      hypothesisId: "H1,H2,H3,H4",
      location: "js/game.js:deploy",
      message: "round_start",
      data: {
        round,
        players: [0, 1].map((i) => {
          const s = statsFor(i);
          return {
            p: i + 1,
            loadout: { ...loadouts[i] },
            atk: s.attack,
            def: s.defense,
            mob: s.mobility,
            burst: s.burst,
            mass: s.mass,
            armor: s.armor,
            bank: s.bank,
            launch: s.launch,
          };
        }),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  updateSpinHUD();
  void startBattleAudio();
  lastTs = performance.now();
  requestAnimationFrame(loop);
}

function endRound(winner, reason) {
  state = "roundOver";
  stopBattleAudio();
  wins[winner] += 1;
  updateMatchMeta();

  // #region agent log
  const m = getDebugMetrics();
  fetch("http://127.0.0.1:7268/ingest/a04cf68a-ab33-4531-8136-543ff0f661d0", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c6244d" },
    body: JSON.stringify({
      sessionId: "c6244d",
      runId: "ko-post-fix-2",
      hypothesisId: "H1,H2,H3,H4",
      location: "js/game.js:endRound",
      message: "round_end",
      data: {
        round,
        winner: winner + 1,
        reason,
        elapsedSimSec: m ? Number(m.elapsedSimSec.toFixed(2)) : 0,
        hits: m?.hits ?? 0,
        maxR: m ? m.maxR.map((v) => Number(v.toFixed(1))) : [0, 0],
        peakVr: m ? m.peakVr.map((v) => Number(v.toFixed(1))) : [0, 0],
        outCapHits: m ? [...m.outCapHits] : [0, 0],
        potBleedVr: m ? m.potBleedVr.map((v) => Number(v.toFixed(1))) : [0, 0],
        bowlBrakeVr: m ? m.bowlBrakeVr.map((v) => Number(v.toFixed(1))) : [0, 0],
        finalSpin: tops.map((t) => Number(t.spin.toFixed(1))),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const name = winner === 0 ? "Player 1" : "Player 2";
  showBanner(`${name} wins — ${reason}`);
  resultFreeze = performance.now() + 1600;

  requestAnimationFrame(loop);
}

function finishRoundOver() {
  state = "idle";
  stopBattleAudio();
  round += 1;
  updateMatchMeta();
  setPartsEnabled(true);
  deployBtn.disabled = false;
  placeIdleTops();
}

function loop(ts) {
  if (state === "idle") return;

  const rawDt = (ts - lastTs) / 1000;
  lastTs = ts;
  const dt = Math.min(0.033, Math.max(0.001, rawDt));

  if (state === "fighting") {
    const speed = BASE_SIM_SPEED * getGameSpeed();
    const scaledDt = dt * speed;
    const subSteps = Math.max(1, Math.ceil(scaledDt / 0.02));
    const stepDt = scaledDt / subSteps;

    let winner = null;
    let reason = null;
    let maxCollision = 0;
    for (let i = 0; i < subSteps; i++) {
      const res = stepPhysics(tops, stepDt);
      if (res.collision > maxCollision) {
        maxCollision = res.collision;
      }
      if (res.winner !== null) {
        winner = res.winner;
        reason = res.reason;
        break;
      }
    }

    if (maxCollision > 0) {
      playCollisionSound(maxCollision);
    }

    updateSpinHUD();
    updateBattleAudio(tops, speed);
    renderAll({ fighting: true });

    if (winner !== null) {
      endRound(winner, reason);
      return;
    }
    requestAnimationFrame(loop);
    return;
  }

  if (state === "roundOver") {
    renderAll({ fighting: false });
    if (ts >= resultFreeze) {
      finishRoundOver();
      return;
    }
    requestAnimationFrame(loop);
  }
}

function init() {
  fillPartSelects(partSelects, loadouts);
  for (const select of partSelects) {
    select.addEventListener("change", onPartChange);
  }
  deployBtn.addEventListener("click", deploy);

  if (isDebugEnabled()) {
    setupDebugStatInputs();
    const debugRoot = document.getElementById("bowl-debug");
    if (debugRoot) {
      initBowlDebug(debugRoot, () => {
        if (state === "idle") renderAll({ fighting: false });
      });
    }
  }

  updateStatHUD();
  updateMatchMeta();
  setPartsEnabled(true);
  deployBtn.disabled = false;
  placeIdleTops();
  showBanner("Swap parts, then Deploy");
}

init();
