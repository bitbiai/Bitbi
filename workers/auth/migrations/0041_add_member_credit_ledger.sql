-- Member credit balances for registered user image generation.
-- Additive only. Organization credit tables remain unchanged.

CREATE TABLE IF NOT EXISTS member_credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  feature_key TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  idempotency_key TEXT,
  request_hash TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credit_ledger_user_idempotency
  ON member_credit_ledger (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_member_credit_ledger_user_created
  ON member_credit_ledger (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_member_credit_ledger_user_feature_created
  ON member_credit_ledger (user_id, feature_key, created_at DESC);

CREATE TABLE IF NOT EXISTS member_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  credits_delta INTEGER NOT NULL DEFAULT 0,
  credit_ledger_id TEXT,
  idempotency_key TEXT,
  request_hash TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (credit_ledger_id) REFERENCES member_credit_ledger(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_usage_events_user_idempotency
  ON member_usage_events (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_member_usage_events_user_created
  ON member_usage_events (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_member_usage_events_user_feature_created
  ON member_usage_events (user_id, feature_key, created_at DESC, id DESC);
