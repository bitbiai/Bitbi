# Current Implementation Handoff

Date: 2026-04-28

Purpose: concise restart point for future Codex sessions after Phase 0 through Phase 2-L, Admin Control Plane, Pricing / Credit Purchase, pricing asset-reference fix, Stripe Testmode config-diagnostics/admin-checkout lockdown work, and the gated live Credits dashboard. This is not a production deploy approval.

## Current Baseline

| Area | Current state |
| --- | --- |
| Branch | `main` |
| Latest observed commit before Phase 2-L work | `41377c4 str` |
| Working tree at reconciliation start | Clean |
| Latest implemented work | Phase 2-L Live Stripe Credit Packs for platform admins and active organization owners, plus gated Credits dashboard |
| Latest auth D1 migration | `0040_add_live_stripe_credit_pack_scope.sql` |
| Latest AI Worker Durable Object migration | `v1-service-auth-replay` |
| Baseline preflight | `npm run release:preflight` passed before Phase 2-L edits |
| Prior documentation reconciliation validation | `git diff --check`, release/config/route/body/data/activity/operational checks, Worker tests 346/346, static tests 163/163, asset-version checks, static build, and `npm run release:preflight` passed before Phase 2-L |
| Phase 2-K targeted validation | Baseline `npm run release:preflight` passed before edits; targeted `npm run check:js` and Phase 2-J/2-K-adjacent Worker tests passed during implementation |
| Phase 2-L targeted validation | Baseline `npm run release:preflight`, `npm run check:js`, `npm run check:route-policies`, `npm run test:workers` 352/352, and focused Credits static tests passed during implementation |
| Merge readiness | Requires final Phase 2-L full validation and review |
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
- Backend live checkout route: `POST /api/orgs/:id/billing/checkout/live-credit-pack`.
- Backend Credits dashboard route: `GET /api/orgs/:id/billing/credits-dashboard`.
- Live webhook route: `POST /api/billing/webhooks/stripe/live`.
- Allowed buyers: platform/global admins and active owners of the target organization.
- Explicitly denied: unauthenticated users, normal users, org admins unless also platform admins, members, viewers, and owners of other organizations.
- Live packs: `live_credits_5000` = 5,000 credits for 1.00 EUR; `live_credits_10000` = 10,000 credits for 1.50 EUR.
- Checkout requires `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`, live-like `STRIPE_LIVE_SECRET_KEY`, and configured live success/cancel URLs.
- Credits are granted only after verified live Stripe webhook completion and server-side revalidation of persisted checkout row, buyer authorization scope, pack, amount, currency, payment status, and organization/user.
- This is not public pricing, not subscriptions, not invoices, not customer portal, not Stripe Tax, and not full production billing readiness.

## Docs To Read First Next Time

1. `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
2. `AUDIT_NEXT_LEVEL.md`
3. `AUDIT_ACTION_PLAN.md`
4. `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md`
5. `PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md`
6. `PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md`
7. `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md`
8. `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`
9. `DATA_INVENTORY.md`
10. `docs/DATA_RETENTION_POLICY.md`
11. `workers/auth/CLAUDE.md`
12. `config/release-compat.json`

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

Recommended next phase: staging verification and deployment evidence, or if staging is intentionally skipped, a bounded operator-run production canary using `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` for Testmode and `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true` for the shortest possible live credit-pack canary window. This is not production-readiness approval.

Priority order:

1. Apply migrations through `0040` in staging and verify release compatibility against real resources.
2. Configure Stripe Testmode in staging and verify platform-admin-only checkout, kill-switch failure, webhook signature validation, exact-once credit grant, duplicate delivery, payload mismatch, unpaid/no-credit behavior, non-admin-created checkout no-credit behavior, and Pricing success/cancel states.
3. Verify Admin Control Plane sections against real staging APIs.
4. Verify org/billing/image/text/lifecycle cleanup flows end-to-end in staging.
5. Verify the Phase 2-L Credits page, live checkout authorization, live webhook signature validation, exactly-once grant, no-credit failure paths, and no public pricing exposure.
6. Choose one next implementation track: refund/chargeback/manual-review policy, video AI entitlement wiring, or tenant-owned asset migration.

## What Not To Redo

Do not redo Phase 0/1 hardening, Phase 2-A org/RBAC, Phase 2-B billing foundations, Phase 2-C/D/E/F image usage enforcement/replay/cleanup, Phase 2-H text generation, Phase 2-I billing event ingestion, Phase 2-J Stripe Testmode checkout, Phase 2-K admin checkout lockdown, Phase 2-L live credit packs/Credits dashboard, Admin Control Plane, or Pricing unless a focused regression is found.

## Commit Guidance

Commit this documentation reconciliation separately from runtime code. No application runtime code, migrations, frontend behavior, Worker routes, tests, dependencies, deploy config, or Stripe logic should be changed by this pass unless validation requires a documentation-file classification fix.
