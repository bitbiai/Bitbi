-- Add optional generated thumbnail metadata for public News Pulse items.
-- Existing rows remain valid and default to the existing icon/dot fallback.

ALTER TABLE news_pulse_items
  ADD COLUMN visual_prompt TEXT;

ALTER TABLE news_pulse_items
  ADD COLUMN visual_status TEXT NOT NULL DEFAULT 'missing'
  CHECK (visual_status IN ('missing', 'pending', 'ready', 'failed', 'skipped'));

ALTER TABLE news_pulse_items
  ADD COLUMN visual_object_key TEXT;

ALTER TABLE news_pulse_items
  ADD COLUMN visual_thumb_url TEXT;

ALTER TABLE news_pulse_items
  ADD COLUMN visual_generated_at TEXT;

ALTER TABLE news_pulse_items
  ADD COLUMN visual_error TEXT;

ALTER TABLE news_pulse_items
  ADD COLUMN visual_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE news_pulse_items
  ADD COLUMN visual_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_news_pulse_visual_status
  ON news_pulse_items(visual_status, visual_attempts, published_at DESC);
