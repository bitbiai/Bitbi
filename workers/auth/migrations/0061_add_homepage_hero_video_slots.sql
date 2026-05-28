-- Homepage Hero Videos: operator-managed optimized public hero media.
-- Source assets remain private/public source records; the homepage only serves
-- optimized derivatives through versioned public slot URLs.

CREATE TABLE IF NOT EXISTS homepage_hero_video_derivatives (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL CHECK (slot IN ('right_top', 'right_bottom', 'left_top', 'left_bottom')),
  source_type TEXT NOT NULL CHECK (source_type IN ('public', 'admin_asset')),
  source_asset_id TEXT NOT NULL,
  source_user_id TEXT,
  source_title TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'external_ffmpeg', 'cloudflare_stream')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  version TEXT,
  file_r2_key TEXT,
  poster_r2_key TEXT,
  file_mime_type TEXT,
  poster_mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  fps INTEGER,
  size_bytes INTEGER,
  poster_size_bytes INTEGER,
  original_size_bytes INTEGER,
  original_mime_type TEXT,
  target_preset_json TEXT NOT NULL DEFAULT '{}',
  provider_payload_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  idempotency_key_hash TEXT,
  request_hash TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_homepage_hero_video_derivatives_idempotency
  ON homepage_hero_video_derivatives(idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_homepage_hero_video_derivatives_slot_status
  ON homepage_hero_video_derivatives(slot, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_homepage_hero_video_derivatives_source
  ON homepage_hero_video_derivatives(source_type, source_asset_id, source_user_id);

CREATE TABLE IF NOT EXISTS homepage_hero_video_slots (
  slot TEXT PRIMARY KEY CHECK (slot IN ('right_top', 'right_bottom', 'left_top', 'left_bottom')),
  display_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  derivative_id TEXT REFERENCES homepage_hero_video_derivatives(id) ON DELETE SET NULL,
  source_type TEXT CHECK (source_type IN ('public', 'admin_asset')),
  source_asset_id TEXT,
  source_user_id TEXT,
  title TEXT,
  operator_reason TEXT,
  updated_by_user_id TEXT,
  last_idempotency_key_hash TEXT,
  last_request_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO homepage_hero_video_slots (slot, display_order, enabled)
VALUES
  ('right_top', 10, 0),
  ('right_bottom', 20, 0),
  ('left_top', 30, 0),
  ('left_bottom', 40, 0);
