# Async Video Jobs Incident Runbook

## Symptoms

- Admin video jobs stay in `queued`, `provider_pending`, `polling`, or `ingesting`.
- Queue retries or poison-message rows spike.
- Status API returns sanitized failures for many jobs.

## Likely Causes

- Provider outage or credential issue.
- AI video queue backlog.
- R2 ingest failure.
- D1 lock/state transition issue.
- Malformed queue messages from an incompatible deploy.

## Immediate Checks

- Inspect recent failed jobs and poison messages through admin-only operational routes.
- Check Cloudflare queue backlog and retry/exhaustion metrics.
- Check `ai_video_jobs` statuses in staging or production dashboards.
- Check auth and AI Worker logs with the job correlation id.

## Safe Commands

- `npm run test:workers`
- `npm run test:release-compat`
- `npm run validate:cloudflare-prereqs`
- `npm run check:live-health -- --auth-base-url <staging-or-prod-url> --ai-base-url <staging-or-prod-url> --require-live`

## Approval-Required Commands

- Queue purge or replay actions.
- Production D1 updates to job status.
- Production R2 object deletion or overwrite.
- Worker deploys.

## Rollback Considerations

- Default admin UI should remain on async route.
- The legacy sync video route is debug-gated and must not be opened broadly as rollback.
- Roll back auth and AI Workers together if route contracts changed.

## User Impact

Admins may be unable to generate or retrieve video outputs. Existing successful outputs should remain available if R2 and status routes are healthy.

## Logs and Events

- `ai_video_job_created`
- `ai_video_job_enqueued`
- `ai_video_job_provider_task_created`
- `ai_video_job_poll_scheduled`
- `ai_video_job_retry_scheduled`
- `ai_video_job_succeeded`
- `ai_video_job_failed`
- `ai_video_job_poison_message_recorded`

## Escalation Criteria

- Queue oldest pending age exceeds alert threshold.
- Any poison-message spike after deploy.
- R2 ingest failures for all jobs.

## Data-Loss Risk

Medium. Avoid manual job mutation unless the idempotency and provider-task state are understood.
