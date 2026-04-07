-- Daily AI quota reservations/consumption ledger.
-- This keeps quota enforcement atomic for concurrent requests while
-- preserving ai_generation_log as the success history/audit log.

CREATE TABLE ai_daily_quota_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day_start TEXT NOT NULL,
  slot INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, day_start, slot)
);

CREATE INDEX idx_ai_daily_quota_usage_user_day
  ON ai_daily_quota_usage(user_id, day_start, status, expires_at);

INSERT INTO ai_daily_quota_usage (id, user_id, day_start, slot, status, created_at, expires_at, consumed_at)
SELECT
  'backfill-' || id,
  user_id,
  substr(created_at, 1, 10) || 'T00:00:00.000Z',
  ROW_NUMBER() OVER (
    PARTITION BY user_id, substr(created_at, 1, 10)
    ORDER BY created_at ASC, id ASC
  ),
  'consumed',
  created_at,
  NULL,
  created_at
FROM ai_generation_log
WHERE created_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now');
