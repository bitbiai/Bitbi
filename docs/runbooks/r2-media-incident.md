# R2 Media Incident Runbook

## Symptoms

- Private media routes return `404`, `403`, or `5xx`.
- Async video outputs or posters fail to ingest or serve.
- Cleanup jobs report dead-lettered R2 deletes.

## Likely Causes

- Missing R2 binding or bucket.
- Bucket permission/drift issue.
- Provider output fetch issue.
- Cleanup bug or lifecycle policy conflict.

## Immediate Checks

- Verify R2 bindings in `workers/auth/wrangler.jsonc` and `config/release-compat.json`.
- Inspect auth Worker logs for R2 ingest/fetch/delete failures.
- Confirm object keys are deterministic and not user-input-derived.
- Test authorized media access through the Worker, not direct bucket URLs.

## Safe Commands

- `npm run test:workers`
- `npm run validate:cloudflare-prereqs`
- `npm run test:release-compat`

## Approval-Required Commands

- Production R2 object delete, overwrite, or lifecycle changes.
- Bucket creation or binding changes.
- Worker deploys that change media access policy.

## Rollback Considerations

- Do not expose raw internal R2 keys as a workaround.
- Preserve ownership checks and private/public media boundaries.

## User Impact

Users/admins may be unable to view uploaded media, generated media, or AI video outputs.

## Logs and Events

- R2 ingest failure events.
- `r2_cleanup_dead_lettered`
- Media route `5xx` logs with correlation id.

## Escalation Criteria

- Broad private media outage.
- Any unauthorized media exposure.
- Suspected bucket lifecycle deletion.

## Data-Loss Risk

High for delete/overwrite operations. Use restore procedure before manual mutation.
