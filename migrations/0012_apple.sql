-- App Store subscriptions and Sign in with Apple. The server also creates these on first use.
ALTER TABLE darts_users ADD COLUMN apple_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS darts_users_apple ON darts_users(apple_subject) WHERE apple_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS flight_apple (
  original_transaction_id TEXT PRIMARY KEY,
  user_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  interval_key TEXT,
  expires_at INTEGER,
  environment TEXT,
  will_renew INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_apple_user ON flight_apple(user_id);

CREATE TABLE IF NOT EXISTS flight_apns (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_apns_user ON flight_apns(user_id);
