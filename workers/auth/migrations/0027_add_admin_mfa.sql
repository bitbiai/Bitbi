-- Admin-only TOTP MFA state with encrypted secrets and hashed recovery codes.

CREATE TABLE IF NOT EXISTS admin_mfa_credentials (
  admin_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT,
  secret_iv TEXT,
  pending_secret_ciphertext TEXT,
  pending_secret_iv TEXT,
  enabled_at TEXT,
  last_accepted_timestep INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE(admin_user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_recovery_codes_admin_unused
  ON admin_mfa_recovery_codes(admin_user_id, used_at, created_at DESC);
