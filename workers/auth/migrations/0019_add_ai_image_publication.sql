-- Mempics publication state for member-owned AI image assets
-- Migration 0019

ALTER TABLE ai_images ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE ai_images ADD COLUMN published_at TEXT;

CREATE INDEX idx_ai_images_visibility_published_at
  ON ai_images(visibility, published_at, created_at);
