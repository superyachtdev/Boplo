-- Persistent Boplo chat threads. Free users can keep two active threads;
-- a future Stripe webhook will change plan to pro for unlimited threads.
CREATE TABLE IF NOT EXISTS boplo_entitlements (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS boplo_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  vibe TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES darts_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boplo_conversations_user_status_updated
  ON boplo_conversations(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS boplo_conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('me', 'them', 'suggestion')),
  body TEXT NOT NULL,
  option_group TEXT,
  label TEXT,
  why TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES boplo_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boplo_conversation_messages_thread_created
  ON boplo_conversation_messages(conversation_id, created_at ASC);
