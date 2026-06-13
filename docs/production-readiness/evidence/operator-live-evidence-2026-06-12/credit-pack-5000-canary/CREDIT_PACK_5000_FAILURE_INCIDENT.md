# 5000 Credit Pack Canary Fulfillment Failure

Generated: 2026-06-13

## Status

Live billing remains operator-approved for the broader system, but this 5000-credit-pack canary is a failed fulfillment incident until the paid checkout is repaired and verified.

Recommended temporary safety action:

- Set `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` until the repair/hardening Worker deploy is complete and the already-paid checkout is repaired.
- Keep `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS` and `/api/billing/webhooks/stripe/live` unchanged unless the operator explicitly decides otherwise.
- Do not ask the member to purchase again.

## Proven From Operator Evidence

- Before purchase, the member Credits page showed:
  - Total available: 2580 credits
  - Purchased credits: 64
  - Subscription credits: 0
  - Legacy/bonus credits: 2516
- After purchase, the member Credits page still showed:
  - Total available: 2580 credits
  - Purchased credits: 64
- After purchase, purchase history showed a new `live_credits_5000` row with:
  - Status: `created`
  - Amount: 9.99 EUR
  - Scope: member
- Stripe showed a live successful checkout/payment for:
  - Amount: 999 EUR cents
  - Credit pack: `live_credits_5000`
  - Credits: 5000
  - Scope: member
  - Mode: live
  - Local/internal checkout reference present
- Stripe webhook delivery for `checkout.session.completed` returned HTTP 500 / Cloudflare error code 1101.
- Admin live-billing export after purchase showed:
  - `memberLiveCreditPackByStatus.created` increased by 1
  - `memberLiveCreditPackByStatus.completed` did not increase
  - Provider grant rows did not increase
  - Recent Admin live event list did not include the new `checkout.session.completed` event

## Failure Chain

1. BITBI created a local member live credit-pack checkout row.
2. Stripe captured the live 9.99 EUR payment.
3. Stripe delivered `checkout.session.completed` to the live webhook endpoint.
4. The Worker returned HTTP 500 / Cloudflare 1101.
5. BITBI did not persist a successful provider event for the checkout.
6. BITBI did not grant the 5000 purchased credits.
7. The member checkout remained `created`.

## What Is Unknown

The exact runtime exception is not present in the local evidence artifacts. Cloudflare Worker logs for the failing delivery are required to identify the exact stack trace. This report does not guess the stack trace.

## Repair Policy

The repair must be idempotent and operator-audited:

- Verify the local checkout row is a live member `live_credits_5000` checkout for 999 EUR cents and 5000 credits.
- Verify redacted Stripe payment evidence manually before applying the repair.
- Use the same purchased-credit bucket and `stripe_live_checkout` source as normal webhook fulfillment.
- Use the webhook-compatible member ledger idempotency key derived from the Stripe checkout session and pack id.
- Link the checkout row to the member ledger entry and mark it completed/paid.
- Re-running the same repair must be a no-op and must not double-grant credits.
- Do not store raw Stripe payloads, webhook signatures, checkout URLs, customer portal URLs, card data, cookies, bearer tokens, or secrets.

## Evidence Status

This canary must not be marked artifact-backed successful until a follow-up evidence package shows:

- The repair was applied by an admin/operator using the dry-run-first repair path.
- The member purchased-credit balance increased by exactly 5000 once.
- The checkout row moved from `created` to `completed`.
- The member ledger contains exactly one `stripe_live_checkout` grant for the checkout.
- Duplicate repair/webhook attempts did not double-grant.

