-- Private player video references. Original clips live in the VIDEOS R2 bucket;
-- D1 holds ownership, processing state and the resulting review only.
CREATE TABLE IF NOT EXISTS darts_video_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','analysing','ready','failed')),
  analysis_json TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  analysed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS darts_video_reviews_user ON darts_video_reviews(user_id, created_at DESC);
