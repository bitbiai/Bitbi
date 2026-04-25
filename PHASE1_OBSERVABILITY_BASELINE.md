# Phase 1 Observability Baseline

Date: 2026-04-25

Scope: observability baseline for Phase 1-A and Phase 1-B async admin AI video jobs. This is not a full SLO/alerting program.

## Logged Events

The auth worker emits structured JSON logs through `logDiagnostic()` for the async video job lifecycle:

| Event | Component | Purpose |
|---|---|---|
| `ai_video_job_created` | `ai-video-jobs` | Job row was created after auth, origin, body-size, validation, idempotency, and rate-limit checks. |
| `ai_video_job_enqueued` | `ai-video-jobs` | Queue message was published for the job. |
| `ai_video_job_enqueue_failed` | `ai-video-jobs` | Job insert succeeded but queue send failed; job is marked failed and the create request returns `503`. |
| `ai_video_job_started` | `ai-video-jobs-queue` | Queue consumer leased a job and began provider processing. |
| `ai_video_job_retried` | `ai-video-jobs-queue` | Provider/service failure was classified retryable and the job was requeued. |
| `ai_video_job_poll_scheduled` | `ai-video-jobs` | Provider task is pending and a delayed poll message was enqueued. |
| `ai_video_job_poll_result` | `ai-video-jobs-queue` | Provider poll returned a pending state and the next poll was scheduled. |
| `vidu_provider_task_created` | `invoke-video` | AI worker created a direct Vidu provider task without long polling. |
| `ai_video_job_poster_ingest_failed` | `ai-video-jobs-ingest` | Optional poster ingest failed without failing the completed video. |
| `ai_video_job_succeeded` | `ai-video-jobs-queue` | Provider returned a video URL, output ingest succeeded, and the job was marked `succeeded`. |
| `ai_video_job_failed` | `ai-video-jobs-queue` | Job reached permanent failure or retry exhaustion. |
| `ai_video_job_bad_queue_payload` | `ai-video-jobs-queue` | Malformed queue message was rejected and logged. |
| `ai_video_job_poison_message_recorded` | `ai-video-jobs-queue` | Malformed or exhausted queue message was persisted with a redacted body summary. |
| `ai_video_job_poison_message_record_failed` | `ai-video-jobs-queue` | Poison persistence failed; investigate because malformed messages may be acknowledged without durable evidence. |
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
- Oldest `provider_pending` or `polling` job age in D1.
- Count and reason split for `ai_video_job_poison_message_recorded`.
- R2 ingest failures split by `video_output_*` and `video_poster_*` error codes.
- Error-rate split by `error_code`, `provider`, and `model`.
- P95/P99 queue consumer duration from `duration_ms`.
- `ai_video_job_enqueue_failed` count; any occurrence should page or open an incident ticket.
- `ai_video_job_bad_queue_payload` or `ai_video_job_poison_message_recorded` count; any non-test occurrence should be investigated.

## Current Limitations

- Logs are present, but dashboards, alert rules, runbooks, and SLO burn-rate alerting are not repo-enforced.
- Phase 1-B ingests completed admin video job output into R2, but there is no admin/support UI for browsing job timelines or poison-message records.
- Queue processing uses short provider task create/poll routes for the async path, but the legacy synchronous compatibility route still exists and should be restricted or retired after staging verification.
- Cloudflare dashboards and alerts must still be configured outside this document or added through future repo-controlled IaC/drift checks.
