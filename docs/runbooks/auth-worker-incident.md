# Auth Worker Incident Runbook

## Symptoms

- `GET /api/health` returns `503` or times out.
- Login/register/admin APIs return elevated `5xx`.
- Spike in `shared_rate_limiter_fail_closed`, D1 errors, or config failure logs.

## Likely Causes

- Missing or mismatched auth Worker secrets.
- D1 outage, migration mismatch, or query regression.
- Durable Object rate limiter unavailable.
- Bad Worker deploy or incompatible route/config change.

## Immediate Checks

- Run `npm run release:preflight` locally on the candidate revision.
- Run `npm run validate:cloudflare-prereqs` and verify live/manual prerequisites separately.
- Check Cloudflare Worker logs for `bitbi-auth` with correlation IDs.
- Check D1 status and latest migration checkpoint.

## Safe Commands

- `npm run test:workers`
- `npm run test:release-compat`
- `npm run validate:release`
- `npm run check:live-health -- --auth-base-url <staging-or-prod-url> --require-live`

## Approval-Required Commands

- `npx wrangler deploy`
- `npx wrangler d1 migrations apply bitbi-auth-db --remote`
- Any production D1 execute/import/export operation.

## Rollback Considerations

- Do not roll back below migrations already required by deployed code without a rollback plan.
- If config fails closed, prefer fixing secrets/bindings over disabling guards.
- Keep purpose-specific secret fallback policy from Phase 1-D intact.

## User Impact

Users may be unable to log in, manage account state, access private media, or use admin features.

## Logs and Events

- `worker_config_invalid`
- `shared_rate_limiter_fail_closed`
- D1 error fields from route logs
- Auth/session route failure events

## Escalation Criteria

- Any production auth `5xx` lasting more than 5 minutes.
- Any admin lockout affecting all admins.
- Any suspected secret exposure.

## Data-Loss Risk

High for manual D1 writes. Do not mutate production data during triage without approval.
