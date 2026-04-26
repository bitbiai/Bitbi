# PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md

Date: 2026-04-26

## Executive Summary

Phase 1-I implements bounded, sanitized export archive generation for approved admin data-lifecycle export requests. Archives are JSON manifests stored in the existing private `AUDIT_ARCHIVE` R2 bucket with D1 metadata, expiration, SHA-256, size, and status fields.

The phase does not implement irreversible deletion. Deletion/anonymization execution remains design-only and disabled by default. This preserves the Phase 1-H safety model while adding a practical export artifact path for support/admin workflows.

Post-Phase 1-I handoff: Phase 1-J implements the bounded expired archive cleanup and a safe reversible-action executor pilot that were deferred here. Irreversible hard deletion, user self-service privacy flows, contact-processor policy enforcement, and historical R2 owner backfill remain deferred.

## Scope

Implemented:

- Additive D1 migration `0033_harden_data_export_archives.sql`.
- Bounded JSON export archive generation from approved export plans.
- Private R2 storage under deterministic `data-exports/{subjectUserId}/{requestId}/{archiveId}.json` keys.
- Admin-only archive metadata and authorized download routes.
- Archive expiration enforcement on access.
- Archive generation bounds for item count and JSON byte size.
- Static guardrails, route policies, release compatibility, and Worker tests.
- Deletion/anonymization executor design in `docs/DATA_DELETION_EXECUTOR_DESIGN.md`.

Not implemented:

- User-facing privacy center.
- Public or unauthenticated export download URLs.
- Inline binary media archives.
- Irreversible D1/R2 deletion.
- Automated export-archive R2 cleanup cron. Post-Phase 1-J note: bounded scheduled cleanup now exists; this bullet is retained as historical Phase 1-I scope.
- Legal compliance certification.

## Files Changed

| Area | Files |
| --- | --- |
| D1 migration | `workers/auth/migrations/0033_harden_data_export_archives.sql` |
| Export archive service | `workers/auth/src/lib/data-export-archive.js` |
| Admin lifecycle routes | `workers/auth/src/routes/admin-data-lifecycle.js` |
| Route policy and release contract | `workers/auth/src/app/route-policy.js`, `config/release-compat.json`, `scripts/check-route-policies.mjs`, `scripts/test-release-compat.mjs` |
| Static guardrails | `scripts/check-data-lifecycle-policy.mjs`, `scripts/check-js.mjs` |
| Tests and harness | `tests/workers.spec.js`, `tests/helpers/auth-worker-harness.js` |
| Documentation | `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md`, `docs/DATA_DELETION_EXECUTOR_DESIGN.md`, `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `PHASE1H_DATA_LIFECYCLE_REPORT.md`, `PHASE1E_ROUTE_POLICY_REPORT.md`, `workers/auth/CLAUDE.md` |

## Baseline From Phase 1-H

Phase 1-H created lifecycle requests, plan items, and archive metadata tables. Requests were forced to dry-run, export archive generation was deferred, and no delete/anonymize executor existed.

## New Migration

`workers/auth/migrations/0033_harden_data_export_archives.sql` adds metadata columns to `data_export_archives`:

- `manifest_version`
- `status`
- `updated_at`
- `downloaded_at`
- `deleted_at`
- `error_code`
- `error_message`

New indexes:

- `idx_data_export_archives_request_status`
- `idx_data_export_archives_status_expires`

The migration is additive and does not rewrite existing lifecycle request rows or user data.

## Export Archive Behavior

`workers/auth/src/lib/data-export-archive.js` generates archives only when:

- The lifecycle request exists.
- The request type is `export`.
- The request has been planned and approved.
- Plan items already exist.
- A non-expired ready archive does not already exist for the request.
- `AUDIT_ARCHIVE` is available.
- Item count and JSON byte limits are not exceeded.

Archive document shape:

- `manifest`: version, generated timestamp, format, binary policy, and secret policy.
- `request`: lifecycle request id/type/status/subject/approval metadata.
- `records`: sanitized lifecycle item summaries.
- `media`: sanitized manifest references to planned media/R2 objects; no binary objects or raw internal R2 object keys are embedded.

Forbidden material remains excluded:

- Password hashes.
- Session/reset/verification token hashes.
- SIWE challenge secrets.
- MFA TOTP secrets or recovery code hashes.
- Service-auth signatures/secrets.
- API keys/provider credentials.
- Raw request bodies or raw internal logs.

## R2 / Archive Storage

Archives are written to the existing private `AUDIT_ARCHIVE` bucket. No new Cloudflare binding is introduced.

Key format:

`data-exports/{subjectUserId}/{requestId}/{archiveId}.json`

The archive object key contains ids only, not email addresses or user-provided text. Admin API metadata responses intentionally do not expose the internal export-archive R2 key.

Archive JSON media references intentionally avoid raw internal media R2 keys. They expose the resource type/id, bucket label, key class, and SHA-256 digest of the internal media key for support correlation without leaking storage paths.

## Archive Authorization

Routes added:

- `POST /api/admin/data-lifecycle/requests/:id/generate-export`
- `GET /api/admin/data-lifecycle/requests/:id/export`
- `GET /api/admin/data-lifecycle/exports/:id`

All routes are admin-only and inherit production MFA policy through the admin boundary. The mutation route requires same-origin protection, a byte-limited JSON parse, fail-closed `admin-data-lifecycle-ip` limiting, and `Idempotency-Key`.

The download route returns the archive JSON only through the authenticated admin Worker route. It does not create a public URL.

## Archive Retention

Each archive has `expires_at` and `status`. The download route rejects expired archives with `410` and marks ready-but-expired metadata as `expired`.

Physical R2 object cleanup was intentionally deferred in Phase 1-I until a bounded cleanup worker/cron was added and tested. Post-Phase 1-J note: `workers/auth/src/lib/data-export-cleanup.js` now performs bounded, prefix-scoped cleanup for expired `data-exports/` objects.

## Deletion / Anonymization Executor

No deletion/anonymization execute endpoint is exposed in Phase 1-I.

`docs/DATA_DELETION_EXECUTOR_DESIGN.md` defines the required state machine, approval model, reversible actions, disabled irreversible actions, R2 stages, D1 stages, failure handling, rollback limits, and tests required before hard deletion or irreversible anonymization can be enabled.

## Route Policy and Release Compatibility

Route policies added:

- `admin.data-lifecycle.requests.generate-export`
- `admin.data-lifecycle.requests.export.read`
- `admin.data-lifecycle.exports.read`

Release compatibility updates:

- Latest auth migration is now `0033_harden_data_export_archives.sql`.
- Admin auth route patterns include the archive generation, archive metadata, and archive download routes.
- `npm run check:data-lifecycle` now verifies migration `0033`, archive indexes, archive route policies, private `AUDIT_ARCHIVE` usage, and archive bounds.

## Tests Added / Updated

Worker tests cover:

- Approved export request generates a private archive.
- Archive generation requires `Idempotency-Key`.
- Foreign-origin generation is rejected before R2 writes.
- Repeated generation returns the existing archive without a second R2 write.
- Non-admin archive download is rejected.
- Admin archive download returns sanitized JSON.
- Archive excludes another user’s data.
- Archive excludes token/password hash fields.
- Archive excludes raw internal media R2 keys and exposes only safe media key digests/classes.
- Archive does not inline media binaries.
- Archive expiration returns `410`.
- Item-count limit fails safely with `413`.
- R2 write failure marks archive/request failure safely.

Static guards cover:

- Archive migration columns and indexes.
- Archive route policy coverage.
- No forbidden secret-field selects.
- No irreversible user delete operations.
- Private `AUDIT_ARCHIVE` archive storage.
- No raw internal media R2 key exposure in archive JSON.
- Archive item/byte bounds.

## Staff Pre-Merge Review Findings

Review result before fixes: conditional pass with one privacy hardening issue.

Review result after fixes: conditional pass. The archive privacy issue below was fixed, the requested Worker/static/release/policy validation commands passed, and production deploy remains blocked until staging migration and live Cloudflare verification are complete.

Issue found:

- The first Phase 1-I archive manifest included raw internal media R2 object keys inside the downloaded archive JSON media manifest. The route was admin-only and metadata responses did not expose the private export archive key, but including raw media storage paths in a privacy export artifact created avoidable coupling to internal storage layout and would have been risky if user-owned export access is added later.

Fix applied:

- `workers/auth/src/lib/data-export-archive.js` now redacts raw internal media R2 keys from lifecycle item summaries and media manifests.
- Archive media entries now expose `bucket`, `keyClass`, `keySha256`, and `internalKeyIncluded: false` instead of `key`.
- `tests/workers.spec.js` now asserts the downloaded archive JSON does not contain raw media R2 paths and that media references use key digests/classes.
- `scripts/check-data-lifecycle-policy.mjs` now fails if the archive helper reintroduces `key: entry.r2_key` / `key: row.r2_key`, or if the safe media reference fields are removed.
- `DATA_INVENTORY.md` and `docs/DATA_RETENTION_POLICY.md` now explicitly document that Phase 1-I export archives do not expose raw internal media R2 keys.

No irreversible deletion, R2 object deletion, audit-log deletion, or user self-service privacy route was added during review.

## Commands Run and Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:toolchain` | PASS | Node/npm toolchain guard remains green. |
| `npm run test:quality-gates` | PASS | Secret/DOM/toolchain scanner tests pass. |
| `npm run check:secrets` | PASS | No obvious committed secret patterns detected. |
| `npm run check:dom-sinks` | PASS | DOM sink baseline guard remains green. |
| `npm run check:js` | PASS | 29 targeted JS files passed syntax checks after adding the archive helper. |
| `npm run check:worker-body-parsers` | PASS | No new unsafe direct Worker body parser bypasses detected. |
| `npm run check:route-policies` | PASS | 96 route policies passed after adding archive routes. |
| `npm run check:data-lifecycle` | PASS | Lifecycle guard passes for migration `0032`, migration `0033`, route policies, archive bounds, and destructive-operation guardrails. |
| `npm run test:operational-readiness` | PASS | Operational readiness helper tests remain green. |
| `npm run check:operational-readiness` | PASS | Required operational docs/runbooks still exist. |
| `npm run check:live-health` | PASS, skipped live check | No live health URL configured; skipped mode is explicit and non-flaky. |
| `npm run check:live-security-headers` | PASS, skipped live check | No public base URL configured; skipped mode is explicit and non-flaky. |
| `npm run check:admin-activity-query-shape` | PASS | Phase 1-G raw metadata/cursor regression guard remains green. |
| `npm run test:release-compat` | PASS | Release contract accepts migration `0033` and archive route patterns. |
| `npm run test:release-plan` | PASS | Release planner accepts the Phase 1-I file classification and check recommendations. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prerequisite tests remain green. |
| `npm run validate:cloudflare-prereqs` | PASS repo config; production BLOCKED | Live validation was skipped, so production deploy remains blocked as intended. |
| `npm run test:asset-version` | PASS | Asset version tests remain green. |
| `npm run validate:release` | PASS | Release compatibility manifest validates. |
| `npm run validate:asset-version` | PASS | Asset version validation remains green. |
| `npm run build:static` | PASS | Static site build succeeds. |
| `npm run test:static` | PASS, 155/155 | Static UI regression suite remains green. |
| `npm run test:workers` | PASS, 311/311 | Worker suite includes Phase 1-I archive generation, redaction, authorization, idempotency, bounds, expiration, and R2 failure tests. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "admin data lifecycle export archive"` | PASS, 2/2 | Targeted archive regression tests passed after the review fix. |
| `npm run release:preflight` | PASS | Aggregate preflight passed with Phase 1-I changes. |
| `git diff --check` | PASS | No whitespace errors. |
| `git status --short` | PASS, dirty expected | Shows the Phase 1-I files that must be committed together before merge. |

Not run:

- Root `npm ci` and Worker package install/audit checks were not rerun because no package manifests or lockfiles changed.
- Root `npm ls --depth=0` and `npm audit --audit-level=low` were not rerun during this review because no dependency manifests or lockfiles changed.
- Remote D1 migrations were not run.
- Live Cloudflare validation with `--require-live` was not run because no live URLs/credentials were configured in this local pass.
- Production deploy and `npm run release:apply` were not run.

## Merge Readiness

Status: conditional pass.

Merge requires all Phase 1-I code, migration, tests, release policy, and documentation files to be committed together. The final validation suite passed, including `npm run release:preflight`.

## Production Deploy Readiness

Status: blocked.

Do not deploy until:

- Auth D1 migrations through `0033_harden_data_export_archives.sql` are applied in staging.
- `AUDIT_ARCHIVE` is verified in staging for archive writes/reads.
- Admin lifecycle export create/plan/approve/generate/download is verified in staging.
- Archive expiration behavior is verified.
- No deletion/anonymization execute route is exposed.
- Existing Phase 0/1 production prerequisites remain satisfied.

## Required Staging / Production Migration Steps

1. Apply migrations through `0032`.
2. Apply migration `0033_harden_data_export_archives.sql`.
3. Deploy auth Worker code.
4. Verify archive generation writes one private object under `data-exports/`.
5. Verify metadata responses do not expose the archive R2 key.
6. Verify authorized admin download works and non-admin access is denied.
7. Verify expired archive access returns `410`.

## Rollback Plan

- Keep migration `0033`; it is additive and safe to leave in place.
- Roll back auth Worker code if archive routes must be disabled.
- Do not drop `data_export_archives` metadata in rollback.
- If an incorrect archive is generated, remove access by rolling back the route code and manually review the private R2 object; do not delete lifecycle evidence.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
| --- | --- | ---: | ---: | --- |
| No user self-service privacy center. | Support/admin must initiate exports. | No | No | Design user-facing request/confirmation flow later. |
| No irreversible deletion executor. | Delete/anonymize requests remain plans only. | No | No, if documented | Implement executor only after legal/product policy and staging dry runs. |
| No archive cleanup cron. | Phase 1-I left expired R2 archive object cleanup for later work. | No | No, if TTL access enforcement is acceptable | Post-Phase 1-J: bounded scheduled cleanup now exists; verify it in staging before production. |
| Contact processor retention remains external. | Contact-form privacy handling still needs processor workflow. | No | Yes for full privacy claims | Decide Resend/contact retention process or repo-owned storage. |
| Legal retention policy not approved. | Cannot claim compliance-grade lifecycle. | No | Yes for compliance claims | Product/legal review of retention and deletion policy. |

## Next Recommended Actions

1. Commit all Phase 1-I files together, including untracked report, design, migration, and archive helper files.
2. Apply migration `0033` in staging after `0032`.
3. Verify admin export archive generation/download against realistic staging data.
4. Post-Phase 1-J: verify bounded scheduled cleanup for expired export archives in staging.
5. Decide user self-service export/delete policy and confirmation flow.
6. Implement deletion/anonymization executor only after policy approval and dry-run evidence.
