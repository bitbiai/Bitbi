-- Phase 1-I: bounded data export archive metadata hardening.
-- Additive only. Archive bytes live in private R2; this migration tracks
-- lifecycle/status metadata without changing existing lifecycle request rows.

ALTER TABLE data_export_archives ADD COLUMN manifest_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE data_export_archives ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE data_export_archives ADD COLUMN updated_at TEXT;
ALTER TABLE data_export_archives ADD COLUMN downloaded_at TEXT;
ALTER TABLE data_export_archives ADD COLUMN deleted_at TEXT;
ALTER TABLE data_export_archives ADD COLUMN error_code TEXT;
ALTER TABLE data_export_archives ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_data_export_archives_request_status
  ON data_export_archives (request_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_export_archives_status_expires
  ON data_export_archives (status, expires_at);
