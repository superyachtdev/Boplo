-- Boplo Flight: Stripe subscription state, one row per user
CREATE TABLE IF NOT EXISTS flight_billing (
 user_id TEXT PRIMARY KEY REFERENCES darts_users(id) ON DELETE CASCADE,
 customer_id TEXT UNIQUE,
 subscription_id TEXT,
 status TEXT NOT NULL DEFAULT 'none',
 price_key TEXT,
 current_period_end INTEGER,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
 trial_end INTEGER,
 trial_used INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_billing_customer ON flight_billing(customer_id);
