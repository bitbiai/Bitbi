# Current Implementation Handoff

Date: 2026-04-29

Purpose: concise restart point for future Codex sessions after Phase 0 through Phase 2-N, Admin Control Plane, Pricing / Credit Purchase, pricing asset-reference fix, Stripe Testmode config-diagnostics/admin-checkout lockdown work, and the gated live Credits/Organization dashboards. This is not a production deploy approval.

## Current Baseline

| Area | Current state |
| --- | --- |
| Branch | `main` |
| Latest observed commit before Phase 2-N work | `3554904 credit` |
| Working tree at Phase 2-N start | Clean |
| Latest implemented work | Phase 2-N Organization context page/selection and Admin AI credit-debit diagnostics |
| Latest auth D1 migration | `0040_add_live_stripe_credit_pack_scope.sql` |
| Latest AI Worker Durable Object migration | `v1-service-auth-replay` |
| Baseline preflight | `npm run release:preflight` passed before Phase 2-M edits |
| Prior documentation reconciliation validation | `git diff --check`, release/config/route/body/data/activity/operational checks, Worker tests 346/346, static tests 163/163, asset-version checks, static build, and `npm run release:preflight` passed before Phase 2-L |
| Phase 2-K targeted validation | Baseline `npm run release:preflight` passed before edits; targeted `npm run check:js` and Phase 2-J/2-K-adjacent Worker tests passed during implementation |
| Phase 2-L targeted validation | Baseline `npm run release:preflight`, `npm run check:js`, `npm run check:route-policies`, `npm run test:workers` 352/352, and focused Credits static tests passed during implementation |
| Phase 2-M validation | Baseline `npm run release:preflight`, focused Phase 2-M/Phase 2-L Worker tests, focused Admin AI/Credits static tests, `npm run test:workers` 359/359, `npm run test:static` 168/168, `npm run build:static`, and `npm run release:preflight` passed during implementation |
| Phase 2-N validation | See `PHASE2N_ORGANIZATION_CONTEXT_AND_CREDIT_DEBIT_VISIBILITY_REPORT.md` and final Codex response for command results |
| Merge readiness | Ready for review after Phase 2-N validation; no commit made |
| Staging readiness | Requires migrations/config/resources and functional staging verification |
| Production readiness | Blocked |
| Live billing readiness | Narrow live one-time credit-pack checkout exists behind `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`; full live billing remains blocked |

## What Is Implemented

- Phase 0/1 security, reliability, route-policy, operational readiness, audit search, data lifecycle, export archive, cleanup, and safe executor foundations.
- Phase 2-A organizations, memberships, and basic RBAC.
- Phase 2-B billing plans, entitlements, credit ledger, usage events, and admin credit grants.
- Phase 2-C/D/E/F org-scoped image credit enforcement, usage attempts, reservations, replay, cleanup, admin inspection, and replay-object cleanup.
- Phase 2-G text route inspection/no-op.
- Phase 2-H org-scoped backend-only member text generation with entitlement/credit enforcement and bounded text replay.
- Phase 2-I provider-neutral billing event ingestion and synthetic test webhook foundation.
- Phase 2-J Stripe Testmode credit-pack checkout foundation and verified Testmode webhook credit grants.
- Phase 2-K server-side platform-admin-only Stripe Testmode checkout lockdown with explicit operator kill switch.
- Phase 2-L narrow live Stripe one-time credit packs for platform admins and active organization owners, plus `/account/credits.html`.
- Phase 2-M updated live credit-pack economics and charges existing organization credits when platform admins run Admin AI image tests for Flux 1 schnell or Flux 2 klein 9B.
- Phase 2-N adds `/account/organization.html`, shared active organization selection, a sanitized organization dashboard API, and safe Admin AI Lab credit-debit diagnostics so platform admins can verify which organization owns credits and receives admin image-test debits.
- Admin Control Plane frontend for existing sanitized admin APIs.
- Admin-only Pricing page for Free, 5000 Credits, and 10000 Credits.
- Stripe Testmode config diagnostics that identify missing variable names without exposing values.

## What Is Not Implemented

- Public live Stripe checkout, subscriptions, invoices, customer portal, Stripe Tax, Stripe Connect, coupons, refund/chargeback automation, or full production payment processing.
- Full tenant-owned asset migration or full enterprise tenant isolation.
- Video/music member-facing credit enforcement.
- User self-service privacy center.
- Irreversible deletion/anonymization executor.
- Legal/compliance certification.
- Full Cloudflare IaC/drift enforcement, live alert evidence, load budgets, or restore drill evidence.

## Production Blockers

- Apply auth migrations through `0040`.
- Provision required auth/AI/contact secrets and verify without printing values.
- Verify matching `AI_SERVICE_AUTH_SECRET` in auth and AI Workers.
- Verify `SERVICE_AUTH_REPLAY` binding and DO migration.
- Verify auth D1/R2/Queue/service/DO bindings.
- Configure Stripe Testmode values: `STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.
- Enable `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` only for a bounded admin-only Testmode canary window; leave it absent/false otherwise.
- Verify Stripe Testmode checkout and webhook behavior in staging.
- Configure live Stripe values only if running the Phase 2-L canary: `ENABLE_LIVE_STRIPE_CREDIT_PACKS`, `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_WEBHOOK_SECRET`, `STRIPE_LIVE_CHECKOUT_SUCCESS_URL`, `STRIPE_LIVE_CHECKOUT_CANCEL_URL`.
- Keep `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` except during the explicitly bounded live credit-pack canary.
- Verify live checkout/webhook exactly-once credit grant behavior only through the operator-run canary.
- Verify Phase 2-M admin-only BFL image-test charging against real staging/canary org credit balances, including no provider call on missing org/idempotency/insufficient credits, no debit on provider failure, exactly-once debit on retry, and ledger/dashboard visibility.
- Verify Phase 2-N organization selection in staging/canary, including solo-admin BITBI auto-selection, platform-admin organization selector, owner-only Organization page access, Organization/Credits/Admin AI Lab context sharing, and visible debit diagnostics after BFL admin image tests.
- Verify Admin Control Plane and Pricing in staging against real APIs.
- Run live health/security-header checks with explicit URLs.
- Verify dashboard-managed WAF/static headers/RUM/alerts or codify them.
- Execute and record a D1/R2 restore drill.

## Stripe / Testmode Status

- Checkout route: `POST /api/orgs/:id/billing/checkout/credit-pack`.
- Webhook route: `POST /api/billing/webhooks/stripe`.
- Checkout is server-side platform-admin-only and still requires active org owner/admin membership for the target organization.
- Checkout requires `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true`, `STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_CHECKOUT_SUCCESS_URL`, and `STRIPE_CHECKOUT_CANCEL_URL`.
- Checkout does not require `STRIPE_WEBHOOK_SECRET`.
- Webhook requires `STRIPE_WEBHOOK_SECRET`.
- Live mode is rejected/disabled.
- Credits are granted only after verified Testmode `checkout.session.completed`, server-side pack/amount/currency/org/user/payment validation, and confirmation that the persisted checkout session was created by an active platform admin.
- Duplicate webhooks must not double-grant.

## Pricing / Admin Rollout Status

- Pricing route: `/pricing.html`.
- Header link visible only to authenticated admins.
- Direct pricing route access is frontend admin-gated.
- Exposed options: Free, Buy 5000 Credits, Buy 10000 Credits.
- Free tier copy: 10 successful legacy image generations per UTC day.
- Pricing uses the server-side platform-admin-only organization checkout route and generated idempotency keys. The signed-in platform admin must also be an active owner/admin of the selected organization.
- No public rollout or live billing activation.

## Credits Dashboard / Live Credit Pack Status

- Credits route: `/account/credits.html`.
- Profile navigation adds `Credits` below `Wallet` only for platform admins and active organization owners.
- Organization route: `/account/organization.html`.
- Profile navigation adds `Organization` near Wallet/Credits only for platform admins and active organization owners.
- Active frontend organization context is stored as localStorage key `bitbi.activeOrganizationId`; it is convenience-only and backend authorization remains authoritative.
- Backend live checkout route: `POST /api/orgs/:id/billing/checkout/live-credit-pack`.
- Backend Credits dashboard route: `GET /api/orgs/:id/billing/credits-dashboard`.
- Backend Organization dashboard route: `GET /api/orgs/:id/organization-dashboard`.
- Live webhook route: `POST /api/billing/webhooks/stripe/live`.
- Allowed buyers: platform/global admins and active owners of the target organization.
- Explicitly denied: unauthenticated users, normal users, org admins unless also platform admins, members, viewers, and owners of other organizations.
- Live packs: `live_credits_5000` = 5,000 credits for 9.99 EUR; `live_credits_12000` = 12,000 credits for 19.99 EUR. `live_credits_10000` is not offered for new live checkout; existing persisted legacy sessions can only be validated against their stored server-side row.
- Checkout requires `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`, live-like `STRIPE_LIVE_SECRET_KEY`, and configured live success/cancel URLs.
- Credits are granted only after verified live Stripe webhook completion and server-side revalidation of persisted checkout row, buyer authorization scope, pack, amount, currency, payment status, and organization/user.
- This is not public pricing, not subscriptions, not invoices, not customer portal, not Stripe Tax, and not full production billing readiness.

## Admin AI Image Test Credit Charging Status

- Route: `POST /api/admin/ai/test-image`.
- Scope: platform/global admin area only; no normal user, org owner, org admin, member, viewer, or public route access is added.
- Chargeable models in this phase: `@cf/black-forest-labs/flux-1-schnell`, `@cf/black-forest-labs/flux-2-klein-9b`, and proxied `black-forest-labs/flux-2-klein-9b`.
- Target organization: required through `organization_id` / `organizationId`; credits are deducted from the selected organization's existing credit balance.
- Admin AI Lab now uses the shared active organization context. If no organization is selected for a charged BFL image test, the UI/backend fail before provider execution with `Select an organization before running this charged image test.`
- Successful charged tests return safe diagnostics including organization id/name, model id, charged credits, ledger/usage/attempt ids when available, idempotency status, and balance before/after.
- Idempotency: charged BFL admin image tests require `Idempotency-Key`; same key/body is replay-safe without duplicate debit/provider call, and same key/different body conflicts.
- Default deductions: Flux 1 schnell default admin image test = 1 credit; Flux 2 klein 9B default text-only <=1MP admin image test = 10 credits.
- Provider failure: no debit; billing finalization failure does not return or persist an uncharged paid result.

## Docs To Read First Next Time

1. `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
2. `AUDIT_NEXT_LEVEL.md`
3. `AUDIT_ACTION_PLAN.md`
4. `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md`
5. `PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md`
6. `PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md`
7. `PHASE2N_ORGANIZATION_CONTEXT_AND_CREDIT_DEBIT_VISIBILITY_REPORT.md`
8. `PHASE2M_ADMIN_BFL_IMAGE_TEST_CREDIT_PRICING_REPORT.md`
9. `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md`
10. `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`
11. `DATA_INVENTORY.md`
12. `docs/DATA_RETENTION_POLICY.md`
13. `workers/auth/CLAUDE.md`
14. `config/release-compat.json`

Historical but no longer current entrypoints:

- `PHASE1_COMPLETION_HANDOFF.md`
- `PHASE2A_ENTRYPOINT.md`

## Commands To Rerun

Before new implementation work:

```bash
git status --short
git log --oneline -10
npm run release:preflight
```

For documentation-only updates:

```bash
git diff --check
npm run check:js
npm run test:release-compat
npm run test:release-plan
npm run validate:release
npm run test:cloudflare-prereqs
npm run validate:cloudflare-prereqs
npm run check:route-policies
npm run check:worker-body-parsers
npm run check:data-lifecycle
npm run check:admin-activity-query-shape
npm run test:operational-readiness
npm run check:operational-readiness
npm run test:workers
npm run test:static
npm run test:asset-version
npm run validate:asset-version
npm run build:static
npm run release:preflight
```

Do not run production deploys, remote D1 migrations, `release:apply`, live Stripe setup, real production billing webhook tests, or Cloudflare dashboard mutations from Codex.

## Recommended Next Work

Recommended next phase: staging verification and deployment evidence, or if staging is intentionally skipped, a bounded operator-run production canary using `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` for Testmode and `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true` for the shortest possible live credit-pack canary window. Include Phase 2-N organization selection and Phase 2-M admin-only BFL image-test charging in that canary after selecting/seeding the intended organization with enough credits. This is not production-readiness approval.

Priority order:

1. Apply migrations through `0040` in staging and verify release compatibility against real resources.
2. Configure Stripe Testmode in staging and verify platform-admin-only checkout, kill-switch failure, webhook signature validation, exact-once credit grant, duplicate delivery, payload mismatch, unpaid/no-credit behavior, non-admin-created checkout no-credit behavior, and Pricing success/cancel states.
3. Verify Admin Control Plane sections against real staging APIs.
4. Verify org/billing/image/text/lifecycle cleanup flows end-to-end in staging.
5. Verify the Phase 2-L Credits page, live checkout authorization, live webhook signature validation, exactly-once grant, no-credit failure paths, and no public pricing exposure.
6. Verify Phase 2-N `/account/organization.html`, active organization selector/defaulting, solo-admin BITBI owner setup, Organization/Credits/Admin AI Lab context sharing, and safe platform-admin-not-owner warning.
7. Verify Phase 2-M Admin AI Lab organization selector, BFL cost labels, sufficient-credit denial, provider-failure no-charge behavior, exactly-once debit, balance refresh, and sanitized ledger/Credits/Organization dashboard display.
8. Choose one next implementation track: refund/chargeback/manual-review policy, video AI entitlement wiring, or tenant-owned asset migration.

## What Not To Redo

Do not redo Phase 0/1 hardening, Phase 2-A org/RBAC, Phase 2-B billing foundations, Phase 2-C/D/E/F image usage enforcement/replay/cleanup, Phase 2-H text generation, Phase 2-I billing event ingestion, Phase 2-J Stripe Testmode checkout, Phase 2-K admin checkout lockdown, Phase 2-L live credit packs/Credits dashboard, Phase 2-M admin BFL image-test charging, Phase 2-N organization context/credit-debit visibility, Admin Control Plane, or Pricing unless a focused regression is found.

## Commit Guidance

Commit Phase 2-N runtime, frontend, tests, and documentation together after review. No deployment, remote migration, live Stripe setup, real payment, or Cloudflare dashboard mutation was performed by Codex.
