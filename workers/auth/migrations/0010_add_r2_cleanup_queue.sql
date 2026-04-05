-- Durable queue for R2 blob deletions that failed during bulk-delete.
-- The scheduled handler retries pending entries periodically and marks
-- exhausted entries as 'dead' for operator inspection (never hard-deleted).
CREATE TABLE IF NOT EXISTS r2_cleanup_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    r2_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT
);
