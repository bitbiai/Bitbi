# Manual Review Status Operator Evidence Template

Date/time:

Operator:

Repo commit SHA:

Deployed Auth Worker version/commit if known:

Main/live host:

Remote migration `0057_add_ai_asset_manual_review_state.sql` applied: `unknown`

## Endpoints Tested

| Endpoint | Tested | Evidence file |
| --- | --- | --- |
| `POST /api/admin/tenant-assets/folders-images/manual-review/import` dry-run |  |  |
| `POST /api/admin/tenant-assets/folders-images/manual-review/import` confirmed execution |  |  |
| `GET /api/admin/tenant-assets/folders-images/manual-review/items` |  |  |
| `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id` |  |  |
| `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id/events` |  |  |
| `GET /api/admin/tenant-assets/folders-images/manual-review/evidence` |  |  |
| `GET /api/admin/tenant-assets/folders-images/manual-review/evidence/export` |  |  |
| `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status` |  |  |
| Admin Control Plane review queue panel |  |  |

## Dry-Run Import Result

| Field | Value |
| --- | --- |
| Proposed review item count |  |
| Created count | `0` |
| Skipped count |  |
| Existing count |  |
| Dry-run wrote review rows | `no` |
| Dry-run wrote review events | `no` |
| Safety flags recorded |  |
| Evidence path |  |

## Confirmed Import Result

Complete only if the operator intentionally ran confirmed import execution.

| Field | Value |
| --- | --- |
| Confirmed import performed | `no` |
| Created review item count |  |
| Skipped count |  |
| Existing count |  |
| Created event count |  |
| Idempotency same-key/same-request behavior |  |
| Idempotency same-key/different-request behavior |  |
| Evidence path |  |

## Queue Read Result

| Field | Value |
| --- | --- |
| Total review items |  |
| Total events |  |
| Counts by status |  |
| Counts by category |  |
| Counts by severity |  |
| Counts by priority |  |
| Latest import timestamp |  |
| Latest status update timestamp |  |
| Evidence/export path |  |

## Status Update Result

Complete only if the operator intentionally ran a bounded status update.

| Field | Value |
| --- | --- |
| Status update performed | `no` |
| Review item id or redacted reference |  |
| Old status |  |
| New status |  |
| Status event created |  |
| Event type |  |
| Event timestamp |  |
| Idempotency same-key/same-request behavior |  |
| Idempotency same-key/different-request behavior |  |
| Evidence path |  |

## Admin Control Plane Evidence

| Field | Value |
| --- | --- |
| Queue panel rendered |  |
| Refresh behavior |  |
| JSON export behavior |  |
| Safe list/detail fields rendered |  |
| Event history rendered |  |
| Status controls used |  |
| No dangerous controls present |  |
| Screenshot/note path |  |

## Safety Confirmations

| Safety item | Confirmed |
| --- | --- |
| No ownership backfill |  |
| No access-check switch |  |
| No source asset row update |  |
| No ownership metadata update |  |
| No R2 listing or mutation |  |
| No provider call |  |
| No Stripe call |  |
| No Cloudflare API call |  |
| No GitHub settings mutation |  |
| No credit or billing mutation |  |
| No tenant isolation claim |  |
| Production readiness remains blocked |  |

## Decision

Decision state:

- `operator_evidence_pending`
- `operator_evidence_collected_blocked`
- `evidence_rejected_unsafe`
- `needs_more_operator_evidence`

Decision rationale:

Next recommended phase:

## Redaction Review

Confirm this evidence package contains none of the following:

- raw prompts;
- provider request/response bodies;
- private R2 keys;
- signed URLs;
- cookies/auth headers/bearer tokens/session values;
- Stripe data;
- Cloudflare tokens;
- private keys;
- raw idempotency keys;
- raw request hashes if policy avoids exposing them;
- unsafe metadata blobs.

