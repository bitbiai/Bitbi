# Phase 1-A Remediation Report

Date: 2026-04-25

## Phase 1-B Handoff Note

Phase 1-B has since addressed several limitations recorded in this Phase 1-A report: the default admin UI now uses async video jobs, the queue consumer uses bounded provider task create/poll routes instead of `/internal/ai/test-video`, completed outputs are ingested into `USER_IMAGES` R2, and malformed/exhausted video queue messages are persisted in `ai_video_job_poison_messages`.

This Phase 1-A report remains historically accurate for the foundation sprint. Current async video status and deploy requirements are tracked in `PHASE1B_REMEDIATION_REPORT.md`.

## Executive Summary

Phase 1-A implements the first runtime foundation for async admin AI video generation and adds low-risk engineering guardrails. It does not implement orgs, tenants, billing, compliance workflows, full IaC, or a frontend/admin rewrite.

Implemented:

- Added D1 table `ai_video_jobs` through migration `0029_add_ai_video_jobs.sql`.
- Added auth Worker queue binding `AI_VIDEO_JOBS_QUEUE` for `bitbi-ai-video-jobs`.
- Added admin async video job create/status APIs.
- Added idempotency-key handling for job creation.
- Added auth Worker queue consumer processing for async video jobs.
- Kept the existing synchronous `/api/admin/ai/test-video` route as a compatibility path.
- Added lifecycle logs for job create/enqueue/start/retry/success/failure.
- Added a CI/release guardrail that fails on direct Worker body parser calls.
- Updated release compatibility and Cloudflare deploy prerequisite validation.

Risk reduced:

- New async job creation returns quickly and does not call the AI provider in the browser request path.
- Queue processing is durable enough to survive duplicate deliveries, transient failures, and retry exhaustion through D1 state.
- Production deploy prerequisites now include the new queue and auth D1 migration.

Still not solved:

- The current admin UI still uses the synchronous compatibility route unless a caller explicitly uses `/api/admin/ai/video-jobs`.
- The queue consumer currently calls the existing signed `/internal/ai/test-video` path, whose provider implementation can still poll synchronously inside the queue invocation.
- Completed async jobs currently store and return the provider URL. R2 video ingest, SSRF-safe download, poster extraction, and publication integration remain Phase 1-B work.
- Live Cloudflare resources were not provisioned or verified by this implementation pass.

Merge status: pass after final validation, provided all changed/new files are committed together.

Production deploy status: fail until migration `0029_add_ai_video_jobs.sql` is applied, `AI_VIDEO_JOBS_QUEUE` exists and is bound, existing Phase 0 secrets/bindings remain verified, and staging proves create/status/queue processing.

## Baseline Inventory

| Area | Current state before Phase 1-A | Evidence |
|---|---|---|
| Current sync route | Admin video generation uses `POST /api/admin/ai/test-video`. | `workers/auth/src/routes/admin-ai.js`, `workers/ai/src/routes/video.js`. |
| Provider invocation | AI worker invokes Cloudflare AI and Vidu fallback through `invokeVideo()`. | `workers/ai/src/lib/invoke-ai-video.js`. |
| Request owner | Admin-only today. Member video job routes were not added. | Existing admin route and new `/api/admin/ai/video-jobs`. |
| Durable state | No video job table existed before this phase. | New migration `0029_add_ai_video_jobs.sql`. |
| Existing queues | Auth worker already consumed activity-ingest and image-derivative queues. | `workers/auth/src/index.js`, `workers/auth/wrangler.jsonc`. |
| Existing R2 | User media buckets exist, but trusted async video ingest is not implemented. | `workers/auth/wrangler.jsonc`, `AI_VIDEO_ASYNC_JOB_DESIGN.md`. |
| Existing frontend | Admin AI Lab uses `apiAdminAiTestVideo()` synchronously. | `js/pages/admin/ai-lab.js`, `js/shared/auth-api.js`. |

## Files Changed

| Area | Files |
|---|---|
| D1 schema | `workers/auth/migrations/0029_add_ai_video_jobs.sql` |
| Async video implementation | `workers/auth/src/lib/ai-video-jobs.js`, `workers/auth/src/routes/admin-ai.js`, `workers/auth/src/index.js` |
| Worker config/release contract | `workers/auth/wrangler.jsonc`, `config/release-compat.json`, `scripts/lib/cloudflare-deploy-prereqs.mjs`, `scripts/lib/release-compat.mjs`, `scripts/test-cloudflare-deploy-prereqs.mjs` |
| API wrappers | `js/shared/auth-api.js` |
| Request limits | `workers/auth/src/lib/request.js` |
| Tests/harness | `tests/helpers/auth-worker-harness.js`, `tests/workers.spec.js`, `scripts/test-release-compat.mjs`, `scripts/test-release-plan.mjs` |
| Guardrail tooling | `scripts/check-worker-body-parsers.mjs`, `package.json`, `scripts/lib/release-plan.mjs`, `.github/workflows/static.yml` |
| Documentation | `workers/auth/CLAUDE.md`, `AI_VIDEO_ASYNC_JOB_DESIGN.md`, `PHASE1_OBSERVABILITY_BASELINE.md`, `PHASE1A_REMEDIATION_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md` |

## D1 Migration

New migration:

- `workers/auth/migrations/0029_add_ai_video_jobs.sql`

Table:

- `ai_video_jobs`

Key fields:

- `id`, `user_id`, `scope`, `status`
- `provider`, `model`, `prompt`
- `input_json`, `request_hash`
- `provider_task_id`, `idempotency_key`
- `attempt_count`, `max_attempts`, `next_attempt_at`, `locked_until`
- `output_r2_key`, `output_url`
- `error_code`, `error_message`
- `created_at`, `updated_at`, `completed_at`, `expires_at`

Indexes:

- owner/scope/status/created
- provider/task id
- owner/scope/idempotency key
- status/next attempt
- expiration

Deploy impact:

- Apply auth D1 migration `0029_add_ai_video_jobs.sql` before deploying auth Worker code that serves `/api/admin/ai/video-jobs` or consumes `bitbi-ai-video-jobs`.

## Queue Binding

New auth Worker queue:

| Binding | Queue | Role |
|---|---|---|
| `AI_VIDEO_JOBS_QUEUE` | `bitbi-ai-video-jobs` | Carries async admin video job messages. |

Message schema:

```json
{
  "schema_version": 1,
  "type": "ai_video_job.process",
  "job_id": "vidjob_...",
  "user_id": "admin-user-id",
  "attempt": 1,
  "correlation_id": "optional-correlation-id",
  "reason": "created",
  "enqueued_at": "2026-04-25T00:00:00.000Z"
}
```

Unknown or malformed queue messages are logged with `ai_video_job_bad_queue_payload` and are not silently ignored.

## API Routes

New routes:

| Route | Method | Behavior |
|---|---|---|
| `/api/admin/ai/video-jobs` | `POST` | Validates admin auth, same-origin policy, fail-closed limiter, 512 KB body limit, video payload schema, idempotency, D1 insert, and queue publish. Returns `202` with job status. |
| `/api/admin/ai/video-jobs/:id` | `GET` | Returns owner-scoped sanitized job status for the admin who created the job. |

Compatibility route retained:

- `/api/admin/ai/test-video` remains synchronous and unchanged for compatibility while the async path is proven.

## Idempotency

`POST /api/admin/ai/video-jobs` accepts `Idempotency-Key`.

Behavior:

| Case | Result |
|---|---|
| Missing key | Creates a new job, protected by auth/rate limits. |
| Same key and same canonical payload | Returns the existing job with `existing: true`. |
| Same key and different canonical payload | Returns `409` with `idempotency_conflict`. |

The key is scoped to `user_id` and `scope`.

## Job Lifecycle

Implemented statuses:

- `queued`
- `starting`
- `provider_pending`
- `processing`
- `succeeded`
- `failed`
- `cancelled`
- `expired`

Phase 1-A currently uses:

- `queued` on create/retry
- `starting` while queue consumer holds a lease
- `succeeded` on provider success
- `failed` on permanent failure, queue send failure, or retry exhaustion

## Retry And Failure Behavior

| Failure | Behavior |
|---|---|
| Missing queue binding | Create route fails closed with `503`; no job is inserted. |
| Queue send failure after insert | Job is marked `failed` with `queue_send_failed`; create route returns `503`; provider is not called. |
| Transient AI service/provider failure | Job returns to `queued`, stores sanitized error code/message, and the queue message is retried with backoff. |
| Max attempts reached | Job is marked `failed`; message is acknowledged. |
| Duplicate/terminal job message | Consumer returns no-op and does not call provider again. |
| Malformed message | Consumer logs a bad-payload event and does not silently lose it without evidence. |

## Security Behavior

The create route preserves Phase 0 hardening:

- Admin authentication is required.
- Global same-origin mutation policy applies.
- Admin AI fail-closed limiter runs before body parsing.
- Body parsing uses a 512 KB limited JSON reader.
- Validation uses the existing admin AI video contract.
- Queue binding/state failures fail closed.
- No provider call occurs during job creation.
- Auth-to-AI calls from the queue still use HMAC service auth and nonce replay protection via `proxyToAiLab()`.

## Observability

Added lifecycle events:

- `ai_video_job_created`
- `ai_video_job_enqueued`
- `ai_video_job_enqueue_failed`
- `ai_video_job_started`
- `ai_video_job_retried`
- `ai_video_job_succeeded`
- `ai_video_job_failed`
- `ai_video_job_bad_queue_payload`
- `ai_video_job_missing`

See `PHASE1_OBSERVABILITY_BASELINE.md`.

## Tests Added Or Updated

Worker tests added for:

- Valid async job creation and queue publish.
- No provider call during create.
- Idempotency repeat and conflict.
- Missing queue binding fail-closed behavior.
- Limiter unavailable fail-closed behavior.
- Oversized body rejection before job creation/queueing.
- Queue send failure marking job failed safely.
- Queue consumer signed AI service call.
- Completed owner status response.
- Owner-scoped status 404 for another admin.
- Retryable provider failure requeue.
- Retry exhaustion permanent failure.
- Duplicate retry delivery before `next_attempt_at` does not reacquire the job or call the provider again.
- Malformed percent-encoded status-route IDs return a safe 404.

Release/tooling tests updated for:

- New migration checkpoint.
- New queue producer/consumer binding.
- New manual Cloudflare queue prerequisite.
- New admin AI API route and pattern-route contract.
- Cloudflare prereq validator covering `AI_VIDEO_JOBS_QUEUE`.
- Release preflight command list including `npm run check:worker-body-parsers`.

## Phase 1-A Staff Pre-Merge Review

Review result: pass after targeted fixes.

Reviewed:

- Original audit and remediation documents: `AUDIT_NEXT_LEVEL.md`, `AUDIT_ACTION_PLAN.md`, `PHASE0_REMEDIATION_REPORT.md`, `PHASE0B_REMEDIATION_REPORT.md`, `AI_VIDEO_ASYNC_JOB_DESIGN.md`.
- Current Phase 1-A diff/status.
- Migration `workers/auth/migrations/0029_add_ai_video_jobs.sql`.
- Queue binding/consumer config for `AI_VIDEO_JOBS_QUEUE`.
- Async video create/status routes in `workers/auth/src/routes/admin-ai.js`.
- Queue processing in `workers/auth/src/lib/ai-video-jobs.js` and `workers/auth/src/index.js`.
- Changed Worker tests, release-compat tests, and harness behavior.

Findings fixed during review:

| Finding | Risk | Fix | Evidence |
|---|---|---|---|
| Retry-delayed jobs could be reacquired before `next_attempt_at` if a duplicate queue message arrived early. | Duplicate provider calls and premature retry pressure after transient provider failure. | `acquireJobLease()` now requires `(next_attempt_at IS NULL OR next_attempt_at <= now)` before moving a job back to `starting`. | `workers/auth/src/lib/ai-video-jobs.js`; `tests/workers.spec.js` verifies an early duplicate retry is acknowledged as no-op and does not call the provider again. |
| The status route `/api/admin/ai/video-jobs/:id` was implemented but not represented as a release-compat pattern route. | Release contract could miss future route drift for the new status API. | Added `adminAi.authOnlyPatternRoutes`, release-compat validation for admin AI pattern routes, and a regression test that fails when the pattern is omitted. | `config/release-compat.json`, `scripts/lib/release-compat.mjs`, `scripts/test-release-compat.mjs`. |
| Malformed percent-encoded job IDs could throw during `decodeURIComponent()`. | Bad path input could become a 500 instead of a safe not-found response. | Status route now uses a safe decode helper and returns 404 for malformed or slash-containing IDs. | `workers/auth/src/routes/admin-ai.js`; `tests/workers.spec.js` covers malformed `%` encoding. |

Review findings not changed:

| Finding | Reason not changed | Remaining action |
|---|---|---|
| Job creation allows missing `Idempotency-Key`. | This matches the Phase 1-A admin-only compatibility design and existing tests; requiring it would be a behavior change for the new API. | Require `Idempotency-Key` before broader/non-admin rollout or when the admin UI is switched to async by default. |
| Queue send is not a full transactional outbox. | Implementing an outbox/recovery sweep is larger than a targeted Phase 1-A pre-merge fix. | Add queued-job recovery and/or an outbox pattern in Phase 1-B. |
| Malformed queue messages are logged and acknowledged, but not persisted to a DLQ. | Phase 1-A intentionally documents DLQ/poison-message persistence as remaining work. | Add DLQ or poison-message table in Phase 1-B. |

## Validation Results

Final validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run test:workers` | PASS before changes, 272/272 | Baseline before Phase 1-A edits. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "video-jobs\|video job"` | PASS, 8/8 | Focused async video job route/queue tests. |
| `npm run test:workers` | PASS, 280/280 | Full Worker suite after Phase 1-A changes. |
| `npm run test:static` | PASS, 155/155 | Static smoke suite remains green. |
| `npm run test:release-compat` | PASS | Release contract accepts new migration/queue/routes. |
| `npm run test:release-plan` | PASS | Release planner accepts updated preflight and migration. |
| `npm run test:cloudflare-prereqs` | PASS | Prereq validator tests include new queue binding. |
| `npm run validate:release` | PASS | Release compatibility validates against repo state. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production blocked | Live validation skipped, as expected locally. |
| `npm run check:worker-body-parsers` | PASS | No direct Worker body parser calls found. |
| `npm run test:asset-version` | PASS | Asset-version tests pass. |
| `npm run validate:asset-version` | PASS | Asset-version validation passes. |
| `npm run build:static` | PASS | Static site builds to `_site`. |
| `npm run release:preflight` | PASS | Aggregated release preflight passed, including release compatibility, Cloudflare prereqs, body-parser guard, Worker tests, asset-version checks, static tests, and release plan. |
| `git diff --check` | PASS | No whitespace errors in the diff. |
| Root `npm ls --depth=0` | PASS | Root package graph resolves. |
| `workers/auth` `npm ls --depth=0` | PASS | Auth worker package graph resolves. |
| `workers/contact` `npm ls --depth=0` | PASS | Contact worker package graph resolves. |
| `workers/ai` `npm ls --depth=0` | PASS | AI worker package graph resolves. |
| Root `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Root lockfile has no low-or-higher npm audit findings. |
| `workers/auth` `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Auth worker lockfile has no low-or-higher npm audit findings. |
| `workers/contact` `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Contact worker lockfile has no low-or-higher npm audit findings. |
| `workers/ai` `npm audit --audit-level=low` | PASS, 0 vulnerabilities | AI worker lockfile has no low-or-higher npm audit findings. |

Checks not run:

- Root and Worker `npm ci` were not rerun because Phase 1-A did not change dependency versions or lockfiles; `npm ls --depth=0` and `npm audit --audit-level=low` were run for root and each Worker package instead.
- Live Cloudflare validation was not run locally. Production deploy remains blocked until staging/live resources are verified.
- No production deploy, remote D1 migration, or `npm run release:apply` was run.

## Merge Readiness

Pass, provided every changed/new file in this Phase 1-A set is committed together.

Merge requirements:

- Include all code, migration, config, test, CI, and documentation changes in one commit set.
- Re-run `npm run release:preflight` after any further changes.
- Do not merge a partial set that adds routes without migration/queue config, or config without tests/docs.
- Include currently untracked Phase 1-A files:
  - `PHASE1A_REMEDIATION_REPORT.md`
  - `PHASE1_OBSERVABILITY_BASELINE.md`
  - `scripts/check-worker-body-parsers.mjs`
  - `workers/auth/migrations/0029_add_ai_video_jobs.sql`
  - `workers/auth/src/lib/ai-video-jobs.js`

## Production Deploy Readiness

Production deploy is blocked until live prerequisites are verified.

Required before production:

- Existing Phase 0 requirements remain satisfied:
  - matching `AI_SERVICE_AUTH_SECRET` in `workers/auth` and `workers/ai`
  - deployed `SERVICE_AUTH_REPLAY`
  - deployed `v1-service-auth-replay`
  - applied migration `0028_add_admin_mfa_failed_attempts.sql`
- New Phase 1-A requirements:
  - create Cloudflare Queue `bitbi-ai-video-jobs`
  - bind it as `AI_VIDEO_JOBS_QUEUE` in `workers/auth`
  - configure auth worker as a consumer for `bitbi-ai-video-jobs`
  - apply D1 migration `0029_add_ai_video_jobs.sql`
  - verify staging create/status/queue processing before production

## Rollback Plan

- Keep `/api/admin/ai/test-video` available as the synchronous compatibility path.
- If async jobs fail in staging, stop using `/api/admin/ai/video-jobs` and keep the table for inspection.
- If a production issue occurs after deploy, disable callers to the async route, let already queued jobs finish or fail, and avoid dropping the D1 table until retention/support review is complete.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
|---|---|---:|---:|---|
| Queue consumer still calls existing synchronous provider implementation | Removes browser request blocking for async route, but queue invocations can still be long. | No | No, if staging validates provider runtime limits | Phase 1-B: split Vidu create/poll into short queue-driven poll units. |
| R2 video ingest not implemented | Completed jobs expose provider URL instead of controlled private media object. | No | Should be accepted only for admin-only staged rollout | Phase 1-B: implement SSRF-safe download, byte/content-type limits, R2 storage, and poster handling. |
| Admin UI still defaults to synchronous compatibility route | Async route exists but is not the default UI path. | No | No for API-only rollout; yes if goal is full UI cutover | Add async UI polling behind a feature flag after staging API validation. |
| Live Cloudflare queue/migration not verified locally | Missing queue or unapplied migration will fail at runtime. | No | Yes | Provision and verify in staging before production. |
| No DLQ | Poison messages are logged but not persisted to a dedicated dead-letter table/queue. | No | No for initial rollout | Add DLQ or poison-message table in Phase 1-B. |

## Next Recommended Actions

1. Commit all Phase 1-A files together.
2. Provision `bitbi-ai-video-jobs` and apply migration `0029_add_ai_video_jobs.sql` in staging.
3. Run staging create/status/queue tests with fake and real provider paths.
4. Implement Phase 1-B short polling units and R2 ingest before switching the admin UI fully to async video jobs.
5. Add DLQ or poison-message persistence for malformed/exhausted queue messages.
