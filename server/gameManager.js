const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const { buildBotLoadout } = require('./botBuilder');

const BASE_SIM_SPEED = 2;
const TICK_MS = 1000 / 30;
const ROUND_FREEZE_MS = 1700;
const DISCONNECT_GRACE_MS = 15000;
const PVP_TARGET_WINS = 6;

async function loadSharedModules() {
  const sharedDir = path.join(__dirname, '..', 'public', 'js', 'shared');
  const partsMod = await import(pathToFileURL(path.join(sharedDir, 'parts.js')).href);
  const physicsMod = await import(pathToFileURL(path.join(sharedDir, 'physics.js')).href);
  return { partsMod, physicsMod };
}

function serializeTop(top) {
  return {
    r: top.r,
    theta: top.theta,
    vr: top.vr,
    vt: top.vt,
    spin: top.spin,
    maxSpin: top.maxSpin,
    angle: top.angle,
    alive: top.alive,
    attack: top.attack,
    defense: top.defense,
    mobility: top.mobility,
    burst: top.burst,
    edge: top.edge,
    armor: top.armor,
    stability: top.stability,
    mass: top.mass,
    launch: top.launch,
    grip: top.grip,
    bank: top.bank,
  };
}

function buildIdleTops(partsMod, physicsMod, loadouts) {
  return [0, 1].map((i) => {
    const stats = partsMod.deriveStats(loadouts[i]);
    const pose = physicsMod.deployPose(i, stats);
    pose.vr = 0;
    pose.vt = 0;
    pose.spin = stats.maxSpin;
    pose.r = 160;
    return physicsMod.createTop(stats, pose);
  });
}

function buildFightingTops(partsMod, physicsMod, loadouts) {
  return [0, 1].map((i) => {
    const stats = partsMod.deriveStats(loadouts[i]);
    return physicsMod.createTop(stats, physicsMod.deployPose(i, stats));
  });
}

function isValidPart(partsMod, slot, partId) {
  const list = partsMod.CATALOG[slot];
  if (!list) return false;
  return list.some((p) => p.id === partId);
}

async function attachGameServer(io, dbHelpers) {
  const { partsMod, physicsMod } = await loadSharedModules();

  /** @type {Map<number, Set<string>>} */
  const onlineUsers = new Map();
  /** @type {Array<{ socketId: string, userId: number, username: string, joinedAt: number }>} */
  const pvpQueue = [];
  /** @type {Map<string, any>} */
  const pvpMatches = new Map();
  /** @type {Map<string, any>} */
  const botRooms = new Map();

  function broadcastLobbyStats() {
    io.to('lobby').emit('lobby:stats', {
      onlineCount: onlineUsers.size,
      queueCount: pvpQueue.length,
    });
  }

  function removeFromQueue(socketId) {
    const idx = pvpQueue.findIndex((q) => q.socketId === socketId);
    if (idx !== -1) {
      pvpQueue.splice(idx, 1);
      broadcastLobbyStats();
      return true;
    }
    return false;
  }

  function clearRoomTimers(room) {
    if (room.simTimer) {
      clearInterval(room.simTimer);
      room.simTimer = null;
    }
    if (room.freezeTimer) {
      clearTimeout(room.freezeTimer);
      room.freezeTimer = null;
    }
  }

  function buildPvpStateForSlot(match, viewerSlot) {
    const revealAll = match.state !== 'loadout';
    const players = match.players.map((p, idx) => ({
      slot: idx,
      userId: p.userId,
      username: p.username,
      locked: p.locked,
      connected: p.connected,
      loadout: revealAll || idx === viewerSlot ? { ...p.loadout } : null,
    }));

    return {
      mode: 'pvp',
      matchId: match.id,
      yourSlot: viewerSlot,
      targetWins: match.targetWins,
      state: match.state,
      round: match.round,
      wins: [...match.wins],
      players,
      ownedParts: { ...(match.players[viewerSlot]?.ownedParts || {}) },
      tops: match.tops.map(serializeTop),
      winnerSlot: match.winnerSlot,
      endedReason: match.endedReason,
    };
  }

  function emitPvpState(match) {
    for (let slot = 0; slot < 2; slot++) {
      const player = match.players[slot];
      if (player.socketId) {
        io.to(player.socketId).emit('game:state', buildPvpStateForSlot(match, slot));
      }
    }
  }

  function buildBotState(room) {
    return {
      mode: 'bot',
      yourSlot: 0,
      targetWins: null,
      state: room.state,
      round: room.round,
      wins: [...room.wins],
      botConfig: { ...room.botConfig },
      ownedParts: { ...(room.ownedParts || {}) },
      players: [
        {
          slot: 0,
          userId: room.userId,
          username: room.username,
          locked: room.state !== 'idle',
          connected: true,
          loadout: { ...room.loadouts[0] },
        },
        {
          slot: 1,
          userId: null,
          username: room.botName,
          locked: true,
          connected: true,
          loadout: { ...room.loadouts[1] },
        },
      ],
      tops: room.tops.map(serializeTop),
      winnerSlot: null,
      endedReason: null,
    };
  }

  function emitBotState(room) {
    io.to(room.socketId).emit('game:state', buildBotState(room));
  }

  function startSimulationLoop(room, onTick, onRoundEnd) {
    clearRoomTimers(room);
    room.state = 'fighting';
    const loadouts =
      room.mode === 'pvp'
        ? [room.players[0].loadout, room.players[1].loadout]
        : room.loadouts;
    room.tops = buildFightingTops(partsMod, physicsMod, loadouts);

    onTick(0);

    room.simTimer = setInterval(() => {
      if (room.state !== 'fighting') {
        clearRoomTimers(room);
        return;
      }

      const scaledDt = (TICK_MS / 1000) * BASE_SIM_SPEED;
      const subSteps = Math.max(1, Math.ceil(scaledDt / 0.02));
      const stepDt = scaledDt / subSteps;

      let winner = null;
      let reason = null;
      let maxCollision = 0;

      for (let i = 0; i < subSteps; i++) {
        const res = physicsMod.stepPhysics(room.tops, stepDt);
        if (res.collision > maxCollision) {
          maxCollision = res.collision;
        }
        if (res.winner !== null) {
          winner = res.winner;
          reason = res.reason;
          break;
        }
      }

      onTick(maxCollision);

      if (winner !== null) {
        clearInterval(room.simTimer);
        room.simTimer = null;
        onRoundEnd(winner, reason);
      }
    }, TICK_MS);
  }

  function startPvpRound(match) {
    if (match.state === 'matchOver') return;

    startSimulationLoop(
      match,
      (collision) => {
        io.to(`pvp:${match.id}`).emit('game:tick', {
          tops: match.tops.map(serializeTop),
          collision,
          round: match.round,
          wins: [...match.wins],
          state: match.state,
        });
      },
      (winner, reason) => {
        match.state = 'roundOver';
        match.wins[winner] += 1;

        io.to(`pvp:${match.id}`).emit('game:roundEnd', {
          winner,
          winnerName: match.players[winner].username,
          reason,
          round: match.round,
          wins: [...match.wins],
          targetWins: match.targetWins,
        });

        if (match.wins[winner] >= match.targetWins) {
          finishPvpMatch(match, winner, 'completed');
          return;
        }

        match.freezeTimer = setTimeout(() => {
          match.freezeTimer = null;
          if (match.state !== 'roundOver') return;
          match.round += 1;
          startPvpRound(match);
        }, ROUND_FREEZE_MS);
      }
    );

    emitPvpState(match);
  }

  async function finishPvpMatch(match, winnerSlot, endedReason) {
    if (match.state === 'matchOver') return;
    clearRoomTimers(match);
    for (const p of match.players) {
      if (p.disconnectTimer) {
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = null;
      }
    }

    match.state = 'matchOver';
    match.winnerSlot = winnerSlot;
    match.endedReason = endedReason;

    const p1 = match.players[0];
    const p2 = match.players[1];
    const winnerUserId = winnerSlot != null ? match.players[winnerSlot].userId : null;

    try {
      await dbHelpers.recordPvpMatch({
        p1UserId: p1.userId,
        p2UserId: p2.userId,
        p1Username: p1.username,
        p2Username: p2.username,
        p1Score: match.wins[0],
        p2Score: match.wins[1],
        winnerUserId,
        p1Loadout: p1.loadout,
        p2Loadout: p2.loadout,
        endedReason,
      });
    } catch (err) {
      console.error('Failed to persist PvP match:', err);
    }

    emitPvpState(match);
    io.to(`pvp:${match.id}`).emit('game:matchEnd', {
      winnerSlot,
      winnerName: winnerSlot != null ? match.players[winnerSlot].username : null,
      wins: [...match.wins],
      endedReason,
    });

    setTimeout(() => {
      pvpMatches.delete(match.id);
    }, 120000);
  }

  function tryPairQueue() {
    while (pvpQueue.length >= 2) {
      const p1Entry = pvpQueue.shift();
      const p2Idx = pvpQueue.findIndex((q) => q.userId !== p1Entry.userId);
      if (p2Idx === -1) {
        pvpQueue.unshift(p1Entry);
        break;
      }
      const [p2Entry] = pvpQueue.splice(p2Idx, 1);

      const matchId = crypto.randomUUID();
      const defaults = [partsMod.starterLoadout(), partsMod.starterLoadout()];
      const match = {
        id: matchId,
        mode: 'pvp',
        targetWins: PVP_TARGET_WINS,
        state: 'loadout',
        round: 1,
        wins: [0, 0],
        players: [
          {
            userId: p1Entry.userId,
            username: p1Entry.username,
            socketId: null,
            loadout: { ...defaults[0] },
            ownedParts: {},
            locked: false,
            connected: false,
            disconnectTimer: null,
          },
          {
            userId: p2Entry.userId,
            username: p2Entry.username,
            socketId: null,
            loadout: { ...defaults[1] },
            ownedParts: {},
            locked: false,
            connected: false,
            disconnectTimer: null,
          },
        ],
        tops: buildIdleTops(partsMod, physicsMod, defaults),
        simTimer: null,
        freezeTimer: null,
        winnerSlot: null,
        endedReason: null,
        createdAt: Date.now(),
      };

      pvpMatches.set(matchId, match);

      io.to(p1Entry.socketId).emit('queue:matched', {
        matchId,
        opponent: p2Entry.username,
      });
      io.to(p2Entry.socketId).emit('queue:matched', {
        matchId,
        opponent: p1Entry.username,
      });

      broadcastLobbyStats();
    }
  }

  io.on('connection', (socket) => {
    const sess = socket.request.session;
    if (!sess || !sess.user || !sess.userId) {
      socket.emit('auth:required');
      socket.disconnect(true);
      return;
    }

    const userId = sess.userId;
    const username = sess.user;

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // --- Lobby & Matchmaking ---
    socket.on('lobby:join', () => {
      socket.join('lobby');
      socket.emit('lobby:stats', {
        onlineCount: onlineUsers.size,
        queueCount: pvpQueue.length,
      });
      const inQueue = pvpQueue.some((q) => q.userId === userId);
      socket.emit('queue:status', { searching: inQueue });
      broadcastLobbyStats();
    });

    socket.on('queue:join', () => {
      const existingIdx = pvpQueue.findIndex((q) => q.userId === userId);
      if (existingIdx !== -1) {
        pvpQueue[existingIdx].socketId = socket.id;
      } else {
        pvpQueue.push({
          socketId: socket.id,
          userId,
          username,
          joinedAt: Date.now(),
        });
      }
      socket.emit('queue:status', { searching: true });
      broadcastLobbyStats();
      tryPairQueue();
    });

    socket.on('queue:leave', () => {
      removeFromQueue(socket.id);
      socket.emit('queue:status', { searching: false });
    });

    // --- Bot Training Mode ---
    socket.on('bot:join', async ({ archetype = 'random', grade = 'medium' } = {}) => {
      try {
        await dbHelpers.ensureStarterInventory(userId);
        const ownedParts = await dbHelpers.getUserInventoryMap(userId);
        const built = buildBotLoadout(partsMod, { archetype, grade });
        const loadouts = [partsMod.starterLoadout(), built.loadout];
        const room = {
          socketId: socket.id,
          userId,
          username,
          mode: 'bot',
          state: 'idle',
          round: 1,
          wins: [0, 0],
          botConfig: built.config,
          botName: built.botName,
          ownedParts,
          loadouts,
          tops: buildIdleTops(partsMod, physicsMod, loadouts),
          simTimer: null,
          freezeTimer: null,
        };
        botRooms.set(socket.id, room);
        emitBotState(room);
      } catch (err) {
        console.error('Error joining bot room:', err);
        socket.emit('game:error', { message: 'Failed to load your inventory.' });
      }
    });

    socket.on('bot:setPart', async ({ slot, partId } = {}) => {
      const room = botRooms.get(socket.id);
      if (!room || room.state !== 'idle') return;
      if (!isValidPart(partsMod, slot, partId)) return;
      const owns = await dbHelpers.userOwnsPart(userId, partId);
      if (!owns) return;
      room.loadouts[0][slot] = partId;
      room.tops = buildIdleTops(partsMod, physicsMod, room.loadouts);
      emitBotState(room);
    });

    socket.on('bot:configure', ({ archetype, grade } = {}) => {
      const room = botRooms.get(socket.id);
      if (!room || room.state !== 'idle') return;
      const built = buildBotLoadout(partsMod, {
        archetype: archetype ?? room.botConfig.archetype,
        grade: grade ?? room.botConfig.grade,
      });
      room.botConfig = built.config;
      room.botName = built.botName;
      room.loadouts[1] = built.loadout;
      room.tops = buildIdleTops(partsMod, physicsMod, room.loadouts);
      emitBotState(room);
    });

    socket.on('bot:reroll', () => {
      const room = botRooms.get(socket.id);
      if (!room || room.state !== 'idle') return;
      const built = buildBotLoadout(partsMod, room.botConfig);
      room.botName = built.botName;
      room.loadouts[1] = built.loadout;
      room.tops = buildIdleTops(partsMod, physicsMod, room.loadouts);
      emitBotState(room);
    });

    socket.on('bot:deploy', () => {
      const room = botRooms.get(socket.id);
      if (!room || room.state !== 'idle') return;

      startSimulationLoop(
        room,
        (collision) => {
          io.to(room.socketId).emit('game:tick', {
            tops: room.tops.map(serializeTop),
            collision,
            round: room.round,
            wins: [...room.wins],
            state: room.state,
          });
        },
        (winner, reason) => {
          room.state = 'roundOver';
          room.wins[winner] += 1;

          dbHelpers.recordBotRound(room.userId, winner === 0).catch((err) => {
            console.error('Failed to record bot round:', err);
          });

          io.to(room.socketId).emit('game:roundEnd', {
            winner,
            winnerName: winner === 0 ? room.username : room.botName,
            reason,
            round: room.round,
            wins: [...room.wins],
            targetWins: null,
          });

          room.freezeTimer = setTimeout(() => {
            room.freezeTimer = null;
            if (!botRooms.has(socket.id)) return;
            room.state = 'idle';
            room.round += 1;
            room.tops = buildIdleTops(partsMod, physicsMod, room.loadouts);
            emitBotState(room);
          }, ROUND_FREEZE_MS);
        }
      );

      emitBotState(room);
    });

    // --- PvP Best-of-11 Mode ---
    socket.on('pvp:join', async ({ matchId } = {}) => {
      const match = pvpMatches.get(matchId);
      if (!match) {
        socket.emit('game:error', { message: 'Match not found or has already ended.' });
        return;
      }

      const slot = match.players.findIndex((p) => p.userId === userId);
      if (slot === -1) {
        socket.emit('game:error', { message: 'You are not a participant in this match.' });
        return;
      }

      const player = match.players[slot];
      player.socketId = socket.id;
      player.connected = true;
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }

      try {
        await dbHelpers.ensureStarterInventory(userId);
        player.ownedParts = await dbHelpers.getUserInventoryMap(userId);
      } catch (err) {
        console.error('Error loading PvP inventory:', err);
      }

      socket.data.pvpMatchId = matchId;
      socket.data.pvpSlot = slot;
      socket.join(`pvp:${matchId}`);

      emitPvpState(match);
    });

    socket.on('pvp:setPart', async ({ matchId, slot: partSlot, partId } = {}) => {
      const match = pvpMatches.get(matchId || socket.data.pvpMatchId);
      if (!match || match.state !== 'loadout') return;
      const playerSlot = socket.data.pvpSlot;
      if (playerSlot !== 0 && playerSlot !== 1) return;

      const player = match.players[playerSlot];
      if (player.locked) return;
      if (!isValidPart(partsMod, partSlot, partId)) return;
      const owns = await dbHelpers.userOwnsPart(userId, partId);
      if (!owns) return;

      player.loadout[partSlot] = partId;
      match.tops = buildIdleTops(partsMod, physicsMod, [
        match.players[0].loadout,
        match.players[1].loadout,
      ]);

      socket.emit('game:state', buildPvpStateForSlot(match, playerSlot));
    });

    socket.on('pvp:lockIn', ({ matchId } = {}) => {
      const match = pvpMatches.get(matchId || socket.data.pvpMatchId);
      if (!match || match.state !== 'loadout') return;
      const playerSlot = socket.data.pvpSlot;
      if (playerSlot !== 0 && playerSlot !== 1) return;

      const player = match.players[playerSlot];
      if (player.locked) return;

      player.locked = true;

      if (match.players[0].locked && match.players[1].locked) {
        startPvpRound(match);
      } else {
        emitPvpState(match);
      }
    });

    // --- Disconnect cleanup ---
    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
        }
      }

      removeFromQueue(socket.id);
      broadcastLobbyStats();

      const botRoom = botRooms.get(socket.id);
      if (botRoom) {
        clearRoomTimers(botRoom);
        botRooms.delete(socket.id);
      }

      const matchId = socket.data.pvpMatchId;
      const slot = socket.data.pvpSlot;
      if (matchId && (slot === 0 || slot === 1)) {
        const match = pvpMatches.get(matchId);
        if (match && match.state !== 'matchOver') {
          const player = match.players[slot];
          if (player.socketId === socket.id) {
            player.connected = false;
            player.socketId = null;
            emitPvpState(match);

            player.disconnectTimer = setTimeout(() => {
              player.disconnectTimer = null;
              if (match.state === 'matchOver') return;
              if (!player.connected) {
                const winnerSlot = slot === 0 ? 1 : 0;
                finishPvpMatch(match, winnerSlot, 'forfeit');
              }
            }, DISCONNECT_GRACE_MS);
          }
        }
      }
    });
  });
}

module.exports = {
  attachGameServer,
};
