-- Phase 6.23: additive action/audit tracking for admin-approved legacy media reset.
-- This migration creates empty tracking tables only. It does not delete media,
-- mutate source asset rows, backfill ownership, switch access checks, touch R2,
-- or modify existing ai_folders/ai_images/manual-review rows.

CREATE TABLE IF NOT EXISTS tenant_asset_media_reset_actions (
  id TEXT PRIMARY KEY,
  dry_run INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  requested_domains_json TEXT NOT NULL,
  normalized_request_hash TEXT NOT NULL,
  idempotency_key_hash TEXT,
  operator_user_id TEXT,
  operator_email TEXT,
  reason TEXT,
  acknowledgements_json TEXT,
  evidence_report_generated_at TEXT,
  evidence_snapshot_hash TEXT,
  before_summary_json TEXT,
  result_summary_json TEXT,
  error_summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (dry_run IN (0, 1))
);

CREATE TABLE IF NOT EXISTS tenant_asset_media_reset_action_events (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT,
  domain TEXT,
  item_count INTEGER,
  r2_key_type_counts_json TEXT,
  safe_summary_json TEXT,
  error_summary_json TEXT,
  actor_user_id TEXT,
  actor_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_media_reset_actions_status_created_at
  ON tenant_asset_media_reset_actions(status, created_at);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_media_reset_actions_idempotency
  ON tenant_asset_media_reset_actions(idempotency_key_hash);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_media_reset_actions_request_hash
  ON tenant_asset_media_reset_actions(normalized_request_hash);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_media_reset_action_events_action_created_at
  ON tenant_asset_media_reset_action_events(action_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tenant_asset_media_reset_action_events_type
  ON tenant_asset_media_reset_action_events(event_type);
