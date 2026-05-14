# BITBI Pro Member Subscriptions Report

## Audit Summary

- Personal member credits were historically stored in `member_credit_ledger` as one running balance. The ledger remains the compatibility source for existing dashboards and histories, but new code adds bucket rows so subscription, purchased, and legacy or bonus credits are separated.
- One-time Stripe member credit packs continue to use `POST /api/account/billing/checkout/live-credit-pack` and the existing `checkout.session.completed` webhook path.
- Live Stripe webhook events are verified and recorded through the existing billing event ingestion tables before side effects. Duplicate provider events remain idempotent.
- The public pricing page was a static vanilla JS page focused on one-time packs. It now separates BITBI Pro monthly subscription from one-time packs.
- Asset Manager quota enforcement lives in the auth worker storage quota helper. The fixed member limit is now resolved dynamically per user.

## Implementation Summary

- Added migration `workers/auth/migrations/0047_add_member_subscriptions_and_credit_buckets.sql`.
- Added `billing_member_subscriptions` for local Stripe subscription state.
- Added `billing_member_subscription_checkout_sessions` for subscription checkout idempotency and audit.
- Added `member_credit_buckets` for separated balances:
  - `subscription`
  - `purchased`
  - `legacy_or_bonus`
- Added `member_credit_bucket_events` for bucket-level audit events.
- Existing `member_credit_ledger` behavior is preserved for compatibility.

## Credit Separation Invariants

- Subscription renewals only inspect the `subscription` bucket for the matching subscription and period.
- Subscription top-up grants only the missing amount needed to return the subscription bucket to 6000 credits.
- Purchased credits are never reduced, reset, overwritten, or counted into the subscription allowance.
- Legacy or bonus credits preserve historical balances whose origin cannot be proven safely.
- New one-time live Stripe credit-pack grants increment the `purchased` bucket and still write the existing member ledger entry.
- Consumption uses subscription credits first, then legacy or bonus credits, then purchased credits.

## Stripe Subscription Flow

- New route: `POST /api/account/billing/checkout/subscription`.
- Checkout uses Stripe Checkout `mode=subscription` with the configured subscription Price ID.
- Checkout creation does not grant credits.
- Subscription lifecycle events update `billing_member_subscriptions`.
- Paid invoice events top up subscription credits idempotently.
- Idempotency key shape for period top-up:
  `subscription-topup:{provider_subscription_id}:{period_start}:{invoice_id}`.

## Storage Behavior

- Admin users remain unlimited.
- Active or trialing paid BITBI Pro subscriptions with a current paid period receive 5 GB.
- Free or inactive users receive 50 MB.
- Users above their current limit after subscription expiry keep existing assets but cannot save more until under the active limit or resubscribed.

## Frontend Changes

- Pricing now shows BITBI Pro separately from one-time credit packs.
- Account Credits dashboard shows total, subscription, legacy or bonus, and purchased credit balances plus subscription state, next top-up, and storage limit.
- Legal terms in English and German mention subscription credits, monthly top-up, non-accumulation, separation from purchased credits, cancellation through the paid period, and immediate digital provision.

## Required Configuration

Set these auth worker variables before enabling live subscriptions:

- `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS=true`
- `STRIPE_LIVE_SUBSCRIPTION_PRICE_ID`
- `STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL`
- `STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL`

Existing one-time credit-pack variables remain unchanged.

## Deployment Notes

- Apply D1 migration `0047_add_member_subscriptions_and_credit_buckets.sql` before deploying auth worker code.
- Deploy auth worker after migration and config are in place.
- Deploy static pages after worker deploy so pricing and dashboard routes are available.
- No destructive database changes are included.

## Validation

Focused and full validation commands are recorded in the implementation summary for the change. The expected gates are:

- `npm run check:js`
- `npm run check:dom-sinks`
- `npm run check:route-policies`
- `npm run test:workers`
- `npm run test:static`
- `npm run test:release-compat`
- `npm run validate:release`

