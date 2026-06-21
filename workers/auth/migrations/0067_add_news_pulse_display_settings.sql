CREATE TABLE IF NOT EXISTS news_pulse_display_settings (
  surface TEXT PRIMARY KEY CHECK (surface IN ('desktop', 'mobile')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  reason TEXT
);

