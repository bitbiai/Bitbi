-- Public homepage AI/creative-tech news pulse cache.
-- Items are short source-attributed summaries served by /api/public/news-pulse.

CREATE TABLE IF NOT EXISTS news_pulse_items (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'de')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'AI',
  published_at TEXT NOT NULL,
  visual_type TEXT NOT NULL DEFAULT 'icon' CHECK (visual_type IN ('generated', 'icon', 'none')),
  visual_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  source_key TEXT,
  content_hash TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_pulse_locale_status_published
  ON news_pulse_items(locale, status, published_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_pulse_expires
  ON news_pulse_items(expires_at);
