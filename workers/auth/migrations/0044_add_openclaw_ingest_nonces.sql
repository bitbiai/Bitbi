CREATE TABLE IF NOT EXISTS openclaw_ingest_nonces (
  nonce TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_openclaw_ingest_nonces_expires
  ON openclaw_ingest_nonces(expires_at);
