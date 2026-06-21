# Live Billing Runbook

Status: repository support is ready for operator live-billing canary. Production readiness and live billing readiness remain blocked until sanitized operator evidence is collected, attached, and reviewed.

## Scope

This runbook covers the safe live Stripe billing workflow for BITBI credit packs, BITBI Pro subscriptions, verified webhooks, Customer Portal, optional tax/invoice settings, and evidence handling.

The Admin Live Billing Command Center does not enable live billing. It is a redacted cockpit for configuration presence, local D1 billing signals, reconciliation, review queues, evidence export, and operator go/no-go.

## Deploy Requirement

1. Apply any pending Auth D1 migrations reported by `npm run release:plan`.
2. Deploy the Auth Worker because live billing routes, webhooks, portal, reconciliation, and Admin status are Worker code.
3. Deploy Static Pages because Admin and Credits member UI changed.

No new D1 migration is introduced by this live-billing command-center/portal wave unless `npm run release:plan` reports a pending existing migration from another change.

## Required Cloudflare Secrets And Vars

Configure values only in Cloudflare dashboard or approved secret tooling. Never commit values.

- `STRIPE_LIVE_SECRET_KEY`
- `STRIPE_LIVE_WEBHOOK_SECRET`
- `STRIPE_LIVE_SUBSCRIPTION_PRICE_ID`
- `STRIPE_LIVE_CHECKOUT_SUCCESS_URL`
- `STRIPE_LIVE_CHECKOUT_CANCEL_URL`
- `STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL`
- `STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL`
- `STRIPE_LIVE_CUSTOMER_PORTAL_RETURN_URL`
- `ENABLE_LIVE_STRIPE_CREDIT_PACKS`
- `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS`
- `ENABLE_STRIPE_AUTOMATIC_TAX`
- `ENABLE_STRIPE_TAX_ID_COLLECTION`
- `ENABLE_STRIPE_INVOICE_CREATION`

Recommended initial optional flag values until legal, tax, and accounting review approves them:

- `ENABLE_STRIPE_AUTOMATIC_TAX=false`
- `ENABLE_STRIPE_TAX_ID_COLLECTION=false`
- `ENABLE_STRIPE_INVOICE_CREATION=false`

Optional tax and invoice flags being configured is not legal, tax, accounting, or production-readiness proof.

## Stripe Dashboard Checklist

- Configure the live API key and webhook secret as Cloudflare secrets.
- Configure the live webhook endpoint to point to `/api/billing/webhooks/stripe/live`.
- Subscribe the live webhook endpoint to:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`
  - `checkout.session.expired`
  - `charge.refunded`
  - `refund.created`
  - `refund.updated`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`
- Confirm live one-time credit-pack Prices match the public BITBI catalog exactly.
- Confirm the BITBI Pro live Price ID is a 9.99 EUR monthly subscription and matches `STRIPE_LIVE_SUBSCRIPTION_PRICE_ID`.
- Configure Stripe Customer Portal in Stripe Dashboard before enabling portal usage.
- Enable Stripe Tax, tax ID collection, and invoice options only after operator, legal, tax, and accounting review.

## Admin Starting Point

1. Open `/admin/#live-billing`.
2. Confirm the page reports blocked readiness and redacted config facts only.
3. Confirm the Admin page offers no buttons that create live checkout, call Stripe, refund, claw back credits, cancel subscriptions, mutate Cloudflare, edit secrets, or enable flags.
4. Copy the Cloudflare env checklist and Stripe Dashboard checklist from Admin.
5. Export the sanitized JSON or Markdown status before enabling live flags.

## Local Evidence Tooling

Generate local evidence skeletons:

```bash
npm run billing:canary-evidence
node scripts/billing-canary-evidence.mjs --format json --output docs/production-readiness/evidence/live-billing-canary.json --force
node scripts/billing-canary-evidence.mjs --format markdown --output docs/production-readiness/evidence/live-billing-canary.md --force
```

The evidence tooling is dry-run by default. It makes no Stripe calls, sends no webhooks, triggers no live payments, mutates no credits, mutates no subscriptions, and changes no Cloudflare/D1/R2/GitHub/provider state.

Do not paste raw Stripe secrets, webhook signatures, raw payloads, cards, payment methods, cookies, bearer tokens, session values, raw customer IDs, private object keys, or raw provider responses into evidence files.

## Required Operator Evidence

- `live_credit_pack_checkout_canary`
- `exactly_once_credit_grant_after_verified_webhook`
- `live_subscription_checkout_canary`
- `bitbi_pro_subscription_checkout`
- `verified_webhook_receipt`
- `duplicate_webhook_idempotency`
- `wrong_price_id_rejection`
- `missing_webhook_secret_fail_closed`
- `no_credit_before_webhook`
- `invoice_paid_subscription_credit_grant`
- `refund_dispute_failure_review_only`
- `raw_payload_signature_secret_redaction`
- `customer_portal_session_canary`
- `tax_invoice_configuration_review`
- `redacted_admin_live_billing_export`

Each evidence item must be sanitized and reviewed before any live billing readiness claim.

## Canary Sequence

1. Deploy Auth Worker and Static Pages after validation passes.
2. Open Admin -> Finance -> Live Billing and export redacted status before enabling live flags.
3. Configure Cloudflare secrets/vars with optional tax and invoice flags false.
4. Verify Admin status shows configured shapes, not secrets.
5. Use a dedicated canary member account and perform a controlled live credit-pack purchase only when the operator intentionally triggers a real payment.
6. Confirm no credit before verified webhook, then exactly-one credit grant after `checkout.session.completed`.
7. Replay/duplicate webhook evidence must show idempotency and no duplicate grant.
8. Use a dedicated canary member account for BITBI Pro subscription; confirm subscription state and `invoice.paid` or `invoice.payment_succeeded` top-up once per period.
9. Confirm Customer Portal session is available only after valid Stripe customer context.
10. Confirm failed invoice, refund, and dispute evidence remains review-only.
11. Export sanitized evidence and attach it under `docs/production-readiness/evidence/`.
12. Only then review whether the readiness verdict can move from blocked to operator-reviewed.

## Safety Guarantees

- Checkout creation does not grant credits.
- Credit-pack grants require verified live `checkout.session.completed` payment evidence.
- BITBI Pro monthly credits are topped up only after verified paid subscription invoice evidence.
- Duplicate provider events must not double-grant.
- Wrong Price ID, wrong provider mode, testmode live endpoint events, refunds, disputes, payment failures, and action-required invoices do not automatically grant or claw back credits.
- Refunds, disputes, and payment failures are review-only operator records.
- Admin Live Billing does not call Stripe, refund, cancel, repair, grant, claw back, deploy, mutate Cloudflare, mutate subscriptions, or enable live flags.

## Rollback Plan

1. Set `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false`.
2. Set `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS=false`.
3. Keep the webhook endpoint available for already-created Stripe events unless deliberately retiring the integration.
4. Do not delete evidence, ledger, subscription, checkout, billing event, or review rows.
5. Use Billing Reviews and Billing Reconciliation to inspect any in-flight events before changing Stripe Dashboard routing.

## Readiness Verdict

Allowed current claim: repository support is ready for operator live-billing canary.

Blocked claims until sanitized live evidence exists and has been reviewed:

- Production ready
- Live billing ready
- Stripe live complete
- Live payments proven
