# Phase 2-L Live Stripe Credit Packs And Credits Dashboard Report

Date: 2026-04-28

## Scope

Phase 2-L adds a narrow live Stripe one-time credit-pack purchase path for platform admins and active organization owners, plus a gated Credits dashboard page. It keeps the Phase 2-K Stripe Testmode lockdown intact and leaves the admin-only Pricing page as a separate Testmode rollout surface.

This phase enables only fixed live one-time credit packs for eligible buyers. It does not make pricing public, does not add subscriptions, invoices, customer portal, Stripe Tax, Connect, coupons, refund automation, or full production billing readiness.

Phase 2-M later updated the live credit-pack economics. The current live catalog is now 5,000 credits for 9.99 EUR and 12,000 credits for 19.99 EUR; the original Phase 2-L 10,000-credit live pack is no longer offered for new checkout creation.

## Files Changed

- `workers/auth/migrations/0040_add_live_stripe_credit_pack_scope.sql`
- `workers/auth/src/lib/stripe-billing.js`
- `workers/auth/src/lib/billing-events.js`
- `workers/auth/src/routes/orgs.js`
- `workers/auth/src/routes/billing-webhooks.js`
- `workers/auth/src/index.js`
- `workers/auth/src/app/route-policy.js`
- `config/release-compat.json`
- `scripts/test-release-compat.mjs`
- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`
- `account/credits.html`
- `css/account/credits.css`
- `js/pages/credits/main.js`
- `js/pages/profile/main.js`
- `js/shared/auth-api.js`
- `account/profile.html`
- `css/account/profile.css`
- `tests/auth-admin.spec.js`
- `workers/auth/CLAUDE.md`
- `CURRENT_IMPLEMENTATION_HANDOFF.md`
- `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `DATA_INVENTORY.md`
- `docs/DATA_RETENTION_POLICY.md`

## Migration

Added forward-only auth D1 migration:

- `0040_add_live_stripe_credit_pack_scope.sql`

Schema summary:

- Adds `authorization_scope` to `billing_checkout_sessions`, constrained to `platform_admin` or `org_owner` when present.
- Adds `payment_status`, `granted_at`, `failed_at`, and `expired_at` for checkout/session reconciliation.
- Adds indexes for provider mode plus organization, user, status, creation time, and authorization-scope lookups.

The migration is additive only. It does not rewrite or migrate old Testmode rows into live purchase rows.

## Access Boundary

Allowed for live checkout and the Credits dashboard:

- Platform/global admin.
- Active organization owner for that same organization.

Denied:

- Unauthenticated users.
- Normal authenticated users without eligible organization ownership.
- Organization admin unless also a platform/global admin.
- Organization member.
- Organization viewer.
- Organization owner for a different organization.
- Stale, inactive, removed, or non-owner memberships.

The server enforces this boundary on every live checkout and Credits dashboard API. Frontend gating is only a usability layer.

## Live Packs And Prices

The live catalog is fixed server-side:

| Pack id | Credits | Amount | Currency |
| --- | ---: | ---: | --- |
| `live_credits_5000` | 5,000 | 9.99 | `eur` |
| `live_credits_12000` | 12,000 | 19.99 | `eur` |

Clients may send only the pack id. The server rejects unknown packs and ignores or rejects client-supplied amount, credits, currency, product, price, or model data.

`live_credits_10000` is retained only as a legacy persisted-session validation concern. New live checkout creation must not offer or silently remap it.

## Live Configuration

Live checkout creation requires:

- `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`
- `STRIPE_LIVE_SECRET_KEY`
- `STRIPE_LIVE_CHECKOUT_SUCCESS_URL`
- `STRIPE_LIVE_CHECKOUT_CANCEL_URL`

Live webhook processing requires:

- `STRIPE_LIVE_WEBHOOK_SECRET`

Fail-closed behavior:

- Missing or non-`true` `ENABLE_LIVE_STRIPE_CREDIT_PACKS` blocks checkout before any Stripe API call.
- `STRIPE_LIVE_SECRET_KEY` must look live-like, currently `sk_live_...`; `sk_test_...` is rejected for live checkout.
- Missing config diagnostics return variable names only, never values.
- The live webhook endpoint fails closed without `STRIPE_LIVE_WEBHOOK_SECRET`.
- These live variables are optional/operator-controlled and are not required for unrelated app routes or local validation.

Testmode remains separate:

- `POST /api/orgs/:id/billing/checkout/credit-pack` remains Phase 2-K platform-admin-only Testmode checkout.
- `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` and Testmode Stripe variables remain unchanged.
- `POST /api/billing/webhooks/stripe` remains the Testmode webhook route.

## New Routes

- `POST /api/orgs/:id/billing/checkout/live-credit-pack`
- `GET /api/orgs/:id/billing/credits-dashboard`
- `POST /api/billing/webhooks/stripe/live`

Route-policy metadata marks the live checkout route as authenticated, same-origin mutation protected, byte-limited, fail-closed, and platform-admin-or-org-owner only. The live webhook route is anonymous/provider-signature authenticated, raw-body parsed, fail-closed, and not browser CSRF protected.

## Checkout Behavior

Live checkout:

- Requires authenticated user.
- Requires active target organization.
- Allows only platform admin or active organization owner.
- Requires `Idempotency-Key`.
- Requires live kill switch and valid live Stripe config.
- Creates a durable internal checkout row before calling Stripe.
- Persists user id, organization id, pack id, credits, amount, currency, provider mode `live`, status, idempotency hash, request fingerprint, and authorization scope.
- Calls Stripe Checkout in `payment` mode with one fixed server-side line item and `payment_method_types[0]=card`.
- Returns only sanitized checkout URL/session/pack metadata.
- Does not grant credits during checkout creation.

No Stripe API call is attempted when authorization, config, rate-limit, body, idempotency, or pack validation fails.

## Webhook Behavior

The live webhook:

- Uses raw request body verification with `Stripe-Signature`.
- Uses `STRIPE_LIVE_WEBHOOK_SECRET`, separate from Testmode.
- Accepts only live Stripe events with `livemode=true`.
- Rejects or safely no-ops Testmode events on the live endpoint.
- Stores billing provider events through the Phase 2-I ingestion foundation with `provider_mode=live`.
- Deduplicates by provider/event id and payload hash.
- Rejects same event id with a different payload hash and grants nothing.
- Grants credits only for verified live `checkout.session.completed` events with `payment_status=paid`.
- Validates session id, pack id, organization id, user id, amount, currency, credits, payment status, provider mode, and persisted checkout row.
- Does not trust Stripe metadata alone for authorization.
- For `org_owner` scope, verifies the buyer is still an active owner of the organization at grant time.
- For `platform_admin` scope, verifies the buyer is still an active platform admin at grant time.
- Uses a deterministic ledger source reference: `stripe_live_checkout:<checkout_session_id>:<pack_id>`.
- Grants exactly once on duplicate deliveries.
- Does not grant for unpaid, failed, expired, canceled, `no_payment_required`, amount mismatch, currency mismatch, pack mismatch, unknown session, authorization revocation, or live/test mode mismatch.

Refund and chargeback reversal automation is not implemented in this phase.

## Credits Dashboard

New page route:

- `/account/credits.html`

The page shell may load for direct access, but dashboard data and purchase controls render only after frontend eligibility checks and successful authorized API responses.

The dashboard shows:

- Organization summary.
- Current/available/reserved balances.
- Lifetime live purchased credits, manual grants, and consumed credits where available.
- Two live pack cards.
- Safe checkout status.
- Recent purchase history.
- Recent ledger activity.
- Success/cancel return states.

Organization owners see generic unavailable checkout messaging if live config is disabled. Platform admins may see missing live config variable names only, never values.

## Profile Navigation

Added a `Credits` link directly below `Wallet` in the profile navigation.

Visibility:

- Platform admins: visible.
- Active organization owners: visible.
- Organization admins, members, viewers, normal users, and logged-out users: hidden.

The existing profile link spacing was tightened so adding Credits does not materially increase the profile navigation block height. Existing Wallet, Studio, and AI Lab behavior is preserved.

## Pricing Page Impact

`/pricing.html` remains the controlled admin-only Testmode Pricing page. It was not made public and was not converted to live checkout. The new live purchase surface is `/account/credits.html`.

No live purchase controls are exposed to organization admins, members, viewers, normal users, or logged-out users.

## Sanitization

Responses and UI do not expose:

- Stripe secret keys.
- Webhook secrets.
- Raw webhook bodies.
- Raw Stripe signatures.
- Raw provider payloads.
- Card or payment method data.
- SQL/debug metadata.
- Service-auth metadata.
- Raw request fingerprints or idempotency hashes.

Admin/operator diagnostics may include missing config variable names only.

## Validation Commands And Results

Validation completed so far during implementation:

- `npm run release:preflight` before edits: PASS.
- `npm run check:js`: PASS.
- `npm run check:route-policies`: PASS.
- `npm run test:workers`: PASS, 352/352.
- `npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "Credits dashboard live credit packs"`: PASS, 3/3.

Full validation must be rerun after documentation updates:

- `git diff --check`
- `npm run check:js`
- `npm run check:route-policies`
- `npm run test:workers`
- `npm run test:release-compat`
- `npm run test:release-plan`
- `npm run validate:release`
- `npm run test:cloudflare-prereqs`
- `npm run validate:cloudflare-prereqs`
- `npm run check:worker-body-parsers`
- `npm run check:data-lifecycle`
- `npm run check:admin-activity-query-shape`
- `npm run test:operational-readiness`
- `npm run check:operational-readiness`
- `npm run test:static`
- `npm run test:asset-version`
- `npm run validate:asset-version`
- `npm run build:static`
- `npm run release:preflight`

Codex did not deploy, apply remote migrations, configure Cloudflare, run live Stripe setup, run real live webhook tests, or mutate dashboard settings.

## Remaining Risks

- Live checkout is narrowly implemented but not production-readiness proof.
- Staging was not performed by Codex.
- If staging is skipped, production canary risk is materially higher.
- Refund/chargeback handling is not automated.
- Legal/product review is still needed for public pricing, billing terms, invoices/receipts/tax handling, refund policy, retention policy, and customer support operations.
- Organization asset ownership migration remains incomplete.
- Full live observability, alerting, restore-drill evidence, and Cloudflare drift control remain open.

## Operator Production Canary Checklist

Documented only; Codex must not execute these steps.

1. Confirm final commit and clean tree:
   `git status --short`
   `git log -1 --oneline`
2. Run final local validation:
   `npm run release:preflight`
3. Take or verify a D1 backup/export before applying migration `0040`.
4. Apply auth migrations through `0040_add_live_stripe_credit_pack_scope.sql`.
5. Keep Testmode config unchanged.
6. Configure live Stripe values with the live flag initially false:
   `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false`
   `STRIPE_LIVE_SECRET_KEY`
   `STRIPE_LIVE_WEBHOOK_SECRET`
   `STRIPE_LIVE_CHECKOUT_SUCCESS_URL`
   `STRIPE_LIVE_CHECKOUT_CANCEL_URL`
7. Register the live Stripe webhook endpoint:
   `POST /api/billing/webhooks/stripe/live`
8. Configure only required live events:
   `checkout.session.completed`
   `checkout.session.expired` if status tracking is desired.
9. Deploy code with `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false`.
10. Verify normal users, organization admins, members, and viewers cannot see or use Credits checkout.
11. Set `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true` only for the canary window.
12. Perform exactly one 9.99 EUR live purchase as a platform admin or active organization owner.
13. Verify live webhook signature validation.
14. Verify exactly one credit ledger grant.
15. Replay the duplicate webhook and verify no duplicate grant.
16. Verify purchase appears on the Credits dashboard.
17. Verify ledger entry appears correctly.
18. Verify no public pricing exposure.
19. Verify organization admin still cannot purchase.
20. Immediately set `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` if anything unexpected occurs.
21. Record health/header checks and restore-drill evidence later; skipping staging does not remove production-readiness gaps.

## Rollback Plan

- Disable live checkout immediately by setting/removing `ENABLE_LIVE_STRIPE_CREDIT_PACKS`.
- Remove or unset `STRIPE_LIVE_SECRET_KEY` or live success/cancel URLs to make checkout fail closed.
- Remove or rotate `STRIPE_LIVE_WEBHOOK_SECRET` to block live webhook processing if needed.
- Hide/revert `/account/credits.html` and profile Credits links in static rollback.
- Leave migration `0040` in place; it is additive and safe if unused.
- Do not delete `credit_ledger`, `usage_events`, `billing_provider_events`, `billing_event_actions`, or `billing_checkout_sessions` during rollback.

## Explicit Non-Readiness Statement

Phase 2-L implements only narrow live one-time credit-pack checkout for platform admins and active organization owners. It is not public billing, not subscriptions, not invoices, not customer portal, not Stripe Tax, not Connect, not coupons, not full SaaS billing readiness, not full tenant isolation, and not production readiness.
