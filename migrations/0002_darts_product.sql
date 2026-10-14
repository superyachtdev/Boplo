CREATE TABLE IF NOT EXISTS darts_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  google_subject TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS darts_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS darts_sessions_user ON darts_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS darts_magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS darts_oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS darts_practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_type TEXT NOT NULL,
  three_dart_average REAL NOT NULL CHECK(three_dart_average BETWEEN 1 AND 180),
  doubles_rate REAL NOT NULL CHECK(doubles_rate BETWEEN 0 AND 100),
  checkout_rate REAL NOT NULL CHECK(checkout_rate BETWEEN 0 AND 100),
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS darts_practice_user ON darts_practice_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS darts_drill_completions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  drill_key TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS darts_drills_user ON darts_drill_completions(user_id, completed_at DESC);
