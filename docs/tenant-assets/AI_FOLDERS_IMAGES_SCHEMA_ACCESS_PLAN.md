# AI Folders / Images Schema And Access Plan

Date: 2026-05-18

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

Purpose: current schema/access baseline for `ai_folders` and `ai_images`. Historical implementation steps are frozen elsewhere.

## Current Schema State

Migration `0056_add_ai_folder_image_ownership_metadata.sql` adds nullable ownership metadata columns to:

- `ai_folders`
- `ai_images`

Current metadata fields:

- `asset_owner_type`
- `owning_user_id`
- `owning_organization_id`
- `created_by_user_id`
- `ownership_status`
- `ownership_source`
- `ownership_confidence`
- `ownership_metadata_json`
- `ownership_assigned_at`

New personal folder/image writes assign high-confidence personal ownership metadata. Existing rows are not backfilled by default.

## Current Runtime Access State

- Folder/image runtime access checks remain based on existing user-scoped behavior.
- Public gallery behavior is unchanged.
- Media serving behavior is unchanged.
- Lifecycle/export/delete behavior is unchanged.
- Storage quota accounting is unchanged.
- Reads have not switched to ownership metadata.

## Current Admin Evidence Endpoints

- `GET /api/admin/tenant-assets/folders-images/evidence`
- `GET /api/admin/tenant-assets/folders-images/evidence/export`

These endpoints are bounded admin evidence tools. They do not authorize backfill, switch reads, mutate rows, or list/mutate R2.

## Current Manual Review Endpoints

- `POST /api/admin/tenant-assets/folders-images/manual-review/import`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id/events`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence/export`
- `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status`

Manual-review writes are limited to review-state rows/events. They do not update source asset rows or ownership metadata.

## Current Reset Endpoints

- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run`
- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run/export`
- `POST /api/admin/tenant-assets/legacy-media-reset/execute`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/evidence`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/export`

The executor defaults to dry-run. Confirmed execution remains blocked by current evidence status and requires a separate approved phase.

## Current Access-Switch Requirements

Access-switch planning remains blocked until:

1. Legacy row ownership evidence is complete and safe.
2. Manual-review idempotency gaps are resolved.
3. Public/gallery attribution and derivative/R2 behavior are reviewed.
4. Backfill or reset decisions are separately approved.
5. Tests prove old and new access decisions are safe.

## Blocked Claims

- No ownership backfill readiness.
- No access-switch readiness.
- No tenant isolation claim.
- No confirmed media reset readiness.
- No production readiness claim.
