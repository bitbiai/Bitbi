-- Homepage hero production processor state and Memvid Stream hover-preview metadata.
--
-- This migration is additive. Existing homepage hero slots/derivatives keep their
-- 0061 behavior; new columns support a signed external_ffmpeg processor without
-- making original source videos public.

ALTER TABLE homepage_hero_video_derivatives
  ADD COLUMN source_r2_key TEXT;

ALTER TABLE homepage_hero_video_derivatives
  ADD COLUMN source_fingerprint TEXT;

ALTER TABLE homepage_hero_video_derivatives
  ADD COLUMN error_code TEXT;

ALTER TABLE homepage_hero_video_derivatives
  ADD COLUMN processing_started_at TEXT;

ALTER TABLE homepage_hero_video_derivatives
  ADD COLUMN processing_completed_at TEXT;

ALTER TABLE homepage_hero_video_derivatives
  ADD COLUMN superseded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_homepage_hero_video_derivatives_processor_status
  ON homepage_hero_video_derivatives(provider, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_homepage_hero_video_derivatives_source_fingerprint
  ON homepage_hero_video_derivatives(source_type, source_asset_id, source_fingerprint, target_preset_json, status);

CREATE TABLE IF NOT EXISTS homepage_hero_video_uploads (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  original_file_name TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  operator_reason TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES ai_text_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_homepage_hero_video_uploads_user_created
  ON homepage_hero_video_uploads(user_id, created_at);

CREATE TABLE IF NOT EXISTS memvid_stream_previews (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_r2_key TEXT NOT NULL,
  source_fingerprint TEXT,
  stream_uid TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'uploading', 'processing', 'ready', 'failed', 'disabled', 'superseded')),
  preview_duration_seconds REAL,
  max_loop_count INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  provider_metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (asset_id) REFERENCES ai_text_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memvid_stream_previews_asset_status
  ON memvid_stream_previews(asset_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_memvid_stream_previews_status_updated
  ON memvid_stream_previews(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_memvid_stream_previews_stream_uid
  ON memvid_stream_previews(stream_uid);

CREATE TABLE IF NOT EXISTS memvid_stream_preview_events (
  id TEXT PRIMARY KEY,
  preview_id TEXT,
  asset_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  preview_duration_seconds REAL,
  max_loop_count INTEGER NOT NULL DEFAULT 3,
  estimated_delivered_seconds REAL,
  provider_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (preview_id) REFERENCES memvid_stream_previews(id) ON DELETE SET NULL,
  FOREIGN KEY (asset_id) REFERENCES ai_text_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memvid_stream_preview_events_asset_created
  ON memvid_stream_preview_events(asset_id, created_at);

CREATE INDEX IF NOT EXISTS idx_memvid_stream_preview_events_type_created
  ON memvid_stream_preview_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS memvid_stream_preview_backfill_requests (
  id TEXT PRIMARY KEY,
  idempotency_key_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  queued_count INTEGER NOT NULL DEFAULT 0,
  operator_user_id TEXT,
  operator_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL
);
