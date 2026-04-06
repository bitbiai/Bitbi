-- User activity log for tracking user-initiated events
CREATE TABLE IF NOT EXISTS user_activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  meta_json TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_created_id ON user_activity_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity_log (user_id);
