-- Supporting index for cursor-based audit log pagination
-- Covers: ORDER BY created_at DESC, id DESC
-- and WHERE (created_at < ? OR (created_at = ? AND id < ?))
CREATE INDEX IF NOT EXISTS idx_audit_log_created_id
  ON admin_audit_log (created_at DESC, id DESC);
