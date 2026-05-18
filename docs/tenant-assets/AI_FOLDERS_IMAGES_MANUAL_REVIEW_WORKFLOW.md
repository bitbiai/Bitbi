# AI Folders / Images Manual Review Workflow

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current manual-review workflow baseline for folder/image ownership evidence. Historical phase detail is frozen outside this active doc.

## Current Workflow State

- Manual-review tables exist: `ai_asset_manual_review_items` and `ai_asset_manual_review_events`.
- Admin import can create review items/events only when explicitly confirmed.
- Queue read/detail/event/evidence/export endpoints exist.
- Admin status updates can move review items through approved statuses and append immutable review events.
- Admin Control Plane visibility and review-state-only status controls exist.
- These workflows update review-state rows only; they do not update `ai_folders`, `ai_images`, ownership metadata, runtime access checks, public gallery state, quota, billing, credits, or R2.

## Current Statuses

Active review statuses:

- `pending_review`
- `review_in_progress`
- `approved_personal_user_asset`
- `approved_organization_asset`
- `approved_legacy_unclassified`
- `approved_platform_admin_test_asset`
- `blocked_public_unsafe`
- `blocked_derivative_risk`
- `blocked_relationship_conflict`
- `blocked_missing_evidence`
- `needs_legal_privacy_review`
- `deferred`
- `rejected`
- `superseded`

Approved/blocked statuses are operator evidence only. They do not authorize backfill or access switching.

## Current Evidence Decision

Current manual-review operator decision: `operator_evidence_collected_needs_more_idempotency`.

Idempotency completion status: `operator_evidence_pending_manual_review_idempotency_completion`.

Known evidence exists for:

- import dry-run,
- confirmed import,
- queue/evidence export,
- one status-change rollup.

Remaining gap:

- import replay, import conflict, successful standalone status-update response, status replay, and status conflict evidence remain incomplete.

## Current Admin Endpoints

- `POST /api/admin/tenant-assets/folders-images/manual-review/import`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id/events`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence/export`
- `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status`

Write endpoints require admin authorization, production MFA where policy requires, same-origin protection, idempotency, bounded request bodies, explicit confirmation, and reason where applicable.

## Blocked Claims

- No ownership backfill readiness.
- No access-switch readiness.
- No source asset mutation approval.
- No R2 action approval.
- No tenant isolation claim.
- No production readiness claim.
