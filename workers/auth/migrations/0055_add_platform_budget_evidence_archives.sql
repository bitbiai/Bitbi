-- Phase 4.21: Platform Budget Evidence Archive / Retention Workflow.
-- Additive metadata table only. Archive creation stores sanitized operator
-- evidence snapshots in AUDIT_ARCHIVE under a dedicated approved prefix.

CREATE TABLE IF NOT EXISTS platform_budget_evidence_archives (
  id TEXT PRIMARY KEY,
  budget_scope TEXT NOT NULL,
  archive_type TEXT NOT NULL,
  archive_status TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  format TEXT NOT NULL,
  sha256 TEXT,
  size_bytes INTEGER,
  filters_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key_hash TEXT,
  request_hash TEXT,
  reason TEXT,
  created_by_user_id TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT,
  error_code TEXT,
  error_message TEXT,
  CHECK (archive_type IN ('repair_report', 'combined_evidence')),
  CHECK (archive_status IN ('created', 'failed', 'expired', 'deleted', 'cleanup_failed')),
  CHECK (format IN ('json', 'markdown')),
  CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_evidence_archives_storage_key
  ON platform_budget_evidence_archives (storage_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_budget_evidence_archives_idempotency
  ON platform_budget_evidence_archives (idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_budget_evidence_archives_scope_created
  ON platform_budget_evidence_archives (budget_scope, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_platform_budget_evidence_archives_status_expires
  ON platform_budget_evidence_archives (archive_status, expires_at);

CREATE INDEX IF NOT EXISTS idx_platform_budget_evidence_archives_created_by
  ON platform_budget_evidence_archives (created_by_user_id, created_at DESC);
