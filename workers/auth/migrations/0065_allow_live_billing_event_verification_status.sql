-- Allow live Stripe webhook verification metadata to be stored.
-- The live webhook verifier returns verified_live_signature; without this
-- CHECK update, D1 rejects verified live events before fulfillment can no-op
-- or grant idempotently.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS billing_provider_events_next (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_account TEXT,
  provider_mode TEXT NOT NULL DEFAULT 'test',
  event_type TEXT NOT NULL,
  event_created_at TEXT,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  dedupe_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_summary_json TEXT NOT NULL DEFAULT '{}',
  organization_id TEXT,
  user_id TEXT,
  billing_customer_id TEXT,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (billing_customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  UNIQUE(provider, provider_event_id),
  UNIQUE(dedupe_key),
  CHECK (provider <> ''),
  CHECK (provider_event_id <> ''),
  CHECK (event_type <> ''),
  CHECK (provider_mode IN ('test', 'sandbox', 'synthetic', 'live')),
  CHECK (processing_status IN ('received', 'planned', 'ignored', 'failed')),
  CHECK (verification_status IN ('verified_test_signature', 'verified_live_signature', 'failed', 'unverified'))
);

INSERT INTO billing_provider_events_next (
  id,
  provider,
  provider_event_id,
  provider_account,
  provider_mode,
  event_type,
  event_created_at,
  received_at,
  processing_status,
  verification_status,
  dedupe_key,
  payload_hash,
  payload_summary_json,
  organization_id,
  user_id,
  billing_customer_id,
  error_code,
  error_message,
  attempt_count,
  last_processed_at,
  created_at,
  updated_at
)
SELECT
  id,
  provider,
  provider_event_id,
  provider_account,
  provider_mode,
  event_type,
  event_created_at,
  received_at,
  processing_status,
  verification_status,
  dedupe_key,
  payload_hash,
  payload_summary_json,
  organization_id,
  user_id,
  billing_customer_id,
  error_code,
  error_message,
  attempt_count,
  last_processed_at,
  created_at,
  updated_at
FROM billing_provider_events;

DROP TABLE billing_provider_events;
ALTER TABLE billing_provider_events_next RENAME TO billing_provider_events;

PRAGMA foreign_keys=on;

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_provider_type
  ON billing_provider_events(provider, event_type, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_status_received
  ON billing_provider_events(processing_status, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_org_received
  ON billing_provider_events(organization_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_customer_received
  ON billing_provider_events(billing_customer_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_mode_status_received
  ON billing_provider_events(provider_mode, processing_status, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_last_processed
  ON billing_provider_events(last_processed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_created
  ON billing_provider_events(event_created_at DESC, id DESC);
