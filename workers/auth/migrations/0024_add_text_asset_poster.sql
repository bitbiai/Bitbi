-- Video poster thumbnails for ai_text_assets (Memvids).
-- Mirrors the derivative key/dimension pattern from ai_images (0017).
ALTER TABLE ai_text_assets ADD COLUMN poster_r2_key TEXT;
ALTER TABLE ai_text_assets ADD COLUMN poster_width INTEGER;
ALTER TABLE ai_text_assets ADD COLUMN poster_height INTEGER;
