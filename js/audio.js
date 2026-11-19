/**
 * Per-player gated tones.
 * P1 = low fundamental, P2 = perfect fifth (3:2).
 * Gate rate from spin; ON always brief, OFF lengthens as spin drops.
 */

const LOW_FREQ = 392; // G4
const HIGH_FREQ = LOW_FREQ * 1.5; // D5 — perfect fifth
const MASTER_GAIN = 0.07;
const SFX_GAIN = 0.22;
const COLLISION_COOLDOWN_SEC = 0.045;
const ON_SEC = 0.036;
const OFF_MIN = 0.025; // high spin — tight gaps
const OFF_MAX = 0.32; // low spin — longer silence between blips

/**
 * @typedef {object} Voice
 * @property {OscillatorNode} osc
 * @property {GainNode} gate
 * @property {boolean} on
 * @property {number} phaseEndsAt
 */

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let master = null;
/** @type {GainNode | null} */
let sfxMaster = null;
/** @type {AudioBuffer | null} */
let noiseBuffer = null;
/** @type {Voice[]} */
let voices = [];
let running = false;
let lastCollisionAt = -1;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createNoiseBuffer(audioCtx) {
  const length = Math.floor(audioCtx.sampleRate * 0.08);
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);

  sfxMaster = ctx.createGain();
  sfxMaster.gain.value = SFX_GAIN;
  sfxMaster.connect(ctx.destination);
  noiseBuffer = createNoiseBuffer(ctx);

  const freqs = [LOW_FREQ, HIGH_FREQ];
  voices = freqs.map((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    osc.connect(gate);
    gate.connect(master);
    osc.start();
    return {
      osc,
      gate,
      on: false,
      phaseEndsAt: ctx.currentTime,
    };
  });

  return ctx;
}

/**
 * Resume audio (must run from a user gesture).
 */
export async function startBattleAudio() {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* ignore */
    }
  }
  running = true;
  const now = c.currentTime;
  for (const v of voices) {
    v.on = false;
    v.phaseEndsAt = now;
    v.gate.gain.cancelScheduledValues(now);
    v.gate.gain.setValueAtTime(0, now);
  }
}

export function stopBattleAudio() {
  running = false;
  if (!ctx || !voices.length) return;
  const now = ctx.currentTime;
  for (const v of voices) {
    v.on = false;
    v.gate.gain.cancelScheduledValues(now);
    v.gate.gain.setValueAtTime(0, now);
  }
}

/**
 * @param {number} spinRatio 0..1
 */
function offDuration(spinRatio) {
  const t = Math.max(0, Math.min(1, spinRatio));
  // Lower spin → longer OFF (and thus lower gate frequency)
  return lerp(OFF_MAX, OFF_MIN, t * t);
}

/**
 * Advance gated tones from current top spin.
 * @param {{ spin: number, maxSpin: number, alive?: boolean }[]} tops
 * @param {number} [speed=1]
 */
export function updateBattleAudio(tops, speed = 1) {
  if (!running || !ctx || !voices.length) return;
  const now = ctx.currentTime;
  const speedScale = Math.max(0.1, speed);

  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    const top = tops[i];
    if (!top || top.alive === false || top.spin <= 0) {
      if (v.on || v.gate.gain.value > 0) {
        v.on = false;
        v.gate.gain.cancelScheduledValues(now);
        v.gate.gain.setValueAtTime(0, now);
      }
      v.phaseEndsAt = now + 0.05;
      continue;
    }

    const ratio = top.spin / Math.max(1, top.maxSpin);

    while (v.phaseEndsAt <= now) {
      if (!v.on) {
        // Start brief ON blip
        v.on = true;
        const onEnd = v.phaseEndsAt + ON_SEC;
        v.gate.gain.cancelScheduledValues(v.phaseEndsAt);
        v.gate.gain.setValueAtTime(0, v.phaseEndsAt);
        v.gate.gain.linearRampToValueAtTime(1, v.phaseEndsAt + 0.003);
        v.gate.gain.setValueAtTime(1, onEnd - 0.004);
        v.gate.gain.linearRampToValueAtTime(0, onEnd);
        v.phaseEndsAt = onEnd;
      } else {
        // OFF gap — length from spin (gate frequency), scaled by game speed
        v.on = false;
        const off = offDuration(ratio) / speedScale;
        v.phaseEndsAt += off;
      }
    }
  }
}

/**
 * Play a metallic clash sound scaled by collision intensity (0..1).
 * @param {number} [intensity=0.7]
 */
export function playCollisionSound(intensity = 0.7) {
  if (!ctx || !sfxMaster || ctx.state !== "running") return;
  const now = ctx.currentTime;
  if (now - lastCollisionAt < COLLISION_COOLDOWN_SEC) return;
  lastCollisionAt = now;

  const strength = Math.max(0.15, Math.min(1, intensity));
  const jitter = 0.94 + Math.random() * 0.12;
  const dur = lerp(0.07, 0.14, strength);

  // 1. Metallic clang (two inharmonic partials)
  const clangGain = ctx.createGain();
  clangGain.gain.setValueAtTime(0.001, now);
  clangGain.gain.linearRampToValueAtTime(0.45 * (0.4 + 0.6 * strength), now + 0.003);
  clangGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  clangGain.connect(sfxMaster);

  const osc1 = ctx.createOscillator();
  osc1.type = "triangle";
  osc1.frequency.setValueAtTime(lerp(720, 960, strength) * jitter, now);
  osc1.frequency.exponentialRampToValueAtTime(480 * jitter, now + dur);
  osc1.connect(clangGain);
  osc1.start(now);
  osc1.stop(now + dur + 0.01);

  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(lerp(1180, 1620, strength) * jitter, now);
  osc2.frequency.exponentialRampToValueAtTime(840 * jitter, now + dur * 0.8);
  const osc2Gain = ctx.createGain();
  osc2Gain.gain.value = 0.35;
  osc2.connect(osc2Gain);
  osc2Gain.connect(clangGain);
  osc2.start(now);
  osc2.stop(now + dur + 0.01);

  // 2. Sharp spark/clack noise transient
  if (noiseBuffer) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(lerp(2000, 3400, strength), now);
    filter.Q.value = 1.6;
    const nGain = ctx.createGain();
    const nDur = lerp(0.025, 0.05, strength);
    nGain.gain.setValueAtTime(0.65 * (0.35 + 0.65 * strength), now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + nDur);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(sfxMaster);
    noise.start(now);
    noise.stop(now + nDur + 0.005);
  }

  // 3. Low impact punch for heavier hits
  const thud = ctx.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(lerp(150, 210, strength), now);
  thud.frequency.exponentialRampToValueAtTime(58, now + 0.055);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.55 * strength, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  thud.connect(thudGain);
  thudGain.connect(sfxMaster);
  thud.start(now);
  thud.stop(now + 0.065);
}
