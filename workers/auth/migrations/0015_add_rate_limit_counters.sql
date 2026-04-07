-- Shared durable rate-limit counters for abuse-sensitive endpoints.
-- Fixed-window counters are intentionally minimal and cleaned up by the auth worker cron.

CREATE TABLE rate_limit_counters (
  scope TEXT NOT NULL,
  limiter_key TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, limiter_key, window_start_ms)
);

CREATE INDEX idx_rate_limit_counters_expires_at
  ON rate_limit_counters(expires_at);
