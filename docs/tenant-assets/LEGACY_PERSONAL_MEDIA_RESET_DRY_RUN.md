# Legacy Personal Media Reset Dry Run

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

Purpose: current dry-run/reporting baseline for evaluating whether retiring old personal/admin-created media is safer than ownership backfill. This document does not authorize deletion.

## Current Runtime State

Read-only reset dry-run/reporting endpoints exist:

- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run`
- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run/export`

The report inventories D1-known folders/images/public references/derivatives and conservative coverage for other media domains. It does not list live R2, mutate D1, update review rows, delete media, backfill ownership, or switch access checks.

## Current Executor State

Action tracking and a dry-run-default executor path exist:

- `POST /api/admin/tenant-assets/legacy-media-reset/execute`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/evidence`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/export`

Confirmed execution remains blocked by current evidence status and requires a separate approved phase.

## Current Domain Coverage

First-pass domains:

- `ai_images`
- `ai_folders`
- `ai_image_derivatives`
- `public_gallery_references`

Deferred domains:

- video assets/jobs,
- music/audio assets,
- text assets,
- profile avatars,
- data lifecycle exports,
- audit archives,
- unknown media tables,
- manual-review supersession.

## Current Evidence Decision

The reset dry-run decision references prior live/main evidence at `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`. The raw JSON is not present in the current checkout, no sanitized replacement is present, and the decision remains rejected unsafe because the evidence exposed a raw idempotency key.

Current decision: `legacy_media_reset_dry_run_rejected_unsafe`.

Sanitized evidence status: `pending_sanitized_evidence_required`.

Operator template: `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md`.

The dry-run topic is not closed, and the confirmation gate remains closed.

## Post-Cleanup Rebaseline

The operator manually deleted most old images and videos after the prior dry-run evidence was captured. The previous reset candidate counts are now stale/superseded by manual media cleanup and are retained as historical evidence only.

Current status: `post_cleanup_evidence_pending`.

Current rebaseline packet: `docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/`.

Before any future confirmation review, collect fresh authenticated read-only/status/evidence exports for legacy media reset. Do not use the old candidate counts as current reset scope.

## Current Safety Rules

- No confirmed deletion/reset is approved.
- No public/gallery depublish/delete is approved.
- No source asset rows are approved for mutation.
- No ownership metadata update or backfill is approved.
- No live R2 listing/deletion is approved.
- No billing/credit mutation or refund behavior is approved.
- No tenant isolation or production readiness is claimed.
