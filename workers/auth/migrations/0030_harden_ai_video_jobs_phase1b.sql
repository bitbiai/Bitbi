-- Phase 1-B async video hardening.
-- Adds queue-safe polling/ingest statuses, durable output metadata, poster metadata,
-- and poison-message persistence for malformed/exhausted AI video queue messages.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS ai_video_jobs_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('admin', 'member')),
  status TEXT NOT NULL CHECK (status IN (
    'queued',
    'starting',
    'provider_pending',
    'polling',
    'processing',
    'ingesting',
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
  output_content_type TEXT,
  output_size_bytes INTEGER,
  poster_r2_key TEXT,
  poster_url TEXT,
  poster_content_type TEXT,
  poster_size_bytes INTEGER,
  provider_state TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, scope, idempotency_key)
);

INSERT INTO ai_video_jobs_next (
  id,
  user_id,
  scope,
  status,
  provider,
  model,
  prompt,
  input_json,
  request_hash,
  provider_task_id,
  idempotency_key,
  attempt_count,
  max_attempts,
  next_attempt_at,
  locked_until,
  output_r2_key,
  output_url,
  output_content_type,
  output_size_bytes,
  poster_r2_key,
  poster_url,
  poster_content_type,
  poster_size_bytes,
  provider_state,
  error_code,
  error_message,
  created_at,
  updated_at,
  completed_at,
  expires_at
)
SELECT
  id,
  user_id,
  scope,
  status,
  provider,
  model,
  prompt,
  input_json,
  request_hash,
  provider_task_id,
  idempotency_key,
  attempt_count,
  max_attempts,
  next_attempt_at,
  locked_until,
  output_r2_key,
  output_url,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  error_code,
  error_message,
  created_at,
  updated_at,
  completed_at,
  expires_at
FROM ai_video_jobs;

DROP TABLE ai_video_jobs;
ALTER TABLE ai_video_jobs_next RENAME TO ai_video_jobs;

PRAGMA foreign_keys=on;

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

CREATE TABLE IF NOT EXISTS ai_video_job_poison_messages (
  id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL,
  message_type TEXT,
  schema_version TEXT,
  job_id TEXT,
  reason_code TEXT NOT NULL,
  body_summary TEXT NOT NULL,
  correlation_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_video_job_poison_created
  ON ai_video_job_poison_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_video_job_poison_reason
  ON ai_video_job_poison_messages (reason_code, created_at DESC);
