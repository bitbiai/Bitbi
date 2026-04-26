-- Phase 2-J: Stripe Testmode credit-pack checkout foundation.
-- Additive only. This tracks testmode Checkout Sessions and links verified
-- checkout completion webhooks to idempotent credit grants. Live payments,
-- subscriptions, invoices, and customer portal flows are not enabled.

CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_mode TEXT NOT NULL DEFAULT 'test',
  provider_checkout_session_id TEXT,
  provider_payment_intent_id TEXT,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credit_pack_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint_hash TEXT NOT NULL,
  checkout_url TEXT,
  provider_customer_id TEXT,
  billing_event_id TEXT,
  credit_ledger_entry_id TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (billing_event_id) REFERENCES billing_provider_events(id) ON DELETE SET NULL,
  FOREIGN KEY (credit_ledger_entry_id) REFERENCES credit_ledger(id) ON DELETE SET NULL,
  CHECK (provider = 'stripe'),
  CHECK (provider_mode IN ('test', 'live')),
  CHECK (credit_pack_id <> ''),
  CHECK (credits > 0),
  CHECK (amount_cents > 0),
  CHECK (currency <> ''),
  CHECK (status IN ('created', 'completed', 'expired', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_sessions_provider_session
  ON billing_checkout_sessions(provider, provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_sessions_org_user_idempotency
  ON billing_checkout_sessions(organization_id, user_id, idempotency_key_hash);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_org_status
  ON billing_checkout_sessions(organization_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_payment_intent
  ON billing_checkout_sessions(provider, provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_pack_created
  ON billing_checkout_sessions(credit_pack_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_event
  ON billing_checkout_sessions(billing_event_id);
