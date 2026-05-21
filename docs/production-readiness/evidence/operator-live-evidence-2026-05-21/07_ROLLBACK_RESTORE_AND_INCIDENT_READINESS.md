# 07 - Rollback, Restore, And Incident Readiness

Date: 2026-05-21

Operator: pending human review; local rollback drill summary filled by Codex

This template records readiness evidence. It does not execute rollback, restore, remote migrations, deploys, or Cloudflare mutations.

Local sprint command: `npm run release:rollback-drill` passed. It was local-only, executed no rollback, and reported no runtime deploy steps required by the current evidence diff.

Rollback drill commit context:

- Current commit: `6be19411c897109c2d74e609b91fb9b5a88c8567`
- Previous commit reference in local drill output: `eef6e7db3e9a2ea80831feecf0336b94ddff0d7e`
- Final master closure and Mega Packet refreshes reran the local rollback drill. No rollback, deploy, remote migration, Cloudflare/GitHub API call, or resource mutation was executed.

## Rollback Evidence

| Item | Evidence reference | Result |
| --- | --- | --- |
| Previous Auth Worker version/deploy id | Operator Cloudflare evidence required | pending |
| Previous AI Worker version/deploy id | Operator Cloudflare evidence required | pending |
| Previous Contact Worker version/deploy id | Operator Cloudflare evidence required | pending |
| Previous static Pages artifact/deploy id | Operator GitHub Pages evidence required | pending |
| Rollback owner assigned | Operator to assign | pending |
| Rollback criteria documented | Local drill output reviewed; human criteria approval pending | partial |
| Rollback command placeholders reviewed, not executed | Local drill output reviewed; no rollback executed | confirmed not executed |
| Post-rollback smoke checks defined | Checklist below; live execution pending | partial |

## Restore Drill Evidence

| Item | Evidence reference | Result |
| --- | --- | --- |
| D1 backup/export policy reviewed | Operator/runbook evidence required | pending |
| D1 restore drill evidence | Operator evidence required; no remote restore run by Codex | pending |
| R2 restore drill evidence | Operator evidence required; no R2 mutation/listing run by Codex | pending |
| Queue recovery/idempotency approach reviewed | Operator/runbook evidence required | pending |
| Durable Object state recovery expectations reviewed | Operator/runbook evidence required | pending |
| RPO/RTO targets reviewed | Operator/business evidence required | pending |

## Incident Readiness

| Item | Evidence reference | Result |
| --- | --- | --- |
| `docs/SLO_ALERT_BASELINE.md` reviewed | Repo file exists; operator review/signoff pending | partial |
| `docs/OBSERVABILITY_EVENTS.md` reviewed | Repo file exists; operator review/signoff pending | partial |
| Service runbooks reviewed | Repo runbooks exist; operator review/signoff pending | partial |
| Alerts/notifications reviewed in Cloudflare/dashboard | Operator dashboard evidence required | pending |
| Escalation owners assigned | Operator to fill | pending |
| Operator Timeline/Triage reviewed | Admin/operator evidence required | pending |

## Mega Packet Rollback Follow-Up

| Item | Evidence reference | Result |
| --- | --- | --- |
| `npm run release:rollback-drill` | Passed locally for commit `6be19411c897109c2d74e609b91fb9b5a88c8567`; no rollback executed | local pass |
| `npm run test:rollback-drill` | Rollback drill tests passed | local pass |
| Previous deploy ids captured | Operator Cloudflare/GitHub evidence required | pending |
| Rollback owner assigned | Operator to fill before any release window | pending |
| Restore drill executed | Separate staging/operator drill required; not run by Codex | pending |
| Alerts/SLO dashboard verified | `docs/SLO_ALERT_BASELINE.md` and `docs/OBSERVABILITY_EVENTS.md` reviewed; dashboard evidence pending | partial / pending |
| Escalation owners assigned | Operator to fill | pending |

## Post-Rollback Smoke Checks

- Auth health: previous approved public read-only check returned 200; rerun pending if a release occurs
- Public homepage: previous approved public read-only check returned 200; rerun pending if a release occurs
- Admin readiness: pending operator-authenticated browser evidence
- Billing evidence: pending operator/Stripe canary evidence
- Tenant asset evidence: pending operator/admin evidence
- Contact form safe mode: pending approved read-only/manual evidence

Notes:

- The sprint did not execute rollback, restore, deploy, remote migration, or Cloudflare mutation.
