# Phase Pricing Page / Credit Packs Report

Date: 2026-04-27

## Executive Summary

This phase adds a controlled, admin-only Pricing page for the current Stripe Testmode credit-pack foundation. It gives platform admins a product-facing way to inspect the free tier, select an eligible owner/admin organization, buy a 5000-credit or 10000-credit Testmode pack, and enter the existing Stripe Testmode Checkout flow.

Phase 2-K supersedes the original backend access boundary described in this report: checkout creation is now server-side platform-admin-only, also requires the signed-in platform admin to be an active owner/admin of the selected organization, and is disabled unless `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true`.

This is not a public pricing rollout. The header link is visible only to authenticated admins, direct page access is frontend admin-gated, and live Stripe remains disabled. No subscriptions, invoices, customer portal, live checkout, production webhooks, or production billing activation were added.

## Scope

- Added `pricing.html` as the controlled pricing route.
- Added `js/pages/pricing/main.js` for admin-gated pricing rendering, org selection, billing state loading, checkout initiation, and success/cancel states.
- Added `css/pages/pricing.css` for the responsive pricing experience.
- Added admin-only Pricing links to the shared desktop/mobile header.
- Updated the Models overlay so implemented capabilities are not mislabeled as `Soon`.
- Updated the Stripe Testmode server catalog to expose `credits_5000` and `credits_10000` for this rollout.
- Updated tests and docs for the product-facing credit packs.

## Pricing Product Rollout Strategy

The Pricing experience is available only to authenticated admins while the Stripe integration remains Testmode-only. This keeps discoverability controlled until staging validates checkout creation, webhook verification, exactly-once credit grants, and no live billing side effects.

The page itself is also gated. Anonymous and non-admin users who open `/pricing.html` directly see an access-denied state, not pricing cards or checkout controls.

## Pricing Route And Header Integration

Route:

- `/pricing.html`

Header visibility:

- Logged-out users: no Pricing link.
- Logged-in non-admin users: no Pricing link.
- Logged-in admins: Pricing link appears in the desktop header to the right of `BITBI` and before the existing main navigation links.
- Logged-in admins on mobile: Pricing appears in the authenticated mobile account area before Admin.

## Pricing Options

The page renders exactly three options:

| Option | Meaning |
| --- | --- |
| Free | Default account tier. Non-admin registered users currently have 10 successful legacy FLUX.1 Schnell image generations per UTC day. |
| Buy 5000 Credits | One-time Stripe Testmode checkout pack, `credits_5000`, 5000 organization credits, 4900 cents `eur`. |
| Buy 10000 Credits | One-time Stripe Testmode checkout pack, `credits_10000`, 10000 organization credits, 8900 cents `eur`. |

The older small Phase 2-J placeholder packs were replaced in the server-side catalog for this rollout instead of being exposed publicly in parallel.

## Checkout Behavior

The page reuses:

- `POST /api/orgs/:id/billing/checkout/credit-pack`

Checkout requirements remain enforced by the auth Worker:

- Authenticated user.
- Active organization membership.
- Organization role `owner` or `admin`.
- Same-origin mutation.
- Byte-limited JSON parser.
- Fail-closed rate limit.
- `Idempotency-Key`.
- `STRIPE_MODE=test`.
- Known active credit pack.

The frontend:

- Loads the admin's organizations through `GET /api/orgs`.
- Filters checkout orgs to active `owner`/`admin` memberships for the signed-in platform admin.
- Selects the only eligible org automatically when there is exactly one.
- Shows an org selector when multiple eligible orgs exist.
- Disables checkout when there is no eligible org.
- Generates an idempotency key for each checkout initiation.
- Redirects only to the sanitized `checkout_url` returned by the backend.
- Does not grant or fake credits at checkout creation time.

## Success And Cancel States

The route supports:

- `/pricing.html?checkout=success`
- `/pricing.html?checkout=cancel`

Success messaging is intentionally asynchronous and Testmode-specific: credits appear only after the verified Stripe Testmode webhook is processed. Cancel messaging confirms no credits were granted.

## Model Status Updates

The Models overlay now distinguishes implemented vs unavailable model states:

- Public/free image model `FLUX.1 Schnell` is shown as `Included`.
- Member-facing org-scoped text model `Llama 3.1 8B Instruct Fast` is shown as `Requires credits`.
- FLUX.2, music, video, and other admin-only/provider-lab entries that are not member-facing paid routes remain `Coming soon`.

No unsupported model was marked live or purchasable. Admin AI Lab remains admin-only and is not charged by this page.

## Backend/API Changes

- `workers/auth/src/lib/stripe-billing.js` now exposes `credits_5000` and `credits_10000` as the active Testmode credit-pack catalog.
- No new backend route was added.
- Added forward-only auth D1 migration `0039_raise_credit_balance_cap_for_pricing_packs.sql` to raise the original Phase 2-B `credits.balance.max` entitlement cap so verified 5000/10000-credit Testmode webhook grants do not fail closed.
- No dependency was added.
- Existing Stripe raw-body webhook verification, event dedupe, payload mismatch handling, checkout idempotency, and exact-once credit grant behavior remain in place.

## Security And Standards

- Pricing link is admin-only in desktop and mobile header render paths.
- Direct pricing route access is frontend admin-gated.
- Checkout creation is backend-enforced by platform admin auth/MFA policy plus org owner/admin RBAC, and remains disabled unless `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true`.
- Live Stripe mode remains rejected by the backend.
- No secret values, Stripe signatures, provider payloads, raw webhook bodies, tokens, hashes, SQL/debug metadata, or service-auth internals are rendered.
- The page does not expose Cloudflare or Stripe configuration editing.

## Tests Added / Updated

- Static tests cover admin-only Pricing header visibility, hidden pre-login/non-admin behavior, direct route access denial, three pricing cards, checkout initiation with idempotency key, success/cancel states, responsive layout, and updated Models overlay status labels.
- Worker tests were updated so the Stripe Testmode checkout/webhook exact-once tests use `credits_5000` and `credits_10000`.
- Admin Control Plane static fixtures were updated to reflect the new product-facing credit-pack IDs.

## Validation Results

Passed:

- `npm run check:js`
- `npm run check:route-policies`
- `npm run test:workers` (`346 passed`)
- `npm run test:static` (`163 passed`)
- `npm run test:release-compat`
- `npm run test:release-plan`
- `npm run test:cloudflare-prereqs`
- `npm run validate:cloudflare-prereqs` (repo config PASS; live validation SKIPPED; production deploy BLOCKED)
- `npm run validate:release`
- `npm run check:worker-body-parsers`
- `npm run check:data-lifecycle`
- `npm run check:admin-activity-query-shape`
- `npm run test:operational-readiness`
- `npm run check:operational-readiness`
- `npm run test:asset-version`
- `npm run validate:asset-version`
- `npm run build:static`
- `npm run release:preflight`

Failures found and fixed during validation:

- Initial `npm run test:workers` failed because the new 5000-credit pack exceeded the old Phase 2-B `credits.balance.max` seed/cap. Fixed with forward-only migration `0039_raise_credit_balance_cap_for_pricing_packs.sql` and updated harness seed data.
- Initial `npm run test:static` failed on two pricing assertions: header order with the existing Profile link and local `/pricing` URL normalization for success/cancel states. Fixed the tests to match actual app routing.
- Initial `npm run release:preflight` failed because `pricing.html` and this phase report were uncategorized by the release planner. Fixed by adding `pricing.html` to static asset roots/source scanning and classifying the pricing phase report as validation metadata.
- A later `npm run release:preflight` failed the DOM sink guard because the pricing page used `innerHTML`. Fixed by replacing the pricing page rendering path with DOM node construction and `textContent`.

## Merge Readiness

Merge-ready from local validation. `npm run release:preflight` is green, and no production-affecting commands were run.

## Production Deploy Readiness

Blocked. This page depends on the existing Phase 2-J/2-K Stripe Testmode foundation and migration `0039_raise_credit_balance_cap_for_pricing_packs.sql`, and remains a controlled admin-only Testmode rollout. Production readiness requires verification of platform-admin-only checkout creation, disabled kill-switch behavior, Stripe Testmode webhook completion, exactly-once credit grant, non-admin-created checkout no-credit behavior, success/cancel return URLs, model status truthfulness, and no live billing side effects.

## Staging Verification Steps

1. Deploy static pricing page and auth Worker code to staging only after migrations through `0039` are applied.
2. Configure Stripe Testmode env vars and success/cancel URLs, preferably `/pricing.html?checkout=success` and `/pricing.html?checkout=cancel`.
3. Sign in as admin and verify the Pricing link appears in desktop/mobile headers.
4. Verify anonymous and non-admin users cannot see the header link or pricing cards.
5. Enable `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` only for the canary window, then create a Testmode checkout session for `credits_5000` and `credits_10000` as a platform admin who is also org owner/admin.
6. Complete a Stripe Testmode checkout and verify webhook grants credits exactly once.
7. Verify duplicate webhooks do not grant credits twice.
8. Verify Models overlay labels match actual member-facing capabilities.

## Rollback Plan

- Revert `pricing.html`, `js/pages/pricing/main.js`, `css/pages/pricing.css`, and header/model overlay changes to remove the pricing surface.
- Revert the `STRIPE_CREDIT_PACKS` catalog change if the old placeholder packs are still needed for internal tests.
- Keep migrations `0038` and `0039` in place; both are additive/forward-only and safe to leave unused if the pricing page is reverted.
- Remove or leave unused Stripe Testmode success/cancel URLs in staging configuration.

## Remaining Risks

- Pricing is still admin-only and not a public rollout.
- Prices are Testmode placeholders and not final production commercial policy.
- Live Stripe, subscriptions, invoices, customer portal, production payment webhooks, and production billing activation remain disabled.
- Only implemented org-scoped image/text routes are credit-enforced; video/music remain unavailable for member paid usage.
- Existing assets are still not fully tenant-migrated.

## Next Recommended Actions

1. Review the pricing/header/model/catalog diff for truthfulness and access control.
2. Apply auth D1 migrations through `0039` in staging before deploying auth Worker changes.
3. Configure staging Stripe Testmode success/cancel URLs to the pricing return states.
4. Verify end-to-end Testmode checkout-to-webhook-to-credit-grant behavior in staging.
5. Decide whether to keep pricing admin-only for another release or define a public rollout gate.
