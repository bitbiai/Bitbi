# SaaS Progress and Current State Report

Date: 2026-04-29

Scope: documentation/audit reconciliation for the BITBI SaaS hardening roadmap. This report reconciles the current repository state after Phase 0 through the latest committed work. It is not a legal compliance certification, production deploy approval, live billing approval, or full tenant-isolation claim.

## 1. Executive Summary

BITBI started this remediation sequence as a functional Cloudflare Workers plus static-site product with meaningful tests, but with serious SaaS maturity gaps: failing static smoke tests, unsigned internal Auth-to-AI calls, inconsistent fail-closed limits, no durable admin MFA failed-attempt state, synchronous admin video polling, no route-policy registry, limited operational readiness evidence, no scalable audit/activity search, no data lifecycle foundation, no organization model, no billing/entitlement system, no credit ledger, no provider billing event ingestion, and no controlled pricing or admin operating surface.

The repository now has a substantially improved SaaS foundation:

- Security hardening: HMAC Auth-to-AI service authentication, nonce replay protection, fail-closed sensitive route limits, byte-limited request parsing, durable admin MFA failed-attempt state, purpose-specific auth secrets, route-policy registry/checks, and secret/DOM/toolchain quality gates.
- Reliability and operations: async admin video jobs with queues/R2/poison handling, debug-gated sync video route, health checks, SLO/event/runbook/backup-restore docs, release compatibility checks, live-check scripts, and operational readiness guards.
- Data lifecycle: data inventory, retention baseline, lifecycle request schema, admin planning APIs, bounded export archive generation/download, expired archive cleanup, and a safe reversible-action executor pilot with irreversible deletion disabled by default.
- SaaS foundations: organizations, memberships, basic RBAC, billing plans, entitlements, credit ledger, usage events, org-scoped AI image/text credit enforcement, usage attempts/reservations/replay, usage-attempt cleanup/admin inspection, replay-object cleanup, provider-neutral billing event ingestion, Stripe Testmode checkout/session tracking, verified Testmode checkout credit grants, server-side platform-admin-only Testmode checkout lockdown, admin-only Pricing page, Admin Control Plane, gated live Credits dashboard, and admin-only credit charging for selected Black Forest Labs Admin AI image tests.

The repository is not full enterprise SaaS maturity. Production deploy remains blocked until migrations through `0040`, live Cloudflare secret/binding/resource verification, Stripe Testmode configuration, explicit `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` canary enablement when needed, live Stripe credit-pack configuration with `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true` only during a bounded canary window, checkout/webhook verification, org/billing/AI/lifecycle/admin/pricing/Credits/Admin AI Lab verification, and live health/security-header evidence are complete. Phase 2-M updates the live credit-pack economics and charges existing organization credits only when platform admins run supported BFL Admin AI image tests; public live billing, subscriptions, invoices, customer portal, Stripe Tax, Stripe Connect, refund/chargeback automation, full tenant-owned asset migration, full Cloudflare IaC/drift control, legal-approved privacy workflows, formal load budgets, and compliance certification remain incomplete.

## 2. Current Branch / Commit / Working Tree Status

| Item | Current value |
| --- | --- |
| Branch | `main` |
| Latest commit observed before Phase 2-M work | `4a06ba2 Live` |
| Recent relevant commits | `9cba90e Add admin-gated pricing page for credit packs`, `7b684e7 fix`, `7e7d61f fix`, `2ef7496 status` |
| Working tree at Phase 2-K start | Clean |
| Current update scope | Runtime hardening plus documentation for Phase 2-M Admin-only Black Forest Labs image-test credit charging and live credit-pack economics |
| Baseline validation before edits | `npm run release:preflight` passed on 2026-04-29 |

## 3. Current Maturity Assessment

| Dimension | Assessment |
| --- | --- |
| Overall SaaS readiness | Substantially improved SaaS foundation, but not full enterprise SaaS maturity. |
| Security readiness | Stronger than original baseline for auth, service auth, replay, rate limits, body parsing, admin MFA, route policy, and secrets. Still requires live secret parity, live Cloudflare checks, legacy fallback retirement, and broader SAST/SBOM/license gates. |
| Operational readiness | Repo-owned runbooks/SLO/event/backup docs and checks exist. Live alerting, restore drill evidence, dashboard drift enforcement, and production incident evidence are still missing. |
| Billing readiness | Credit-ledger, entitlements, usage events, provider-neutral events, Stripe Testmode credit-pack checkout, narrow live one-time credit-pack checkout, and admin-only BFL image-test debits exist. Testmode checkout is server-side platform-admin-only and disabled unless `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true`. Live credit-pack checkout is limited to platform admins and active org owners and disabled unless `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`. No public billing, subscriptions, invoices, customer portal, tax, refund/chargeback automation, or full production payment processing. |
| Tenant readiness | Organization/membership/RBAC foundation exists. Existing assets are still largely user-owned, not fully tenant-owned. Full tenant isolation is not complete. |
| Privacy/compliance readiness | Admin/support lifecycle planning, export archives, cleanup, and reversible executor pilot exist. User self-service, legal-approved retention, contact processor workflow, irreversible deletion, and compliance certification remain incomplete. |
| Production readiness | Blocked until staging/live verification and migration/secret/resource prerequisites are complete. |
| Live billing readiness | Narrow live one-time credit-pack checkout exists behind a disabled-by-default operator flag. Full live billing readiness remains blocked. |

## 4. Phase-By-Phase Timeline

| Phase | Status | Purpose | Main files/routes/migrations | Validation evidence | Remaining blockers |
| --- | --- | --- | --- | --- | --- |
| Phase 0-A | Completed | Fix immediate static/security/package blockers. | `PHASE0_REMEDIATION_REPORT.md`, Auth-to-AI HMAC helpers, static smoke fixes, AI lockfile. | Report records static 155/155, Worker 260/260, preflight pass. | Live `AI_SERVICE_AUTH_SECRET` parity. |
| Phase 0-A+ | Completed | Add nonce-backed service-auth replay protection and more fail-closed limits. | `SERVICE_AUTH_REPLAY`, `workers/ai/src/lib/service-auth-replay*.js`, route tests. | Report records HMAC/replay/security regressions passing. | DO binding/migration live verification. |
| Phase 0-B | Completed | Cloudflare prereq validator, byte-limited parsing, durable MFA failed attempts, async video design. | `0028_add_admin_mfa_failed_attempts.sql`, request-body helpers, prereq scripts. | Report records Worker 272/272, static 155/155, preflight pass. | Migration/live prereq verification. |
| Phase 1-A | Completed | Async admin video job foundation. | `0029_add_ai_video_jobs.sql`, `/api/admin/ai/video-jobs`, queue binding. | Report records Worker 280/280, static 155/155, preflight pass. | Queue and migration staging verification. |
| Phase 1-B | Completed | Queue-safe video task processing, R2 output/poster ingest, poison-message persistence. | `0030_harden_ai_video_jobs_phase1b.sql`, internal video task routes, admin async UI. | Report records Worker 285/285, static 155/155, preflight pass. | Provider/R2 staging verification. |
| Phase 1-C | Completed | Restrict sync video debug route and add quality gates/admin diagnostics. | `ALLOW_SYNC_VIDEO_DEBUG`, poison/failed job admin APIs, quality gate scripts. | Report records Worker 289/289, static 155/155, preflight pass. | Broader type/lint and live ops maturity. |
| Phase 1-D | Completed | Purpose-specific auth/security secrets. | `workers/auth/src/lib/security-secrets.js`, session/MFA/pagination/save-reference updates. | Report records Worker 300/300, static 155/155, preflight pass. | Provision new secrets and retire legacy fallback later. |
| Phase 1-E | Completed | Route-policy registry and route-policy guard. | `workers/auth/src/app/route-policy.js`, `scripts/check-route-policies.mjs`. | Report records route-policy/static/worker/release checks passing. | Registry is metadata/checking, not full centralized enforcement. |
| Phase 1-F | Completed | Operational readiness foundations. | `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md`, runbooks, health/live-check scripts. | Report records Worker 303/303, static 155/155, preflight pass. | Live alerts, restore drills, drift checks. |
| Phase 1-G | Completed | Scalable audit/activity search and signed cursors. | `0031_add_activity_search_index.sql`, `activity-search.js`, activity query-shape guard. | Report records Worker 306/306, static 155/155, preflight pass. | Staging projection verification and possible historical backfill. |
| Phase 1-H | Completed | Data lifecycle request/planning foundation. | `0032_add_data_lifecycle_requests.sql`, `data-lifecycle.js`, admin data lifecycle routes. | Report records Worker 309/309, static 155/155, preflight pass. | Legal/product review, no irreversible deletion. |
| Phase 1-I | Completed | Bounded private export archives and deletion executor design. | `0033_harden_data_export_archives.sql`, `data-export-archive.js`, `DATA_DELETION_EXECUTOR_DESIGN.md`. | Report records Worker 311/311, static 155/155, preflight pass. | Archive staging verification and executor design remains mostly disabled. |
| Phase 1-J | Completed | Export archive cleanup and safe deletion executor pilot. | `data-export-cleanup.js`, scheduled cleanup, admin archive cleanup, `execute-safe`. | Report records Worker 313/313, static 155/155, preflight pass. | Staging cleanup/executor verification. |
| Phase 2-A | Completed for current scope | Organization, membership, basic RBAC foundation. | `0034_add_organizations.sql`, `orgs.js`, `routes/orgs.js`, `routes/admin-orgs.js`. | Report records Worker 317/317, static 155/155, preflight pass. | Full tenant-owned asset migration deferred. |
| Phase 2-B | Completed for current scope | Billing, plans, entitlements, credit ledger, usage events. | `0035_add_billing_entitlements.sql`, `billing.js`, org/admin billing APIs. | Report records Worker 320/320, static 155/155, preflight pass. | Live billing and route wiring deferred. |
| Phase 2-C | Completed for current scope | Opt-in org-scoped image credit enforcement. | `ai-usage-policy.js`, `/api/ai/generate-image`. | Report records Worker 326/326, static 155/155, preflight pass. | Provider-result idempotency was deferred to Phase 2-D. |
| Phase 2-D | Completed for current scope | Durable usage attempts, reservations, image replay, retry safety. | `0036_add_ai_usage_attempts.sql`, `ai-usage-attempts.js`. | Report records Worker 331/331, static 155/155, preflight pass. | Cleanup was deferred to Phase 2-E/F. |
| Phase 2-E | Completed for current scope | Usage-attempt cleanup and sanitized admin inspection. | Admin usage-attempt list/detail/cleanup, scheduled cleanup. | Report records Worker 334/334, static 155/155, preflight pass. | Staging cleanup/admin verification. |
| Phase 2-F | Completed for current scope | Safe temporary replay object cleanup. | Prefix-scoped cleanup under `tmp/ai-generated/{userId}/{tempId}`. | Report records Worker 336/336, static 155/155, preflight pass. | Staging R2 cleanup failure/no-unrelated-delete verification. |
| Phase 2-G | Inspection/no-op | Inspect text routes before wiring. | No separate report found; Phase 2-H report records only admin-only provider-backed text route existed. | No code changes inferred. | Superseded by intentional Phase 2-H route. |
| Phase 2-H | Completed for current scope | Backend-only org-scoped member AI text generation. | `/api/ai/generate-text`, HMAC `AI_LAB` text proxy, text replay metadata. | Report records Worker 339/339, static 155/155, preflight pass. | Staging org-scoped text verification. |
| Phase 2-I | Completed for current scope | Provider-neutral billing event ingestion. | `0037_add_billing_event_ingestion.sql`, `billing-events.js`, `/api/billing/webhooks/test`. | Report records Worker 342/342 and full validation. | Staging synthetic webhook verification; no live provider enabled. |
| Phase 2-J | Completed for current scope | Stripe Testmode credit-pack checkout and verified webhook credit grants. | `0038_add_stripe_credit_pack_checkout.sql`, `stripe-billing.js`, `/api/orgs/:id/billing/checkout/credit-pack`, `/api/billing/webhooks/stripe`. | Report records Worker 346/346, static 155/155, preflight pass. | Staging Stripe Testmode config/webhook/checkout verification. |
| Phase 2-K | Completed for current scope | Lock down Stripe Testmode checkout creation to platform admins and require explicit operator enablement. | `stripe-billing.js`, `routes/orgs.js`, route policy, release compat, Worker tests, `PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md`. | Targeted Phase 2-J/2-K Worker tests and `check:js` passed during implementation; full validation required before merge. | Verify platform-admin-only checkout, disabled flag failure, admin-created checkout grant, non-admin checkout no-credit, and no live billing side effects. |
| Phase 2-L | Completed for current scope | Add narrow live one-time credit packs and gated Credits dashboard for platform admins and active org owners. | `0040_add_live_stripe_credit_pack_scope.sql`, `stripe-billing.js`, `routes/orgs.js`, `billing-webhooks.js`, `/account/credits.html`, `js/pages/credits/main.js`. | Baseline preflight, `check:js`, route-policy check, Worker 352/352, and focused Credits static tests passed during implementation; full validation required before merge. | Apply migration `0040`; verify live config disabled-by-default behavior, live checkout authorization, live webhook signature, exactly-once credit grant, role-revocation no-credit paths, and no public pricing exposure. |
| Phase 2-M | Completed for current scope | Update live pack economics and charge platform-admin-only Admin AI image tests for supported Black Forest Labs image models against selected organization credits. | `admin-ai-image-credit-pricing.js`, `stripe-billing.js`, `billing.js`, `routes/admin-ai.js`, Admin AI Lab UI/tests/docs. | Baseline preflight, focused Phase 2-M/Phase 2-L Worker tests, focused Admin AI/Credits static tests, Worker 359/359, static 168/168, static build, and release preflight passed. | Verify Admin AI Lab organization selector/cost labels, sufficient-credit denial, provider-failure no-charge behavior, exactly-once debit/idempotency, and sanitized ledger/Credits dashboard display in staging or bounded canary. |
| Admin Control Plane | Completed for current scope | Frontend admin operating surface over existing APIs. | `admin/index.html`, `js/pages/admin/control-plane.js`, `css/admin/admin.css`. | Report records Worker 346/346, static 159/159, preflight pass after corrective pass. | Staging verification against real APIs. |
| Pricing / Credit Packs | Completed for current scope | Admin-only pricing page and Testmode checkout UX. | `pricing.html`, `js/pages/pricing/main.js`, `css/pages/pricing.css`, `0039_raise_credit_balance_cap_for_pricing_packs.sql`. | Report records Worker 346/346, static 163/163, preflight pass. | Staging checkout/return/model-status verification and Stripe Testmode config. |
| Pricing asset-reference fix | Completed | Fix root-absolute asset references in `pricing.html`. | `pricing.html`. | Committed as `7b684e7 fix`; asset/static/build/preflight checks were requested and fixed. | None beyond standard staging static verification. |
| Stripe config diagnostics fix | Completed | Improve missing Stripe Testmode config diagnostics without exposing values. | `stripe-billing.js`, `tests/workers.spec.js`, `workers/auth/CLAUDE.md`. | Committed as `7e7d61f fix`; test/workers and preflight passed in corrective pass. | Operators must still configure staging secrets/URLs. |

## 5. Major Security Improvements Completed

- HMAC service authentication from auth Worker to AI Worker.
- Nonce-backed replay protection for internal AI service calls.
- Fail-closed limiter behavior on high-risk auth/admin/MFA/profile/avatar/wallet/AI/org/billing/lifecycle routes.
- Byte-limited request parsing and a static body-parser guard.
- Durable admin MFA failed-attempt lockout state.
- Purpose-specific security secrets for session hashes, pagination cursors, admin MFA encryption/proofs/recovery hashes, and generated-image save references.
- Route-policy registry and route-policy coverage checks.
- Secret scan, DOM sink baseline, toolchain check, JS syntax check, and quality-gate tests.
- Raw-body verification boundaries for synthetic and Stripe Testmode billing webhooks.
- Safe Stripe config diagnostics that expose variable names only, not values.

## 6. Major Reliability And Operational Improvements Completed

- Async admin video job D1/Queue/R2 architecture.
- Queue-safe video task create/poll and poison-message persistence.
- Sync video debug route restricted by `ALLOW_SYNC_VIDEO_DEBUG`.
- R2 cleanup retry queues and scheduled cleanup paths.
- Operational readiness docs, incident runbooks, SLO/event baseline, backup/restore drill plan.
- Live health/security-header check scripts that clearly skip without configured live URLs.
- Release compatibility and release-plan checks that separate repo config readiness from production deploy readiness.
- Admin Control Plane surfaces for implemented operational APIs and safe unavailable states.

## 7. Major SaaS Architecture Foundations Completed

- Organization and membership tables with owner/admin/member/viewer roles.
- Basic organization helper and user/admin org APIs.
- Billing plan, subscription placeholder, entitlement, billing customer placeholder, credit ledger, and usage event tables.
- Admin credit grant and org billing/usage APIs.
- Org-scoped AI image and text credit enforcement with entitlement checks.
- AI usage attempts, reservations, idempotency conflict checks, duplicate provider-call suppression, retry-safe finalization, and bounded replay.
- Provider-neutral billing event ingestion and Stripe Testmode checkout/session tracking.
- Admin-only pricing UX for 5000/10000-credit Testmode packs.
- Gated live Credits dashboard for platform admins and active organization owners.
- Admin-only BFL image-test credit charging against selected organization credit balances.

## 8. Organization / RBAC Status

Implemented:

- `organizations` and `organization_memberships` in migration `0034`.
- Roles: `owner`, `admin`, `member`, `viewer`.
- User org create/list/detail/member-add/member-list APIs.
- Admin org list/detail APIs.
- Billing and AI routes can require active membership and role thresholds.

Not complete:

- Existing assets are not fully migrated to organization ownership.
- No full enterprise RBAC policy engine.
- No SSO, SCIM, domain verification, audit-export policy for organizations, or team billing admin workflow.

## 9. Billing / Credits / Entitlements Status

Implemented:

- Migration `0035` adds plans, subscriptions, entitlements, billing customers, credit ledger, and usage events.
- Free plan and entitlement seed exists, including `ai.text.generate`, `ai.image.generate`, `ai.video.generate`, private storage, member max, monthly credits, and balance cap.
- Migration `0039` raises the free-plan `credits.balance.max` to support 5000/10000-credit Testmode pack grants.
- Migration `0040` adds checkout authorization/payment-state fields needed for live credit-pack reconciliation and grant authorization.
- `billing.js` resolves org billing state, checks entitlements/credits, grants/consumes credits idempotently, and prevents negative balances.
- Phase 2-M updates the live pack catalog to `live_credits_5000` at 9.99 EUR and `live_credits_12000` at 19.99 EUR. New live checkout creation does not offer `live_credits_10000`.
- Phase 2-M also records `admin_ai_image_test` credit ledger/usage debits when platform admins successfully run charged BFL Admin AI image tests for a selected organization.
- Admin credit grant route exists and is surfaced in the Admin Control Plane with confirmation, reason, and generated idempotency key.

Not complete:

- No public live payment provider activation.
- No subscription billing, invoices, customer portal, taxes, coupons, Stripe Connect, production checkout, or monthly credit grant scheduler.
- Billing export/delete policy remains deferred pending legal/product review.

## 10. Stripe Testmode / Checkout / Webhook Status

Implemented:

- Provider-neutral billing event ingestion in migration `0037`.
- Stripe Testmode checkout/session tracking in migration `0038`.
- `STRIPE_MODE` must equal `test`.
- Checkout creation requires `STRIPE_MODE`, `STRIPE_SECRET_KEY`, `STRIPE_CHECKOUT_SUCCESS_URL`, and `STRIPE_CHECKOUT_CANCEL_URL`.
- Checkout creation also requires `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true`.
- Checkout creation is server-side platform-admin-only and still requires the platform admin to be an active org owner/admin for the target organization.
- Checkout creation does not require `STRIPE_WEBHOOK_SECRET`.
- Stripe webhook verification requires `STRIPE_MODE` and `STRIPE_WEBHOOK_SECRET`.
- Stripe live-mode keys/events are rejected or ignored safely in this phase.
- Verified Testmode `checkout.session.completed` can grant credits exactly once after pack/org/user/amount/currency/payment-status validation and persisted checkout creator platform-admin validation.
- Duplicate same event id/hash does not double-grant; same event id with different payload hash is rejected.
- Missing Stripe config now returns safe config variable names only.
- Non-admin-created or webhook-only checkout sessions are not credit-grantable.

Not complete:

- Public live Stripe checkout is not enabled.
- Testmode checkout is not production-ready.
- Subscriptions, invoices, customer portal, Stripe Tax, Connect, and production-trusted live webhooks are not implemented.

## 10A. Live Stripe Credit-Pack Status

Implemented:

- Live checkout route: `POST /api/orgs/:id/billing/checkout/live-credit-pack`.
- Live webhook route: `POST /api/billing/webhooks/stripe/live`.
- Credits dashboard route: `GET /api/orgs/:id/billing/credits-dashboard`.
- Credits page: `/account/credits.html`.
- Allowed live buyers: platform/global admins and active owners of the target organization.
- Denied live buyers: unauthenticated users, normal users, org admins unless also platform admins, members, viewers, and owners of other organizations.
- Fixed live packs: `live_credits_5000` for 5,000 credits at 9.99 EUR, and `live_credits_12000` for 12,000 credits at 19.99 EUR. `live_credits_10000` is not offered for new live checkout; any legacy persisted sessions can only be validated against their stored server-side row.
- Live checkout is disabled unless `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`.
- Live webhook uses `STRIPE_LIVE_WEBHOOK_SECRET` and accepts only live events.
- Credit grants require a persisted live checkout row and revalidate authorization scope at webhook time.

Not complete:

- No public pricing rollout.
- No subscriptions, invoices, customer portal, Stripe Tax, coupons, Connect, refund/chargeback automation, or final billing operations process.
- Staging/live verification was not performed by Codex.

## 11. AI Usage Credit Enforcement Status

Implemented:

- Legacy no-org image generation remains backward-compatible and uncharged by the credit ledger.
- Org-scoped `/api/ai/generate-image` enforces membership, role, entitlement, credits, idempotency, reservation/finalization, same-key replay, and provider-failure no-charge behavior.
- Org-scoped `/api/ai/generate-text` is backend-only and requires explicit organization context, membership, `ai.text.generate`, credits, and `Idempotency-Key`.
- Platform-admin-only Admin AI image tests for Flux 1 schnell and Flux 2 klein 9B now require selected organization context and `Idempotency-Key`, calculate server-side model cost, reserve existing organization credits, debit exactly once on provider success, and do not charge on provider failure.
- AI usage attempt cleanup releases stale reservations without creating debits.
- Temporary image replay object cleanup is prefix-scoped and attempt-linked.

Not complete:

- Admin AI Lab is charged only for the explicitly listed Black Forest Labs image-test models in the platform-admin-only image-test flow; other admin lab paths remain uncharged unless separately wired and tested.
- Text asset storage routes are not charged.
- Video/music routes are not credit-enforced for members.
- Full paid model/catalog enforcement across every AI route is not complete.

## 12. Data Lifecycle / Privacy Operations Status

Implemented:

- Data inventory and retention baseline.
- Lifecycle request and item schema.
- Admin lifecycle create/list/detail/plan/approve/export generation/download APIs.
- Bounded private export archive generation in `AUDIT_ARCHIVE`.
- Expired export archive cleanup under `data-exports/` only.
- Safe reversible executor pilot for approved requests.

Not complete:

- User self-service export/delete remains deferred.
- Irreversible hard deletion is disabled by default.
- Contact processor workflow is not automated.
- Organization/billing/Stripe lifecycle export/delete policy is not integrated.
- Legal/product retention approval is still required.

## 13. Audit/Activity/Search Status

Implemented:

- `activity_search_index` projection table.
- Redacted/indexed activity search for admin/user activity.
- Signed cursors using `PAGINATION_SIGNING_SECRET`.
- Guard script blocks raw activity `meta_json` search and raw cursors.
- Hot-window bounded counts and archive/prune behavior.

Not complete:

- Historical backfill is not automatic.
- Production cardinality/load testing is not recorded.
- Long-term audit/anonymization policy remains legal/product work.

## 14. Admin Control Plane Status

Implemented sections:

- Overview / Command Center.
- Security & Policy.
- Organizations / RBAC.
- Billing / Credits / Entitlements.
- Stripe / Billing Events.
- AI Usage / Credits / Attempts.
- AI Operations / Video Diagnostics.
- Data Lifecycle / Privacy Operations.
- Release / Operational Readiness.
- Admin Settings.

Safety boundaries:

- Frontend-only surface using existing APIs.
- No backend APIs, migrations, dependencies, or runtime behavior changes were added by the control-plane phase.
- Actions are limited to existing safe APIs: manual credit grant with confirmation/reason/idempotency and AI usage cleanup with dry-run default/confirmation/bounded limit/idempotency.
- No secret editing, dashboard settings editing, live billing toggle, irreversible deletion UI, or production readiness proof.

## 15. Pricing Page / Credit Pack UX Status

Implemented:

- `/pricing.html` static route.
- Pricing link visible only to authenticated admins in desktop/mobile headers.
- Direct page access is frontend admin-gated.
- Exactly three options: Free, Buy 5000 Credits, Buy 10000 Credits.
- Free tier copy reflects current legacy free image generation allowance: 10 successful image generations per UTC day.
- Paid packs use `credits_5000` and `credits_10000`.
- Checkout initiation uses the server-side platform-admin-only org checkout route and generated idempotency key. The admin must also be an active owner/admin of the selected organization.
- Success/cancel return states are supported.
- Models overlay uses truthful labels: `Included`, `Requires credits`, or `Coming soon`.

Not complete:

- Pricing is not public.
- Stripe Testmode config must exist in staging before checkout works.
- Public pricing, commercial terms, live billing, subscriptions, and invoices need product/legal approval.

## 16. Current Migrations And Required Deployment Order

Latest auth D1 migration: `0040_add_live_stripe_credit_pack_scope.sql`.

Required auth migration order before staging auth Worker behavior that depends on these phases:

1. Apply all auth migrations through `0040`.
2. Deploy AI Worker with matching `AI_SERVICE_AUTH_SECRET` and `SERVICE_AUTH_REPLAY` Durable Object migration `v1-service-auth-replay`.
3. Deploy auth Worker with required D1/R2/Queue/service/DO bindings.
4. Deploy contact Worker with required `RESEND_API_KEY` and limiter DO.
5. Deploy static site, including Admin Control Plane, admin-only Pricing page, and gated Credits dashboard.

Do not apply remote migrations from Codex. Operators must apply and verify in staging/production.

## 17. Current Route/API Inventory Summary

Key implemented route groups:

- Auth/profile/wallet/avatar/favorites routes with body limits and route policies.
- Admin users/stats/activity/user-activity/admin MFA routes.
- Admin AI routes, async video job routes, poison/failed diagnostics, image derivative backfill, and usage-attempt inspection/cleanup.
- Member AI routes, including legacy/member image generation and org-scoped text generation.
- Organization routes: `/api/orgs`, `/api/orgs/:id`, members, entitlements, billing, usage, and credit-pack checkout.
- Admin organization and billing routes.
- Data lifecycle admin routes for requests, plans, archives, cleanup, export, and execute-safe.
- Billing webhook routes: `/api/billing/webhooks/test`, `/api/billing/webhooks/stripe`, and `/api/billing/webhooks/stripe/live`.
- Health routes for Workers.

Route policy guard currently validates the registered auth-worker route policies, including Phase 2-L live checkout, live webhook, and Credits dashboard routes.

## 18. Current Validation Evidence

Baseline before documentation edits:

- `git status --short`: clean.
- `npm run release:preflight`: passed.

Latest Phase 2-M targeted validation:

- `npm run check:js`: passed.
- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "Phase 2-M|admin BFL|live_credits_12000|live_credits_10000|live checkout|live Stripe webhook|credits dashboard|admin AI image"`: passed, 9/9.
- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "charged BFL admin image tests|POST /api/admin/ai/test-image returns|allows FLUX.2 Klein"`: passed, 8/8.
- `npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "admin image-test credit labels|credits dashboard|Credits link|Pricing page|renders owner credits"`: passed, 4/4.
- `npm run test:workers`: passed, 359/359.

Latest Phase 2-L targeted validation:

- `npm run check:js`: passed.
- `npm run check:route-policies`: passed.
- `npm run test:workers`: passed, 352/352.
- `npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "Credits dashboard live credit packs"`: passed, 3/3.

Full Phase 2-M validation passed locally; production deploy remains blocked by live/staging prerequisites.

Latest report evidence:

- Pricing report records `npm run test:workers` 346 passed and `npm run test:static` 163 passed.
- Phase 2-L targeted validation records `npm run test:workers` 352 passed and focused Credits static tests 3 passed.
- Phase 2-M validation records `npm run test:workers` 359 passed, `npm run test:static` 168 passed, asset checks passed, static build passed, and `npm run release:preflight` passed.
- Admin Control Plane report records `npm run test:workers` 346 passed and `npm run test:static` 159 passed for that phase.
- Stripe diagnostics corrective pass records `npm run test:workers`, `npm run test:release-compat`, `npm run test:cloudflare-prereqs`, `npm run validate:cloudflare-prereqs`, `npm run release:preflight`, and `git diff --check` passing.

Live Cloudflare validation, live Stripe setup, real production billing webhook tests, remote D1 migrations, production deploy, and `release:apply` have not been run.

## 19. Current Production Blockers

- Apply auth migrations through `0040`.
- Provision and verify required auth/AI/contact secrets without printing values.
- Verify matching `AI_SERVICE_AUTH_SECRET` in auth and AI Workers.
- Deploy/verify `SERVICE_AUTH_REPLAY` Durable Object and migration.
- Verify D1/R2/Queue/service bindings, including `USER_IMAGES`, `AUDIT_ARCHIVE`, `AI_LAB`, `ACTIVITY_INGEST_QUEUE`, `AI_IMAGE_DERIVATIVES_QUEUE`, and `AI_VIDEO_JOBS_QUEUE`.
- Configure Stripe Testmode only for Testmode flows: `STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.
- Configure live Stripe only for the Phase 2-L canary with `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` initially, `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_WEBHOOK_SECRET`, `STRIPE_LIVE_CHECKOUT_SUCCESS_URL`, and `STRIPE_LIVE_CHECKOUT_CANCEL_URL`.
- Keep `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` absent/false except during an explicitly approved admin-only Testmode canary window.
- Verify Stripe Testmode checkout and webhook endpoint in staging.
- Verify Admin Control Plane and Pricing in staging with real APIs.
- Verify Phase 2-M Admin AI Lab organization selection, BFL model cost labels, insufficient-credit denial, provider-failure no-charge behavior, duplicate idempotency no-double-debit behavior, and sanitized ledger/Credits dashboard display.
- Run live health/security-header checks with explicit staging/production URLs.
- Verify dashboard-managed WAF/static headers/RUM/alerts or move them to IaC.
- Execute and record staging D1/R2 restore drill.
- Keep `ALLOW_SYNC_VIDEO_DEBUG` absent/false unless a controlled emergency debug approval exists.

## 20. Current Staging Verification Checklist

- Auth/session/secret migration compatibility.
- Auth-to-AI HMAC and replay rejection.
- Admin MFA lockout/reset.
- Async video jobs, queue consumer, R2 output/poster access, poison/failed diagnostics.
- Activity projection writes, signed cursor search, bounded counts.
- Data lifecycle planning, export archive generation/download, archive cleanup, execute-safe dry-run/execute.
- Organization create/list/detail/member/admin inspection.
- Billing plan/org billing/usage, admin credit grant, ledger/idempotency/no-negative balance.
- Org-scoped image generation success, insufficient credits, no duplicate provider call, replay, provider failure, billing failure.
- Usage-attempt cleanup and replay-object cleanup.
- Org-scoped text generation success, replay, entitlement denial, provider failure, billing failure.
- Synthetic billing webhook valid/invalid/duplicate/mismatch behavior.
- Stripe Testmode platform-admin-only checkout creation, disabled flag failure, webhook signature verification, exact-once credit grant, duplicate/mismatch/no-credit failures, and non-admin-created checkout no-credit behavior.
- Phase 2-L live checkout platform-admin/org-owner authorization, live flag/config failure modes, live webhook signature verification, exact-once credit grant, duplicate/mismatch/no-credit failures, org-owner/admin revocation no-credit behavior, and Credits dashboard display.
- Phase 2-M Admin AI Lab BFL image-test charging: organization selector, Flux 1 schnell 1-credit label/debit, Flux 2 klein 9B 10-credit label/debit, missing org/idempotency denial, insufficient-credit denial before provider call, provider-failure no-charge behavior, duplicate idempotency no-double-debit behavior, billing-finalization failure safe response, and ledger/Credits dashboard visibility.
- Pricing page header visibility, direct access denial, org selector, checkout redirect, success/cancel states, model labels.
- Admin Control Plane sections, sanitized details, unavailable/fail-closed states, action safety.
- Live health and static security headers with `--require-live`.

## 21. Remaining Risks And Gaps

- No full tenant-owned asset migration.
- No public/full live billing readiness.
- No subscriptions, invoices, customer portal, tax, coupons, Connect, refund/chargeback automation, or public checkout.
- Video/music member usage is not credit-enforced.
- Member-facing image pricing is unchanged by Phase 2-M; only the platform-admin Admin AI image-test flow for listed BFL models is newly charged.
- User self-service privacy flows remain deferred.
- Irreversible deletion is disabled and not legal-approved.
- Contact processor retention/export/delete workflow remains manual/open.
- Full Cloudflare IaC/drift enforcement is missing.
- Live alerts, restore drills, and load/performance budgets are incomplete.
- Large frontend/admin/test modules remain hard to review.
- Legacy `SESSION_SECRET` fallback retirement requires a planned migration window.

## 22. Recommended Next Phases

1. Staging verification and deployment evidence phase: apply migrations through `0040` in staging, configure Testmode Stripe, configure live Stripe with `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` initially, enable canary flags only for bounded windows, verify all Phase 0 through Pricing/Phase 2-M flows, run live health/header checks, and document results.
2. Billing operations hardening: keep public billing disabled while designing refund/chargeback/manual-review policy, subscriptions/invoices/customer portal/tax/legal terms, and webhook side-effect policy.
3. Tenant-owned asset migration phase: add nullable organization ownership to one low-risk domain, backfill safely, and prove dual-read behavior.
4. Video AI entitlement wiring phase: wire a member-safe async video route to org entitlements/credits without touching admin debug/lab flows.
5. Operational maturity phase: Cloudflare IaC/drift checks, alerts, restore drills, load budgets, and incident evidence.

Do not start all tracks at once.

## 23. What Must Not Be Redone

- Phase 0/1 security hardening.
- Async video job foundations.
- Route-policy registry/checks.
- Operational readiness docs/checks.
- Activity search projection/signed cursors.
- Data lifecycle request/export/cleanup/safe executor foundations.
- Organization/RBAC foundation.
- Billing/entitlement/credit ledger foundation.
- Org-scoped image/text enforcement and usage attempts.
- Provider-neutral billing event ingestion.
- Stripe Testmode checkout foundation.
- Phase 2-K platform-admin-only checkout lockdown and explicit Testmode checkout kill switch.
- Phase 2-L narrow live credit-pack checkout and Credits dashboard foundation.
- Phase 2-M admin BFL image-test credit pricing and charging.
- Admin Control Plane and admin-only Pricing page.

Only revisit these if a focused regression is found.

## 24. What Must Be Deployed Next, If Anything

Nothing should be deployed from Codex. For staging, operators should deploy:

- Auth migrations through `0040`.
- AI Worker with service-auth replay binding/migration.
- Auth Worker with all D1/R2/Queue/service/DO bindings and secrets.
- Contact Worker with contact secret and limiter binding.
- Static site including Admin Control Plane, Pricing assets, and Credits dashboard assets.

Production should not be deployed until staging evidence is recorded and live/manual Cloudflare verification is complete.

## 25. Rollback Considerations

- Migrations `0034` through `0040` are additive/forward-only; do not attempt destructive rollback. Disable routes/UI instead if a problem occurs.
- Pricing page rollback can remove/hide `pricing.html`, pricing JS/CSS, and header links while leaving migrations and backend foundation idle.
- Stripe Testmode checkout can fail closed by setting/removing `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` or by removing Stripe Testmode config from the environment.
- Live credit-pack checkout can fail closed by setting/removing `ENABLE_LIVE_STRIPE_CREDIT_PACKS` or by removing live Stripe checkout config from the environment.
- Admin Control Plane rollback is static/frontend only.
- AI usage attempt/replay behavior is tied to migration `0036`; if disabling paid org-scoped AI paths, preserve legacy no-org image behavior and avoid deleting ledger/usage/attempt rows.

## 26. Notes For Future Codex Sessions

- Start with `CURRENT_IMPLEMENTATION_HANDOFF.md`, this report, `AUDIT_NEXT_LEVEL.md`, `AUDIT_ACTION_PLAN.md`, `DATA_INVENTORY.md`, and `docs/DATA_RETENTION_POLICY.md`.
- Confirm `git status --short` is clean before implementing new phases.
- Confirm latest auth migration is `0040_add_live_stripe_credit_pack_scope.sql`.
- Run `npm run release:preflight` before feature work if practical.
- Do not claim production readiness, live billing, full tenant isolation, or legal compliance.
- Do not run deploys, remote migrations, live Stripe setup, real production webhook tests, or Cloudflare dashboard mutations.
