-- Member Stripe customers are not organization billing_customers. Preserve the
-- existing organization FK and add an explicitly separate provider/mode identity.
CREATE TABLE billing_member_customers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider = 'stripe'),
  provider_mode TEXT NOT NULL CHECK(provider_mode = 'live'),
  provider_customer_ref TEXT NOT NULL CHECK(provider_customer_ref <> ''),
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_mode, provider_customer_ref)
);
CREATE INDEX idx_billing_member_customers_user ON billing_member_customers(user_id, provider, provider_mode);
CREATE TRIGGER billing_member_customers_identity_immutable
BEFORE UPDATE ON billing_member_customers
WHEN NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.provider <> OLD.provider
  OR NEW.provider_mode <> OLD.provider_mode OR NEW.provider_customer_ref <> OLD.provider_customer_ref
BEGIN SELECT RAISE(ABORT, 'member customer identity is immutable'); END;

ALTER TABLE billing_provider_events ADD COLUMN member_billing_customer_id TEXT
  REFERENCES billing_member_customers(id) ON DELETE SET NULL;

-- A started operation exists only within one batch; completion and all effects
-- commit together. No asynchronous claim or expiring lease is introduced.
CREATE TABLE billing_member_subscription_operations (
  event_id TEXT PRIMARY KEY REFERENCES billing_provider_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_customer_id TEXT NOT NULL REFERENCES billing_member_customers(id),
  provider_subscription_id TEXT NOT NULL,
  local_subscription_id TEXT REFERENCES billing_member_subscriptions(id) ON DELETE SET NULL,
  mutation_token TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('started', 'completed')),
  outcome_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_member_subscription_operations_subscription
  ON billing_member_subscription_operations(provider_subscription_id, event_id);

-- The service period, never the Event/Invoice delivery ID, owns the allowance.
-- The start is already the bucket's unique boundary; a different end conflicts.
CREATE TABLE billing_member_subscription_periods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_subscription_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end > period_start),
  allowance INTEGER NOT NULL CHECK(allowance > 0),
  provider_invoice_id TEXT NOT NULL UNIQUE,
  mutation_token TEXT NOT NULL,
  ledger_entry_id TEXT REFERENCES member_credit_ledger(id) ON DELETE SET NULL,
  granted_credits INTEGER NOT NULL DEFAULT 0 CHECK(granted_credits >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(provider_subscription_id, period_start)
);
CREATE INDEX idx_member_subscription_periods_user ON billing_member_subscription_periods(user_id, period_start);

-- Legacy/in-flight writers must not move an already bound subscription between
-- owners or Stripe identities. NULL customer bindings may be completed once.
CREATE TRIGGER billing_member_subscription_identity_immutable
BEFORE UPDATE ON billing_member_subscriptions
WHEN NEW.user_id <> OLD.user_id OR NEW.provider <> OLD.provider OR NEW.provider_mode <> OLD.provider_mode
  OR NEW.provider_subscription_id <> OLD.provider_subscription_id
  OR (OLD.provider_customer_id IS NOT NULL AND NEW.provider_customer_id IS NOT OLD.provider_customer_id)
BEGIN SELECT RAISE(ABORT, 'member subscription identity is immutable'); END;

-- A customer already used by the organization contract is not a member payment
-- identity. Neither old nor new writers may silently move it across scopes.
CREATE TRIGGER billing_member_customer_scope_fence
BEFORE INSERT ON billing_member_customers
WHEN EXISTS (SELECT 1 FROM billing_customers WHERE provider=NEW.provider AND provider_customer_ref=NEW.provider_customer_ref)
BEGIN SELECT RAISE(ABORT, 'billing customer scope conflicts'); END;
CREATE TRIGGER billing_organization_customer_scope_fence_insert
BEFORE INSERT ON billing_customers
WHEN EXISTS (SELECT 1 FROM billing_member_customers WHERE provider=NEW.provider AND provider_customer_ref=NEW.provider_customer_ref)
BEGIN SELECT RAISE(ABORT, 'billing customer scope conflicts'); END;
CREATE TRIGGER billing_organization_customer_scope_fence_update
BEFORE UPDATE ON billing_customers
WHEN EXISTS (SELECT 1 FROM billing_member_customers WHERE provider=NEW.provider AND provider_customer_ref=NEW.provider_customer_ref)
BEGIN SELECT RAISE(ABORT, 'billing customer scope conflicts'); END;
