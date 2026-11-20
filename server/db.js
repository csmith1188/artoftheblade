const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const sqlite3 = require('sqlite3').verbose();

const dbFile = process.env.DATABASE_FILE || './db/database.db';
const dbDir = path.dirname(dbFile);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to database:', dbFile);
  }
});

const CHEST_GRADE_WEIGHTS = [
  { grade: 'low', weight: 72 },
  { grade: 'medium', weight: 22 },
  { grade: 'high', weight: 6 },
];

const STARTER_PART_IDS = [
  'layer-balanced-balanced-low',
  'disk-balanced-balanced-low',
  'driver-balanced-balanced-low',
];

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function loadPartsModule() {
  const partsPath = path.join(__dirname, '..', 'public', 'js', 'shared', 'parts.js');
  return import(pathToFileURL(partsPath).href);
}

async function seedItems() {
  const { ALL_PARTS } = await loadPartsModule();
  await exec('BEGIN TRANSACTION');
  try {
    for (const part of ALL_PARTS) {
      await run(
        `INSERT OR REPLACE INTO items (
          id, name, slot, category, focus, focus_label, grade, grade_order,
          burst, edge, max_spin, armor, stability, mass, launch, grip, bank
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          part.id,
          part.name,
          part.slot,
          part.category,
          part.focus,
          part.focusLabel,
          part.grade,
          part.gradeOrder,
          part.burst,
          part.edge,
          part.maxSpin,
          part.armor,
          part.stability,
          part.mass,
          part.launch,
          part.grip,
          part.bank,
        ]
      );
    }
    await exec('COMMIT');
  } catch (err) {
    await exec('ROLLBACK');
    throw err;
  }
}

async function ensureStarterInventory(userId) {
  for (const itemId of STARTER_PART_IDS) {
    await run(
      `INSERT OR IGNORE INTO user_inventory (user_id, item_id, quantity)
       VALUES (?, ?, 1)`,
      [userId, itemId]
    );
  }
}

async function initSchema() {
  const schemaPath = path.join(__dirname, '..', 'db', 'init.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  await exec(sql);

  // Safely migrate existing databases that predate the chests column
  const userCols = await all('PRAGMA table_info(users)');
  const hasChests = userCols.some((c) => c.name === 'chests');
  if (!hasChests) {
    await run('ALTER TABLE users ADD COLUMN chests INTEGER NOT NULL DEFAULT 3');
  }

  await seedItems();

  // Backfill starter inventory for any existing users
  const existingUsers = await all('SELECT id FROM users');
  for (const u of existingUsers) {
    await ensureStarterInventory(u.id);
  }
}

async function upsertUser({ username, formbarId = null }) {
  const cleanName = String(username || '').trim().slice(0, 64);
  if (!cleanName) {
    throw new Error('Username is required');
  }

  let existing = null;
  if (formbarId != null) {
    existing = await get('SELECT * FROM users WHERE formbar_id = ?', [formbarId]);
  }
  if (!existing) {
    existing = await get('SELECT * FROM users WHERE username = ?', [cleanName]);
  }

  if (existing) {
    let record = existing;
    if (existing.username !== cleanName || (formbarId != null && existing.formbar_id !== formbarId)) {
      await run(
        'UPDATE users SET username = ?, formbar_id = COALESCE(?, formbar_id) WHERE id = ?',
        [cleanName, formbarId, existing.id]
      );
      record = await get('SELECT * FROM users WHERE id = ?', [existing.id]);
    }
    await ensureStarterInventory(record.id);
    return record;
  }

  const res = await run(
    'INSERT INTO users (formbar_id, username) VALUES (?, ?)',
    [formbarId, cleanName]
  );
  await ensureStarterInventory(res.lastID);
  return get('SELECT * FROM users WHERE id = ?', [res.lastID]);
}

async function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

async function getUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

async function getUserInventoryMap(userId) {
  const rows = await all(
    'SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND quantity > 0',
    [userId]
  );
  /** @type {Record<string, number>} */
  const map = {};
  for (const row of rows) {
    map[row.item_id] = row.quantity;
  }
  return map;
}

async function getUserInventoryItems(userId) {
  return all(
    `SELECT ui.item_id, ui.quantity, ui.acquired_at, i.*
     FROM user_inventory ui
     JOIN items i ON i.id = ui.item_id
     WHERE ui.user_id = ? AND ui.quantity > 0
     ORDER BY i.slot ASC, i.grade_order DESC, i.name ASC`,
    [userId]
  );
}

async function userOwnsPart(userId, itemId) {
  if (!userId || !itemId) return false;
  const row = await get(
    'SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  return Boolean(row && row.quantity > 0);
}

async function addItemToInventory(userId, itemId, amount = 1) {
  await run(
    `INSERT INTO user_inventory (user_id, item_id, quantity)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, item_id)
     DO UPDATE SET quantity = quantity + excluded.quantity`,
    [userId, itemId, amount]
  );
  const row = await get(
    'SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  return row ? row.quantity : amount;
}

function rollChestGrade() {
  const total = CHEST_GRADE_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let r = Math.random() * total;
  for (const entry of CHEST_GRADE_WEIGHTS) {
    r -= entry.weight;
    if (r < 0) return entry.grade;
  }
  return 'low';
}

async function openChest(userId) {
  const dec = await run(
    'UPDATE users SET chests = chests - 1 WHERE id = ? AND chests > 0',
    [userId]
  );
  if (dec.changes === 0) {
    return { ok: false, error: 'No chests available to open.' };
  }

  const grade = rollChestGrade();
  const candidates = await all('SELECT * FROM items WHERE grade = ?', [grade]);
  if (!candidates.length) {
    // Refund chest if catalog unexpectedly empty
    await run('UPDATE users SET chests = chests + 1 WHERE id = ?', [userId]);
    throw new Error(`No items found in catalog for grade "${grade}"`);
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const existing = await get(
    'SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?',
    [userId, picked.id]
  );
  const isDuplicate = Boolean(existing && existing.quantity > 0);
  const quantity = await addItemToInventory(userId, picked.id, 1);
  const user = await get('SELECT chests FROM users WHERE id = ?', [userId]);

  return {
    ok: true,
    item: picked,
    quantity,
    isDuplicate,
    chestsRemaining: user ? user.chests : 0,
  };
}

async function getRecentMatches(userId, limit = 20) {
  return all(
    `SELECT * FROM matches
     WHERE p1_user_id = ? OR p2_user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [userId, userId, limit]
  );
}

async function recordPvpMatch({
  p1UserId,
  p2UserId,
  p1Username,
  p2Username,
  p1Score,
  p2Score,
  winnerUserId,
  p1Loadout,
  p2Loadout,
  endedReason = 'completed',
}) {
  await run(
    `INSERT INTO matches (
      p1_user_id, p2_user_id, p1_username, p2_username,
      p1_score, p2_score, winner_user_id,
      p1_loadout_json, p2_loadout_json, ended_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p1UserId,
      p2UserId,
      p1Username,
      p2Username,
      p1Score,
      p2Score,
      winnerUserId,
      JSON.stringify(p1Loadout || {}),
      JSON.stringify(p2Loadout || {}),
      endedReason,
    ]
  );

  if (winnerUserId != null) {
    const loserUserId = winnerUserId === p1UserId ? p2UserId : p1UserId;
    await run(
      'UPDATE users SET wins = wins + 1, chests = chests + 1 WHERE id = ?',
      [winnerUserId]
    );
    if (loserUserId != null && loserUserId !== winnerUserId) {
      await run('UPDATE users SET losses = losses + 1 WHERE id = ?', [loserUserId]);
    }
  }
}

async function recordBotRound(userId, playerWon) {
  if (!userId) return;
  if (playerWon) {
    await run(
      'UPDATE users SET bot_wins = bot_wins + 1, chests = chests + 1 WHERE id = ?',
      [userId]
    );
  } else {
    await run('UPDATE users SET bot_losses = bot_losses + 1 WHERE id = ?', [userId]);
  }
}

module.exports = {
  db,
  CHEST_GRADE_WEIGHTS,
  STARTER_PART_IDS,
  initSchema,
  seedItems,
  ensureStarterInventory,
  upsertUser,
  getUserById,
  getUserByUsername,
  getUserInventoryMap,
  getUserInventoryItems,
  userOwnsPart,
  addItemToInventory,
  openChest,
  getRecentMatches,
  recordPvpMatch,
  recordBotRound,
};
