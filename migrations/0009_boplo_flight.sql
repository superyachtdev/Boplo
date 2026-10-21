CREATE TABLE IF NOT EXISTS flight_profiles (
 user_id TEXT PRIMARY KEY REFERENCES darts_users(id) ON DELETE CASCADE,
 data TEXT NOT NULL DEFAULT '{}',
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flight_records (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES darts_users(id) ON DELETE CASCADE,
 data TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_records_owner ON flight_records(user_id, created_at DESC);
