# Phase 2-J Stripe Testmode Credit Pack Checkout Report

Date: 2026-04-26

## Executive Summary

Phase 2-J adds a Stripe Testmode-only credit-pack checkout foundation. It lets active organization owners/admins create Stripe Testmode Checkout Sessions for fixed server-side credit packs and lets the auth Worker verify Stripe Testmode `checkout.session.completed` webhooks from raw body plus `Stripe-Signature` before idempotently granting organization credits.

This phase does not activate live payments. It does not add subscriptions, invoices, customer portal, Stripe Tax, Stripe Connect, coupons, frontend checkout UI, production billing, or a global paywall.

## Scope

- Added a testmode-only Stripe provider adapter using `fetch`; no Stripe SDK or dependency was added.
- Added a fixed test credit-pack catalog: `credits_100`, `credits_500`, and `credits_1000`.
- Added owner/admin org checkout creation for credit packs.
- Added Stripe Testmode webhook verification and processing for `checkout.session.completed`.
- Added idempotent checkout/session/event/ledger behavior.
- Preserved Phase 2-I provider-neutral synthetic webhook ingestion.
- Preserved org-scoped AI image/text credit enforcement, usage attempts, reservation/replay, and cleanup behavior.

## Provider Strategy

Stripe is now an explicit provider adapter, but only for Testmode:

- Required for checkout creation: `STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_CHECKOUT_SUCCESS_URL`, and `STRIPE_CHECKOUT_CANCEL_URL`.
- Required for webhook verification: `STRIPE_MODE=test` and `STRIPE_WEBHOOK_SECRET`.
- `STRIPE_MODE=live`, `sk_live_...`, and live-mode webhook payloads are rejected in this phase.
- Stripe config is optional in release compatibility because unrelated app routes must continue to run without Stripe configured; Stripe routes fail closed when config is absent.

## New Migration / Schema

Added auth D1 migration:

- `workers/auth/migrations/0038_add_stripe_credit_pack_checkout.sql`

New table:

- `billing_checkout_sessions`

The table records provider, mode, Stripe Checkout Session id, optional payment intent/customer ids, organization id, user id, credit pack id, credits, amount, currency, status, idempotency/request hashes, optional checkout URL for same-key retry, billing event linkage, credit ledger linkage, timestamps, and sanitized metadata.

Indexes cover provider session uniqueness, organization/user idempotency uniqueness, org/status lookup, provider payment intent lookup, credit pack lookup, and billing event lookup.

The migration is additive and forward-only. It does not rebuild or delete existing tables.

## Credit Pack Catalog

Server-side Testmode catalog:

| Pack | Credits | Amount | Currency | Notes |
| --- | ---: | ---: | --- | --- |
| `credits_100` | 100 | 900 cents | `eur` | Testmode placeholder |
| `credits_500` | 500 | 3900 cents | `eur` | Testmode placeholder |
| `credits_1000` | 1000 | 6900 cents | `eur` | Testmode placeholder |

These are not final production prices. Webhook processing validates credits, amount, currency, mode, metadata, session id, and paid status against the server-side catalog before granting credits.

## Checkout Creation Behavior

Route:

- `POST /api/orgs/:id/billing/checkout/credit-pack`

Requirements:

- Authenticated user.
- Active org membership.
- Org role `owner` or `admin`.
- Same-origin request.
- Byte-limited JSON body.
- Fail-closed rate limit.
- `Idempotency-Key` required.
- `STRIPE_MODE=test`.
- Known active credit pack.

The route creates a Stripe Testmode Checkout Session in `payment` mode and stores sanitized checkout metadata. Same idempotency key plus same request returns the same safe session response; same key plus different pack/org/user conflicts before another Stripe call. Credits are not granted during checkout creation.

## Stripe Webhook Behavior

Route:

- `POST /api/billing/webhooks/stripe`

The route is intentionally not browser-CSRF protected because it is provider-facing, but it is raw-body limited, fail-closed rate limited, and authenticated by Stripe signature verification. It verifies `Stripe-Signature` using raw body and `STRIPE_WEBHOOK_SECRET` before JSON parsing.

Accepted side-effect event in Phase 2-J:

- Testmode `checkout.session.completed`

Unsupported events are stored/ignored safely where applicable. Live-mode events are rejected or ignored with no side effects.

## Event Idempotency And Credit Grant Behavior

- Billing provider events are stored through the Phase 2-I ingestion foundation.
- Duplicate provider event id with the same payload hash is idempotent and does not grant credits twice.
- Duplicate provider event id with a different payload hash conflicts and creates no side effects.
- Valid Testmode checkout completion grants credits once using the Phase 2-B credit ledger helper with an idempotent Stripe event source reference.
- Unsupported, unpaid, live-mode, malformed, mismatched amount/currency, or metadata-invalid events grant no credits.
- No usage events are created by checkout/webhook processing.
- No organization subscriptions or plans are upgraded in this phase.

## Admin Inspection

Existing admin billing event routes continue to provide sanitized inspection:

- `GET /api/admin/billing/events`
- `GET /api/admin/billing/events/:id`

Admin responses omit raw webhook bodies, raw signatures, Stripe secrets, card/payment method data, raw provider payloads, payload hashes, and SQL/debug metadata.

## Route Policy And Release Compatibility

Route policy entries added:

- `orgs.billing.checkout.credit-pack`
- `billing.webhooks.stripe`

Release compatibility now tracks:

- Latest auth migration `0038_add_stripe_credit_pack_checkout.sql`.
- Literal auth Worker route `POST /api/billing/webhooks/stripe`.
- Optional Stripe Testmode prereqs: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.

## Tests Added / Updated

Worker tests cover:

- Checkout auth/RBAC: unauthenticated, non-member, member/viewer denial, owner/admin success.
- Checkout idempotency and conflict handling.
- Missing/unknown pack, missing Stripe config, live mode, Stripe API failure, foreign origin, oversized body, limiter `429`, and fail-closed limiter `503`.
- Stripe webhook missing/invalid/stale signature, missing secret, oversized raw body, malformed verified JSON, live-mode rejection, unsupported events, metadata/amount/unpaid failures.
- Valid Testmode checkout completion granting credits exactly once.
- Duplicate same event no double grant.
- Same event id/different payload hash conflict.
- Admin billing event inspection sanitization.
- Route policy coverage for checkout and Stripe webhook routes.
- Release compatibility migration/route/prereq tracking.

## Commands Run And Results

Validation during implementation:

| Command | Result |
| --- | --- |
| `npm run release:preflight` before edits | PASS |
| `npm run check:js` | PASS |
| `npm run check:route-policies` | PASS |
| `npm run check:worker-body-parsers` | PASS |
| `npm run test:release-compat` | PASS |
| `npm run test:workers` | PASS, 346/346 |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "Phase 2-J"` | PASS, 4/4 |
| `npm run test:static` | PASS, 155/155 |
| `npm run test:release-plan` | PASS |
| `npm run test:cloudflare-prereqs` | PASS |
| `npm run validate:cloudflare-prereqs` | PASS for repo config, live validation skipped, production deploy blocked |
| `npm run validate:release` | PASS |
| `npm run check:data-lifecycle` | PASS |
| `npm run check:admin-activity-query-shape` | PASS |
| `npm run test:operational-readiness` | PASS |
| `npm run check:operational-readiness` | PASS |
| `npm run build:static` | PASS |
| `npm run release:preflight` | PASS |
| `git diff --check` | PASS |

Package manifests and lockfiles were not changed, so `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low` were not rerun for Phase 2-J.

## Merge Readiness

Ready for pre-merge review. Release preflight is green and the full Worker/static/release validation set passed locally. No commit or push was performed.

## Production Deploy Readiness

Blocked. Production/staging deployment requires:

- Applying auth D1 migration `0038_add_stripe_credit_pack_checkout.sql`.
- Configuring Stripe Testmode-only secrets/vars in staging.
- Creating a Stripe Testmode webhook endpoint pointing at `/api/billing/webhooks/stripe`.
- Verifying checkout creation, webhook signature verification, valid Testmode checkout completion, duplicate event handling, payload mismatch handling, exactly-once credit grant, failed/unpaid no-credit behavior, sanitized admin inspection, and no live billing side effects.

Live Stripe payments are not enabled by this phase.

## Rollback Plan

- Disable/remove Stripe Testmode config to make checkout/webhook routes fail closed.
- Revert the auth Worker code and route-policy/release/doc/test changes if needed.
- Do not roll back migration `0038` destructively; leave the additive table unused unless a reviewed forward migration is created.
- Existing credits already granted in staging/test should be reviewed and corrected with explicit admin ledger adjustments only if needed.

## Remaining Risks

- Stripe Testmode catalog amounts are placeholders, not final pricing.
- Full production billing, subscriptions, invoices, taxes, customer portal, and live webhooks remain unimplemented.
- Checkout URL is stored for idempotent same-key retry; it is not exposed through admin event inspection but should be revisited before production billing.
- Billing/customer lifecycle export/delete policy remains incomplete until legal/product review.
- Staging/liveness verification is still required.

## Next Recommended Actions

1. Run full Phase 2-J validation and review diffs.
2. Apply migration `0038` in staging only.
3. Configure Stripe Testmode secrets/URLs/webhook endpoint in staging.
4. Verify Testmode checkout-to-webhook-to-credit-grant exactly-once behavior.
5. Decide whether the next phase is live-provider hardening, subscriptions, invoices, customer portal, or video AI credit enforcement.
