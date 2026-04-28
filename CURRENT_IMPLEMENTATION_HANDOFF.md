# Current Implementation Handoff

Date: 2026-04-28

Purpose: concise restart point for future Codex sessions after Phase 0 through Phase 2-K, Admin Control Plane, Pricing / Credit Purchase, pricing asset-reference fix, and Stripe Testmode config-diagnostics/admin-checkout lockdown work. This is not a production deploy approval.

## Current Baseline

| Area | Current state |
| --- | --- |
| Branch | `main` |
| Latest observed commit before Phase 2-K work | `2ef7496 status` |
| Working tree at reconciliation start | Clean |
| Latest implemented work | Phase 2-K Admin-only Stripe Testmode Lockdown on top of Admin-only Pricing / Credit Purchase and Stripe Testmode diagnostics |
| Latest auth D1 migration | `0039_raise_credit_balance_cap_for_pricing_packs.sql` |
| Latest AI Worker Durable Object migration | `v1-service-auth-replay` |
| Baseline preflight | `npm run release:preflight` passed before this documentation pass |
| Documentation reconciliation validation | `git diff --check`, release/config/route/body/data/activity/operational checks, Worker tests 346/346, static tests 163/163, asset-version checks, static build, and `npm run release:preflight` passed |
| Phase 2-K targeted validation | Baseline `npm run release:preflight` passed before edits; targeted `npm run check:js` and Phase 2-J/2-K-adjacent Worker tests passed during implementation |
| Merge readiness | Requires final Phase 2-K full validation and review |
| Staging readiness | Requires migrations/config/resources and functional staging verification |
| Production readiness | Blocked |
| Live billing readiness | Blocked; live Stripe remains disabled |

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
- Admin Control Plane frontend for existing sanitized admin APIs.
- Admin-only Pricing page for Free, 5000 Credits, and 10000 Credits.
- Stripe Testmode config diagnostics that identify missing variable names without exposing values.

## What Is Not Implemented

- Live Stripe, live checkout, subscriptions, invoices, customer portal, Stripe Tax, Stripe Connect, coupons, or production payment processing.
- Full tenant-owned asset migration or full enterprise tenant isolation.
- Video/music member-facing credit enforcement.
- User self-service privacy center.
- Irreversible deletion/anonymization executor.
- Legal/compliance certification.
- Full Cloudflare IaC/drift enforcement, live alert evidence, load budgets, or restore drill evidence.

## Production Blockers

- Apply auth migrations through `0039`.
- Provision required auth/AI/contact secrets and verify without printing values.
- Verify matching `AI_SERVICE_AUTH_SECRET` in auth and AI Workers.
- Verify `SERVICE_AUTH_REPLAY` binding and DO migration.
- Verify auth D1/R2/Queue/service/DO bindings.
- Configure Stripe Testmode values: `STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.
- Enable `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` only for a bounded admin-only Testmode canary window; leave it absent/false otherwise.
- Verify Stripe Testmode checkout and webhook behavior in staging.
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

## Docs To Read First Next Time

1. `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
2. `AUDIT_NEXT_LEVEL.md`
3. `AUDIT_ACTION_PLAN.md`
4. `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md`
5. `PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md`
6. `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md`
7. `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`
8. `DATA_INVENTORY.md`
9. `docs/DATA_RETENTION_POLICY.md`
10. `workers/auth/CLAUDE.md`
11. `config/release-compat.json`

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

Recommended next phase: staging verification and deployment evidence, or if staging is intentionally skipped, a bounded operator-run production canary using `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` for the shortest possible window. This is not production-readiness approval.

Priority order:

1. Apply migrations through `0039` in staging and verify release compatibility against real resources.
2. Configure Stripe Testmode in staging and verify platform-admin-only checkout, kill-switch failure, webhook signature validation, exact-once credit grant, duplicate delivery, payload mismatch, unpaid/no-credit behavior, non-admin-created checkout no-credit behavior, and Pricing success/cancel states.
3. Verify Admin Control Plane sections against real staging APIs.
4. Verify org/billing/image/text/lifecycle cleanup flows end-to-end in staging.
5. Choose one next implementation track: Stripe live-readiness design, video AI entitlement wiring, or tenant-owned asset migration.

## What Not To Redo

Do not redo Phase 0/1 hardening, Phase 2-A org/RBAC, Phase 2-B billing foundations, Phase 2-C/D/E/F image usage enforcement/replay/cleanup, Phase 2-H text generation, Phase 2-I billing event ingestion, Phase 2-J Stripe Testmode checkout, Phase 2-K admin checkout lockdown, Admin Control Plane, or Pricing unless a focused regression is found.

## Commit Guidance

Commit this documentation reconciliation separately from runtime code. No application runtime code, migrations, frontend behavior, Worker routes, tests, dependencies, deploy config, or Stripe logic should be changed by this pass unless validation requires a documentation-file classification fix.
