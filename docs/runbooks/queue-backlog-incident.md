# Queue Backlog Incident Runbook

## Symptoms

- Queue oldest pending age rises.
- Worker queue retries spike.
- Derivative/video jobs do not progress.

## Likely Causes

- Consumer deploy failure.
- Provider/R2/D1 outage causing retries.
- Malformed messages.
- Downstream rate limits or quota exhaustion.

## Immediate Checks

- Identify affected queue: `bitbi-auth-activity-ingest`, `bitbi-ai-image-derivatives`, or `bitbi-ai-video-jobs`.
- Check Cloudflare queue dashboard for backlog, oldest message age, retry count, and consumer errors.
- Inspect Worker logs for queue-specific events and correlation IDs.
- For video queue, inspect failed jobs and poison messages through admin-only tooling.

## Safe Commands

- `npm run test:workers`
- `npm run validate:cloudflare-prereqs`
- `npm run test:release-compat`

## Approval-Required Commands

- Queue purge, replay, or manual message injection.
- Production D1 job status updates.
- Worker deploys.

## Rollback Considerations

- Roll back producer and consumer contract changes together.
- Avoid replaying non-idempotent work without checking dedupe/idempotency state.

## User Impact

Depending on queue, audit ingestion, image derivatives, or async video jobs may lag.

## Logs and Events

- `ai_video_job_consumer_retry`
- `ai_derivative_consumer_retry`
- `queue_batch_unrecognized`
- `ai_video_job_poison_message_recorded`

## Escalation Criteria

- Oldest pending age exceeds alert threshold.
- Consumer cannot process any messages.
- Poison messages spike after a deploy.

## Data-Loss Risk

Medium. Queue purges can drop work; replay can duplicate work if idempotency is misunderstood.
