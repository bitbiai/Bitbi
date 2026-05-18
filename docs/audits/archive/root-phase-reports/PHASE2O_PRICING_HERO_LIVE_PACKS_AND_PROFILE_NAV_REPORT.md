# Phase 2-O Pricing Hero Live Packs And Profile Navigation Report

Date: 2026-04-29

## Scope

Phase 2-O is a runtime UI/UX and navigation reconciliation pass. It updates the admin-gated Pricing page to match the current live credit-pack model from Phase 2-L/2-M and keeps profile navigation aligned with the Credits and Organization pages from Phase 2-L/2-N.

This phase does not add billing architecture, public billing, subscriptions, invoices, customer portal, Stripe Tax, coupons, Connect, refunds, chargeback reversal, new backend authorization, deployments, remote migrations, live Stripe setup, real payments, or Cloudflare dashboard mutations.

## Files Changed

- `pricing.html`
- `css/pages/pricing.css`
- `js/pages/pricing/main.js`
- `css/account/profile.css`
- `tests/auth-admin.spec.js`

Documentation updated:

- `CURRENT_IMPLEMENTATION_HANDOFF.md`
- `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE2O_PRICING_HERO_LIVE_PACKS_AND_PROFILE_NAV_REPORT.md`

## Migration

No migration was added. Latest auth migration remains `0040_add_live_stripe_credit_pack_scope.sql`.

## Pricing Page Hero

The Pricing page hero was redesigned to use the same dark/glass BITBI visual language as the rest of the static site, with larger hero spacing, radial cyan/gold atmosphere, and responsive card layout.

Final hero title:

- `Credits for BITBI AI`

Visible stale Testmode wording was removed from the Pricing page runtime UI. The page remains admin-gated and does not claim public checkout.

## Final Visible Pricing Tiers

- Free
- 5,000 credits — 9.99 EUR (`9,99 €`)
- 12,000 credits — 19.99 EUR (`19,99 €`)

The outdated visible 10,000-credit tier was removed from the Pricing page. The paid cards use the current live pack ids for display alignment:

- `live_credits_5000`
- `live_credits_12000`

## CTA And Access Truthfulness

Paid Pricing CTAs now open `/account/credits.html` instead of calling the older Stripe Testmode checkout route directly. Checkout remains controlled by the existing Credits dashboard backend authorization and live/Testmode kill switches.

The Pricing route and header link remain admin-gated. Organization owners who are eligible for live credit packs use the Credits page rather than this admin-only Pricing preview.

## Profile Navigation

The profile navigation/card stack keeps the account links in this order:

- Existing links above Wallet, including Studio and AI Lab where eligible.
- Wallet
- Credits
- Organization

Credits and Organization visibility remains tied to the existing eligible states: platform/global admins and active organization owners. The profile card stack was compacted when Credits and Organization are visible so the account navigation footprint remains controlled without clipping or hiding links.

### Corrective Profile Navigation Fix

A follow-up regression fix updated the profile navigation eligibility check to match the real `/api/profile` response shape. The backend profile account payload reports `email`, `role`, verification state, and creation timestamp, but does not include `account.id`; the frontend previously hid Credits and Organization before checking platform-admin eligibility when `account.id` was absent.

Current behavior:

- Platform/global admins see `Credits` and `Organization` directly under `Wallet` on `/account/profile.html`, even if an organization dashboard for the selected org is unavailable.
- Active organization owners can still see the links after the organization-list eligibility check succeeds.
- Regular users, organization admins, members, and viewers remain hidden from the restricted Credits/Organization profile links unless they meet the eligible owner/platform-admin condition.
- No billing backend, Stripe behavior, migrations, or authorization boundaries changed.

## Validation

Focused static tests were added/updated for the Pricing hero, live pack tiers, removal of stale Testmode runtime copy, paid CTA routing to Credits, and profile navigation ordering/height.

Commands run:

- `npm run release:preflight` before edits: passed. Live health/security checks and live Cloudflare validation remained skipped, so production deploy stayed blocked by live verification.
- `npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "Pricing credit-pack rollout|admin profile keeps AI Lab|organization owner mobile profile"`: passed after updating Phase 2-O expectations.
- `git diff --check`: passed.
- `npm run check:js`: passed.
- `npm run check:route-policies`: passed.
- `npm run test:workers`: passed, `360/360`.
- `npm run test:release-compat`: passed.
- `npm run test:release-plan`: passed.
- `npm run validate:release`: passed.
- `npm run test:cloudflare-prereqs`: passed.
- `npm run validate:cloudflare-prereqs`: passed for repo config; live Cloudflare validation remained skipped and production deploy remained blocked.
- `npm run check:worker-body-parsers`: passed.
- `npm run check:data-lifecycle`: passed.
- `npm run check:admin-activity-query-shape`: passed.
- `npm run test:operational-readiness`: passed.
- `npm run check:operational-readiness`: passed.
- `npm run test:static`: passed, `171/171`.
- `npm run test:asset-version`: passed.
- `npm run validate:asset-version`: passed.
- `npm run build:static`: passed.
- `npm run release:preflight`: passed on rerun. The first post-edit preflight attempt failed inside the embedded static suite due timeout-heavy unrelated audio/smoke/wallet tests; standalone `npm run test:static` had already passed, and the full preflight passed on rerun without code changes.

## Remaining Risks

- The Pricing page is a restricted UI preview; production checkout readiness still depends on the Credits dashboard backend, Stripe configuration, webhook verification, and operator-run canary verification.
- Live credit packs remain disabled unless `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`.
- Public billing, subscriptions, invoices, customer portal, Stripe Tax, coupons, Connect, refunds, and chargeback reversal remain unimplemented.
- Staging/live verification was not performed by Codex.

## Non-Goals

- No new billing architecture.
- No public billing expansion.
- No subscriptions.
- No invoices.
- No customer portal.
- No Stripe Tax.
- No production readiness claim.
- No deploys, remote migrations, live Stripe setup, real payments, or Cloudflare dashboard mutations by Codex.
