# Legacy Personal Media Reset Executor Design

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0059_add_data_lifecycle_completion_state.sql`.

Purpose: current design and implementation boundary for the legacy media reset executor. This document does not authorize confirmed deletion.

## Current Implemented Foundation

Migration `0058_add_legacy_media_reset_actions.sql` adds:

- `tenant_asset_media_reset_actions`
- `tenant_asset_media_reset_action_events`

Executor/action endpoints exist in repo:

- `POST /api/admin/tenant-assets/legacy-media-reset/execute`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/evidence`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/export`

The executor defaults to dry-run and is bounded to selected first-pass domains.

Confirmed execution is hard-disabled by default. `dryRun: false` fails closed unless the optional operator-controlled env gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly `true` or boolean `true`. Any missing value or other value keeps confirmed execution disabled. This gate does not approve deletion; it only prevents accidental confirmed execution before a future approved confirmation phase.

## Current Allowed First-Pass Domains

- `ai_images`
- `ai_folders`
- `ai_image_derivatives`
- `public_gallery_references`

These domains may be planned by the executor, but confirmed execution remains blocked until evidence and approval gates pass.

## Current Deferred Domains

- `ai_text_assets`
- `music_assets`
- `video_assets`
- `profile_avatars`
- `data_lifecycle_exports`
- `audit_archive`
- unknown media tables
- manual-review supersession

Deferred domains must not be touched by first-pass reset execution.

## Future Confirmed Execution Gate

A future confirmed execution phase must require:

- sanitized dry-run evidence,
- explicit operator decision to enable `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` only for that approved phase,
- admin authorization,
- production MFA,
- same-origin protection,
- `Idempotency-Key`,
- `dryRun: false`,
- `confirm: true`,
- bounded reason,
- public-content removal acknowledgement if public references are selected,
- irreversible deletion acknowledgement,
- no-credit-refund acknowledgement,
- before and after evidence exports.

The current evidence fails the gate because prior evidence contained a raw idempotency key, the raw JSON is absent from the current checkout, no sanitized replacement evidence package is accepted, and the operator's manual media cleanup superseded the old candidate counts. Use `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md` plus the post-cleanup evidence packet at `docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/` before any confirmation review.

## Current Safety Model

- No broad SQL deletion.
- No direct R2 prefix delete.
- No live R2 listing.
- No raw private R2 keys in responses/docs.
- R2 work, if ever approved, must be limited to D1-known key categories and audited counts.
- Public/gallery references must be handled deliberately before source rows.
- Images and derivatives must be handled before folders.
- Storage/quota verification must be captured after any approved execution.

## Current Blocked Claims

- No confirmed reset execution occurred.
- Confirmed execution is disabled by default; dry-run/reporting remains available.
- Repo evidence does not claim which media rows were deleted by the operator's manual cleanup; fresh read-only evidence is required.
- No ownership backfill occurred.
- No access checks changed.
- No tenant isolation or production readiness is claimed.
