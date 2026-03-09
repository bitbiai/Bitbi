-- Migration number: 0003 	 2026-03-09T15:54:41.632Z
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);