-- Phase 4.17: first narrow live platform budget cap foundation.
-- Additive only. This stores operator-configured daily/monthly platform
-- budget limits and bounded usage events for platform_admin_lab_budget.

CREATE TABLE IF NOT EXISTS platform_budget_limits (
  id TEXT PRIMARY KEY,
  budget_scope TEXT NOT NULL,
  window_type TEXT NOT NULL,
  limit_units INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'enforce',
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TEXT,
  ends_at TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  CHECK (window_type IN ('daily', 'monthly')),
  CHECK (limit_units > 0),
  CHECK (mode IN ('enforce')),
  CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_limits_active_scope_window
  ON platform_budget_limits (budget_scope, window_type)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_platform_budget_limits_scope_status
  ON platform_budget_limits (budget_scope, status, window_type);

CREATE TABLE IF NOT EXISTS platform_budget_limit_events (
  id TEXT PRIMARY KEY,
  budget_scope TEXT NOT NULL,
  window_type TEXT NOT NULL,
  old_limit_units INTEGER,
  new_limit_units INTEGER NOT NULL,
  reason TEXT,
  changed_by_user_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (window_type IN ('daily', 'monthly')),
  CHECK (old_limit_units IS NULL OR old_limit_units > 0),
  CHECK (new_limit_units > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_limit_events_idempotency
  ON platform_budget_limit_events (budget_scope, window_type, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_platform_budget_limit_events_scope_created
  ON platform_budget_limit_events (budget_scope, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS platform_budget_usage_events (
  id TEXT PRIMARY KEY,
  budget_scope TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  source_route TEXT,
  actor_user_id TEXT,
  actor_role TEXT,
  units INTEGER NOT NULL,
  window_day TEXT NOT NULL,
  window_month TEXT NOT NULL,
  idempotency_key_hash TEXT,
  request_fingerprint TEXT,
  source_attempt_id TEXT,
  source_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK (units > 0),
  CHECK (status IN ('recorded'))
);

CREATE INDEX IF NOT EXISTS idx_platform_budget_usage_events_scope_day
  ON platform_budget_usage_events (budget_scope, window_day, status);

CREATE INDEX IF NOT EXISTS idx_platform_budget_usage_events_scope_month
  ON platform_budget_usage_events (budget_scope, window_month, status);

CREATE INDEX IF NOT EXISTS idx_platform_budget_usage_events_operation_created
  ON platform_budget_usage_events (operation_key, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_usage_events_attempt_once
  ON platform_budget_usage_events (source_attempt_id)
  WHERE source_attempt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_usage_events_job_once
  ON platform_budget_usage_events (source_job_id)
  WHERE source_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_usage_events_idempotency_once
  ON platform_budget_usage_events (budget_scope, operation_key, idempotency_key_hash, request_fingerprint)
  WHERE idempotency_key_hash IS NOT NULL AND request_fingerprint IS NOT NULL;
