-- Additive member subscription and bucket-aware credit accounting.
-- Existing member_credit_ledger remains the backward-compatible running balance.

CREATE TABLE IF NOT EXISTS billing_member_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_mode TEXT NOT NULL DEFAULT 'live',
  provider_customer_id TEXT,
  provider_subscription_id TEXT NOT NULL,
  provider_price_id TEXT,
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  canceled_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (provider = 'stripe'),
  CHECK (provider_mode = 'live'),
  CHECK (provider_subscription_id <> ''),
  CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_member_subscriptions_provider_id
  ON billing_member_subscriptions(provider, provider_mode, provider_subscription_id);

CREATE INDEX IF NOT EXISTS idx_billing_member_subscriptions_user_status_period
  ON billing_member_subscriptions(user_id, status, current_period_end DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_member_subscriptions_customer
  ON billing_member_subscriptions(provider, provider_mode, provider_customer_id);

CREATE TABLE IF NOT EXISTS billing_member_subscription_checkout_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_mode TEXT NOT NULL DEFAULT 'live',
  provider_checkout_session_id TEXT,
  provider_subscription_id TEXT,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  provider_price_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint_hash TEXT NOT NULL,
  checkout_url TEXT,
  provider_customer_id TEXT,
  billing_event_id TEXT,
  authorization_scope TEXT NOT NULL DEFAULT 'member'
    CHECK (authorization_scope = 'member'),
  payment_status TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  failed_at TEXT,
  expired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (billing_event_id) REFERENCES billing_provider_events(id) ON DELETE SET NULL,
  CHECK (provider = 'stripe'),
  CHECK (provider_mode = 'live'),
  CHECK (plan_id <> ''),
  CHECK (provider_price_id <> ''),
  CHECK (amount_cents > 0),
  CHECK (currency <> ''),
  CHECK (status IN ('created', 'completed', 'expired', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_member_subscription_checkout_provider_session
  ON billing_member_subscription_checkout_sessions(provider, provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_member_subscription_checkout_user_idempotency
  ON billing_member_subscription_checkout_sessions(user_id, idempotency_key_hash);

CREATE INDEX IF NOT EXISTS idx_billing_member_subscription_checkout_user_created
  ON billing_member_subscription_checkout_sessions(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_member_subscription_checkout_subscription
  ON billing_member_subscription_checkout_sessions(provider, provider_mode, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS member_credit_buckets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('subscription', 'purchased', 'legacy_or_bonus')),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  local_subscription_id TEXT,
  provider_subscription_id TEXT,
  period_start TEXT,
  period_end TEXT,
  source TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (local_subscription_id) REFERENCES billing_member_subscriptions(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credit_buckets_user_purchased
  ON member_credit_buckets(user_id, bucket_type)
  WHERE bucket_type = 'purchased';

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credit_buckets_user_legacy
  ON member_credit_buckets(user_id, bucket_type)
  WHERE bucket_type = 'legacy_or_bonus';

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credit_buckets_subscription_period
  ON member_credit_buckets(user_id, bucket_type, provider_subscription_id, period_start)
  WHERE bucket_type = 'subscription'
    AND provider_subscription_id IS NOT NULL
    AND period_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_member_credit_buckets_user_type
  ON member_credit_buckets(user_id, bucket_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS member_credit_bucket_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('subscription', 'purchased', 'legacy_or_bonus')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  member_credit_ledger_id TEXT,
  source TEXT NOT NULL,
  idempotency_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bucket_id) REFERENCES member_credit_buckets(id) ON DELETE CASCADE,
  FOREIGN KEY (member_credit_ledger_id) REFERENCES member_credit_ledger(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credit_bucket_events_bucket_idempotency
  ON member_credit_bucket_events(bucket_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_member_credit_bucket_events_user_created
  ON member_credit_bucket_events(user_id, created_at DESC, id DESC);
