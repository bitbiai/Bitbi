# Phase 2-A Entrypoint

Date: 2026-04-26

Mission: implement the Organization / Tenant / RBAC foundation without redoing Phase 0 or Phase 1 hardening work.

## Source Documents To Read First

- `PHASE1_COMPLETION_HANDOFF.md`
- `AUDIT_NEXT_LEVEL.md`
- `AUDIT_ACTION_PLAN.md`
- `PHASE1E_ROUTE_POLICY_REPORT.md`
- `PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md`
- `PHASE1H_DATA_LIFECYCLE_REPORT.md`
- `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md`
- `PHASE1J_RETENTION_EXECUTOR_REPORT.md`
- `DATA_INVENTORY.md`
- `docs/DATA_RETENTION_POLICY.md`
- `docs/DATA_DELETION_EXECUTOR_DESIGN.md`
- `workers/auth/src/index.js`
- `workers/auth/src/app/route-policy.js`
- `workers/auth/migrations/`
- `config/release-compat.json`
- `tests/workers.spec.js`

## Current Completed Baseline

Phase 0-A through Phase 1-J are complete and merged at the checkpoint. The repo has:

- Passing Worker/static/release preflight evidence from Phase 1-J.
- Auth-to-AI HMAC with nonce replay protection.
- Fail-closed sensitive route limits and byte-limited request parsing.
- Durable admin MFA failed-attempt state.
- Async admin AI video jobs with queue/R2/poison-message hardening and sync debug gating.
- Purpose-specific auth/security secrets with explicit legacy compatibility.
- Low-risk quality gates, route policy registry/checks, operational docs/runbooks/live checks.
- Indexed/redacted admin activity search projection and signed cursors.
- Data inventory, retention baseline, admin lifecycle planning APIs, bounded private export archives, expired archive cleanup, and safe reversible lifecycle executor pilot.

## Do Not Redo

- Do not rebuild Phase 0/1 security controls.
- Do not replace async video job architecture unless tenant ownership requires a small additive change.
- Do not remove existing route-policy, quality, body-parser, query-shape, or data-lifecycle checks.
- Do not implement billing, entitlements, SSO, or full compliance automation in Phase 2-A.
- Do not claim full tenant isolation until existing user-owned resources are migrated or explicitly scoped.
- Do not deploy or run production-affecting commands.

## Prerequisites

- `git status --short` is clean.
- Latest Phase 1-J commit is present and pushed.
- The handoff documentation update containing `PHASE1_COMPLETION_HANDOFF.md` and `PHASE2A_ENTRYPOINT.md` is committed.
- `npm run release:preflight` passes on the starting commit.
- Latest auth migration number is documented as `0033`.
- Production deploy blockers from `PHASE1_COMPLETION_HANDOFF.md` are known.
- No production deploy is assumed.

## Phase 2-A Scope

Implement the smallest safe Organization / Tenant / RBAC foundation:

- Add organization schema.
- Add organization membership schema.
- Add basic roles such as owner/admin/member/viewer if suitable for current product needs.
- Add tenant context helper for future route migration.
- Add minimal org APIs for create/list/detail/member inspection or management.
- Add admin org inspection routes if low-risk.
- Add a backfill plan for existing single-user accounts and user-owned records.
- Preserve existing user-owned flows until explicitly migrated.
- Add route policy entries for every new sensitive route.
- Update release compatibility and migration tracking.
- Add Worker tests for org creation, membership, role enforcement, cross-org denial, admin inspection, idempotency where needed, CSRF, body-size limits, fail-closed rate limits, and migration/prereq coverage.
- Update audit/action docs and create a Phase 2-A report.

## Phase 2-A Out Of Scope

- Billing, plans, entitlements, invoices, payment webhooks.
- Full migration of every existing asset/media/activity/lifecycle record to org ownership.
- Full enterprise RBAC/policy engine.
- SSO/SAML/OIDC enterprise identity.
- Frontend redesign or full admin UI rewrite.
- Legal compliance certification.
- Production deploy or Cloudflare dashboard mutation.

## Definition Of Done

- New org/membership/role schema is forward-only and D1-compatible.
- Existing individual-user flows continue to pass tests.
- New org helpers have clear ownership and authorization behavior.
- Minimal org APIs are authenticated, same-origin protected for mutations, byte-limited, fail-closed rate-limited, and route-policy registered.
- Cross-org access is denied in tests.
- Backfill plan is documented and does not mutate production.
- Release compatibility and route-policy checks are updated.
- `npm run release:preflight` passes.
- Production deploy readiness remains conditional on migrations and live Cloudflare/staging verification.

## Review Prompt Pointer

After implementing Phase 2-A, run a Staff Security / Staff Engineer pre-merge review focused on:

- Cross-org access bypasses.
- Role escalation.
- Missing membership checks.
- Existing user-owned flows broken by tenant assumptions.
- Mutations missing CSRF/body limits/fail-closed rate limits.
- Route policy gaps.
- Migration/index issues.
- Backfill plan safety.
- Production readiness overclaiming.

## Ready-To-Copy Phase 2-A Codex Prompt

```text
You are now implementing Phase 2-A of the SaaS hardening roadmap.

Context:
Phase 0-A, Phase 0-A+, Phase 0-B, and Phase 1-A through Phase 1-J are complete and merged. Do not redo completed Phase 0 or Phase 1 work.

Read first:
- PHASE1_COMPLETION_HANDOFF.md
- PHASE2A_ENTRYPOINT.md
- AUDIT_NEXT_LEVEL.md
- AUDIT_ACTION_PLAN.md
- PHASE1E_ROUTE_POLICY_REPORT.md
- PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md
- PHASE1H_DATA_LIFECYCLE_REPORT.md
- PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md
- PHASE1J_RETENTION_EXECUTOR_REPORT.md
- DATA_INVENTORY.md
- docs/DATA_RETENTION_POLICY.md
- workers/auth/src/index.js
- workers/auth/src/app/route-policy.js
- workers/auth/migrations/
- config/release-compat.json
- tests/workers.spec.js
- current git status and current git diff

Before coding:
1. Confirm git status is clean or contains only expected Phase 2-A changes.
2. Confirm latest auth migration is 0033_harden_data_export_archives.sql.
3. Run or inspect npm run release:preflight if practical.
4. Stop and report if the repo is already red.

Mission:
Implement the Organization / Tenant / RBAC foundation with minimal, production-safe changes.

Scope:
- Add forward-only D1 schema for organizations and memberships.
- Add basic role model and indexes.
- Add a small tenant/org context helper.
- Add minimal authenticated organization APIs.
- Add admin org inspection if low-risk.
- Preserve existing individual user-owned behavior.
- Add a safe backfill plan for existing accounts and owned records.
- Register all new sensitive routes in the route policy registry.
- Update release compatibility and tests.
- Create PHASE2A_ORG_RBAC_REPORT.md.
- Update AUDIT_ACTION_PLAN.md and AUDIT_NEXT_LEVEL.md.

Out of scope:
- Billing/plans/entitlements.
- Full migration of every existing asset to org ownership.
- Enterprise RBAC/policy engine.
- SSO.
- Frontend redesign.
- Production deploy or Cloudflare dashboard mutation.

Security requirements:
- Do not weaken auth, admin/MFA, route-policy checks, CSRF/origin checks, body-size limits, fail-closed rate limits, HMAC service auth, nonce replay protection, purpose-specific secrets, async video safety, activity search safety, or data lifecycle guardrails.
- Every new mutation must use same-origin protection, byte-limited parsing, fail-closed limiter behavior, and route-policy metadata.
- Cross-org access must be denied by default.
- Do not claim full tenant isolation until all relevant records are migrated or explicitly scoped as legacy user-owned behavior.

Tests:
- org creation/list/detail
- membership creation/list/update where implemented
- role enforcement
- cross-org denial
- user without membership denied
- admin inspection boundaries
- CSRF rejection before side effects
- body-size rejection before parsing
- fail-closed limiter unavailable returns 503
- exceeded limiter returns 429
- migration/release compatibility
- route-policy coverage
- existing user-owned flows remain green

Validation:
Run at minimum:
- npm run test:workers
- npm run test:static
- npm run test:release-compat
- npm run test:release-plan
- npm run test:cloudflare-prereqs
- npm run validate:cloudflare-prereqs
- all Phase 1-C quality checks
- npm run check:route-policies
- all Phase 1-F operational-readiness checks
- npm run check:admin-activity-query-shape
- npm run check:data-lifecycle
- npm run validate:release
- npm run build:static
- npm run release:preflight
- git diff --check

Final response:
Return what changed, why it matters, files added/modified, new migrations, org/RBAC behavior, backfill plan, route-policy/release changes, tests/checks added, commands passed/failed, merge readiness, production deploy readiness, required staging/production migration steps, rollback plan, remaining blockers, and next 5 actions.
```

## Phase 2-A Pre-Flight Checklist

```text
Before starting Phase 2-A:
[ ] git status is clean
[ ] latest Phase 1-J commit is pushed
[ ] npm run release:preflight passes
[ ] AUDIT_NEXT_LEVEL.md includes Phase 1-J progress
[ ] AUDIT_ACTION_PLAN.md is updated through Phase 1-J
[ ] PHASE1_COMPLETION_HANDOFF.md exists
[ ] PHASE2A_ENTRYPOINT.md exists
[ ] handoff documentation update is committed
[ ] no production deploy is assumed
[ ] latest migration number is documented
```
