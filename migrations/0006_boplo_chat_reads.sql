-- Confirmed chat reads are private to the signed-in Boplo account.
CREATE TABLE IF NOT EXISTS boplo_chat_reads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  transcript TEXT NOT NULL,
  vibe TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boplo_chat_reads_user_created ON boplo_chat_reads(user_id, created_at DESC);
