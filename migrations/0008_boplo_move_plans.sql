-- Boplo Landing: global move planning, paid budget tools, and a moderated
-- local-knowledge marketplace. All personal move data remains scoped to one user.

CREATE TABLE IF NOT EXISTS boplo_move_profiles (
  user_id TEXT PRIMARY KEY,
  destination TEXT,
  move_date TEXT,
  move_reason TEXT,
  priorities_json TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'GBP',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS boplo_move_entitlements (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'move_plan')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive', 'active', 'refunded')),
  order_id TEXT UNIQUE,
  active_until INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS boplo_move_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'refunded', 'expired')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boplo_move_orders_user_created ON boplo_move_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS boplo_move_calculations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  currency TEXT NOT NULL,
  monthly_rent INTEGER NOT NULL,
  deposit_months REAL NOT NULL,
  monthly_living INTEGER NOT NULL,
  travel_and_setup INTEGER NOT NULL,
  emergency_buffer INTEGER NOT NULL,
  savings INTEGER NOT NULL,
  first_month_total INTEGER NOT NULL,
  three_month_total INTEGER NOT NULL,
  remaining_after_first_month INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boplo_move_calculations_user_updated ON boplo_move_calculations(user_id, updated_at DESC);

-- Adviser entries are created by moderation/admin tooling, not public self-signup.
CREATE TABLE IF NOT EXISTS boplo_local_advisors (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL,
  languages_json TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending', 'approved', 'suspended')),
  rating REAL NOT NULL DEFAULT 0,
  completed_sessions INTEGER NOT NULL DEFAULT 0,
  async_question_price INTEGER,
  call_15_price INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS boplo_local_advisor_cities (
  advisor_id TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT,
  local_since TEXT,
  PRIMARY KEY(advisor_id, city),
  FOREIGN KEY (advisor_id) REFERENCES boplo_local_advisors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boplo_local_advisor_cities_city ON boplo_local_advisor_cities(city);

CREATE TABLE IF NOT EXISTS boplo_local_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  advisor_id TEXT NOT NULL,
  city TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK(request_type IN ('question', 'call')),
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted', 'accepted', 'answered', 'declined', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (requester_id) REFERENCES darts_users(id) ON DELETE CASCADE,
  FOREIGN KEY (advisor_id) REFERENCES boplo_local_advisors(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS boplo_local_requests_requester_updated ON boplo_local_requests(requester_id, updated_at DESC);

