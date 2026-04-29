# Phase 2-M Admin BFL Image Test Credit Pricing Report

Date: 2026-04-29

## Scope

Phase 2-M makes two narrow changes:

- Updates the live Stripe credit-pack economics used by the gated Credits dashboard/live checkout flow.
- Charges existing organization credits only when a platform/global admin runs the existing Admin AI image test for supported Black Forest Labs image models.

This phase does not change member-facing image generation pricing, does not expose Admin AI tests to normal users, does not make pricing public, and does not implement subscriptions, invoices, customer portal, Stripe Tax, coupons, Connect, refunds, chargeback reversal, or full production readiness.

## Files Changed

- `workers/auth/src/lib/admin-ai-image-credit-pricing.js`
- `workers/auth/src/lib/stripe-billing.js`
- `workers/auth/src/lib/billing.js`
- `workers/auth/src/routes/admin-ai.js`
- `workers/auth/src/app/route-policy.js`
- `admin/index.html`
- `js/pages/admin/ai-lab.js`
- `tests/workers.spec.js`
- `tests/auth-admin.spec.js`
- `CURRENT_IMPLEMENTATION_HANDOFF.md`
- `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md`
- `DATA_INVENTORY.md`
- `docs/DATA_RETENTION_POLICY.md`
- `workers/auth/CLAUDE.md`
- `PHASE2M_ADMIN_BFL_IMAGE_TEST_CREDIT_PRICING_REPORT.md`

## Migration

No new migration was added.

Phase 2-M reuses existing tables:

- `credit_ledger`
- `usage_events`
- `ai_usage_attempts`
- `billing_checkout_sessions` for the already-existing live checkout flow

Latest auth D1 migration remains:

- `0040_add_live_stripe_credit_pack_scope.sql`

## Updated Live Credit Pack Prices

The current live server-side catalog is:

| Pack id | Credits | Amount | Currency |
| --- | ---: | ---: | --- |
| `live_credits_5000` | 5,000 | 9.99 EUR | `eur` |
| `live_credits_12000` | 12,000 | 19.99 EUR | `eur` |

`live_credits_10000` is not offered for new live checkout creation and is not silently remapped. If any old persisted checkout row exists, webhook processing can only validate it against the server-side persisted row and exact stored amount/currency/credits.

## Stripe Fee And Net Credit Value

Operator-supplied Stripe fee assumption:

- `0.75% + 0.25 EUR` per payment

5,000-credit pack:

- Stripe fee: `9.99 * 0.0075 + 0.25 = 0.324925 EUR`
- Net revenue: `9.99 - 0.324925 = 9.665075 EUR`
- Net revenue per credit: `9.665075 / 5000 = 0.001933015 EUR`

12,000-credit pack:

- Stripe fee: `19.99 * 0.0075 + 0.25 = 0.399925 EUR`
- Net revenue: `19.99 - 0.399925 = 19.590075 EUR`
- Net revenue per credit: `19.590075 / 12000 = 0.00163250625 EUR`

The server uses the conservative 12,000-credit net value:

- `BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING = 0.00163250625`

## Pricing Constants And Formula

Constants:

- `BITBI_MODEL_PRICING_USD_TO_EUR = 0.855176`
- `BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING = 0.00163250625`
- `BITBI_TARGET_PROFIT_MARGIN = 0.20`

The exchange-rate value is a fixed pricing baseline and is not fetched at runtime.

Credit formula:

```text
requiredCredits = ceil((providerCostUsd * 0.855176 / 0.80) / 0.00163250625)
```

Any chargeable successful admin image test has a minimum charge of one credit.

## Model Pricing Formulas

### Flux 1 Schnell

Model id:

- `@cf/black-forest-labs/flux-1-schnell`

Provider pricing assumptions:

- `0.0000528 USD` per 512x512 output tile
- `0.0001056 USD` per diffusion step
- Default steps: 4
- Maximum steps considered by the pricing helper: 8

Formula:

```text
tileCount = ceil(width / 512) * ceil(height / 512)
providerCostUsd = tileCount * 0.0000528 + steps * 0.0001056
```

Default admin image test:

- 1024x1024
- 4 steps
- Provider cost: `0.0006336 USD`
- Final charge: 1 credit

### Flux 2 Klein 9B

Recognized model ids:

- `@cf/black-forest-labs/flux-2-klein-9b`
- `black-forest-labs/flux-2-klein-9b`

Provider pricing assumptions:

- `0.015 USD` for the first output MP
- `0.002 USD` per subsequent output MP
- `0.002 USD` per input image MP

Formula:

```text
outputMp = (width * height) / 1_048_576
outputCostUsd = 0.015 + max(outputMp - 1, 0) * 0.002
inputImageCostUsd = sum(inputImageMp) * 0.002
providerCostUsd = outputCostUsd + inputImageCostUsd
```

Default text-only admin image test:

- Output up to 1MP
- Provider cost: `0.015 USD`
- Final charge: 10 credits

Larger output examples:

- 2MP: 12 credits
- 4MP: 14 credits

## Final Credit Deductions

Default Admin AI Lab labels and server charges:

- Flux 1 schnell: `Run image test · 1 credit`
- Flux 2 klein 9B: `Run image test · 10 credits`

The frontend cost label is display-only. The server calculates the authoritative credit cost from model id and bounded model parameters.

## Admin Access Boundary

The charged image-test path remains Admin AI Lab only:

- Platform/global admin required.
- Normal users are denied.
- Organization owners are denied unless they are also platform/global admins.
- Organization admins are denied unless they are also platform/global admins.
- Organization members and viewers are denied.
- Public/member routes are not changed.

## Organization Credit Source

A charged BFL Admin AI image test requires `organization_id` / `organizationId`.

Credits are deducted from the selected organization's existing credit balance. No personal/user-only balance is created. If organization context is missing or invalid, the request fails before provider execution and before any debit.

Phase 2-N adds `/account/organization.html` and shared active organization selection so the platform admin can explicitly see/select the credit-owning organization used by `/account/credits.html` and Admin AI Lab. The selected organization is stored in frontend localStorage as a convenience only; backend authorization and billing remain authoritative.

## Charging Lifecycle

Before provider execution:

- Platform admin session is required.
- Existing admin same-origin/CSRF and byte-limited parsing protections remain in place.
- Existing fail-closed limiter behavior remains in place.
- BFL model support is checked.
- Server calculates credit cost.
- Target organization is validated.
- `Idempotency-Key` is required.
- Existing `ai_usage_attempts` reservation/idempotency machinery is used.
- Insufficient credits fail before provider execution.

On provider success:

- One debit is finalized through `credit_ledger` / `usage_events`.
- Source/reason is `admin_ai_image_test`.
- Metadata is sanitized and includes model/cost/route summary, not raw prompt or provider payload.
- The response includes safe debit diagnostics such as organization id/name, charged credits, model id, ledger/usage/attempt ids when available, idempotency status, and balance before/after.

On provider failure:

- Reservation is released/failed.
- No debit is created.

On billing finalization failure:

- The route returns a safe error.
- The provider result is not returned or persisted as a paid result.

## Idempotency Behavior

Charged BFL Admin AI image tests require `Idempotency-Key`.

- Same key and same meaningful body does not call the provider again and does not debit again.
- Same key and different meaningful body conflicts before provider execution.
- Duplicate success returns safe billing metadata with `credits_charged: 0`.
- Full generated-image replay is not claimed for this admin-test path.

## UI Behavior

Admin AI Lab now includes an admin-only organization selector for image tests.

For chargeable BFL models, the Run button label changes to:

- `Run image test · 1 credit`
- `Run image test · 10 credits`

If the selected organization balance is available, the UI displays a safe organization credit hint and blocks obviously insufficient-credit submits before sending. The server remains authoritative.

## Route Policy

`POST /api/admin/ai/test-image` remains an admin route and now records:

- Platform admin/admin area only.
- Same-origin mutation protected.
- Byte-size limited.
- Fail-closed limiter.
- BFL image-test credit charging for selected models.
- Server-side model cost calculation.
- Required organization context and idempotency for charged tests.
- No public/member/owner route exposure.

## Validation Commands And Results

Validation completed during implementation:

- `npm run release:preflight` before edits: PASS.
- `npm run check:js`: PASS.
- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "Phase 2-M|admin BFL|live_credits_12000|live_credits_10000|live checkout|live Stripe webhook|credits dashboard|admin AI image"`: PASS, 9/9.
- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "charged BFL admin image tests|POST /api/admin/ai/test-image returns|allows FLUX.2 Klein"`: PASS, 8/8.
- `npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "admin image-test credit labels|credits dashboard|Credits link|Pricing page|renders owner credits"`: PASS, 4/4.
- `npm run test:workers`: PASS, 359/359.

Final full validation after documentation updates:

- `git diff --check`: PASS.
- `npm run check:js`: PASS.
- `npm run check:route-policies`: PASS.
- `npm run test:workers`: PASS, 359/359.
- `npm run test:release-compat`: PASS.
- `npm run test:release-plan`: PASS.
- `npm run validate:release`: PASS.
- `npm run test:cloudflare-prereqs`: PASS.
- `npm run validate:cloudflare-prereqs`: PASS for repo config; live validation skipped and production deploy remains blocked.
- `npm run check:worker-body-parsers`: PASS.
- `npm run check:data-lifecycle`: PASS.
- `npm run check:admin-activity-query-shape`: PASS.
- `npm run test:operational-readiness`: PASS.
- `npm run check:operational-readiness`: PASS.
- `npm run test:static`: PASS, 168/168.
- `npm run test:asset-version`: PASS.
- `npm run validate:asset-version`: PASS.
- `npm run build:static`: PASS.
- `npm run release:preflight`: PASS; live health/header checks skipped because no live URLs were configured, and production deploy remains blocked.

## Remaining Risks

- The fixed USD/EUR pricing baseline is static; future exchange-rate automation is not implemented.
- Stripe Tax/VAT handling is not implemented and is intentionally excluded from the credit formula.
- Refund/chargeback reversal is not implemented.
- Admin image-test replay returns safe completed metadata rather than full image-result replay.
- The Admin AI Lab organization selector and credit deduction still require staging/canary verification against real org balances and provider behavior.
- This phase does not prove production readiness.

## Non-Goals

- No public/member charging change.
- No member-facing image generation pricing change.
- No subscriptions.
- No invoices.
- No customer portal.
- No Stripe Tax.
- No coupons or Connect.
- No refund/chargeback reversal.
- No production deploy or remote migration by Codex.
- No live Stripe setup or real payment test by Codex.

## Rollback Plan

- Revert the Phase 2-M code and UI changes.
- If a runtime rollback is needed before code revert, avoid using Admin AI Lab BFL image tests for charged models.
- Disable live credit-pack checkout by keeping `ENABLE_LIVE_STRIPE_CREDIT_PACKS` absent/false.
- Do not delete credit ledger, usage event, billing event, checkout session, or usage-attempt records as part of UI/code rollback.

## Production Readiness

Merge readiness and production readiness are separate.

This phase can be merge-ready after full local validation and review, but production deploy remains blocked until the operator verifies migrations/resources/config, Stripe Testmode/live canary requirements, and Phase 2-M Admin AI Lab BFL charging behavior in staging or a bounded operator canary.
