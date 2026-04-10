-- Admin AI Lab text assets share the existing ai_folders hierarchy and USER_IMAGES R2 bucket.
-- This keeps the production image flow intact while allowing text-like AI lab outputs
-- to be stored as server-serialized plain-text files beside images.

CREATE TABLE ai_text_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  r2_key TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('text', 'embeddings', 'compare', 'live_agent')),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES ai_folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_ai_text_assets_user_created
  ON ai_text_assets(user_id, created_at DESC);

CREATE INDEX idx_ai_text_assets_folder_created
  ON ai_text_assets(folder_id, created_at DESC);

CREATE INDEX idx_ai_text_assets_user_source
  ON ai_text_assets(user_id, source_module, created_at DESC);
