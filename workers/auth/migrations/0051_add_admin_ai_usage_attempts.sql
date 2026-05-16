-- Phase 4.8.1: admin text/embeddings durable idempotency foundation.
-- Additive only. This table supports provider-call suppression and
-- same-key/different-request conflict detection for admin AI Lab text and
-- embeddings requests without storing raw prompts, raw embedding input,
-- generated text, or embedding vectors.

CREATE TABLE IF NOT EXISTS admin_ai_usage_attempts (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL,
  route TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  provider_family TEXT NOT NULL,
  model_key TEXT,
  budget_scope TEXT NOT NULL,
  budget_policy_json TEXT NOT NULL DEFAULT '{}',
  caller_policy_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  provider_status TEXT NOT NULL DEFAULT 'not_started',
  result_status TEXT NOT NULL DEFAULT 'none',
  result_metadata_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'provider_running', 'provider_failed', 'succeeded', 'terminal_failure', 'expired')),
  CHECK (provider_status IN ('not_started', 'running', 'failed', 'succeeded')),
  CHECK (result_status IN ('none', 'metadata_only', 'unavailable'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_ai_usage_attempts_admin_operation_idempotency
  ON admin_ai_usage_attempts (admin_user_id, operation_key, idempotency_key_hash);

CREATE INDEX IF NOT EXISTS idx_admin_ai_usage_attempts_admin_created
  ON admin_ai_usage_attempts (admin_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_ai_usage_attempts_operation_status
  ON admin_ai_usage_attempts (operation_key, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_ai_usage_attempts_status_expires
  ON admin_ai_usage_attempts (status, expires_at);
