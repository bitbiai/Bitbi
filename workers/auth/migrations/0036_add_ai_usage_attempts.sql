-- Phase 2-D: org-scoped AI usage attempts and credit reservations.
-- Additive only. This table supports retry-safe provider execution and
-- reservation/finalization state for paid AI usage without enabling payments.

CREATE TABLE IF NOT EXISTS ai_usage_attempts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT,
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
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_attempts_org_idempotency
  ON ai_usage_attempts (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ai_usage_attempts_org_created
  ON ai_usage_attempts (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_attempts_user_created
  ON ai_usage_attempts (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_attempts_org_feature_created
  ON ai_usage_attempts (organization_id, feature_key, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_attempts_status_expires
  ON ai_usage_attempts (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_attempts_billing_reservations
  ON ai_usage_attempts (organization_id, billing_status, status, expires_at);
