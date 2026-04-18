-- Allow 'video' as a source_module for ai_text_assets so Pixverse video saves can
-- reuse the existing shared saved-assets pipeline beside text, compare, live-agent, and music assets.
-- D1 (SQLite) does not support altering CHECK constraints in place, so recreate the table and copy data.

CREATE TABLE ai_text_assets_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  r2_key TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('text', 'embeddings', 'compare', 'live_agent', 'music', 'video')),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES ai_folders(id) ON DELETE SET NULL
);

INSERT INTO ai_text_assets_new SELECT * FROM ai_text_assets;

DROP TABLE ai_text_assets;

ALTER TABLE ai_text_assets_new RENAME TO ai_text_assets;

CREATE INDEX idx_ai_text_assets_user_created
  ON ai_text_assets(user_id, created_at DESC);

CREATE INDEX idx_ai_text_assets_folder_created
  ON ai_text_assets(folder_id, created_at DESC);

CREATE INDEX idx_ai_text_assets_user_source
  ON ai_text_assets(user_id, source_module, created_at DESC);
