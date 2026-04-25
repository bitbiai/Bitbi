# Phase 1 Observability Baseline

Date: 2026-04-25

Scope: initial observability baseline for Phase 1-A async admin AI video jobs. This is not a full SLO/alerting program.

## Logged Events

The auth worker emits structured JSON logs through `logDiagnostic()` for the async video job lifecycle:

| Event | Component | Purpose |
|---|---|---|
| `ai_video_job_created` | `ai-video-jobs` | Job row was created after auth, origin, body-size, validation, idempotency, and rate-limit checks. |
| `ai_video_job_enqueued` | `ai-video-jobs` | Queue message was published for the job. |
| `ai_video_job_enqueue_failed` | `ai-video-jobs` | Job insert succeeded but queue send failed; job is marked failed and the create request returns `503`. |
| `ai_video_job_started` | `ai-video-jobs-queue` | Queue consumer leased a job and began provider processing. |
| `ai_video_job_retried` | `ai-video-jobs-queue` | Provider/service failure was classified retryable and the job was requeued. |
| `ai_video_job_succeeded` | `ai-video-jobs-queue` | Provider returned a video URL and the job was marked `succeeded`. |
| `ai_video_job_failed` | `ai-video-jobs-queue` | Job reached permanent failure or retry exhaustion. |
| `ai_video_job_bad_queue_payload` | `ai-video-jobs-queue` | Malformed queue message was rejected and logged. |
| `ai_video_job_missing` | `ai-video-jobs-queue` | Queue message referenced a missing job row. |

## Safe Fields

Logs include only operational metadata:

- `job_id`
- `correlation_id`
- `admin_user_id` where applicable
- `provider`
- `model`
- `status`
- `attempt_count`
- `retry_delay_seconds`
- `duration_ms`
- sanitized `error_code`

## Intentionally Not Logged

The implementation must not log:

- `AI_SERVICE_AUTH_SECRET`
- service-auth signatures, nonces, or body hashes
- MFA codes, recovery codes, session tokens, or cookies
- raw prompts or full request bodies
- provider credentials
- raw provider payloads that may contain user content

## Initial SLO Candidates

These are candidates for Phase 1-B/SRE work, not enforced by code yet:

| SLO | Candidate target |
|---|---:|
| Job create availability | 99.5% successful `POST /api/admin/ai/video-jobs` excluding validation errors. |
| Queue start latency | 95% of queued jobs start within 60 seconds. |
| Job terminal completion | 95% of jobs reach `succeeded` or `failed` within 20 minutes. |
| Retry exhaustion rate | Less than 5% of jobs fail after max attempts. |
| Queue backlog | Alert if `bitbi-ai-video-jobs` visible backlog is above normal operating threshold for 10 minutes. |

## Recommended Dashboards And Alerts

Cloudflare dashboard or log analytics should track:

- Count of `ai_video_job_created`, `ai_video_job_succeeded`, `ai_video_job_failed`, and `ai_video_job_retried`.
- Queue backlog and oldest message age for `bitbi-ai-video-jobs`.
- Error-rate split by `error_code`, `provider`, and `model`.
- P95/P99 queue consumer duration from `duration_ms`.
- `ai_video_job_enqueue_failed` count; any occurrence should page or open an incident ticket.
- `ai_video_job_bad_queue_payload` count; any non-test occurrence should be investigated.

## Current Limitations

- Logs are present, but dashboards, alert rules, runbooks, and SLO burn-rate alerting are not repo-enforced.
- Provider video output is not yet ingested into R2 by the async job pipeline; completed jobs currently expose the provider URL returned by the existing AI worker contract.
- Queue processing still calls the existing AI worker synchronous provider invocation path from the queue consumer. This removes browser request blocking for the new async API, but provider polling has not yet been split into short queue-driven poll units.
