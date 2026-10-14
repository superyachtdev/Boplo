CREATE TABLE IF NOT EXISTS scout_plans (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, input TEXT NOT NULL,
 preview TEXT NOT NULL, full_plan TEXT NOT NULL, created INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'preview', session_id TEXT UNIQUE,
 payment_intent TEXT, paid_at INTEGER, recovery_hash TEXT
);
CREATE INDEX IF NOT EXISTS scout_owner ON scout_plans(owner, created);
CREATE INDEX IF NOT EXISTS scout_payment ON scout_plans(payment_intent);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
