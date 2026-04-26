-- Phase 1-H: data lifecycle request foundation for export/deletion/anonymization planning.
-- This migration is additive only. It does not delete or rewrite existing user data.

CREATE TABLE IF NOT EXISTS data_lifecycle_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('export', 'delete', 'anonymize', 'retention_cleanup')),
  subject_user_id TEXT NOT NULL,
  requested_by_user_id TEXT,
  requested_by_admin_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  approval_required INTEGER NOT NULL DEFAULT 1 CHECK (approval_required IN (0, 1)),
  approved_by_admin_id TEXT,
  approved_at TEXT,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1 CHECK (dry_run IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (subject_user_id) REFERENCES users(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  FOREIGN KEY (requested_by_admin_id) REFERENCES users(id),
  FOREIGN KEY (approved_by_admin_id) REFERENCES users(id),
  UNIQUE (type, requested_by_admin_id, subject_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_requests_subject_created
  ON data_lifecycle_requests (subject_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_requests_status_created
  ON data_lifecycle_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_requests_type_status_created
  ON data_lifecycle_requests (type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_requests_expires_at
  ON data_lifecycle_requests (expires_at);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_requests_created_id
  ON data_lifecycle_requests (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS data_lifecycle_request_items (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  table_name TEXT,
  r2_bucket TEXT,
  r2_key TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES data_lifecycle_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_items_request
  ON data_lifecycle_request_items (request_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_items_request_created_id
  ON data_lifecycle_request_items (request_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_items_resource
  ON data_lifecycle_request_items (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_data_lifecycle_items_r2
  ON data_lifecycle_request_items (r2_bucket, r2_key);

CREATE TABLE IF NOT EXISTS data_export_archives (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  r2_bucket TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT,
  size_bytes INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES data_lifecycle_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_data_export_archives_request
  ON data_export_archives (request_id);

CREATE INDEX IF NOT EXISTS idx_data_export_archives_subject_created
  ON data_export_archives (subject_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_export_archives_expires_at
  ON data_export_archives (expires_at);
