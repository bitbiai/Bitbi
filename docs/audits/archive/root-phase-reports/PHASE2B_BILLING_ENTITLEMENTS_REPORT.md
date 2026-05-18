# Phase 2-B Billing / Entitlements Foundation Report

Date: 2026-04-26

Scope: Phase 2-B adds the first billing, plan, entitlement, credit ledger, and usage-event foundation for organization-scoped SaaS monetization. It does not enable live payment processing, invoices, provider webhooks, pricing, or a production billing launch.

## Executive Summary

Phase 2-B introduces additive D1 schema for plans, organization subscriptions, entitlements, credit ledger entries, usage events, and future provider customer mapping. It adds a small billing helper for resolving free/default plan state, checking entitlements, checking and consuming credits, granting credits idempotently, and returning sanitized admin billing summaries.

The new APIs expose read-only organization billing/entitlement/usage summaries and admin-only plan inspection plus manual credit grants. Existing AI/user-owned flows are not paywalled in this phase. The helper and tests prove that future AI route integration can block insufficient credits without allowing negative balances. Production deploy remains blocked until migration `0035_add_billing_entitlements.sql` is applied and staging verifies organization billing, entitlement, grant, and consume flows.

## Scope

Implemented:

- Additive auth D1 migration `0035_add_billing_entitlements.sql`.
- Default free plan and default entitlements.
- Organization-scoped subscription placeholder model.
- Credit ledger and usage-event tables with idempotency keys.
- Billing helper for plan resolution, entitlement checks, credit grants, and credit consumption.
- User/org billing summary APIs.
- Admin billing plan, organization billing inspection, and manual credit grant APIs.
- Route-policy, release compatibility, Worker harness, and Worker tests.
- Data inventory, retention policy, and auth Worker operational documentation updates.

Not implemented:

- No Stripe, Paddle, PayPal, invoice, checkout, subscription portal, or payment webhook integration.
- No real prices or production billing state.
- No full tenant migration of existing user-owned assets.
- No broad refactor of AI generation routes.
- No live Cloudflare deployment or remote migration.

## Baseline

- Starting branch: `main`.
- Phase 2-A was committed as `ea8759a Phase 2-A`.
- Working tree was clean before Phase 2-B edits.
- Latest auth migration before this phase was `0034_add_organizations.sql`.
- Baseline `npm run release:preflight` passed before implementation.
- Production deploy was already blocked on Phase 0/1/2-A live Cloudflare verification and migrations through `0034`.

## New Migration And Schema

New migration:

- `workers/auth/migrations/0035_add_billing_entitlements.sql`

New tables:

| Table | Purpose |
| --- | --- |
| `plans` | Product plan catalog with seeded `free` plan metadata. |
| `organization_subscriptions` | Organization-scoped current/future subscription state. |
| `entitlements` | Feature flags and numeric plan limits. |
| `billing_customers` | Placeholder provider mapping table for future payment integration. |
| `credit_ledger` | Auditable organization credit grants and debits with running balance. |
| `usage_events` | Idempotent feature usage records linked to credit debits. |

Important indexes:

- Plan status/code lookup.
- Organization subscription lookup by organization/status.
- Entitlement lookup by plan/feature.
- Provider and organization lookup for `billing_customers`.
- Ledger lookup by organization/time, feature/time, and idempotency key.
- Usage lookup by organization/feature/time, user/time, and idempotency key.

Seeded free entitlements:

- `ai.text.generate`
- `ai.image.generate`
- `ai.video.generate`
- `ai.storage.private`
- `org.members.max = 5`
- `credits.monthly = 100`
- `credits.balance.max = 1000`

## Billing And Entitlement Behavior

New helper:

- `workers/auth/src/lib/billing.js`

Behavior:

- Resolves an active organization’s billing state.
- Falls back to seeded `plan_free` when no active subscription exists.
- Returns effective plan entitlements.
- Checks whether an organization has a feature entitlement.
- Checks whether an organization has enough credits.
- Produces sanitized admin billing inspection data.
- Does not expose provider customer references, idempotency keys, request hashes, or metadata internals.

Default behavior preserves existing product flows. Current AI routes are not wired to billing enforcement yet, so Phase 2-B does not introduce a breaking paywall.

## Credit Ledger Behavior

Manual credit grants:

- Require platform admin access.
- Require `Idempotency-Key`.
- Reject conflicting reuse of the same idempotency key with a different request hash.
- Respect the active plan’s `credits.balance.max` entitlement.
- Record grant amount, balance after, actor id, source, and sanitized reason metadata.

Credit consumption helper:

- Requires an enabled entitlement.
- Requires a valid idempotency key.
- Rejects insufficient credits with `402 insufficient_credits`.
- Prevents negative balances.
- Records the credit debit and usage event in one D1 batch using an existence check so a usage insert failure cannot leave an unmatched debit.
- Resolves the latest balance by `created_at DESC, rowid DESC` so same-millisecond ledger writes do not rely on random ledger ids for ordering.
- Reusing the same idempotency key with the same request returns the existing usage event.
- Reusing the same idempotency key with a different request returns `409 idempotency_conflict`.

## APIs Added

User/org-scoped:

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/api/orgs/:id/entitlements` | Active organization member. |
| `GET` | `/api/orgs/:id/billing` | Organization admin/owner. |
| `GET` | `/api/orgs/:id/usage` | Organization admin/owner. |

Admin-scoped:

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/api/admin/billing/plans` | Platform admin, production MFA policy, fail-closed read limiter. |
| `GET` | `/api/admin/orgs/:id/billing` | Platform admin, production MFA policy, fail-closed read limiter. |
| `POST` | `/api/admin/orgs/:id/credits/grant` | Platform admin, production MFA policy, same-origin, byte-limited JSON, `Idempotency-Key`, fail-closed write limiter. |

No public test-only credit consume route was added.

## Usage Enforcement Foundation

Phase 2-B intentionally does not refactor all AI routes. It adds reusable helpers and tests that prove future enforcement can safely:

- Resolve organization plan state.
- Check feature entitlement.
- Check credit availability.
- Consume credits idempotently.
- Reject insufficient credits.
- Keep balances non-negative.

Routes to wire in Phase 2-C or later:

- Member/admin AI text generation.
- Member/admin AI image generation.
- Admin async AI video job creation.
- Private AI storage/save routes.
- Any future org-scoped expensive provider operation.

Until those routes are deliberately wired with a default free-plan compatibility policy, existing user-owned flows remain unchanged.

## Route Policy And Release Compatibility

Updated:

- `workers/auth/src/app/route-policy.js`
- `scripts/check-route-policies.mjs`
- `config/release-compat.json`
- `scripts/lib/release-compat.mjs`
- `scripts/test-release-compat.mjs`
- `scripts/check-js.mjs`

Route policy coverage includes:

- `orgs.entitlements.read`
- `orgs.billing.read`
- `orgs.usage.read`
- `admin.billing.plans.list`
- `admin.orgs.billing.read`
- `admin.orgs.credits.grant`

Release compatibility now tracks:

- Latest auth migration `0035_add_billing_entitlements.sql`.
- Admin billing plan route.
- Admin organization billing route.
- Admin organization credit grant mutation.

No new Cloudflare binding, secret, queue, Durable Object, R2 bucket, or cron trigger was introduced.

## Tests Added

Updated:

- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`

New Worker coverage:

- Default free plan and entitlement resolution.
- Organization entitlement read requires active membership.
- Organization billing/usage read requires org admin/owner role.
- Cross-org billing/entitlement reads are denied.
- Platform admin can list sanitized plans.
- Platform admin can inspect sanitized organization billing state.
- Platform admin can grant credits.
- Non-admin cannot grant credits.
- Credit grants are idempotent.
- Conflicting credit grant idempotency keys are rejected.
- Credit consumption is idempotent.
- Insufficient credits are denied.
- Credit balance never goes negative.
- Disabled entitlements block consumption.
- Foreign origin rejects credit grant before side effects.
- Oversized credit grant body returns `413` before parsing.
- Limiter exhaustion returns `429`.
- Missing limiter backend returns `503` fail closed.
- Route-policy lookup covers every new route.
- Existing Worker flows remain covered by the full Worker suite.

## Validation Results

Validation is recorded after implementation:

| Command | Result | Notes |
| --- | --- | --- |
| `npm run release:preflight` before edits | PASS | Confirmed clean Phase 2-A baseline before implementation. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 2-B"` | PASS, 3/3 | Targeted billing/entitlement/credit tests passed during implementation. |
| `npm run check:route-policies` | PASS | 112 registered auth-worker route policies, including Phase 2-B billing routes. |
| `npm run check:js` | PASS | 35 targeted JS files, including the new billing helper and admin route. |
| `npm run test:workers` | PASS, 320/320 | Full Worker suite passed after Phase 2-B changes. |
| `npm run test:static` | PASS, 155/155 | Static suite remains green; Phase 2-B did not change frontend behavior. |
| `npm run test:release-compat` | PASS | Release compatibility recognizes migration `0035` and billing route contracts. |
| `npm run test:release-plan` | PASS | Release planner classifies the auth migration/worker impact correctly. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq tests remain green. |
| `npm run validate:cloudflare-prereqs` | PASS repo config; production BLOCKED | Live validation was skipped, so production deploy remains blocked. |
| `npm run validate:release` | PASS | Release compatibility validation passed. |
| `npm run check:worker-body-parsers` | PASS | Worker body-parser guard remains green. |
| `npm run check:data-lifecycle` | PASS | Data lifecycle guard remains green after inventory/retention updates. |
| `npm run check:admin-activity-query-shape` | PASS | Admin activity query-shape guard remains green. |
| `npm run test:operational-readiness` | PASS | Operational readiness helper tests remain green. |
| `npm run check:operational-readiness` | PASS | Required operational docs/runbooks remain present. |
| `npm run build:static` | PASS | Static build succeeded. |
| `npm run release:preflight` | PASS | Aggregate preflight passed after the ledger ordering fix. |
| `git diff --check` | PASS | No whitespace errors. |

Validation finding fixed before final pass:

- Initial `npm run release:preflight` failed inside `npm run test:workers` because same-millisecond credit ledger entries could be ordered by random ledger id, causing the latest balance lookup to return the pre-consumption grant row. `workers/auth/src/lib/billing.js` now orders ledger balance lookups by `created_at DESC, rowid DESC`, and `tests/helpers/auth-worker-harness.js` simulates insertion-order tie-breaks. The targeted Phase 2-B tests, full Worker suite, and final `npm run release:preflight` pass after the fix.

## Merge Readiness

Status: pass for merge after final validation.

Required before merge:

- Commit the new migration, helper, route, release-compatibility, test, and documentation files together.
- Keep `npm run test:workers`, `npm run test:static`, `npm run release:preflight`, and `git diff --check` green.
- Do not omit `0035_add_billing_entitlements.sql`; APIs depend on the new tables.

## Production Deploy Readiness

Status: blocked.

Production deploy must remain blocked until:

1. Existing Phase 0/1/2-A Cloudflare prerequisites are live-verified.
2. Auth migrations through `0035_add_billing_entitlements.sql` are applied in staging.
3. Auth Worker code is deployed to staging after migration `0035`.
4. Staging verifies:
   - default free plan resolution,
   - organization entitlement read,
   - organization billing/usage read role enforcement,
   - admin plan inspection,
   - admin org billing inspection,
   - admin credit grant idempotency,
   - credit consume helper behavior in tests or a staging-only harness,
   - no live payment provider behavior is active.
5. Operators confirm no real payment webhooks, invoices, or provider mappings are enabled.

## Rollback Plan

- If auth Worker deploy fails, roll back the auth Worker code to the previous version.
- Migration `0035` is additive and can remain in place.
- If billing APIs misbehave in staging, remove client/operator access to the new API surface and roll back auth Worker code; existing user-owned flows do not depend on billing rows.
- Do not delete billing tables or ledger rows as rollback unless a separate audited cleanup plan is approved.

## Remaining Risks

| Risk | Impact | Blocks merge? | Blocks production deploy? | Next action |
| --- | --- | ---: | ---: | --- |
| No live payment provider integration. | No actual billing, checkout, invoices, renewals, or webhook handling exists. | No | No, if documented as foundation only | Design provider integration separately with webhook idempotency and replay tests. |
| Existing AI routes are not wired to entitlement/credit checks. | Credits are not yet enforced on production usage. | No | No, if existing behavior must remain unchanged | Phase 2-C should wire one route family at a time behind a free-plan compatibility policy. |
| Existing assets remain user-owned. | Billing is organization-scoped but assets are not fully tenant-scoped. | No | No, if documented | Continue domain-by-domain tenant migration later. |
| No monthly credit grant scheduler. | Seeded monthly plan grant is metadata only. | No | No | Add grant scheduler after product/billing policy is approved. |
| Migration `0035` is not live-verified. | Billing APIs fail without schema. | No | Yes | Apply and verify migration in staging before deploy. |
| Billing lifecycle/export policy is deferred. | Billing ledger/usage is not included in privacy export/delete plans yet. | No | No for foundation | Define billing lifecycle policy before live payments. |

## Next Recommended Actions

1. Run the full Phase 2-B validation set and keep `npm run release:preflight` green.
2. Stage migration `0035_add_billing_entitlements.sql`.
3. Verify org billing/entitlement/admin credit grant flows in staging.
4. Decide Phase 2-C scope: wire a low-risk AI route to entitlement/credit enforcement or design payment-provider integration.
5. Define billing retention/export/delete policy before enabling real payment-provider data.
