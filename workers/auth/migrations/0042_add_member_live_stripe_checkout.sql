-- Additive member-scoped live Stripe credit-pack checkout tracking.
-- Public pricing purchases for normal members credit the personal member ledger,
-- not an organization ledger, while reusing verified Stripe webhook ingestion.

CREATE TABLE IF NOT EXISTS billing_member_checkout_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_mode TEXT NOT NULL DEFAULT 'live',
  provider_checkout_session_id TEXT,
  provider_payment_intent_id TEXT,
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
  member_credit_ledger_entry_id TEXT,
  authorization_scope TEXT NOT NULL DEFAULT 'member'
    CHECK (authorization_scope = 'member'),
  payment_status TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  granted_at TEXT,
  failed_at TEXT,
  expired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (billing_event_id) REFERENCES billing_provider_events(id) ON DELETE SET NULL,
  FOREIGN KEY (member_credit_ledger_entry_id) REFERENCES member_credit_ledger(id) ON DELETE SET NULL,
  CHECK (provider = 'stripe'),
  CHECK (provider_mode = 'live'),
  CHECK (credit_pack_id <> ''),
  CHECK (credits > 0),
  CHECK (amount_cents > 0),
  CHECK (currency <> ''),
  CHECK (status IN ('created', 'completed', 'expired', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_member_checkout_provider_session
  ON billing_member_checkout_sessions(provider, provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_member_checkout_user_idempotency
  ON billing_member_checkout_sessions(user_id, idempotency_key_hash);

CREATE INDEX IF NOT EXISTS idx_billing_member_checkout_user_created
  ON billing_member_checkout_sessions(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_member_checkout_status_created
  ON billing_member_checkout_sessions(provider, provider_mode, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_member_checkout_event
  ON billing_member_checkout_sessions(billing_event_id);
