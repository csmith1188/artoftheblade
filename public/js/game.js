/* global io */
import {
  CATALOG,
  SLOT_KEYS,
  SLOT_META,
  STAT_KEYS,
  STARTER_LOADOUT,
  deriveStats,
  getPartById,
} from "./shared/parts.js";
import { createPartPicker } from "./partPicker.js";
import { renderPartIconSvg } from "./partIcons.js";
import { createRenderer, createBowlProfileRenderer } from "./render.js";
import {
  startBattleAudio,
  stopBattleAudio,
  updateBattleAudio,
  playCollisionSound,
} from "./audio.js";

const BOOT = window.__GAME_BOOT__ || {
  mode: "bot",
  matchId: "",
  archetype: "random",
  grade: "medium",
  user: "Player",
  userId: null,
};

const BASE_SIM_SPEED = 2;
const SUMMARY_KEYS = ["attack", "defense", "mobility"];

const canvas = document.getElementById("arena");
const bowlLiveCanvas = document.getElementById("bowl-live");
const deployBtn = document.getElementById("deploy-btn");
const postMatchBtn = document.getElementById("post-match-btn");
const banner = document.getElementById("banner");
const roundLabel = document.getElementById("round-label");
const scoreLabel = document.getElementById("score-label");

const botArchetypeSelect = document.getElementById("arena-bot-archetype");
const botGradeSelect = document.getElementById("arena-bot-grade");
const botRerollBtn = document.getElementById("bot-reroll-btn");

const pickerRoots = [
  document.getElementById("picker-p1"),
  document.getElementById("picker-p2"),
];
const summaryRoots = [
  document.getElementById("summary-p1"),
  document.getElementById("summary-p2"),
];

const renderer = createRenderer(canvas);
const bowlProfile = bowlLiveCanvas ? createBowlProfileRenderer(bowlLiveCanvas) : null;

const socket = io();

/** @type {any} */
let roomState = null;
let prevStateName = null;
/** @type {({ slot: string, partId: string } | null)[]} */
const hoveredPreview = [null, null];
/** @type {Array<{ sync: () => void, setEnabled: (enabled: boolean) => void } | null>} */
const partPickers = [null, null];

function renderAll(opts) {
  const tops = roomState?.tops || [];
  renderer.draw(tops, opts);
  bowlProfile?.draw(tops);
}

function showBanner(text) {
  banner.hidden = false;
  banner.textContent = text;
}

function hideBanner() {
  banner.hidden = true;
  banner.textContent = "";
}

function setDeltaEl(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!delta) {
    el.textContent = "";
    el.classList.remove("is-pos", "is-neg");
    return;
  }
  el.textContent = delta > 0 ? `+${delta}` : String(delta);
  el.classList.toggle("is-pos", delta > 0);
  el.classList.toggle("is-neg", delta < 0);
}

function updateStatHUD() {
  if (!roomState) return;
  for (let p = 0; p < 2; p++) {
    const prefix = p === 0 ? "p1" : "p2";
    const player = roomState.players[p];
    const loadout = player?.loadout;

    if (!loadout) {
      document.getElementById(`stat-${prefix}-power`).textContent = "?";
      setDeltaEl(`delta-${prefix}-power`, 0);
      for (const key of SUMMARY_KEYS) {
        document.getElementById(`stat-${prefix}-${key}`).textContent = "?";
        setDeltaEl(`delta-${prefix}-${key}`, 0);
      }
      for (const key of STAT_KEYS) {
        document.getElementById(`stat-${prefix}-${key}`).textContent = "?";
        setDeltaEl(`delta-${prefix}-${key}`, 0);
      }
      continue;
    }

    const s = deriveStats(loadout);
    const hover = hoveredPreview[p];
    const preview =
      hover && CATALOG[hover.slot]
        ? deriveStats({ ...loadout, [hover.slot]: hover.partId })
        : null;

    const curPower = s.attack + s.defense + s.mobility;
    const prevPower = preview ? preview.attack + preview.defense + preview.mobility : curPower;
    document.getElementById(`stat-${prefix}-power`).textContent = String(curPower);
    setDeltaEl(`delta-${prefix}-power`, preview ? prevPower - curPower : 0);

    for (const key of SUMMARY_KEYS) {
      document.getElementById(`stat-${prefix}-${key}`).textContent = String(s[key]);
      setDeltaEl(`delta-${prefix}-${key}`, preview ? preview[key] - s[key] : 0);
    }
    for (const key of STAT_KEYS) {
      document.getElementById(`stat-${prefix}-${key}`).textContent = String(s[key]);
      setDeltaEl(`delta-${prefix}-${key}`, preview ? preview[key] - s[key] : 0);
    }
  }
}

function updateSpinHUD() {
  if (!roomState) return;
  for (let p = 0; p < 2; p++) {
    const el = document.getElementById(p === 0 ? "spin-p1" : "spin-p2");
    const top = roomState.tops?.[p];
    const loadout = roomState.players?.[p]?.loadout;
    const maxSpin = top?.maxSpin ?? (loadout ? deriveStats(loadout).maxSpin : 100);
    const spin = top?.spin ?? maxSpin;
    const pct = Math.max(0, Math.min(100, (spin / Math.max(1, maxSpin)) * 100));
    el.style.width = `${pct}%`;
  }
}

function updateMatchMeta() {
  if (!roomState) return;
  const suffix = roomState.targetWins ? ` · First to ${roomState.targetWins}` : "";
  roundLabel.textContent = `Round ${roomState.round}${suffix}`;
  scoreLabel.textContent = `${roomState.wins[0]} — ${roomState.wins[1]}`;
}

function renderReadOnlySummary(slot, player) {
  const container = summaryRoots[slot];
  if (!container) return;

  if (!player?.loadout) {
    container.innerHTML = `
      <div class="loadout-hidden">
        <p>${player?.locked ? "Build locked in." : "Choosing parts…"}</p>
        <span>Opponent's build reveals once both players lock in.</span>
      </div>
    `;
    return;
  }

  const rows = SLOT_KEYS.map((slotKey) => {
    const part = getPartById(player.loadout[slotKey]) ?? CATALOG[slotKey][0];
    return `
      <div class="loadout-summary-row" data-cat="${part.category}" data-grade="${part.grade}">
        <span class="loadout-summary-icon">${renderPartIconSvg(part, { showPips: false })}</span>
        <div class="loadout-summary-info">
          <span class="loadout-summary-slot">${SLOT_META[slotKey].label}</span>
          <strong class="loadout-summary-name">${part.name}</strong>
          <span class="loadout-summary-meta">${part.focusLabel} · ${part.gradeLabel}</span>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = rows;
}

function ensurePicker(slot) {
  if (partPickers[slot]) return partPickers[slot];
  const rootEl = pickerRoots[slot];
  if (!rootEl) return null;

  partPickers[slot] = createPartPicker(rootEl, {
    player: slot,
    getLoadout: () => roomState?.players?.[slot]?.loadout || { ...STARTER_LOADOUT },
    getOwnedParts: () => roomState?.ownedParts || {},
    onHover: (playerIdx, partSlot, partId) => {
      hoveredPreview[playerIdx] = partSlot && partId ? { slot: partSlot, partId } : null;
      updateStatHUD();
    },
    onEquip: (playerIdx, partSlot, partId) => {
      if (!roomState || playerIdx !== roomState.yourSlot) return;
      if ((roomState.ownedParts?.[partId] || 0) <= 0) return;
      if (roomState.mode === "bot") {
        if (roomState.state !== "idle") return;
        socket.emit("bot:setPart", { slot: partSlot, partId });
      } else if (roomState.mode === "pvp") {
        if (roomState.state !== "loadout") return;
        if (roomState.players[playerIdx]?.locked) return;
        socket.emit("pvp:setPart", {
          matchId: roomState.matchId,
          slot: partSlot,
          partId,
        });
      }
    },
  });

  return partPickers[slot];
}

function syncPanels() {
  if (!roomState) return;
  const { yourSlot, mode, state, players } = roomState;

  for (let p = 0; p < 2; p++) {
    const prefix = p === 0 ? "p1" : "p2";
    const player = players[p];
    const isYou = p === yourSlot;

    const nameEl = document.getElementById(`name-${prefix}`);
    const statusEl = document.getElementById(`status-${prefix}`);
    const spinTagEl = document.getElementById(`spin-tag-${prefix}`);
    const panelEl = document.getElementById(`panel-${prefix}`);

    if (nameEl) {
      nameEl.textContent = isYou ? `${player.username} (You)` : player.username;
    }
    if (spinTagEl) {
      spinTagEl.textContent = `${player.username.slice(0, 10)} Spin`;
    }
    if (panelEl) {
      panelEl.classList.toggle("is-local-player", isYou);
    }

    if (statusEl) {
      let statusText = "";
      let statusClass = "";
      if (mode === "pvp") {
        if (!player.connected && state !== "matchOver") {
          statusText = "Disconnected…";
          statusClass = "is-warn";
        } else if (state === "loadout") {
          statusText = player.locked ? "Locked In" : "Selecting…";
          statusClass = player.locked ? "is-ready" : "";
        } else {
          statusText = "Build Locked";
          statusClass = "is-ready";
        }
      } else {
        statusText = p === 0 ? "Training" : "Auto-built";
      }
      statusEl.textContent = statusText;
      statusEl.className = `panel-status ${statusClass}`.trim();
    }

    const canEdit =
      isYou &&
      ((mode === "bot" && state === "idle") ||
        (mode === "pvp" && state === "loadout" && !player.locked));

    const showInteractivePicker =
      isYou && (mode === "bot" || state === "loadout");

    if (showInteractivePicker) {
      if (pickerRoots[p]) pickerRoots[p].hidden = false;
      if (summaryRoots[p]) summaryRoots[p].hidden = true;
      const picker = ensurePicker(p);
      picker?.sync();
      picker?.setEnabled(canEdit);
    } else {
      if (pickerRoots[p]) pickerRoots[p].hidden = true;
      if (summaryRoots[p]) summaryRoots[p].hidden = false;
      renderReadOnlySummary(p, player);
    }
  }

  if (mode === "bot" && roomState.botConfig) {
    const botEditable = state === "idle";
    if (botArchetypeSelect) {
      botArchetypeSelect.value = roomState.botConfig.archetype;
      botArchetypeSelect.disabled = !botEditable;
    }
    if (botGradeSelect) {
      botGradeSelect.value = roomState.botConfig.grade;
      botGradeSelect.disabled = !botEditable;
    }
    if (botRerollBtn) {
      botRerollBtn.disabled = !botEditable;
    }
  }
}

function syncControls() {
  if (!roomState) return;
  const { mode, state, yourSlot, players, winnerSlot, wins, endedReason } = roomState;
  const me = players[yourSlot];

  if (mode === "bot") {
    postMatchBtn.hidden = true;
    deployBtn.hidden = false;
    if (state === "idle") {
      deployBtn.disabled = false;
      deployBtn.textContent = "Deploy";
    } else {
      deployBtn.disabled = true;
      deployBtn.textContent = "Battling…";
    }
    return;
  }

  // PvP mode
  if (state === "loadout") {
    postMatchBtn.hidden = true;
    deployBtn.hidden = false;
    if (me?.locked) {
      deployBtn.disabled = true;
      deployBtn.textContent = "Locked In — Waiting…";
      showBanner("Build locked! Waiting for opponent to lock in…");
    } else {
      deployBtn.disabled = false;
      deployBtn.textContent = "Lock In Build";
      showBanner("Choose your parts for the Best of 11, then Lock In");
    }
  } else if (state === "fighting") {
    postMatchBtn.hidden = true;
    deployBtn.hidden = false;
    deployBtn.disabled = true;
    deployBtn.textContent = `Round ${roomState.round} · First to ${roomState.targetWins}`;
  } else if (state === "roundOver") {
    postMatchBtn.hidden = true;
    deployBtn.hidden = false;
    deployBtn.disabled = true;
    deployBtn.textContent = "Next Round…";
  } else if (state === "matchOver") {
    deployBtn.hidden = true;
    postMatchBtn.hidden = false;
    const winnerName = winnerSlot != null ? players[winnerSlot]?.username : "Match Over";
    const forfeitTag = endedReason === "forfeit" ? " (Forfeit)" : "";
    showBanner(`${winnerName} wins ${wins[0]} — ${wins[1]}${forfeitTag}`);
  }
}

// --- Socket.IO Event Handlers ---
socket.on("connect", () => {
  if (BOOT.mode === "pvp") {
    socket.emit("pvp:join", { matchId: BOOT.matchId });
  } else {
    socket.emit("bot:join", {
      archetype: BOOT.archetype,
      grade: BOOT.grade,
    });
  }
});

socket.on("auth:required", () => {
  window.location.href = "/login";
});

socket.on("game:error", ({ message }) => {
  stopBattleAudio();
  showBanner(message || "Connection error");
  deployBtn.hidden = true;
  postMatchBtn.hidden = false;
});

socket.on("game:state", (nextState) => {
  const wasFighting = prevStateName === "fighting";
  roomState = nextState;
  prevStateName = nextState.state;

  if (nextState.state === "fighting" && !wasFighting) {
    hideBanner();
    renderer.clearTrails();
    void startBattleAudio();
  } else if (nextState.state !== "fighting" && wasFighting) {
    stopBattleAudio();
  }

  if (nextState.mode === "bot" && nextState.state === "idle") {
    if (nextState.round === 1) {
      showBanner("Swap parts or re-roll the bot, then Deploy");
    } else {
      hideBanner();
    }
  }

  syncPanels();
  syncControls();
  updateStatHUD();
  updateMatchMeta();
  updateSpinHUD();
  renderAll({ fighting: nextState.state === "fighting" });
});

socket.on("game:tick", ({ tops, collision, round, wins, state }) => {
  if (!roomState) return;
  roomState.tops = tops;
  roomState.round = round;
  roomState.wins = wins;
  roomState.state = state;

  if (collision > 0) {
    playCollisionSound(collision);
  }

  updateSpinHUD();
  updateBattleAudio(tops, BASE_SIM_SPEED);
  renderAll({ fighting: true });
});

socket.on("game:roundEnd", ({ winnerName, reason, round, wins }) => {
  if (!roomState) return;
  roomState.state = "roundOver";
  roomState.round = round;
  roomState.wins = wins;
  prevStateName = "roundOver";

  stopBattleAudio();
  updateMatchMeta();
  updateSpinHUD();
  syncControls();
  showBanner(`${winnerName} wins Round ${round} — ${reason}`);
  renderAll({ fighting: false });
});

socket.on("game:matchEnd", ({ winnerSlot, winnerName, wins, endedReason }) => {
  if (!roomState) return;
  roomState.state = "matchOver";
  roomState.winnerSlot = winnerSlot;
  roomState.wins = wins;
  roomState.endedReason = endedReason;
  prevStateName = "matchOver";

  stopBattleAudio();
  updateMatchMeta();
  syncControls();
  const forfeitTag = endedReason === "forfeit" ? " (Opponent disconnected)" : "";
  showBanner(`${winnerName} wins the match ${wins[0]} — ${wins[1]}!${forfeitTag}`);
  renderAll({ fighting: false });
});

// --- UI Event Listeners ---
deployBtn?.addEventListener("click", () => {
  if (!roomState) return;
  if (roomState.mode === "bot" && roomState.state === "idle") {
    socket.emit("bot:deploy");
  } else if (roomState.mode === "pvp" && roomState.state === "loadout") {
    socket.emit("pvp:lockIn", { matchId: roomState.matchId });
  }
});

botArchetypeSelect?.addEventListener("change", () => {
  if (!roomState || roomState.mode !== "bot") return;
  socket.emit("bot:configure", {
    archetype: botArchetypeSelect.value,
    grade: botGradeSelect?.value,
  });
});

botGradeSelect?.addEventListener("change", () => {
  if (!roomState || roomState.mode !== "bot") return;
  socket.emit("bot:configure", {
    archetype: botArchetypeSelect?.value,
    grade: botGradeSelect.value,
  });
});

botRerollBtn?.addEventListener("click", () => {
  if (!roomState || roomState.mode !== "bot") return;
  socket.emit("bot:reroll");
});
