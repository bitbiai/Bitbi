# Release Rollback Runbook

## Symptoms

- New deploy causes elevated `5xx`, failed health checks, queue poison messages, or security-control failures.
- Release preflight was green but live behavior regressed.

## Likely Causes

- Worker/static version mismatch.
- Missing Cloudflare prerequisite in live environment.
- D1 migration/deploy ordering issue.
- Dashboard-managed control drift.

## Immediate Checks

- Identify changed deploy units from `npm run release:plan`.
- Check `npm run release:preflight` on the exact commit.
- Check live health endpoints and Cloudflare prerequisite validation.
- Review release order: migrations, AI Worker, auth Worker, contact Worker, static.

## Safe Commands

- `npm run release:plan`
- `npm run release:preflight`
- `npm run check:live-health -- --require-live --auth-base-url <url> --ai-base-url <url> --contact-base-url <url>`
- `npm run check:live-security-headers -- --base-url <url> --require-live`

## Approval-Required Commands

- `npx wrangler deploy`
- `npm run release:apply`
- Remote D1 migrations or manual SQL.
- Secret/binding/dashboard changes.

## Rollback Considerations

- D1 migrations are forward-only; code rollback must remain compatible with already-applied schema.
- Auth and AI Workers must remain compatible for HMAC route contracts.
- Static Pages deploy does not deploy Workers.
- Do not use legacy sync video route as broad rollback for async video.

## User Impact

Depends on impacted deploy unit: static UX, auth/API, AI jobs, contact form, or media access.

## Logs and Events

- Release preflight output.
- Worker health checks.
- `worker_config_invalid`
- service-auth failures.
- queue poison/retry events.

## Escalation Criteria

- Any security-control bypass suspicion.
- Auth/admin outage.
- Data integrity or migration concern.

## Data-Loss Risk

High if rollback includes D1/R2 mutation. Prefer compatible forward fix over destructive rollback.
