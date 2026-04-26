-- Phase 2-I: provider-neutral billing event ingestion foundation.
-- Additive only: stores verified/test billing-provider event metadata,
-- sanitized summaries, and dry-run action planning records. Raw webhook
-- bodies, signature headers, payment method data, and provider secrets are
-- intentionally not stored.

CREATE TABLE IF NOT EXISTS billing_provider_events (
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
  CHECK (verification_status IN ('verified_test_signature', 'failed', 'unverified'))
);

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

CREATE TABLE IF NOT EXISTS billing_event_actions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  dry_run INTEGER NOT NULL DEFAULT 1,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES billing_provider_events(id) ON DELETE CASCADE,
  UNIQUE(event_id, action_type),
  CHECK (action_type <> ''),
  CHECK (status IN ('planned', 'deferred', 'ignored', 'failed')),
  CHECK (dry_run IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_billing_event_actions_event
  ON billing_event_actions(event_id, status, created_at DESC);
