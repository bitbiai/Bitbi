# Asset Ownership Inventory

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0059_add_data_lifecycle_completion_state.sql`.

Purpose: current ownership inventory for audit restart. Historical phase detail is frozen outside this file.

Machine-checkable current-state registry: `workers/auth/src/lib/tenant-asset-domain-registry.js`.

Admin read-only report: `GET /api/admin/tenant-assets/domains/evidence` (admin/MFA, bounded D1 metadata, no R2 listing/mutation, no backfill, no access switch, no reset/delete approval).

## Current Domain Inventory

| Domain | Current owner signal | Current target state | Current status |
| --- | --- | --- | --- |
| Generated images (`ai_images`) | `user_id`, `folder_id`, nullable ownership metadata | Personal or organization asset with creator evidence | New personal saves write metadata; old rows unresolved. |
| Folders (`ai_folders`) | `user_id`, `status`, nullable ownership metadata | Owner-bound folder container | New personal folders write metadata; old rows unresolved. |
| Image derivatives | Parent image row plus `thumb_key`/`medium_key` | Inherit parent owner | D1-known references only; no live R2 listing. |
| Public gallery references | `visibility='public'` plus user/profile attribution | Explicit publisher model | User/profile based; public reset needs deliberate review. |
| Text/audio/video assets (`ai_text_assets`) | `user_id`, `source_module`, R2/poster fields | Future owner classification | Deferred from first reset executor. |
| Async video jobs (`ai_video_jobs`) | `user_id`, `scope` | Personal, org, or platform-admin class | Deferred from first reset executor. |
| Profiles/avatars | `profiles.user_id`, `PRIVATE_MEDIA` avatar key | Personal or future org publisher asset | Deferred. |
| Private/public media routes | D1 parent lookup or route-specific subject | Route-specific owner evidence | Deferred; R2 keys are not proof. |
| Favorites | `user_id`, public item reference | Reference record with target owner evidence if needed | Deferred. |
| Storage quota | `user_asset_storage_usage.user_id` | User/org quota model or verified recompute | User-centered. |
| Lifecycle/export/delete | `subject_user_id`, planned item rows | User/org subject model | User-centered; org subject deferred. |
| Audit archives | audit/lifecycle/platform scope | Audit archive asset | Not customer media reset domain. |
| R2 object families (`USER_IMAGES`, `PRIVATE_MEDIA`, `AUDIT_ARCHIVE`) | D1 parent rows or archive metadata | Redacted key-family evidence only | Never tenant ownership proof by key shape alone. |

See `docs/tenant-assets/TENANT_ASSET_DOMAIN_EXPANSION_ROADMAP.md` for deferred-domain migration/evidence requirements.

## Post-Cleanup Evidence Status

The operator manually deleted most old images and videos after the prior owner-map, reset, and manual-review evidence was captured. Those earlier counts are now historical retained evidence only and must not be used as active current truth for Backfill, Access-Switch, Reset, or manual-review decisions.

Current rebaseline decision: `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md`.

Current pending evidence packet: `docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/`.

Decision matrix: `docs/tenant-assets/POST_CLEANUP_TENANT_ISOLATION_DECISION_MATRIX.md`.

Status: `post_cleanup_evidence_pending` until fresh authenticated read-only/admin evidence exports are collected and reviewed.

## Superseded Folder/Image Evidence Counts

The committed pre-cleanup main owner-map summary recorded:

- Folders scanned: 16
- Images scanned: 63
- Metadata missing total: 75
- Public unsafe: 21
- Derivative risk: 63
- Simulated dual-read unsafe: 42
- Manual review needed: 90
- Metadata conflicts: 0
- Relationship conflicts: 0
- Orphan folder references: 0
- Organization-owned rows: 0

These counts are retained historical evidence for manual-review traceability only. They are superseded by the manual media cleanup and are not approval for backfill, access switching, reset, deletion, or tenant-isolation claims.

## Superseded Reset Dry-run Evidence

The legacy media reset dry-run decision records historical summary counts for selected first-pass domains, but the prior raw evidence is absent from the current checkout and remains rejected unsafe because it exposed a raw idempotency key. No sanitized replacement evidence is accepted, so the confirmation gate remains closed.

Pre-cleanup dry-run summary from the evidence decision:

- Proposed source row retire count: 53
- Proposed image retire count: 50
- Proposed folder retire count: 3
- Public reference retire count: 17
- Derivative reference retire count: 100
- R2 key-type counts: original 50, thumb 50, medium 50
- Deferred records include video, music, and text assets.

These reset counts are stale after manual media cleanup and must be recomputed through current read-only/status/evidence exports before any confirmation review.

## Current Boundaries

- Do not infer organization ownership from UI active organization context, folder membership, or R2 key shape alone.
- Do not use R2 keys as a tenant-isolation proof.
- Do not backfill or rewrite ownership metadata without a separately approved plan.
- Do not switch runtime reads to ownership metadata yet.
- Do not claim old media was deleted or reset from repo docs alone; require fresh operator evidence.
