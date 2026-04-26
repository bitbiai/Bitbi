-- Phase 2-B: billing / plans / entitlements / credit ledger foundation.
-- Additive only. No live payment provider, webhook, or invoice processing is
-- enabled by this migration.

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  billing_interval TEXT NOT NULL DEFAULT 'none',
  monthly_credit_grant INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_status_code
  ON plans (status, code);

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'manual',
  provider TEXT,
  provider_customer_ref TEXT,
  provider_subscription_ref TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org_status
  ON organization_subscriptions (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan_status
  ON organization_subscriptions (plan_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  value_kind TEXT NOT NULL DEFAULT 'boolean',
  value_numeric INTEGER,
  value_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id),
  UNIQUE (plan_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_plan_feature
  ON entitlements (plan_id, feature_key);

CREATE TABLE IF NOT EXISTS billing_customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_customer_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placeholder',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  UNIQUE (provider, provider_customer_ref),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_org
  ON billing_customers (organization_id, status);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
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
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_org_idempotency
  ON credit_ledger (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_org_created
  ON credit_ledger (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_org_feature_created
  ON credit_ledger (organization_id, feature_key, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  feature_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  credits_delta INTEGER NOT NULL DEFAULT 0,
  credit_ledger_id TEXT,
  idempotency_key TEXT,
  request_hash TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (credit_ledger_id) REFERENCES credit_ledger(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_org_idempotency
  ON usage_events (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_org_feature_created
  ON usage_events (organization_id, feature_key, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
  ON usage_events (user_id, created_at DESC, id DESC);

INSERT OR IGNORE INTO plans (
  id, code, name, status, billing_interval, monthly_credit_grant,
  metadata_json, created_at, updated_at
) VALUES (
  'plan_free',
  'free',
  'Free',
  'active',
  'none',
  100,
  '{"phase":"2-B","livePaymentProvider":false}',
  '2026-04-26T00:00:00.000Z',
  '2026-04-26T00:00:00.000Z'
);

INSERT OR IGNORE INTO entitlements (
  id, plan_id, feature_key, enabled, value_kind, value_numeric, value_text,
  created_at, updated_at
) VALUES
  ('ent_free_ai_text_generate', 'plan_free', 'ai.text.generate', 1, 'boolean', NULL, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'),
  ('ent_free_ai_image_generate', 'plan_free', 'ai.image.generate', 1, 'boolean', NULL, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'),
  ('ent_free_ai_video_generate', 'plan_free', 'ai.video.generate', 1, 'boolean', NULL, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'),
  ('ent_free_ai_storage_private', 'plan_free', 'ai.storage.private', 1, 'boolean', NULL, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'),
  ('ent_free_org_members_max', 'plan_free', 'org.members.max', 1, 'number', 5, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'),
  ('ent_free_credits_monthly', 'plan_free', 'credits.monthly', 1, 'number', 100, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'),
  ('ent_free_credits_balance_max', 'plan_free', 'credits.balance.max', 1, 'number', 1000, NULL, '2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z');
