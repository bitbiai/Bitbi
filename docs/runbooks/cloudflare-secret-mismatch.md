# Cloudflare Secret or Binding Mismatch Runbook

## Symptoms

- Worker config fails closed with generic `503`.
- Auth-to-AI requests return service-auth errors.
- Release prereq validation reports blocked production readiness.

## Likely Causes

- Missing secret in one Worker environment.
- `AI_SERVICE_AUTH_SECRET` differs between auth and AI Workers.
- Purpose-specific auth secret missing after Phase 1-D.
- Missing DO, queue, D1, R2, Images, or service binding.

## Immediate Checks

- Run repo validation: `npm run validate:cloudflare-prereqs`.
- Compare required names in `config/release-compat.json`.
- Use Cloudflare dashboard or approved CLI to verify secret/binding presence by name only.
- Never print secret values.

## Safe Commands

- `npm run test:cloudflare-prereqs`
- `npm run validate:cloudflare-prereqs`
- `npm run test:release-compat`

## Approval-Required Commands

- Secret writes or rotations.
- Worker deploys.
- Binding/resource creation in Cloudflare.

## Rollback Considerations

- For `AI_SERVICE_AUTH_SECRET`, auth and AI Workers must use matching values.
- For purpose-specific auth secrets, keep documented legacy fallback until the migration window is intentionally closed.
- Do not disable fail-closed validation to recover availability.

## User Impact

Depending on missing config, auth, admin, AI, contact, or media routes may be unavailable by design.

## Logs and Events

- `worker_config_invalid`
- service-auth failure events
- Release prerequisite output

## Escalation Criteria

- Any suspected secret exposure.
- Admins locked out by wrong MFA/session secrets.
- All internal AI requests failing after deploy.

## Data-Loss Risk

Low from read-only checks, high from incorrect secret rotations that invalidate sessions/MFA.
