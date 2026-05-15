-- Phase 3.4: member personal image AI Cost Gateway pilot.
-- Additive only. This table supports retry-safe member-credit reservations,
-- provider execution suppression, and temporary result replay metadata for
-- personal member AI image generation without changing organization attempts.

CREATE TABLE IF NOT EXISTS member_ai_usage_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  credit_cost INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved',
  provider_status TEXT NOT NULL DEFAULT 'not_started',
  billing_status TEXT NOT NULL DEFAULT 'reserved',
  result_status TEXT NOT NULL DEFAULT 'none',
  result_temp_key TEXT,
  result_save_reference TEXT,
  result_mime_type TEXT,
  result_model TEXT,
  result_prompt_length INTEGER,
  result_steps INTEGER,
  result_seed INTEGER,
  balance_after INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (credit_cost > 0),
  CHECK (quantity > 0),
  CHECK (status IN ('reserved', 'provider_running', 'provider_failed', 'finalizing', 'billing_failed', 'succeeded', 'expired')),
  CHECK (provider_status IN ('not_started', 'running', 'failed', 'succeeded', 'expired')),
  CHECK (billing_status IN ('reserved', 'released', 'failed', 'finalized')),
  CHECK (result_status IN ('none', 'unavailable', 'stored', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_ai_usage_attempts_user_idempotency
  ON member_ai_usage_attempts (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_member_ai_usage_attempts_user_created
  ON member_ai_usage_attempts (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_member_ai_usage_attempts_user_feature_created
  ON member_ai_usage_attempts (user_id, feature_key, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_member_ai_usage_attempts_status_expires
  ON member_ai_usage_attempts (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_member_ai_usage_attempts_billing_reservations
  ON member_ai_usage_attempts (user_id, billing_status, status, expires_at);
