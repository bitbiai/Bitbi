-- Phase 4.19: explicit admin-approved platform budget usage repair executor.
-- Additive audit table only. Repair execution remains admin-requested,
-- idempotent, local-D1-only, and scoped to platform_admin_lab_budget.

CREATE TABLE IF NOT EXISTS platform_budget_repair_actions (
  id TEXT PRIMARY KEY,
  budget_scope TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_type TEXT NOT NULL,
  requested_action TEXT NOT NULL,
  action_status TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  requested_by_user_id TEXT,
  requested_by_email TEXT,
  reason TEXT,
  source_attempt_id TEXT,
  source_job_id TEXT,
  created_usage_event_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (dry_run IN (0, 1)),
  CHECK (action_status IN ('pending', 'applied', 'review_recorded', 'no_op', 'rejected', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_repair_actions_idempotency
  ON platform_budget_repair_actions (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_platform_budget_repair_actions_candidate
  ON platform_budget_repair_actions (candidate_id);

CREATE INDEX IF NOT EXISTS idx_platform_budget_repair_actions_scope_created
  ON platform_budget_repair_actions (budget_scope, created_at);

CREATE INDEX IF NOT EXISTS idx_platform_budget_repair_actions_status_created
  ON platform_budget_repair_actions (action_status, created_at);
