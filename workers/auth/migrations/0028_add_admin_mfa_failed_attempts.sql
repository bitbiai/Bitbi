-- Durable admin MFA verification failed-attempt state.

CREATE TABLE IF NOT EXISTS admin_mfa_failed_attempts (
  admin_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at TEXT,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_failed_attempts_locked_until
  ON admin_mfa_failed_attempts(locked_until);
