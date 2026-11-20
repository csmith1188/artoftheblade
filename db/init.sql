CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formbar_id INTEGER UNIQUE,
    username VARCHAR(64) UNIQUE NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    bot_wins INTEGER NOT NULL DEFAULT 0,
    bot_losses INTEGER NOT NULL DEFAULT 0,
    chests INTEGER NOT NULL DEFAULT 3,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    slot VARCHAR(16) NOT NULL,
    category VARCHAR(16) NOT NULL,
    focus VARCHAR(16) NOT NULL,
    focus_label VARCHAR(64) NOT NULL,
    grade VARCHAR(16) NOT NULL,
    grade_order INTEGER NOT NULL DEFAULT 0,
    burst INTEGER NOT NULL DEFAULT 0,
    edge INTEGER NOT NULL DEFAULT 0,
    max_spin INTEGER NOT NULL DEFAULT 0,
    armor INTEGER NOT NULL DEFAULT 0,
    stability INTEGER NOT NULL DEFAULT 0,
    mass INTEGER NOT NULL DEFAULT 0,
    launch INTEGER NOT NULL DEFAULT 0,
    grip INTEGER NOT NULL DEFAULT 0,
    bank INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_inventory (
    user_id INTEGER NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_grade ON items(grade);
CREATE INDEX IF NOT EXISTS idx_items_slot ON items(slot);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(user_id);

CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    p1_user_id INTEGER NOT NULL,
    p2_user_id INTEGER NOT NULL,
    p1_username VARCHAR(64) NOT NULL,
    p2_username VARCHAR(64) NOT NULL,
    p1_score INTEGER NOT NULL DEFAULT 0,
    p2_score INTEGER NOT NULL DEFAULT 0,
    winner_user_id INTEGER,
    p1_loadout_json TEXT NOT NULL,
    p2_loadout_json TEXT NOT NULL,
    ended_reason VARCHAR(32) NOT NULL DEFAULT 'completed',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (p1_user_id) REFERENCES users(id),
    FOREIGN KEY (p2_user_id) REFERENCES users(id),
    FOREIGN KEY (winner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_matches_p1 ON matches(p1_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_p2 ON matches(p2_user_id, created_at DESC);
