-- Drill runs are deliberately separate from raw practice sessions.
-- A player can finish the same drill many times and Boplo can compare results over time.
CREATE TABLE IF NOT EXISTS darts_drill_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  drill_key TEXT NOT NULL,
  target INTEGER NOT NULL DEFAULT 0,
  achieved INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER CHECK(confidence BETWEEN 1 AND 5),
  note TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS darts_drill_runs_user ON darts_drill_runs(user_id, completed_at DESC);
