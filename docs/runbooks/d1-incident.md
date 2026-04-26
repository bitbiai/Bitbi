# D1 Incident Runbook

## Symptoms

- Auth/admin/media APIs return D1-related `5xx`.
- Migration validation fails.
- Async video jobs cannot transition state.

## Likely Causes

- D1 service issue.
- Migration not applied before Worker deploy.
- Query/schema drift.
- Hot query or lock contention.

## Immediate Checks

- Compare `config/release-compat.json` latest checkpoint with files in `workers/auth/migrations`.
- Run local Worker tests if a code change is suspected.
- Inspect Cloudflare D1 dashboard for errors and latency.
- Check route logs for safe error codes and correlation IDs.

## Safe Commands

- `npm run test:release-compat`
- `npm run validate:release`
- `npm run test:workers`

## Approval-Required Commands

- `npx wrangler d1 migrations apply bitbi-auth-db --remote`
- Production D1 export/import.
- Any production SQL write, delete, or schema mutation.

## Rollback Considerations

- D1 migrations are forward-only in this repo.
- Rollback code must remain compatible with applied migrations.

## User Impact

Authentication, account state, admin functions, media metadata, and async video state may be unavailable.

## Logs and Events

- Route-level D1 failures.
- `worker_config_invalid` if DB binding is missing.
- Queue retry/failure events caused by D1 errors.

## Escalation Criteria

- D1 outage or schema mismatch affecting login or admin.
- Any suspected data corruption.

## Data-Loss Risk

High. Treat manual D1 commands as production data operations requiring approval.
