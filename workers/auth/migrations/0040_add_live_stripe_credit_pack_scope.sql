-- Phase 2-L: live Stripe credit-pack checkout scope hardening.
-- Additive only. Tracks the server-side authorization scope and live payment
-- state needed to grant credits only for sessions created by a current platform
-- admin or active organization owner. This does not enable subscriptions,
-- invoices, customer portal, Stripe Tax, coupons, Connect, or public billing.

ALTER TABLE billing_checkout_sessions
  ADD COLUMN authorization_scope TEXT
  CHECK (
    authorization_scope IS NULL
    OR authorization_scope IN ('platform_admin', 'org_owner')
  );

ALTER TABLE billing_checkout_sessions
  ADD COLUMN payment_status TEXT;

ALTER TABLE billing_checkout_sessions
  ADD COLUMN granted_at TEXT;

ALTER TABLE billing_checkout_sessions
  ADD COLUMN failed_at TEXT;

ALTER TABLE billing_checkout_sessions
  ADD COLUMN expired_at TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_mode_org_created
  ON billing_checkout_sessions(provider, provider_mode, organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_mode_user_created
  ON billing_checkout_sessions(provider, provider_mode, user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_mode_status_created
  ON billing_checkout_sessions(provider, provider_mode, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_mode_auth_scope
  ON billing_checkout_sessions(provider, provider_mode, authorization_scope, created_at DESC, id DESC)
  WHERE authorization_scope IS NOT NULL;
