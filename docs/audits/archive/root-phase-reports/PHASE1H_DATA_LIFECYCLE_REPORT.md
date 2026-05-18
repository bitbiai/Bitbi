# PHASE1H_DATA_LIFECYCLE_REPORT.md

Date: 2026-04-26

## Executive Summary

Phase 1-H adds the repository foundation for user data lifecycle operations: a data inventory, retention-policy scaffold, D1 request schema, admin-only lifecycle APIs, export planning, deletion/anonymization planning, route-policy coverage, static guardrails, release compatibility updates, and Worker tests.

This phase is deliberately safe by default. It does not delete users, does not hard-delete R2 objects, does not execute production data mutations, and does not claim legal compliance. Export archives and irreversible deletion execution are deferred until policy, staging verification, and rollback expectations are settled.

## Handoff Update After Phase 1-I

Phase 1-I implements the export archive generation path that this report intentionally deferred: approved export plans can now generate bounded sanitized JSON archives into the private `AUDIT_ARCHIVE` R2 bucket. Irreversible deletion/anonymization execution, user self-service privacy flows, and physical expired-archive R2 cleanup remain deferred. See `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md` for current behavior and validation.

## Scope

Included:

- Data inventory across D1 tables, R2 buckets, contact Worker data, and lifecycle request tables.
- D1 schema for lifecycle requests, lifecycle request items, and export archive metadata.
- Admin/support APIs for creating, listing, inspecting, planning, and approving lifecycle requests.
- Export planning that records sanitized D1 summaries and R2 references.
- Deletion/anonymization planning that is dry-run by default and blocks only-active-admin deletion.
- Route policy, release compatibility, CI/preflight, and static guardrail updates.
- Worker tests for idempotency, redaction, subject scoping, CSRF/admin protection, fail-closed limiter behavior, and safe dry-run planning.

Excluded:

- User self-service privacy center.
- Export archive generation/download.
- Irreversible D1 or R2 deletion executor.
- Remote D1 migrations or production data mutation.
- Legal certification or final retention promises.

## Files Changed

| Area | Files |
| --- | --- |
| Data lifecycle service/routes | `workers/auth/src/lib/data-lifecycle.js`, `workers/auth/src/routes/admin-data-lifecycle.js`, `workers/auth/src/routes/admin.js` |
| D1 migration | `workers/auth/migrations/0032_add_data_lifecycle_requests.sql` |
| Route/release policy | `workers/auth/src/app/route-policy.js`, `config/release-compat.json`, `scripts/check-route-policies.mjs`, `scripts/lib/release-compat.mjs`, `scripts/lib/release-plan.mjs`, `scripts/test-release-compat.mjs`, `scripts/test-release-plan.mjs` |
| Static guardrails/CI | `scripts/check-data-lifecycle-policy.mjs`, `scripts/check-js.mjs`, `package.json`, `.github/workflows/static.yml` |
| Tests/harness | `tests/workers.spec.js`, `tests/helpers/auth-worker-harness.js` |
| Documentation | `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md`, `PHASE1H_DATA_LIFECYCLE_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `workers/auth/CLAUDE.md` |

## New Migration

`workers/auth/migrations/0032_add_data_lifecycle_requests.sql` adds:

- `data_lifecycle_requests`
- `data_lifecycle_request_items`
- `data_export_archives`

The migration is additive. It does not rewrite or delete existing data.

Important indexes:

- `data_lifecycle_requests(subject_user_id, created_at DESC)`
- `data_lifecycle_requests(status, created_at DESC)`
- `data_lifecycle_requests(type, status, created_at DESC)`
- `data_lifecycle_requests(expires_at)`
- `data_lifecycle_requests(created_at DESC, id DESC)`
- `data_lifecycle_request_items(request_id, created_at ASC)`
- `data_lifecycle_request_items(request_id, created_at ASC, id ASC)`
- `data_lifecycle_request_items(resource_type, resource_id)`
- `data_lifecycle_request_items(r2_bucket, r2_key)`
- `data_export_archives(request_id)`
- `data_export_archives(subject_user_id, created_at DESC)`
- `data_export_archives(expires_at)`

## Admin API Behavior

Routes added:

- `GET /api/admin/data-lifecycle/requests`
- `POST /api/admin/data-lifecycle/requests`
- `GET /api/admin/data-lifecycle/requests/:id`
- `POST /api/admin/data-lifecycle/requests/:id/plan`
- `POST /api/admin/data-lifecycle/requests/:id/approve`

Security behavior:

- Admin auth is required.
- Production admin MFA policy is inherited through the admin route boundary.
- Mutations require same-origin protection.
- Mutations use byte-limited JSON parsing.
- Create and approve require `Idempotency-Key`.
- The route uses a fail-closed shared limiter policy: `admin-data-lifecycle-ip`.
- Responses are sanitized and omit secret fields.
- Route policies are registered in `workers/auth/src/app/route-policy.js`.

No execute endpoint was added in Phase 1-H.

## Export Planning Behavior

`workers/auth/src/lib/data-lifecycle.js` builds export plans by inserting `data_lifecycle_request_items` entries for exportable/summarized resources.

Included examples:

- Account/profile basics.
- Linked wallet metadata.
- Favorites and AI folder metadata.
- AI image/text/video metadata.
- R2 object references for avatars and generated media.
- Bounded user activity and AI quota summaries.

Excluded secret/sensitive material:

- Password hashes.
- Session token hashes.
- Password reset or email verification token hashes.
- SIWE challenge secrets.
- Admin MFA encrypted TOTP secrets.
- MFA recovery code hashes.
- Service-auth signatures/secrets.
- Provider credentials and raw provider payloads.

Export archive generation is deferred. `data_export_archives` provides the schema foundation, but Phase 1-H does not write archive objects or expose a download route.

## Deletion/Anonymization Planning Behavior

Deletion and anonymization requests are forced to dry-run planning in Phase 1-H.

The plan can include:

- User/profile/favorites/folders/AI assets.
- R2 object references marked `delete_planned` or `retain_or_rekey`.
- Session revocation.
- Reset/verification/SIWE token expiry.
- Admin MFA revocation.
- Admin audit records marked `retain_or_anonymize`.

Safety behavior:

- The service does not hard-delete D1 rows.
- The service does not delete R2 objects.
- The service blocks deletion/anonymization when the subject is the only active admin.
- Approval moves a planned request to `approved`; it does not execute deletion.

## Self-Service Decision

User self-service export/delete was deferred. Phase 1-H implements admin/support tooling first because destructive lifecycle behavior requires confirmation design, abuse controls, retention policy review, and support runbooks before exposing user-facing endpoints.

## Retention Policy Scaffold

`docs/DATA_RETENTION_POLICY.md` records proposed engineering retention behavior for sessions, auth tokens, SIWE challenges, MFA state, contact submissions, activity/audit logs, AI jobs, poison messages, export archives, temporary R2 objects, and generated assets.

The file intentionally marks legal/product decisions as open and does not claim compliance.

## Route Policy and Release Compatibility

Route policies added:

- `admin.data-lifecycle.requests.list`
- `admin.data-lifecycle.requests.create`
- `admin.data-lifecycle.requests.read`
- `admin.data-lifecycle.requests.plan`
- `admin.data-lifecycle.requests.approve`

Release compatibility updates:

- Latest auth migration is now `0032_add_data_lifecycle_requests.sql`.
- Admin auth route coverage includes lifecycle collection and detail/action patterns.
- Release plan recommends `npm run check:data-lifecycle`.
- CI runs the lifecycle guardrail.

## Tests Added/Updated

Worker tests added in `tests/workers.spec.js` cover:

- Export request creation and repeated idempotency-key reuse.
- Idempotency conflict rejection.
- Export plan subject scoping.
- Secret field exclusion/redaction.
- Deletion dry-run planning without destructive side effects.
- Export requests remain dry-run even when a caller submits `dryRun: false`.
- Only-active-admin deletion/anonymization block.
- Approval of planned requests.
- Admin-only access.
- Foreign-origin rejection before side effects.
- Missing idempotency key rejection.
- Fail-closed limiter-unavailable behavior.

`tests/helpers/auth-worker-harness.js` now includes mock support for the lifecycle tables and planning queries.

Static guardrail added:

- `npm run check:data-lifecycle`

## Commands Run and Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:route-policies` | PASS | 93 policies registered after adding lifecycle routes. |
| `npm run check:data-lifecycle` | PASS | Migration tables/indexes, route policies, forbidden secret selects, and no destructive deletes were verified. |
| `npm run test:release-compat` | PASS | Release contract accepts migration `0032` and lifecycle admin route patterns. |
| `npm run check:js` | PASS | Targeted syntax/import check includes the new lifecycle files and script. |
| `npm run test:release-plan` | PASS | Release plan includes the new lifecycle guardrail. |
| `npm run check:admin-activity-query-shape` | PASS | Phase 1-G query-shape guard remains green. |
| `npm run check:worker-body-parsers` | PASS | Direct unsafe Worker body parsing guard remains green. |
| `npm run test:workers` | PASS | 309/309 Worker tests passed after lifecycle tests were added. |
| `npm run test:static` | PASS | 155/155 static tests passed. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq unit tests passed. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production BLOCKED | Repo config is valid; live Cloudflare validation was skipped, so production remains blocked. |
| `npm run check:toolchain` | PASS | Node/npm toolchain expectations remain consistent. |
| `npm run test:quality-gates` | PASS | Quality gate tests passed. |
| `npm run check:secrets` | PASS | Secret leakage guard passed. |
| `npm run check:dom-sinks` | PASS | DOM sink baseline guard passed. |
| `npm run check:operational-readiness` | PASS | Required operational docs/runbooks remain present. |
| `npm run test:operational-readiness` | PASS | Operational readiness tests passed. |
| `npm run check:live-health` | PASS, SKIPPED | No live URL configured; skipped mode is explicit for normal CI. |
| `npm run check:live-security-headers` | PASS, SKIPPED | No public base URL configured; skipped mode is explicit for normal CI. |
| `npm run validate:release` | PASS | Release compatibility validation passed. |
| `npm run test:asset-version` | PASS | Asset version tests passed. |
| `npm run validate:asset-version` | PASS | Asset version validation passed. |
| `npm run build:static` | PASS | Static site built successfully. |
| `npm ls --depth=0` | PASS | Root dependency tree resolves. |
| `npm audit --audit-level=low` | PASS | Root audit found 0 vulnerabilities. |
| `npm run release:preflight` | PASS | Aggregated release preflight passed after classifying `DATA_INVENTORY.md` as validation-only documentation. |
| `git diff --check` | PASS | No whitespace errors in the final diff. |

Intermediate validation issue resolved:

- Initial `npm run release:preflight` failed because the release planner treated root-level `DATA_INVENTORY.md` as uncategorized. The fix updated `scripts/lib/release-plan.mjs` to classify `DATA_*.md` root documentation as validation-only and added coverage in `scripts/test-release-plan.mjs`. The final preflight run passed.

## Staff Security / Privacy / Database Pre-Merge Review

Review result: pass for merge after targeted fixes; production deploy remains blocked until staging migration and live/manual Cloudflare prerequisite verification.

Issues found and fixed:

- The admin lifecycle request list query orders by `created_at DESC, id DESC`, but the first migration draft did not include a matching global list index. Added `idx_data_lifecycle_requests_created_id` to support the unfiltered admin list path without relying on a table scan as the table grows.
- Lifecycle request detail responses order request items by request and creation time. Added `idx_data_lifecycle_items_request_created_id` so the request detail path has a stable tie-breaker index for item ordering.
- Export request creation could persist `dryRun: false` even though Phase 1-H does not implement export archive generation or a deletion executor. `workers/auth/src/lib/data-lifecycle.js` now forces every lifecycle request to `dryRun: true` until explicit execution/archive jobs exist, and the Worker test now attempts `dryRun: false` for an export request and verifies the stored response remains dry-run.

Security/privacy checks confirmed:

- Export planning does not select password hashes, session token hashes, reset/verification token hashes, MFA encrypted secrets, recovery code hashes, service-auth secrets, provider credentials, or raw provider payloads.
- Lifecycle admin endpoints remain behind admin auth, inherited production MFA policy, same-origin mutation protection, fail-closed rate limiting, byte-limited JSON parsing, and required `Idempotency-Key` for create/approve mutations.
- Deletion/anonymization planning remains non-destructive, retains/anonymizes audit records instead of hard-deleting them, and blocks only-active-admin deletion/anonymization.
- R2 handling records owner-scoped references only; Phase 1-H does not fetch, expose, or delete R2 objects.
- No tests were skipped, deleted, or weakened during the review pass.

Checks not run:

- `npm ci` was not rerun because no dependency versions, package lockfiles, or worker package manifests changed; root `npm ls --depth=0` and `npm audit --audit-level=low` were run instead.
- Worker package install/audit checks were not rerun because `workers/auth`, `workers/contact`, and `workers/ai` package manifests and lockfiles did not change.
- Live Cloudflare validation, live health checks with `--require-live`, production deploy, remote D1 migrations, and destructive data operations were not run.

## Merge Readiness

Status: conditional pass.

Merge can be considered because the final validation suite passed. All Phase 1-H files listed above must be committed together. A partial commit can break migration tracking, admin route policy coverage, release-plan expectations, Worker tests, or documentation accuracy.

## Production Deploy Readiness

Status: blocked.

Do not deploy until:

- Auth D1 migration `0032_add_data_lifecycle_requests.sql` is applied in staging.
- Admin lifecycle create/list/detail/plan/approve flows are verified in staging.
- No destructive executor is enabled.
- Retention policy decisions are reviewed by product/legal before any irreversible deletion.
- Existing Phase 0/1 production prerequisites remain satisfied.

Production deploy is not blocked by user self-service or archive generation because those features are intentionally deferred, but production must not be described as compliance-complete.

## Required Staging/Production Migration Steps

1. Apply auth migration `0032_add_data_lifecycle_requests.sql` after all prior migrations through `0031`.
2. Deploy auth Worker code that includes lifecycle APIs.
3. Verify admin lifecycle request creation with a test subject.
4. Verify export planning excludes secret fields and includes only the subject user.
5. Verify deletion/anonymization planning is dry-run and does not remove D1/R2 data.
6. Verify only-active-admin deletion/anonymization is blocked.
7. Keep no execute route exposed until Phase 1-I or later.

## Rollback Plan

- If code deploy must roll back, keep migration `0032`; it is additive and safe to leave in place.
- Disable admin lifecycle access by rolling back the auth Worker route code if needed.
- Do not drop lifecycle tables in production rollback; preserve request evidence.
- If lifecycle planning produces incorrect items, stop using the APIs, keep request rows for investigation, and patch the planner before re-enabling.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
| --- | --- | ---: | ---: | --- |
| Export archives are not generated. | Admins can plan exports but cannot produce a downloadable archive. | No | No, if documented | Phase 1-I: implement bounded JSON archive generation into private R2. |
| No irreversible deletion executor. | Deletion requests remain approved plans only. | No | No, if documented | Phase 1-I: design executor with grace period, audit events, R2 deletion safety, and rollback limitations. |
| User self-service privacy endpoints are absent. | Support/admin must initiate requests. | No | No | Add user-facing request flow after confirmation/abuse policy is defined. |
| Retention windows are not legally approved. | Cannot claim compliance-grade retention. | No | Yes for compliance claims | Product/legal review of `docs/DATA_RETENTION_POLICY.md`. |
| Contact-form processor retention is external. | Contact export/delete handling may require Resend/manual process. | No | Yes for full privacy readiness | Decide whether to store contact submissions in D1 or document processor workflow. |
| Historical R2 ownership may be incomplete. | Destructive R2 deletion could miss or over-delete objects. | No | Yes for deletion executor | Staging inventory/dry-run before enabling execution. |

## Next Recommended Actions

1. Commit all Phase 1-H files together.
2. Apply migration `0032` in staging and verify admin lifecycle planning against realistic fixtures.
3. Have product/legal review `DATA_INVENTORY.md` and `docs/DATA_RETENTION_POLICY.md`.
4. Implement Phase 1-I export archive generation with short-lived private R2 archive metadata.
5. Design deletion execution with a recovery grace period, R2 dry-run verification, audit events, and admin dual-control if required.
6. Decide whether and when to expose user self-service export/delete requests.
