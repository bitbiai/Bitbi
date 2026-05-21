# 06 - Tenant Isolation And Asset Evidence

Date: 2026-05-21

Operator: pending human review; local repo evidence filled by Codex

Current status: tenant isolation is unclaimed. This template does not execute backfill, access-switch enforcement, R2 listing/mutation, reset, deletion, provider calls, Stripe calls, or Cloudflare mutations.

Local sprint status:

- `npm run test:tenant-assets` passed.
- `npm run test:workers` passed 615 Worker tests, including tenant evidence/exact-candidate coverage.
- No tenant ownership backfill was executed.
- No access-switch enforcement was changed.
- No legacy media reset/delete was executed.
- No live R2 listing or mutation was run.

## Ownership Backfill Evidence

Allowed exact candidate execution requirements:

- `domain: ai_images`
- `batchLimit: 1`
- exactly one `candidateAssetIds`
- fresh authenticated preflight evidence
- operator approval

| Check | Evidence reference | Result |
| --- | --- | --- |
| Fresh dry-run evidence collected | Operator/admin evidence required; not collected by Codex | pending |
| Exact candidate asset ID recorded in private/redacted form | Operator/admin evidence required; do not store raw private IDs if not needed | pending |
| UI/backend block broad `ai_folders + ai_images` execution | Repo tests and Phase 0/1-3 guards cover exact-only behavior; live/operator evidence pending | repo-local only / live pending |
| No source row mutation during evidence collection | Sprint performed no tenant mutation | confirmed for this sprint |
| No R2 live listing or mutation | Sprint performed no R2 listing/mutation | confirmed for this sprint |
| No tenant isolation claim made | This package keeps tenant isolation unclaimed | confirmed |

## Manual Review Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Manual-review queue evidence collected | Operator/admin evidence required | pending |
| Import replay evidence | Operator/admin evidence required | pending |
| Import conflict evidence | Operator/admin evidence required | pending |
| Successful standalone status update evidence | Operator/admin evidence required | pending |
| Status replay evidence | Operator/admin evidence required | pending |
| Status conflict evidence | Operator/admin evidence required | pending |
| Evidence contains no raw idempotency keys | No raw keys added by this sprint; operator evidence still needs review | local package clean / operator review pending |

## Access-Switch Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Shadow diagnostics only | No access-switch command run by Codex | confirmed for this sprint |
| Enforced mode remains blocked | No enforcement changed by Codex; operator config verification pending | local sprint blocked / operator pending |
| Rollback/stop conditions documented | Stop conditions below; operator playbook evidence pending | partial |
| Ownership metadata coverage sufficient? | Requires fresh sanitized evidence and operator review | pending |

## Legacy Media Reset Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Confirmed execution remains blocked | No reset/delete command run by Codex | confirmed for this sprint |
| Historical unsafe/stale evidence remains rejected unless sanitized replacement exists | Operator/admin evidence required; do not reuse unsafe stale evidence as approval | pending |
| Sanitized replacement dry-run evidence collected | Operator/admin evidence required | pending |
| `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` remains disabled unless separately approved | Operator secret/config presence evidence required; no values | pending |
| No deletion/reset performed | Sprint performed no deletion/reset | confirmed for this sprint |

## Stop Conditions

- Any raw private R2 key, signed URL, raw idempotency key, cookie, token, provider payload, Stripe data, or personal data appears in evidence.
- Any report implies access checks changed, ownership metadata was broadly backfilled, R2 was listed/mutated, or reset/delete occurred.
- Any high-risk count remains nonzero and someone tries to claim tenant isolation.
