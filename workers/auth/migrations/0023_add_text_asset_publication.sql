-- Memvids publication state for member-owned video assets (mirrors 0019 for images)
-- Also enables future publication of other text-asset types
-- Migration 0023

ALTER TABLE ai_text_assets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE ai_text_assets ADD COLUMN published_at TEXT;

CREATE INDEX idx_ai_text_assets_visibility_published_at
  ON ai_text_assets(visibility, source_module, published_at, created_at);
