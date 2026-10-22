-- Personal inbox state only. Original operation/incident evidence is untouched.
-- Keep tombstones even after a browser report's ordinary retention expires.
ALTER TABLE canvas_notification_reads ADD COLUMN deleted_at TEXT;

-- Atomic bulk boundaries and replay identities, without message content.
CREATE TABLE canvas_notification_mutations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 apply_token TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE INDEX canvas_notification_mutations_viewer ON canvas_notification_mutations(user_id,id);
