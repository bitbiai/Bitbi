# PHASE1J_RETENTION_EXECUTOR_REPORT.md

Date: 2026-04-26

## Executive Summary

Phase 1-J adds bounded cleanup for expired data export archives and introduces a strictly limited deletion/anonymization executor pilot for reversible actions only. It does not implement full legal compliance, user self-service privacy flows, or irreversible hard deletion.

The implemented cleanup path is prefix-scoped to private `AUDIT_ARCHIVE` objects under `data-exports/`, bounded per invocation, idempotent, and safe on partial R2 failure. The executor pilot can dry-run or execute only low-risk actions: revoke sessions, expire password reset/email verification/SIWE challenge rows, and expire export archive metadata for the subject user.

Production deploy remains blocked until staging migrations through `0033`, Worker deploy verification, live Cloudflare prerequisite validation, and staging export cleanup/executor verification are complete.

## Scope

Implemented:

- `workers/auth/src/lib/data-export-cleanup.js` for bounded expired archive cleanup.
- Scheduled auth Worker cleanup integration for expired export archives.
- Admin-only export archive list and cleanup mutation routes.
- Admin-only safe lifecycle execution pilot route.
- Route policy, release compatibility, data-lifecycle static guard, JS syntax guard, tests, and documentation updates.

Not implemented:

- User self-service export/delete route.
- Irreversible hard deletion of users, R2 media, AI assets, or audit logs.
- Public export archive URLs.
- Legal compliance certification.
- Historical R2 owner backfill.
- Contact processor enforcement beyond documentation.

## Files Added / Modified

| Area | Files |
| --- | --- |
| Export cleanup | `workers/auth/src/lib/data-export-cleanup.js`, `workers/auth/src/lib/data-export-archive.js`, `workers/auth/src/index.js` |
| Safe executor pilot | `workers/auth/src/lib/data-lifecycle.js`, `workers/auth/src/routes/admin-data-lifecycle.js` |
| Route policy and release contract | `workers/auth/src/app/route-policy.js`, `config/release-compat.json`, `scripts/check-route-policies.mjs`, `scripts/test-release-compat.mjs`, `PHASE1E_ROUTE_POLICY_REPORT.md` |
| Static guardrails | `scripts/check-data-lifecycle-policy.mjs`, `scripts/check-js.mjs` |
| Tests and harness | `tests/workers.spec.js`, `tests/helpers/auth-worker-harness.js` |
| Operational docs | `PHASE1J_RETENTION_EXECUTOR_REPORT.md`, `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md`, `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md`, `docs/DATA_DELETION_EXECUTOR_DESIGN.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `workers/auth/CLAUDE.md` |

## Baseline From Phase 1-I

Phase 1-I generated bounded, sanitized private export archive JSON under `data-exports/{subjectUserId}/{requestId}/{archiveId}.json` and enforced 14-day access expiration in metadata. Physical R2 object cleanup and deletion/anonymization execution were deferred.

## Export Archive Cleanup Behavior

`workers/auth/src/lib/data-export-cleanup.js`:

- Selects expired archive rows in bounded batches.
- Only considers rows with `deleted_at IS NULL`.
- Only deletes objects when `r2_bucket` is `AUDIT_ARCHIVE`.
- Only deletes keys matching the approved `data-exports/{subjectUserId}/{requestId}/dla_<hex>.json` pattern.
- Verifies the archive belongs to an existing export lifecycle request before deletion.
- Treats missing R2 objects as idempotent success and marks metadata `deleted`.
- Marks R2 failures as `cleanup_failed` with `archive_cleanup_r2_failed` so they remain retryable.
- Marks invalid scope/missing request cases as cleanup failures without deleting any object.
- Returns sanitized result objects with archive ids and SHA-256 key digests, not raw object keys.

## Scheduled Cleanup Behavior

`workers/auth/src/index.js` now invokes `cleanupExpiredDataExportArchives({ limit: 25 })` from the existing scheduled handler. The step is isolated from the existing activity archive and `r2_cleanup_queue` jobs:

- It logs safe aggregate counts only.
- It does not log raw R2 keys.
- A cleanup failure is caught and logged without aborting later scheduled cleanup work.
- No new cron trigger was added; the existing auth cron remains the scheduler.

## Admin Cleanup / Retention Visibility

New admin routes:

- `GET /api/admin/data-lifecycle/exports`
- `POST /api/admin/data-lifecycle/exports/cleanup-expired`

The list endpoint returns sanitized archive metadata, uses page-size caps, and uses signed keyset cursors from `PAGINATION_SIGNING_SECRET`. It does not expose internal R2 keys.

The cleanup mutation requires:

- Admin auth and the existing production MFA boundary.
- Same-origin request context.
- Fail-closed `admin-data-lifecycle-ip` limiter.
- Byte-limited JSON body.
- `Idempotency-Key`.
- Route-policy registration.

## Safe Deletion / Anonymization Executor Pilot

New admin route:

- `POST /api/admin/data-lifecycle/requests/:id/execute-safe`

Implemented safe actions:

- Revoke active sessions for the subject user.
- Expire unused password reset tokens.
- Expire unused email verification tokens.
- Expire unused SIWE challenges.
- Expire ready export archive metadata for the subject user.
- Mark matching lifecycle request items completed.
- Mark the lifecycle request `safe_actions_completed`.

Safety behavior:

- Request must be approved first.
- `dryRun` defaults to `true`.
- `dryRun: true` reports planned safe actions without mutating state.
- `dryRun: false` executes only the safe actions listed above.
- Repeated execution after completion is idempotent.
- Destructive modes such as `mode: "destructive"` or `allowHardDelete` return `409`.
- Only-active-admin deletion/anonymization remains blocked.
- Hard deletion of user rows, AI rows, audit logs, or R2 media remains disabled.

## Actions Implemented

- Expired private export archive object cleanup.
- Export archive metadata status transitions to `deleted` or `cleanup_failed`.
- Admin archive retention list.
- Admin cleanup mutation.
- Safe lifecycle execution pilot for reversible auth-state cleanup and archive expiration.

## Actions Intentionally Disabled

- Hard-delete `users`.
- Hard-delete generated AI metadata.
- Hard-delete `USER_IMAGES` media.
- Hard-delete admin audit/user activity records.
- Irreversible anonymization of primary identity fields.
- User self-service deletion.
- Deletion of historical R2 objects without verified owner mapping.

## User Self-Service Decision

User self-service export/delete remains deferred. The current implementation is admin/support-only because product/legal policy still needs to define confirmation UX, cooldowns, notification requirements, archive delivery rules, deletion grace periods, and account recovery expectations.

Recommended next phase: add a user-owned export request route only after archive generation/cleanup is verified in staging and after support/admin workflows are stable. User self-service deletion should remain blocked until legal/product approve confirmation and grace-period policy.

## Contact Data Lifecycle Policy

The contact Worker still sends contact form payloads through Resend and does not store messages in a repo-owned D1 table. Phase 1-J documents this as a processor-policy gap:

- Contact messages are high-PII.
- Export/delete handling depends on external Resend/mailbox retention until repo-owned storage or processor workflow is defined.
- Contact rate-limit state remains operational and not exportable.

## Historical R2 Ownership Policy

Phase 1-J keeps destructive R2 deletion limited to export archive objects under `data-exports/`. Other historical R2 prefixes remain excluded from the deletion executor until ownership is proven by D1 rows or an owner-map backfill.

Owner-linked prefixes today:

- `avatars/{userId}` in `PRIVATE_MEDIA`.
- `users/{userId}/...` in `USER_IMAGES`.
- `data-exports/{subjectUserId}/{requestId}/{archiveId}.json` in `AUDIT_ARCHIVE`.

Excluded until owner verification/backfill:

- Historical audit/activity archives outside lifecycle export archives.
- Any legacy/private media key not owner-scoped.
- Any provider/transient object without a D1 owner row.

## Route Policy / Release Compatibility Changes

Route policies added:

- `admin.data-lifecycle.exports.list`
- `admin.data-lifecycle.exports.cleanup-expired`
- `admin.data-lifecycle.requests.execute-safe`

Release compatibility updated:

- Admin auth literal routes include archive listing and cleanup.
- Admin auth pattern routes include safe execution.
- No new D1 migration was required.
- No new Cloudflare binding was required.
- No new cron trigger was added.

## Tests Added / Updated

Worker tests cover:

- Admin archive list uses sanitized metadata and signed cursor pagination.
- Non-admin cleanup is rejected.
- Foreign-origin cleanup is rejected before side effects.
- Cleanup deletes only approved expired `data-exports/` objects.
- Cleanup ignores non-expired archives.
- Cleanup refuses out-of-prefix archive keys.
- Cleanup handles missing archive objects idempotently.
- Cleanup records R2 delete failures as `cleanup_failed`.
- Cleanup batch limit is enforced.
- Scheduled cleanup removes expired export archives without breaking existing `r2_cleanup_queue` work.
- Safe executor rejects unapproved requests.
- Safe executor rejects destructive modes.
- Safe executor dry-run performs no mutation.
- Safe executor revokes sessions/tokens and expires archive metadata on explicit `dryRun: false`.
- Safe executor preserves user media rows and admin session state.
- Safe executor is idempotent on repeated execution.

Static guards cover:

- Cleanup helper requires approved-prefix validation.
- Cleanup helper contains invalid-scope failure behavior.
- Lifecycle route policies exist for cleanup/list/execute-safe.
- Hard-delete user/content/audit operations remain blocked.
- User self-service lifecycle routes remain absent.

## Commands Run and Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run test:workers` | PASS, 313/313 | Worker route/security regressions pass, including export cleanup, scheduled cleanup isolation, and safe executor dry-run/execute behavior. |
| `npm run test:static` | PASS, 155/155 | Static/admin UI suite remains green; no frontend behavior changed. |
| `npm run test:release-compat` | PASS | Release contract accepts new lifecycle routes. |
| `npm run test:release-plan` | PASS | Release planner remains consistent with the changed auth Worker surface. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prerequisite tests remain green. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production BLOCKED | Live Cloudflare validation was skipped, so production deploy remains blocked as intended. |
| `npm run check:toolchain` | PASS | Toolchain consistency guard passed. |
| `npm run test:quality-gates` | PASS | Quality-gate scanner tests passed. |
| `npm run check:secrets` | PASS | No obvious committed secret patterns found. |
| `npm run check:dom-sinks` | PASS | No new unreviewed DOM sinks above baseline. |
| `npm run check:worker-body-parsers` | PASS | Direct unsafe Worker body parser usage remains blocked. |
| `npm run check:js` | PASS | Syntax guard passed for 30 targeted files, including the cleanup helper. |
| `npm run check:route-policies` | PASS | 99 registered auth-worker route policies validate. |
| `npm run test:operational-readiness` | PASS | Operational readiness helper tests passed. |
| `npm run check:operational-readiness` | PASS | Required operational docs/runbooks still exist. |
| `npm run check:live-health` | PASS, SKIPPED | No live URL configured; skipped mode is explicit and non-flaky. |
| `npm run check:live-security-headers` | PASS, SKIPPED | No public base URL configured; skipped mode is explicit and non-flaky. |
| `npm run check:admin-activity-query-shape` | PASS | Admin activity query-shape guard remains green. |
| `npm run check:data-lifecycle` | PASS | Lifecycle guard verifies cleanup prefix scope, route policies, disabled hard-delete paths, and no self-service route exposure. |
| `npm run validate:release` | PASS | Release compatibility configuration validates. |
| `npm run build:static` | PASS | Static site build succeeds. |
| `npm run release:preflight` | PASS | Aggregate preflight passed for the full Phase 1-J diff. |
| `git diff --check` | PASS | No whitespace errors. |

Additional focused checks run during implementation:

- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "data lifecycle"`: PASS, 6/6.
- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "scheduled export archive"`: PASS, 1/1.

Checks not run:

- Live Cloudflare secret/binding/R2 delete verification, because no live credentials/URLs were configured for this local pass.
- Production deploy, `npm run release:apply`, and remote D1 migrations.
- Package install/audit commands, because package manifests and lockfiles were not changed.

## Merge Readiness

Status: pass, conditional on committing all Phase 1-J files together.

`npm run release:preflight` passed. Merge still requires all Phase 1-J code, tests, release-policy, and documentation files to be committed together.

## Production Deploy Readiness

Status: blocked.

Do not deploy until:

- Auth migrations through `0033_harden_data_export_archives.sql` are applied in staging.
- The auth Worker with Phase 1-J routes/scheduled cleanup is deployed to staging.
- `AUDIT_ARCHIVE` is live-verified for `data-exports/` write/read/delete behavior.
- Admin archive list/cleanup and safe executor dry-run/execute-safe paths are verified in staging.
- `npm run validate:cloudflare-prereqs -- --live` or equivalent live/manual verification is completed without printing secrets.
- Product/legal accepts that irreversible deletion remains disabled.

## Required Staging / Production Deploy Steps

1. Apply migrations through `0033`.
2. Deploy auth Worker code.
3. Verify `GET /api/admin/data-lifecycle/exports` returns sanitized metadata.
4. Generate a staging export archive and force expiration in staging test data.
5. Run cleanup mutation and verify only `data-exports/` object deletion occurs.
6. Verify scheduled cleanup on the next cron or manual staging trigger.
7. Verify safe executor with a non-critical staging user and confirm only sessions/tokens/archive metadata change.
8. Confirm no hard-delete routes or user self-service delete routes are exposed.

## Rollback Plan

- No migration rollback is required because Phase 1-J adds no schema migration.
- Roll back auth Worker code to disable cleanup and execute-safe routes.
- Existing archive metadata can remain; cleanup is idempotent and metadata-only once objects are missing.
- If cleanup behavior is suspect, disable the Worker route by rollback and inspect `data_export_archives` rows before manual R2 action.
- Do not manually delete non-`data-exports/` R2 objects as part of rollback.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
| --- | --- | ---: | ---: | --- |
| User self-service privacy flow remains deferred. | Users need support/admin handling for export/delete requests. | No | No for admin-only rollout | Design confirmation, cooldown, notification, and archive delivery policy. |
| Irreversible deletion remains disabled. | Delete/anonymize requests only perform safe auth-state cleanup. | No | No, if documented | Implement destructive executor only after legal/product approval and staging dry runs. |
| Contact processor retention remains external. | Contact message export/delete depends on external mailbox/Resend policy. | No | Yes for compliance claims | Define processor workflow or repo-owned contact storage. |
| Historical R2 ownership is not fully proven. | Hard deletion of legacy media could delete cross-user or retained data if enabled prematurely. | No | Yes for destructive deletion | Build a dry-run owner-map/backfill before enabling media deletion. |
| Live cleanup verification not performed locally. | Production behavior depends on live `AUDIT_ARCHIVE` binding and staging cron verification. | No | Yes | Verify in staging before production. |

## Next Recommended Actions

1. Commit all Phase 1-J files together.
2. Verify archive cleanup and safe executor in staging with non-critical test users.
3. Build a dry-run historical R2 owner inventory before enabling any media deletion.
4. Decide user self-service export/delete policy with product/legal.
5. Keep irreversible deletion disabled until legal/product approval, staging dry runs, and owner-map evidence exist.
