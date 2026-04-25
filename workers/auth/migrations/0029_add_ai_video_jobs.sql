-- Async AI video jobs for admin-owned video generation.
-- This is additive and keeps the existing synchronous admin route available.

CREATE TABLE IF NOT EXISTS ai_video_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('admin', 'member')),
  status TEXT NOT NULL CHECK (status IN (
    'queued',
    'starting',
    'provider_pending',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'expired'
  )),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT,
  input_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider_task_id TEXT,
  idempotency_key TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  locked_until TEXT,
  output_r2_key TEXT,
  output_url TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_video_jobs_owner_status_created
  ON ai_video_jobs (user_id, scope, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_video_jobs_provider_task
  ON ai_video_jobs (provider, provider_task_id);

CREATE INDEX IF NOT EXISTS idx_ai_video_jobs_idempotency
  ON ai_video_jobs (user_id, scope, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ai_video_jobs_status_next_attempt
  ON ai_video_jobs (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_ai_video_jobs_expires_at
  ON ai_video_jobs (expires_at);
