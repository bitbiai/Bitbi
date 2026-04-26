# AI Worker Incident Runbook

## Symptoms

- Internal `/internal/ai/*` requests return `401`, `503`, or provider errors.
- `GET /health` fails.
- Auth-to-AI service-auth failures spike.

## Likely Causes

- `AI_SERVICE_AUTH_SECRET` mismatch between auth and AI Workers.
- `SERVICE_AUTH_REPLAY` Durable Object unavailable.
- Provider outage or missing provider secret.
- Bad AI Worker deploy.

## Immediate Checks

- Check `GET /health` with the safe live health script.
- Verify repo config with `npm run validate:cloudflare-prereqs`.
- Check AI Worker logs for service-auth error codes and provider failure events.
- Confirm auth Worker and AI Worker were deployed as a compatible pair.

## Safe Commands

- `npm run test:workers`
- `npm run test:cloudflare-prereqs`
- `npm run check:live-health -- --ai-base-url <staging-or-prod-url> --require-live`

## Approval-Required Commands

- `npx wrangler deploy` from `workers/ai`.
- Secret updates for `AI_SERVICE_AUTH_SECRET` or provider credentials.

## Rollback Considerations

- Auth and AI Workers must agree on service-auth contract and secret.
- Rolling back only one Worker can create signature or route-contract failures.

## User Impact

Admin AI tests, async video jobs, and AI-backed generation flows may fail or queue without progress.

## Logs and Events

- Service-auth failure codes
- `worker_config_invalid`
- `admin_ai_*_failed`
- Provider-specific failure events

## Escalation Criteria

- All internal AI calls failing.
- Suspected HMAC secret mismatch in production.
- Provider billing or credential issue.

## Data-Loss Risk

Low for AI Worker itself; medium if async jobs repeatedly fail and require retry/backfill decisions.
