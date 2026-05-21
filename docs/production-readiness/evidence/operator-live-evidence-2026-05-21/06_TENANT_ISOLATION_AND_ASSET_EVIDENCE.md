# 06 - Tenant Isolation And Asset Evidence

Date:

Operator:

Current status: tenant isolation is unclaimed. This template does not execute backfill, access-switch enforcement, R2 listing/mutation, reset, deletion, provider calls, Stripe calls, or Cloudflare mutations.

## Ownership Backfill Evidence

Allowed exact candidate execution requirements:

- `domain: ai_images`
- `batchLimit: 1`
- exactly one `candidateAssetIds`
- fresh authenticated preflight evidence
- operator approval

| Check | Evidence reference | Result |
| --- | --- | --- |
| Fresh dry-run evidence collected |  | pending |
| Exact candidate asset ID recorded in private/redacted form |  | pending |
| UI/backend block broad `ai_folders + ai_images` execution |  | pending |
| No source row mutation during evidence collection |  | pending |
| No R2 live listing or mutation |  | pending |
| No tenant isolation claim made |  | pending |

## Manual Review Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Manual-review queue evidence collected |  | pending |
| Import replay evidence |  | pending |
| Import conflict evidence |  | pending |
| Successful standalone status update evidence |  | pending |
| Status replay evidence |  | pending |
| Status conflict evidence |  | pending |
| Evidence contains no raw idempotency keys |  | pending |

## Access-Switch Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Shadow diagnostics only |  | pending |
| Enforced mode remains blocked |  | pending |
| Rollback/stop conditions documented |  | pending |
| Ownership metadata coverage sufficient? |  | pending |

## Legacy Media Reset Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Confirmed execution remains blocked |  | pending |
| Historical unsafe/stale evidence remains rejected unless sanitized replacement exists |  | pending |
| Sanitized replacement dry-run evidence collected |  | pending |
| `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` remains disabled unless separately approved |  | pending |
| No deletion/reset performed |  | pending |

## Stop Conditions

- Any raw private R2 key, signed URL, raw idempotency key, cookie, token, provider payload, Stripe data, or personal data appears in evidence.
- Any report implies access checks changed, ownership metadata was broadly backfilled, R2 was listed/mutated, or reset/delete occurred.
- Any high-risk count remains nonzero and someone tries to claim tenant isolation.

