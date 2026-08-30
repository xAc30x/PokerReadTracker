PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  play_style TEXT NOT NULL DEFAULT 'unknown',
  bluff_level INTEGER NOT NULL DEFAULT 0,
  preflop_tags TEXT NOT NULL DEFAULT '[]',
  postflop_tags TEXT NOT NULL DEFAULT '[]',
  preflop_notes TEXT NOT NULL DEFAULT '',
  postflop_notes TEXT NOT NULL DEFAULT '',
  tells_notes TEXT NOT NULL DEFAULT '',
  showdown_notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS players_owner_idx
  ON players (owner_key);
CREATE INDEX IF NOT EXISTS players_owner_updated_idx
  ON players (owner_key, updated_at);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  street TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  hand_id TEXT NOT NULL DEFAULT '',
  hand_number INTEGER NOT NULL DEFAULT 0,
  seat_no INTEGER,
  position TEXT NOT NULL DEFAULT '',
  sequence INTEGER NOT NULL DEFAULT 0,
  preflop_context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS observations_owner_player_idx
  ON observations (owner_key, player_id);
CREATE INDEX IF NOT EXISTS observations_owner_created_idx
  ON observations (owner_key, created_at);
CREATE INDEX IF NOT EXISTS observations_owner_hand_idx
  ON observations (owner_key, hand_id, sequence);

CREATE TABLE IF NOT EXISTS mobile_pairing_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mobile_pairing_owner_idx
  ON mobile_pairing_codes (owner_key);
CREATE INDEX IF NOT EXISTS mobile_pairing_expiry_idx
  ON mobile_pairing_codes (expires_at);

CREATE TABLE IF NOT EXISTS mobile_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'iPhone',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS mobile_sessions_token_idx
  ON mobile_sessions (token_hash);
CREATE INDEX IF NOT EXISTS mobile_sessions_owner_idx
  ON mobile_sessions (owner_key, revoked_at);
