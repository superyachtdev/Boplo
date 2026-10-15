-- Target-level practice data powers Boplo's first honest board heatmap.
-- Each row is a player's recorded attempts at a specific target in one session.
CREATE TABLE IF NOT EXISTS darts_target_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('T20','D20','D16','D8','BULL','OTHER')),
  hits INTEGER NOT NULL DEFAULT 0 CHECK(hits >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES darts_practice_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS darts_target_results_user_target ON darts_target_results(user_id, target, created_at DESC);
