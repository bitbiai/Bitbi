# Phase 2-A Organization / RBAC Foundation Report

Date: 2026-04-26

Scope: Phase 2-A adds the first organization, membership, and basic RBAC foundation to the auth Worker. It preserves existing user-owned product flows and does not implement billing, full tenant isolation, SSO, or a full migration of existing assets to organizations.

## Executive Summary

Phase 2-A introduces a forward-only D1 schema for organizations and memberships, a small organization/RBAC helper, minimal authenticated organization APIs, admin-only organization inspection APIs, route-policy coverage, release compatibility tracking, Worker tests, and a documented backfill plan.

The new model is additive. Existing `user_id` ownership for profiles, media, AI assets, activity, and data lifecycle remains unchanged until a later controlled migration. This phase is merge-ready only after the listed validation commands pass and all changed/new files are committed together. It is not production-deploy-ready until migration `0034_add_organizations.sql` and the existing Phase 0/1 Cloudflare prerequisites are staged and live-verified.

## Baseline

- Phase 0-A through Phase 1-J were already complete and merged before this work started.
- Starting branch was `main`, with a clean status before Phase 2-A edits.
- `npm run release:preflight` passed before implementation.
- Latest auth migration before Phase 2-A was `0033_harden_data_export_archives.sql`.
- Production deployment was already blocked on live Cloudflare verification and staging checks; Phase 2-A adds migration `0034` to that deploy checklist.

## What Changed

### D1 Schema

New migration:

- `workers/auth/migrations/0034_add_organizations.sql`

New tables:

- `organizations`
- `organization_memberships`

Indexes:

- Unique organization slug.
- Unique creator/idempotency key for organization creation.
- Organization created/status indexes for admin/list views.
- Unique `(organization_id, user_id)` membership.
- Unique organization/member-create idempotency index.
- User/status and organization/role membership indexes.

No existing table is rebuilt or destructively modified.

### Organization Helper

New helper:

- `workers/auth/src/lib/orgs.js`

Behavior:

- Defines roles: `owner`, `admin`, `member`, `viewer`.
- Validates organization ids, names, slugs, roles, user ids, and `Idempotency-Key`.
- Creates organizations with an owner membership in one D1 batch.
- Supports idempotent organization creation.
- Lists organizations for an authenticated user.
- Requires active membership for organization detail/member listing.
- Allows owners to grant any role and admins to grant only `member` or `viewer`.
- Denies non-members by default.
- Provides sanitized admin organization detail/list helpers.

### User Organization APIs

New routes:

- `GET /api/orgs`
- `POST /api/orgs`
- `GET /api/orgs/:id`
- `GET /api/orgs/:id/members`
- `POST /api/orgs/:id/members`

Security behavior:

- Authenticated session required.
- Mutations require same-origin browser context through the existing central guard.
- Mutations use byte-limited JSON parsing with `BODY_LIMITS.smallJson`.
- Mutations require `Idempotency-Key`.
- Mutations use fail-closed shared limiter behavior:
  - `org-create-user`
  - `org-member-write-user`
- Cross-org/non-member reads return safe denial.
- Responses omit idempotency hashes and internal request metadata.

### Admin Organization APIs

New routes:

- `GET /api/admin/orgs`
- `GET /api/admin/orgs/:id`

Security behavior:

- Admin session required.
- Existing production admin MFA policy applies through `requireAdmin`.
- Admin reads use fail-closed limiter behavior with `admin-org-read-ip`.
- Responses are sanitized and omit internal idempotency/hash fields.

## Backfill Plan

Phase 2-A does not backfill production data and does not assign existing assets to organizations.

Recommended Phase 2-B/2-C backfill sequence:

1. Create a default personal organization for each active user in staging.
2. Add owner membership for each user in their personal organization.
3. Add nullable `organization_id` columns to selected user-owned tables in small migrations.
4. Dual-read using `user_id` and optional `organization_id` while preserving existing user flows.
5. Backfill one domain at a time, starting with low-risk metadata tables before media/R2-owned data.
6. Add route-level tenant context checks for migrated domains.
7. Only enforce required `organization_id` after staging verification and rollback planning.

Historical R2 objects remain user-owned until an owner-map/backfill is proven. No destructive ownership migration is performed in this phase.

## Route Policy And Release Compatibility

Updated:

- `workers/auth/src/app/route-policy.js`
- `scripts/check-route-policies.mjs`
- `config/release-compat.json`
- `scripts/lib/release-compat.mjs`
- `scripts/test-release-compat.mjs`
- `scripts/lib/release-plan.mjs`

Route-policy coverage includes:

- `orgs.list`
- `orgs.create`
- `orgs.read`
- `orgs.members.list`
- `orgs.members.add`
- `admin.orgs.list`
- `admin.orgs.read`

Release compatibility now tracks:

- Latest auth migration `0034_add_organizations.sql`.
- Auth index delegated organization routes.
- Admin organization inspection routes.

## Tests Added

Updated:

- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`

New Worker coverage:

- Organization create/list/detail.
- Organization creation idempotency.
- Idempotency conflict rejection.
- Foreign-origin mutation rejection before side effects.
- Oversized organization body rejection without body echo.
- Limiter exhaustion returns `429`.
- Missing limiter backend returns `503`.
- Membership add/list with role enforcement.
- Non-member cross-org denial.
- Member role cannot grant additional members.
- Admin org list/detail requires admin and returns sanitized metadata.
- Admin org read fails closed when limiter backend is unavailable.
- Route-policy lookup coverage for org routes.

## Merge Readiness

Status: conditional pass after validation.

Required before merge:

- Commit all changed/new Phase 2-A files together.
- Keep `npm run test:workers`, `npm run test:static`, `npm run release:preflight`, and `git diff --check` green.
- Do not omit the new migration, route files, release compatibility updates, tests, or this report.

## Production Deploy Readiness

Status: blocked until staging/live verification.

Required deploy steps:

1. Apply auth D1 migrations through `0034_add_organizations.sql` in staging.
2. Deploy auth Worker code after migration `0034` is applied.
3. Verify organization create/list/detail/member-add/admin-inspection flows in staging.
4. Verify the existing Phase 0/1 Cloudflare prerequisites remain present:
   `PUBLIC_RATE_LIMITER`, `ACTIVITY_INGEST_QUEUE`, `AI_VIDEO_JOBS_QUEUE`, `USER_IMAGES`, `AUDIT_ARCHIVE`, `AI_LAB`, purpose-specific auth secrets, matching `AI_SERVICE_AUTH_SECRET`, and AI replay Durable Object resources.
5. Keep production deploy blocked until live Cloudflare validation and staging checks pass.

## Rollback Plan

- If auth Worker deploy fails, roll back the auth Worker code to the previous version. Migration `0034` is additive and can remain in place.
- If organization APIs misbehave in staging, do not route users to the new APIs; existing user-owned flows do not depend on organization rows.
- Do not delete org/membership rows as a rollback step unless a separate audited cleanup plan is approved.

## Remaining Risks

| Risk | Impact | Blocks merge? | Blocks production deploy? | Next action |
| --- | --- | ---: | ---: | --- |
| Existing assets remain user-owned. | No full tenant isolation yet. | No | No, if documented as additive foundation | Implement domain-by-domain tenant migration later. |
| No invitations or membership lifecycle UI. | Admin/user workflows are API foundation only. | No | No | Add invites/removal/update flows in a later scoped phase. |
| No billing/entitlements. | Organizations do not enforce paid plans or quotas. | No | No | Defer to Phase 2-B or later. |
| Migration `0034` not live-verified. | New APIs fail in deployed environments without schema. | No | Yes | Apply and verify migration in staging before deploy. |
| Route policy remains metadata/checking, not a central authorization framework. | Review risk is reduced but not eliminated. | No | No | Continue route-by-route enforcement until a safe central wrapper exists. |

## Validation Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run release:preflight` before edits | PASS | Confirmed baseline before Phase 2-A changes. |
| `npm run check:route-policies` | PASS | 106 registered policies after org route additions. |
| `npm run check:js` | PASS | 33 targeted files after adding org modules. |
| `npm run test:release-compat` | PASS | Release compatibility recognizes migration `0034` and org route contracts. |
| `npm run test:release-plan` | PASS | Release planner accepts Phase 2 docs and the auth migration/worker impact classification. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq validator tests remain green. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 2-A"` | PASS, 4/4 | Targeted org/RBAC tests passed. |
| `npm run test:workers` | PASS, 317/317 | Full Worker suite passed after Phase 2-A changes. |
| `npm run test:static` | PASS, 155/155 | Static/UI suite remains green; Phase 2-A did not change frontend behavior. |
| `npm run validate:cloudflare-prereqs` | PASS repo config; production BLOCKED | Live validation was skipped, so production deploy remains blocked. |
| `npm run check:toolchain` | PASS | Toolchain guard remains green. |
| `npm run test:quality-gates` | PASS | Quality gate script tests remain green. |
| `npm run check:secrets` | PASS | No obvious committed secret patterns were detected. |
| `npm run check:dom-sinks` | PASS | DOM sink baseline did not regress. |
| `npm run check:worker-body-parsers` | PASS | Direct unsafe body parser guard remains green. |
| `npm run test:operational-readiness` | PASS | Operational readiness tests remain green. |
| `npm run check:operational-readiness` | PASS | Required operational docs/runbooks remain present. |
| `npm run check:live-health` | PASS, SKIPPED | No live URL configured; skipped mode is explicit and non-production. |
| `npm run check:live-security-headers` | PASS, SKIPPED | No public base URL configured; skipped mode is explicit and non-production. |
| `npm run check:admin-activity-query-shape` | PASS | Activity search/query-shape guard remains green. |
| `npm run check:data-lifecycle` | PASS | Data lifecycle guard remains green. |
| `npm run validate:release` | PASS | Release compatibility config validates. |
| `npm run test:asset-version` | PASS | Asset version tests remain green. |
| `npm run validate:asset-version` | PASS | Asset version validation remains green. |
| `npm run build:static` | PASS | Static build completed. |
| `npm run release:preflight` | PASS | Aggregate preflight passed after Phase 2-A changes. |
| `git diff --check` | PASS | No whitespace errors. |

Not run:

- Live Cloudflare checks with `--require-live`; no staging/production URLs or credentials were configured in this local pass.
- Remote D1 migrations and production deploy; both are explicitly out of scope.
- Package install/audit commands; package manifests and lockfiles were not changed in Phase 2-A.

## Next Recommended Actions

1. Run full pre-merge validation, including `npm run release:preflight`.
2. Review Phase 2-A with a Staff Security / Staff Engineer focus on role escalation, cross-org access, and migration safety.
3. Apply migration `0034` in staging and verify organization flows.
4. Design Phase 2-B around tenant-aware ownership migration or billing/entitlements, but do not combine both in one large rewrite.
5. Keep existing user-owned flows stable until each domain has explicit tenant-context tests and rollback guidance.
