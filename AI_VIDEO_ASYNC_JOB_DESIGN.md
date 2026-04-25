# AI Video Async Job Design

## Status

This began as a Phase 0-B design document. Phase 1-A implemented the first async admin video job foundation:

- Auth D1 migration `0029_add_ai_video_jobs.sql`
- Auth queue binding `AI_VIDEO_JOBS_QUEUE` for `bitbi-ai-video-jobs`
- Admin job create/status APIs at `/api/admin/ai/video-jobs`
- Queue consumer leasing/retry/failure state in D1
- Job lifecycle observability events

Phase 1-B has now implemented the production-usability layer for the admin path:

- AI worker internal task routes `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`
- Auth queue consumer progression through provider create, provider pending, poll, ingest, and succeeded/failed states
- R2 video output ingest into `USER_IMAGES`
- Optional provider poster ingest when a safe poster URL is present
- D1 poison-message persistence in `ai_video_job_poison_messages`
- Admin UI default async create/status polling
- Required `Idempotency-Key` for async video job creation

The design is still not fully complete as a SaaS platform. The existing synchronous `/api/admin/ai/test-video` compatibility route remains for controlled admin/debug rollback, provider behavior still needs staging verification, and there is no support/admin UI for poison-message inspection.

## Current Problem

Video generation can run longer than a normal request lifecycle and can perform provider polling in the request path. That is unsafe for SaaS scale because one browser request holds Worker execution, upstream provider state, admin UI state, and retry behavior together.

Current high-risk code paths:

| Area | Current files | Risk |
|---|---|---|
| Admin browser entrypoint | `js/pages/admin/ai-lab.js`, `js/shared/auth-api.js` | Phase 1-B uses async jobs by default, but the debug compatibility path can still call the old sync route. |
| Auth worker admin proxy | `workers/auth/src/routes/admin-ai.js` | `/api/admin/ai/test-video` still exists as admin compatibility; `/api/admin/ai/video-jobs` is now the default UI path. |
| Service auth | `workers/auth/src/lib/admin-ai-proxy.js`, `js/shared/service-auth.mjs` | Auth-to-AI requests are signed and nonce-protected, but still request/response. |
| AI worker route | `workers/ai/src/routes/video.js`, `workers/ai/src/routes/video-task.js` | The async queue path uses bounded task create/poll routes; the sync test route remains. |
| Provider invocation | `workers/ai/src/lib/invoke-ai-video.js` | Async helpers create/poll in short units; the legacy sync helper still contains long polling for compatibility. |
| Saved video assets | `workers/auth/src/lib/ai-video-jobs.js`, `workers/auth/src/routes/admin-ai.js` | Phase 1-B ingests completed admin job output into `USER_IMAGES`; broader asset publication remains separate work. |

## Why Synchronous Polling Is Unsafe

Synchronous polling will fail under real SaaS load:

| Failure mode | Impact |
|---|---|
| Worker request timeout | Long generations can fail even when the provider eventually succeeds. |
| User/browser disconnect | The job may be lost or duplicated without durable state. |
| Provider latency spikes | Admin route capacity gets consumed by polling. |
| Retry ambiguity | Retrying the browser request can create duplicate provider jobs and duplicate cost. |
| Poor observability | There is no durable job timeline, only transient request logs. |
| Cost control gaps | Per-job duration and provider retry counts are not first-class state. |
| Deploy interruption | In-flight work can be orphaned during worker deployment. |

## Target Architecture

Use Cloudflare-native primitives already present in the repository:

| Primitive | Role |
|---|---|
| D1 | Durable video job metadata, idempotency keys, state transitions, audit references. |
| Queue | Async job execution and retry scheduling. |
| R2 | Final video bytes, poster frames, provider response snapshots when safe. |
| Durable Object | Optional per-provider or per-user concurrency coordination if queue-only controls are insufficient. |
| Workers AI / provider API | Actual video generation provider. |
| Auth worker | Admin/user API, authorization, rate limits, status/read APIs. |
| AI worker | Internal signed service endpoint for provider invocation and status polling work. |

Recommended boundary:

1. Browser calls Auth worker to create a video job.
2. Auth worker validates admin/user auth, CSRF/origin, body size, quota, rate limits, and idempotency.
3. Auth worker inserts a D1 job row and sends a queue message.
4. Queue consumer performs provider create/poll/download/save work outside the browser request.
5. Browser polls a status endpoint or receives future push/notification if added later.
6. Completed jobs expose a stable saved asset or a controlled private media URL.

## Job Lifecycle

Recommended states:

| State | Meaning | Terminal |
|---|---|---:|
| `queued` | Job accepted and queue message sent or ready to send. | No |
| `starting` | Worker is validating provider request and creating upstream job. | No |
| `provider_pending` | Provider accepted the job and returned a task id. | No |
| `polling` | Worker is polling provider status or awaiting callback. | No |
| `ingesting` | Provider output URL exists and Worker is copying bytes to R2. | No |
| `succeeded` | Output persisted and safe metadata is available. | Yes |
| `failed` | Job failed permanently with sanitized error fields. | Yes |
| `cancelled` | User/admin canceled before terminal completion where provider supports it. | Yes |
| `expired` | Job exceeded maximum wall-clock duration or retention window. | Yes |

Allowed transitions should be enforced in code, not left to ad hoc updates.

## D1 Schema Proposal

Add a forward-only migration when implementing:

```sql
CREATE TABLE ai_video_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  source_module TEXT NOT NULL DEFAULT 'video',
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  workflow TEXT NOT NULL,
  prompt_hash TEXT,
  request_json TEXT NOT NULL,
  provider_task_id TEXT,
  output_r2_key TEXT,
  poster_r2_key TEXT,
  mime_type TEXT,
  duration_seconds INTEGER,
  width INTEGER,
  height INTEGER,
  error_code TEXT,
  error_message_public TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  poll_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT,
  locked_by TEXT,
  lock_expires_at TEXT,
  canceled_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_ai_video_jobs_user_created ON ai_video_jobs(user_id, created_at DESC);
CREATE INDEX idx_ai_video_jobs_status_next_poll ON ai_video_jobs(status, next_poll_at);
CREATE INDEX idx_ai_video_jobs_provider_task ON ai_video_jobs(provider, provider_task_id);
CREATE INDEX idx_ai_video_jobs_lock ON ai_video_jobs(lock_expires_at);
```

Store only sanitized request metadata. Do not store raw base64 images longer than needed; if image inputs are needed, store them as temporary private R2 objects with TTL references.

## Queue Design

Recommended queue messages:

```json
{
  "schema_version": 1,
  "type": "ai_video_job.process",
  "job_id": "job-id",
  "user_id": "user-id",
  "attempt": 1,
  "correlation_id": "corr-id",
  "enqueued_at": "2026-04-25T00:00:00.000Z"
}
```

Queue consumer responsibilities:

1. Acquire a lease in D1 using `locked_by` and `lock_expires_at`.
2. Load job and verify state transition is valid.
3. Create provider task if no `provider_task_id` exists.
4. Poll provider only until a small per-invocation budget is consumed.
5. Re-enqueue the job with delay/backoff when still pending.
6. Copy completed provider output to R2 before marking `ready`.
7. Record sanitized error code/message on permanent failure.

Do not keep a single queue invocation sleeping for the full provider duration. Prefer short work units plus delayed re-enqueue.

## Provider Polling vs Callback

Default Phase 1 approach should use queue-driven polling because it fits current Cloudflare Workers and the current Vidu fallback code.

Callback/webhook support can be added later if the provider supports signed callbacks. If added:

| Requirement | Detail |
|---|---|
| Signature verification | Verify provider HMAC or equivalent before reading state. |
| Idempotency | Callback must update only the matching `provider_task_id` and valid state. |
| Replay protection | Reject repeated callback IDs or signatures when provider supports IDs. |
| Same lifecycle | Callback updates the same `ai_video_jobs` state machine. |

## Status API Design

Auth worker APIs:

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/ai/video-jobs` | `POST` | Create admin video job. |
| `/api/admin/ai/video-jobs/:id` | `GET` | Read job status and sanitized metadata. |
| `/api/admin/ai/video-jobs/:id/cancel` | `POST` | Request cancellation. |
| `/api/ai/video-jobs` | `POST` | Future member-facing creation if product enables it. |
| `/api/ai/video-jobs/:id` | `GET` | Owner-readable status. |

Create responses should be fast:

```json
{
  "ok": true,
  "job": {
    "id": "job-id",
    "status": "queued",
    "created_at": "2026-04-25T00:00:00.000Z",
    "status_url": "/api/admin/ai/video-jobs/job-id"
  }
}
```

Status responses should never expose provider secrets, signed provider URLs if not yet ingested, raw provider request bodies, or internal stack traces.

## Idempotency Strategy

Require `Idempotency-Key` on job creation once exposed beyond internal admin tooling. For admin-only Phase 1, accept an optional key but log missing keys.

Rules:

| Case | Behavior |
|---|---|
| Same user and same idempotency key | Return existing job. |
| Same key with different request hash | Return `409 idempotency_conflict`. |
| Missing key | Create job, but rely on rate limit and UI disabling only. This is acceptable only for initial admin-only rollout. |

## Retry Strategy

Use bounded retries:

| Failure | Retry |
|---|---|
| Provider create network error | Retry with exponential backoff up to a small max. |
| Provider polling network error | Retry and preserve provider task id. |
| Provider terminal failure | Mark `failed`, do not retry unless error is classified transient. |
| R2 write failure | Retry ingest, do not create a new provider job. |
| Queue duplicate delivery | Lease and state transition prevent duplicate work. |

## Timeout Strategy

Recommended defaults:

| Timeout | Initial value |
|---|---:|
| Max provider job duration | 15 minutes |
| Queue lease duration | 2 minutes |
| Poll interval | 5 to 15 seconds with backoff |
| Job retention for failed/canceled | 30 days |
| Temp input R2 retention | 24 hours |

Timeouts should be env-configurable but validated with safe bounds.

## Cancellation Strategy

Cancellation should be best-effort:

1. If job is `queued`, mark `canceled`.
2. If job is `provider_pending` or `polling`, mark cancellation requested.
3. If provider supports cancellation, call it from the queue worker.
4. If provider does not support cancellation, stop polling and let provider output expire.
5. Never delete already-published user assets without an explicit separate delete operation.

## Rate Limits and Abuse Controls

Required controls before rollout:

| Control | Scope |
|---|---|
| Fail-closed route limiter | Create, cancel, and expensive status list endpoints. |
| Quota | Per user/admin daily video generation count and estimated cost. |
| Idempotency | Create endpoint. |
| Body-size limit | Create payload, especially image input fields. |
| Input validation | Model, workflow, duration, resolution, prompt length, base64 size. |
| Queue concurrency | Per provider and optionally per user. |
| Cost ceiling | Disable or degrade if budget threshold is exceeded. |

## R2 and Media Handling

Do not serve provider URLs directly as saved assets.

Recommended ingest:

1. Fetch provider output from allowlisted HTTPS hosts only.
2. Enforce max download bytes and content type.
3. Stream to R2 under `users/{userId}/folders/video/{jobId}.mp4` or equivalent.
4. Save poster under derivatives path if generated.
5. Insert/update `ai_text_assets` only after R2 write succeeds.
6. Use current immutable public media URL conventions when published.

## Observability and Audit Events

Emit structured events for:

| Event | Component |
|---|---|
| `ai_video_job_created` | Auth route |
| `ai_video_job_enqueue_failed` | Auth route |
| `ai_video_job_started` | Queue worker |
| `ai_video_provider_task_created` | AI worker/queue worker |
| `ai_video_provider_poll_state` | AI worker/queue worker |
| `ai_video_ingest_started` | Queue worker |
| `ai_video_job_ready` | Queue worker |
| `ai_video_job_failed` | Queue worker |
| `ai_video_job_canceled` | Auth route/queue worker |

Audit logs should include user/admin id, job id, model, workflow, status, correlation id, and sanitized error code. They must not include raw prompts if product treats prompts as private content unless that is explicitly accepted.

## Failure Modes

| Failure | Expected handling |
|---|---|
| D1 unavailable on create | Fail closed with `503`; do not call provider. |
| Queue send fails | Mark job `failed_to_enqueue` or roll back job insert in same logical flow; do not claim accepted. |
| Duplicate queue message | Lease prevents duplicate provider create. |
| Provider task created but D1 update fails | Retry reconciliation by idempotency key or provider task id if available. |
| Provider output URL expires | Mark failed with actionable public error and internal provider code. |
| R2 write fails | Retry ingest without creating another provider job. |
| Deploy during job | New worker resumes from D1 state. |

## Rollback Plan

Phase 1 rollout should keep the existing synchronous admin route behind a feature flag until async job creation and status polling are validated in staging.

Rollback steps:

1. Disable async feature flag.
2. Stop queue consumers or route new creates back to synchronous admin-only behavior.
3. Keep status endpoints read-only for existing jobs.
4. Let in-flight queue jobs finish or mark them failed after timeout.
5. Do not drop new D1 tables until retention and migration rollback decisions are made.

## Migration Plan

Suggested PR sequence:

1. Add D1 schema, release-compat update, and harness support.
2. Add job model helpers and state transition tests.
3. Add queue message producer and consumer skeleton with no provider calls.
4. Move provider create/poll logic behind a queue-safe service interface.
5. Add R2 ingest with byte/content-type limits.
6. Add admin create/status/cancel APIs behind a feature flag.
7. Update admin UI to create jobs and poll status.
8. Staging load test with fake provider latency and duplicate queue delivery.
9. Enable admin-only async path.
10. Remove or lock down synchronous video route after parity is proven.

## Test Plan

Required tests:

| Test family | Cases |
|---|---|
| Unit | State transition table, idempotency, provider response parsing, timeout classification. |
| Worker route | Create/status/cancel auth, CSRF, body size, rate limit, fail-closed D1/queue errors. |
| Queue | Duplicate delivery, lease contention, retry, provider pending, provider success, provider failure. |
| R2 ingest | Max bytes, wrong MIME, private IP/SSRF rejection, expired provider URL. |
| Release | Migration included, queue binding present, env config validated. |
| Load | Many pending jobs without request timeouts or unbounded polling. |

## Open Decisions

| Decision | Owner |
|---|---|
| Whether video jobs are admin-only or member-facing in Phase 1. | Product/engineering |
| Exact daily/monthly video quota and cost budget. | Product/finance |
| Whether prompts are audit-loggable content. | Security/product |
| Provider callback support and signature contract. | Security/backend |
| Retention period for failed jobs and temp image inputs. | Product/compliance |
| Whether cancellation should call provider APIs or only stop local polling. | Backend/SRE |
