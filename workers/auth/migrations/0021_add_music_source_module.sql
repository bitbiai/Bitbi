-- Allow 'music' as a source_module for ai_text_assets so that
-- admin Music AI MP3 outputs can be saved alongside existing text/embeddings/compare/live_agent assets.
-- D1 (SQLite) does not support ALTER TABLE ... ALTER COLUMN or modifying CHECK constraints in place,
-- so we recreate the table with the expanded constraint and copy data across.

CREATE TABLE ai_text_assets_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  r2_key TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('text', 'embeddings', 'compare', 'live_agent', 'music')),
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
