-- RC Hotfix 5: additive final-state/evidence fields for data lifecycle requests.
-- This migration records legal/privacy workflow completion metadata only. It does
-- not execute erasure, delete retained records, or rewrite existing evidence.

ALTER TABLE data_lifecycle_requests ADD COLUMN final_status TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN evidence_status TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN completed_by_user_id TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN completion_note TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN completion_summary_json TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN retained_categories_json TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN execution_summary_json TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN closed_at TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN closed_by_user_id TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN closure_reason TEXT;
ALTER TABLE data_lifecycle_requests ADD COLUMN rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_requests_final_status_created
  ON data_lifecycle_requests (final_status, created_at DESC);
