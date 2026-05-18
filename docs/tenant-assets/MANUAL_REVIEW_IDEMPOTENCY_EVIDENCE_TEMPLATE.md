# Manual Review Idempotency Evidence Template

Date/time:

Operator:

Repo commit SHA:

Deployed Auth Worker reference:

Evidence package file names:

Decision status: `operator_evidence_collected_needs_more_idempotency`

Idempotency completion status: `operator_evidence_pending_manual_review_idempotency_completion`

## Scope Confirmation

| Safety item | Value |
| --- | --- |
| Ownership backfill performed | no |
| Access checks switched | no |
| Source asset rows mutated | no |
| Ownership metadata updated | no |
| Legacy media reset executed | no |
| `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` enabled | no |
| Live R2 listed or mutated | no |
| Provider calls made | no |
| Stripe calls made | no |
| Cloudflare/GitHub settings mutated | no |
| Billing/credit mutation | no |
| Tenant isolation claimed | no |
| Production readiness claimed | no |

## Import Replay Evidence

| Field | Value |
| --- | --- |
| Endpoint | `POST /api/admin/tenant-assets/folders-images/manual-review/import` |
| Same idempotency key reused with same request |  |
| Replay result code/status |  |
| Replay flag or no-duplicate indicator |  |
| Review item count before replay |  |
| Review item count after replay |  |
| Review event count before replay |  |
| Review event count after replay |  |
| Duplicate items/events created | no |
| Raw idempotency key present in evidence | no |
| Evidence file |  |

## Import Conflict Evidence

| Field | Value |
| --- | --- |
| Same idempotency key reused with different request |  |
| Conflict result code/status |  |
| Failed closed |  |
| Review item count before conflict |  |
| Review item count after conflict |  |
| Review event count before conflict |  |
| Review event count after conflict |  |
| Rows/events mutated by conflict | no |
| Raw request hash present in evidence | no |
| Evidence file |  |

## Status Update Success Evidence

| Field | Value |
| --- | --- |
| Endpoint | `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status` |
| Target item reference redacted/bounded |  |
| Old status |  |
| New status |  |
| Response success code/status |  |
| Status-change event type |  |
| Status event count before |  |
| Status event count after |  |
| Queue/item/event readback evidence file |  |
| Source asset rows mutated | no |
| Ownership metadata updated | no |
| R2 touched | no |

## Status Replay Evidence

| Field | Value |
| --- | --- |
| Same idempotency key reused with same status request |  |
| Replay result code/status |  |
| Replay flag or no-duplicate indicator |  |
| Target item status before replay |  |
| Target item status after replay |  |
| Status event count before replay |  |
| Status event count after replay |  |
| Duplicate status event created | no |
| Evidence file |  |

## Status Conflict Evidence

| Field | Value |
| --- | --- |
| Same idempotency key reused with different status request |  |
| Conflict result code/status |  |
| Failed closed |  |
| Target item status before conflict |  |
| Target item status after conflict |  |
| Status event count before conflict |  |
| Status event count after conflict |  |
| Rows/events mutated by conflict | no |
| Evidence file |  |

## Redaction Checklist

Confirm the evidence package contains none of:

- raw idempotency keys;
- raw request hashes or request fingerprints unless separately approved as safe;
- cookies, authorization headers, bearer tokens, or session values;
- signed URLs;
- private R2 keys;
- raw prompts or provider payloads;
- Stripe data;
- Cloudflare/GitHub tokens;
- private keys;
- private user data or unbounded item lists.

## Decision

- Import replay evidence accepted: yes/no
- Import conflict evidence accepted: yes/no
- Status success evidence accepted: yes/no
- Status replay evidence accepted: yes/no
- Status conflict evidence accepted: yes/no
- Queue/item/event readback accepted: yes/no
- Overall accepted for manual-review workflow only: yes/no
- If no, missing or unsafe items:

Accepted manual-review evidence does not approve ownership backfill, access-switching, tenant isolation, production readiness, live billing readiness, or confirmed legacy media reset.
