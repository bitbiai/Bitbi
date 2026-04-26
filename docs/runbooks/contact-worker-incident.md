# Contact Worker Incident Runbook

## Symptoms

- Contact form returns `5xx`, `429`, or fails to deliver email.
- `GET /health` fails.
- Resend upstream errors appear in logs.

## Likely Causes

- Missing `RESEND_API_KEY`.
- Resend outage or rejection.
- Durable Object rate limiter unavailable.
- Origin/CORS regression.

## Immediate Checks

- Run contact health check with configured contact URL.
- Check contact Worker logs for `contact_submit_upstream_error`.
- Verify `PUBLIC_RATE_LIMITER` binding and `RESEND_API_KEY` presence by name.
- Confirm frontend is still sending `Origin: https://bitbi.ai`.

## Safe Commands

- `npm run test:workers`
- `npm run validate:cloudflare-prereqs`
- `npm run check:live-health -- --contact-base-url <staging-or-prod-url> --require-live`

## Approval-Required Commands

- Contact Worker deploy.
- Secret update.
- Rate-limit DO or route changes.

## Rollback Considerations

- Do not fail open if the rate limiter is unavailable.
- If email provider is down, return safe errors rather than accepting messages silently unless product decides otherwise.

## User Impact

Visitors cannot submit contact requests reliably.

## Logs and Events

- `contact_submit_upstream_error`
- `shared_rate_limiter_fail_closed`
- `shared_rate_limiter_blocked`

## Escalation Criteria

- Contact failures lasting more than 30 minutes.
- Suspected abuse or spam surge.
- Provider account suspension.

## Data-Loss Risk

Low for current implementation; unsent contact messages are not durably queued.
