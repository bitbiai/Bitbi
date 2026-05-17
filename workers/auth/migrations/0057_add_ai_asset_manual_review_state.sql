-- Phase 6.13: Additive manual-review state schema for AI folders/images.
-- Schema foundation only. This migration intentionally creates no review
-- items, imports no evidence, performs no ownership backfill, changes no
-- access checks, and does not touch R2.

CREATE TABLE IF NOT EXISTS ai_asset_manual_review_items (
  id TEXT PRIMARY KEY,
  asset_domain TEXT NOT NULL,
  asset_id TEXT,
  related_asset_id TEXT,
  source_table TEXT,
  source_row_id TEXT,
  issue_category TEXT NOT NULL,
  review_status TEXT NOT NULL,
  severity TEXT NOT NULL,
  priority TEXT NOT NULL,
  legacy_owner_user_id TEXT,
  proposed_asset_owner_type TEXT,
  proposed_owning_user_id TEXT,
  proposed_owning_organization_id TEXT,
  proposed_ownership_status TEXT,
  proposed_ownership_source TEXT,
  proposed_ownership_confidence TEXT,
  evidence_source_path TEXT,
  evidence_report_generated_at TEXT,
  evidence_summary_json TEXT,
  safe_notes TEXT,
  assigned_to_user_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_by_id TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS ai_asset_manual_review_events (
  id TEXT PRIMARY KEY,
  review_item_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  actor_user_id TEXT,
  actor_email TEXT,
  reason TEXT,
  idempotency_key TEXT,
  request_hash TEXT,
  event_metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_domain_asset
  ON ai_asset_manual_review_items(asset_domain, asset_id);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_status
  ON ai_asset_manual_review_items(review_status);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_category
  ON ai_asset_manual_review_items(issue_category);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_severity
  ON ai_asset_manual_review_items(severity);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_priority
  ON ai_asset_manual_review_items(priority);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_created_at
  ON ai_asset_manual_review_items(created_at);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_items_evidence_source
  ON ai_asset_manual_review_items(evidence_source_path);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_events_item
  ON ai_asset_manual_review_events(review_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_asset_manual_review_events_idempotency
  ON ai_asset_manual_review_events(idempotency_key);

-- Dedupe uniqueness is deferred because asset_id, related_asset_id, and
-- evidence_source_path are nullable in the planned import model and SQLite
-- treats NULL values in unique indexes as distinct.
