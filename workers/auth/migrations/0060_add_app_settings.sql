-- P2-02: generic app settings store for operator-controlled runtime settings.
-- The first use is registration availability. Missing settings default to
-- registration enabled in code so migration/deploy ordering cannot lock out
-- new account creation accidentally.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at
  ON app_settings (updated_at DESC);
