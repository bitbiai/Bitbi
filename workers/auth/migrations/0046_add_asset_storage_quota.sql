-- Per-user Assets Manager storage quota accounting.
-- Existing ai_images/poster rows are lazily reconciled from R2 object metadata
-- because D1 migrations cannot read USER_IMAGES object sizes.

ALTER TABLE ai_images
  ADD COLUMN size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0);

ALTER TABLE ai_text_assets
  ADD COLUMN poster_size_bytes INTEGER CHECK (poster_size_bytes IS NULL OR poster_size_bytes >= 0);

CREATE TABLE user_asset_storage_usage (
  user_id TEXT PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
