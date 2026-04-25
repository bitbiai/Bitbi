# Phase 1-B Remediation Report

Date: 2026-04-25

## Executive Summary

Phase 1-B moves the default admin AI video flow from a long browser request to the async job path introduced in Phase 1-A. The synchronous `/api/admin/ai/test-video` route remains as an explicit admin/debug compatibility path, but the admin UI now creates `/api/admin/ai/video-jobs`, sends an `Idempotency-Key`, polls job status, and renders the completed protected output reference.

Risk reduced:

- Browser/admin requests no longer use the long synchronous provider path by default.
- Queue processing no longer calls `/internal/ai/test-video`; it uses bounded internal task create/poll routes.
- Completed provider output is downloaded with byte/content-type limits and stored in `USER_IMAGES` R2 under deterministic job-scoped keys.
- Malformed or exhausted video queue messages are durably recorded in D1.
- Missing or malformed async video idempotency keys are rejected before job creation.

Still not solved:

- The legacy synchronous compatibility route still exists and should be restricted or retired after staged async verification.
- Vidu async direct provider create/poll requires `VIDU_API_KEY`; Pixverse can run without that secret, but Vidu jobs fail safely if it is missing.
- There is no full Cloudflare IaC; live Queue/R2/D1/secret verification remains a deployment prerequisite.
- This is not org/tenant/billing/compliance or full observability maturity.

## Scope

Implemented:

- Queue-safe short provider create/poll path.
- R2 output ingest for completed videos.
- Optional provider poster ingest when a poster URL is present.
- Poison-message persistence for malformed/exhausted video queue messages.
- Admin UI async create/status polling by default.
- Required `Idempotency-Key` for async video job creation.
- Release compatibility updates for migration `0030`, internal AI routes, and protected output routes.

Not implemented:

- Removing `/api/admin/ai/test-video`.
- Member-facing video generation.
- Full provider abstraction rewrite.
- Cloudflare dashboard mutation or production deploy.

## Files Changed

| Area | Files |
|---|---|
| Async provider task routes | `workers/ai/src/index.js`, `workers/ai/src/routes/video-task.js`, `workers/ai/src/lib/invoke-ai-video.js` |
| Queue/R2/poison handling | `workers/auth/src/lib/ai-video-jobs.js`, `workers/auth/src/routes/admin-ai.js` |
| D1 schema | `workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql` |
| Admin UI | `js/pages/admin/ai-lab.js`, `js/shared/auth-api.js` already had Phase 1-A wrappers |
| Release tooling | `config/release-compat.json`, `scripts/lib/release-compat.mjs`, `scripts/test-release-compat.mjs`, `scripts/test-release-plan.mjs` |
| Tests | `tests/workers.spec.js`, `tests/helpers/auth-worker-harness.js`, `tests/auth-admin.spec.js` |
| Docs | `PHASE1B_REMEDIATION_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `AI_VIDEO_ASYNC_JOB_DESIGN.md`, `PHASE1_OBSERVABILITY_BASELINE.md` |

## Baseline Before Phase 1-B

Phase 1-A had durable job creation/status APIs and queue plumbing, but:

- `workers/auth/src/lib/ai-video-jobs.js` still called `/internal/ai/test-video` from the queue consumer.
- Completed jobs stored provider URLs rather than controlled R2 output references.
- Malformed queue messages were logged but not persisted.
- Admin UI still defaulted to `apiAdminAiTestVideo()`.
- Missing `Idempotency-Key` was allowed for the admin-only initial rollout.

## Async Provider Short Polling

New AI worker internal routes:

- `POST /internal/ai/video-task/create`
- `POST /internal/ai/video-task/poll`

The auth queue consumer now:

1. Leases a queued/pending job from D1.
2. Calls `/internal/ai/video-task/create` when no provider task id exists.
3. Stores `provider_task_id` and schedules a delayed queue follow-up when the provider is pending.
4. Calls `/internal/ai/video-task/poll` on follow-up messages.
5. Does not call `/internal/ai/test-video` in the async queue path.

Duplicate messages before `next_attempt_at` are no-ops because the lease update requires `next_attempt_at <= now`. Duplicate messages after provider task creation poll the existing `provider_task_id` rather than creating another provider task.

## R2 Ingest And Output

Completed provider video output is fetched only after provider success and is stored in the existing `USER_IMAGES` bucket:

- Output key: `users/{adminUserId}/video-jobs/{jobId}/output.mp4`
- Output URL returned to the UI: `/api/admin/ai/video-jobs/{jobId}/output`
- Poster key, when provider supplies a safe poster URL: `users/{adminUserId}/video-jobs/{jobId}/poster.{ext}`
- Poster URL returned to the UI: `/api/admin/ai/video-jobs/{jobId}/poster`

Safeguards:

- Output max size: 100 MiB.
- Poster max size: 5 MiB.
- Output content types: `video/mp4`, `video/webm`, `video/quicktime`.
- Poster content types: `image/jpeg`, `image/png`, `image/webp`.
- Provider output and poster downloads require `https://` public-host URLs without credentials; localhost, private IPv4, loopback, link-local, `.local`, and local IPv6 targets are rejected before fetch or R2 writes.
- Status APIs do not expose raw R2 keys.
- Output/poster routes are admin-owned and return `Cache-Control: private, no-store`.

## Poster Handling

Provider poster URLs are ingested if present and safe. Poster ingest failure is logged as a warning and does not corrupt an otherwise successful video job. If no poster URL exists, the job succeeds with `posterUrl: null`.

## Poison Message Persistence

Migration `0030_harden_ai_video_jobs_phase1b.sql` adds `ai_video_job_poison_messages`.

Recorded fields:

- Queue name.
- Message type and schema version if present.
- Job id if parseable.
- Reason code.
- Redacted body shape summary.
- Correlation id if present.
- Created timestamp.

Malformed queue messages are recorded before acknowledgement. Exhausted attempts are recorded with `max_attempts_exhausted` and linked to the job id when present. Raw queue bodies, prompts, secrets, signatures, and provider payloads are not stored.

## Admin UI Behavior

Default behavior in `js/pages/admin/ai-lab.js`:

- Creates async video jobs with `apiAdminAiCreateVideoJob()`.
- Sends an `Idempotency-Key`.
- Polls `apiAdminAiGetVideoJob()` with bounded backoff.
- Renders queued/pending/ingesting status text.
- Renders success using the protected output URL returned by the status API.
- Renders sanitized failure messages only.

Compatibility path:

- `apiAdminAiTestVideo()` remains available only behind `window.__BITBI_ADMIN_AI_SYNC_VIDEO_DEBUG === true` in the admin UI.
- The server route remains for controlled debugging/rollback and existing Worker contract coverage.

## Idempotency Behavior

`POST /api/admin/ai/video-jobs` now requires `Idempotency-Key`.

- Missing key returns `428` with `idempotency_key_required`.
- Malformed key returns `400` with `invalid_idempotency_key`.
- Same key and same payload returns the existing job.
- Same key and different payload returns `409` with `idempotency_conflict`.
- Queue/provider work is not duplicated for idempotent repeats.

## Security Behavior

Preserved Phase 0/1-A controls:

- Admin auth and MFA boundary remain enforced by `requireAdmin`.
- Same-origin mutation guard remains central in `workers/auth/src/index.js`.
- Admin AI rate limiting remains fail-closed via `rateLimitAdminAi`.
- Body-size limited parsing remains on job creation.
- Auth-to-AI calls still use HMAC service auth and nonce-backed replay protection through `proxyToAiLab()`.
- Missing critical bindings still fail closed.

New checks:

- `USER_IMAGES` binding is required for async video job processing and protected output reads.
- Async provider task calls do not log secrets, signatures, raw provider credentials, raw prompts, or raw request bodies.
- Output ingestion enforces URL scheme, content type, and byte limits.

## Staff Engineer Pre-Merge Review

Review result after targeted fixes: conditional pass for merge, provided every changed and untracked Phase 1-B file is committed together.

Issues found and fixed:

- Raw admin video payload logging: the admin UI logged the full outgoing video payload, which could include prompts and base64 frame inputs. The log was removed from `js/pages/admin/ai-lab.js`, and `tests/auth-admin.spec.js` now asserts the minimal-mode path does not emit the payload or prompt to the console.
- Provider-pending retry exhaustion gap: jobs that stayed `provider_pending` could requeue indefinitely because max-attempt handling only covered error responses. `workers/auth/src/lib/ai-video-jobs.js` now fails pending jobs at `max_attempts`, records `max_attempts_exhausted` poison evidence, and `tests/workers.spec.js` covers the path.
- Unsafe provider output fetch target: provider output URLs allowed insecure or local targets. Output/poster ingest now requires safe public `https://` URLs before fetch, blocks localhost/private/link-local targets and embedded URL credentials, and a Worker regression test verifies no fetch/R2 write occurs for `http://127.0.0.1/...`.
- Stale video preview copy: the admin video preview still described provider URL streaming and disabled server-side save. The copy now reflects protected async job output.

No tests were skipped, deleted, or weakened during this review.

Targeted review validation:

- `npx playwright test tests/auth-admin.spec.js --grep "Vidu minimal mode exposes"` passed after removing the raw payload log assertion target from runtime code.
- `npm run test:workers -- --grep "unsafe provider output|pending provider tasks|short-polls provider tasks"` passed after adding retry-exhaustion and unsafe-output URL tests.
- `npx playwright test tests/auth-admin.spec.js --grep "saves text, embeddings, compare, live-agent, and video outputs"` passed after aligning the static copy assertion with protected async output behavior.

## Observability Events

Added or expanded event coverage:

- `ai_video_job_created`
- `ai_video_job_enqueued`
- `ai_video_job_started`
- `vidu_provider_task_created`
- `ai_video_job_poll_scheduled`
- `ai_video_job_poll_result`
- `ai_video_job_poster_ingest_failed`
- `ai_video_job_succeeded`
- `ai_video_job_failed`
- `ai_video_job_retried`
- `ai_video_job_poison_message_recorded`
- `ai_video_job_poison_message_record_failed`

Safe fields include job id, correlation id, provider, model, status, attempt count, retry delay, and reason code.

## Tests Added Or Updated

Worker tests:

- Required `Idempotency-Key` coverage.
- Async queue path uses `/internal/ai/video-task/create`, not `/internal/ai/test-video`.
- Provider pending state schedules a delayed follow-up queue message.
- Duplicate queue messages do not duplicate provider task creation.
- Poll success ingests provider output into R2.
- Protected output route serves stored video.
- Malformed queue message records a poison entry without raw body leakage.
- Exhausted retry attempts record poison evidence.

Static/admin UI tests:

- Admin AI Lab default video flow posts to `/api/admin/ai/video-jobs`.
- UI sends payloads through async create for Pixverse and Vidu.
- UI includes the async idempotency path and renders protected/safe outputs.
- A regression assertion verifies the default UI does not call `/api/admin/ai/test-video`.
- The previous 480-second timeout behavior remains covered against the async create request.

## Commands Run And Results

| Command | Result | Notes |
|---|---:|---|
| `npm run test:workers` | PASS, 285/285 | Full Worker suite after Phase 1-B backend changes and Staff review fixes. |
| `npm run test:static` | PASS, 155/155 | Full static/admin UI suite after async UI cutover. One stale copy assertion failed during review, was corrected to protected async output behavior, and the suite reran green. |
| `npm run test:release-compat` | PASS after fixture correction | Initial failure was release-test fixture drift for the new internal docs reference and pattern route normalization. |
| `npm run test:release-plan` | PASS | Initial failure was expected while `PHASE1B_REMEDIATION_REPORT.md` was not yet created; rerun passed after the report and release-plan fixture were updated. |
| `npm run test:cloudflare-prereqs` | PASS | Rerun passed after release-compat fixture drift was corrected. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production blocked | Repo declarations are valid. Live Cloudflare validation was skipped, so production deploy remains blocked. |
| `npm run test:asset-version` | PASS | Asset-version tests unaffected. |
| `npm run validate:release` | PASS | Release compatibility configuration validates. |
| `npm run validate:asset-version` | PASS | Static asset-version references validate. |
| `npm run build:static` | PASS | Static build succeeds. |
| `npm run release:preflight` | PASS | Aggregated preflight passed after Staff review fixes, including release compatibility, Cloudflare prereq repo checks, Worker tests, asset checks, static build, static smoke tests, and release plan output. |
| `git diff --check` | PASS | No whitespace errors in the Phase 1-B diff at the time of final validation. |
| Root and Worker `npm ls --depth=0` | PASS | Root, auth, contact, and AI package graphs resolve. |
| Root and Worker `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Current lockfiles have no low-or-higher npm audit findings. |

Root and Worker `npm ci` was not rerun for Phase 1-B because package manifests and lockfiles did not change; the package graph and audit checks above were rerun.

## Merge Readiness

Current status: merge-ready after final validation, conditional on committing the full coupled file set.

Merge requires all changed and untracked files in this Phase 1-B set to be committed together, including:

- `workers/ai/src/routes/video-task.js`
- `workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql`
- `PHASE1B_REMEDIATION_REPORT.md`
- all modified app, config, script, test, and audit/doc files listed in this report.

Do not merge a partial subset. The new D1 columns, release contract, queue consumer, protected output routes, and tests are coupled.

## Production Deploy Readiness

Current status: blocked until live Cloudflare prerequisites are verified.

Required before production:

- Apply auth D1 migration `0030_harden_ai_video_jobs_phase1b.sql`.
- Confirm `bitbi-ai-video-jobs` exists and is bound as `AI_VIDEO_JOBS_QUEUE`.
- Confirm `USER_IMAGES` R2 bucket binding exists and can accept video/poster objects.
- Confirm matching `AI_SERVICE_AUTH_SECRET` exists in both auth and AI workers.
- Confirm `SERVICE_AUTH_REPLAY` Durable Object binding and migration exist for the AI worker.
- Confirm `VIDU_API_KEY` exists in the AI worker if Vidu Q3 Pro async jobs are intended in production.
- Run staging async video create/pending/poll/succeed/output-read verification.
- Run `npm run validate:cloudflare-prereqs -- --live` where Cloudflare credentials are available; do not print secret values.

## Rollback Plan

- Keep `/api/admin/ai/test-video` available as the compatibility route.
- If async UI behavior fails in staging, set `window.__BITBI_ADMIN_AI_SYNC_VIDEO_DEBUG === true` only for controlled admin/debug sessions while investigating.
- If queue processing fails after deploy, stop using async video create in the UI and inspect `ai_video_jobs` plus `ai_video_job_poison_messages`.
- Do not roll back migration `0030`; it is additive/rebuilds to a compatible superset and preserves old job rows.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
|---|---|---:|---:|---|
| Legacy sync route still exists | Admin/debug callers can still trigger long synchronous provider work if used directly. | No | No, if access remains admin-only and async UI is default | Restrict, hide, or retire after async staging proves stable. |
| Vidu requires live `VIDU_API_KEY` | Vidu async jobs fail safely without the secret. | No | Yes for Vidu rollout | Provision in AI worker and verify without logging value. |
| No full Cloudflare IaC | Dashboard drift remains possible. | No | Yes until live verification passes | Add dashboard-aware/IaC validation in later Phase 1. |
| No full provider DLQ product UI | Poison messages are persisted but not surfaced in admin support tooling. | No | No | Add admin/support inspection in Phase 1-C. |
| No broad SaaS tenant/org/billing controls | Enterprise SaaS maturity remains incomplete. | No | Later product blocker | Continue roadmap after async video hardening. |

## Next Actions

1. Commit all Phase 1-B files together.
2. Apply migration `0030_harden_ai_video_jobs_phase1b.sql` in staging before auth worker deploy.
3. Verify async admin video create, provider pending, provider success, R2 output route, and poison-message persistence in staging.
4. Provision `VIDU_API_KEY` in the AI worker if Vidu Q3 Pro async jobs are enabled.
5. Plan Phase 1-C to restrict or retire `/api/admin/ai/test-video`, add admin poison-message tooling, and add deeper dashboard/IaC verification.

## Final Status

| Area | Status | Notes |
|---|---:|---|
| Async admin UI default | PASS | UI uses `/api/admin/ai/video-jobs` by default. |
| Queue-safe provider path | PASS | Queue uses `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`. |
| R2 output handling | PASS | Completed output stored in `USER_IMAGES` with protected owner-scoped route. |
| Poison persistence | PASS | Malformed/exhausted messages persist redacted D1 entries. |
| Idempotency enforcement | PASS | Missing/malformed keys rejected before job creation. |
| Merge readiness | CONDITIONAL PASS | Final validation passed. Merge requires committing every changed/new Phase 1-B file together. |
| Production deploy readiness | FAIL | Live Cloudflare prerequisites are not verified by this code pass. |
