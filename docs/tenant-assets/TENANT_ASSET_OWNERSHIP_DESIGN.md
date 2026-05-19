# Tenant Asset Ownership Design

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

Purpose: current tenant asset ownership design baseline. Historical phase detail is preserved in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` and tenant evidence docs.

## Current State

- Organizations, memberships, organization credits, and org-scoped generation attempts exist.
- Durable saved media is still largely user-centered.
- `ai_folders` and `ai_images` have nullable ownership metadata columns from `0056_add_ai_folder_image_ownership_metadata.sql`.
- New personal folder/image writes assign high-confidence personal ownership metadata.
- Existing legacy rows may still be null, mixed, ambiguous, or unsafe; do not assume tenant isolation.
- Runtime folder/image access checks have not switched to ownership metadata.
- Global ownership backfill readiness remains blocked; only the new Admin high-risk executor may write locally classified safe folder/image rows after dry-run/evidence review and exact confirmation.

## Current Owner Model

Target owner concepts remain:

| Field/concept | Purpose |
| --- | --- |
| `asset_owner_type` | Personal, organization, platform/admin, legacy, external, or audit owner class. |
| `owning_user_id` | Personal owner. |
| `owning_organization_id` | Organization/tenant owner. |
| `created_by_user_id` | Actor who created/imported the asset. |
| `ownership_status` | Current, legacy, ambiguous, unsafe, or pending review. |
| `ownership_source` | Evidence source for assignment. |
| `ownership_confidence` | Confidence level for the ownership decision. |

Existing `user_id` remains compatibility/access evidence, not sufficient proof of future tenant ownership by itself.

## Current Implemented Tables And Workflows

- `ai_folders` and `ai_images`: nullable ownership metadata exists; new personal writes populate it.
- `ai_asset_manual_review_items` and `ai_asset_manual_review_events`: manual-review state exists from migration `0057_add_ai_asset_manual_review_state.sql`.
- Manual-review admin workflows exist for import, queue reads, item detail, event history, evidence export, status updates, and Admin Control Plane visibility.
- `tenant_asset_media_reset_actions` and `tenant_asset_media_reset_action_events`: reset action tracking exists from migration `0058_add_legacy_media_reset_actions.sql`.
- Legacy media reset dry-run/reporting and a dry-run-default executor path exist for first-pass folders/images/derivatives/public references.
- Admin Tenant Isolation Execution controls now expose three warning-gated stages: Ownership Backfill, Runtime Access-Switch, and Legacy Media Reset. Each stage has a visible warning/exclamation explainer, dry-run or shadow diagnostics, evidence export, explicit disabled reasons, and exact confirmation requirements.

## Current Evidence State

- Prior main folder/image owner-map evidence, manual-review operator evidence, and legacy reset dry-run counts are now classified as stale/superseded by the operator's manual media cleanup. They remain historical evidence only.
- Current post-cleanup decision file: `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md`.
- Current post-cleanup evidence packet path: `docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/`.
- Current status: `post_cleanup_evidence_pending` until fresh authenticated read-only/admin exports are collected and reviewed.
- Manual-review operator evidence still has idempotency gaps and must be refreshed against current post-cleanup state before it is used for backfill/access/reset decisions.
- Legacy media reset dry-run evidence remains rejected unsafe because prior live evidence exposed a raw idempotency key, the raw JSON is absent from the current checkout, no sanitized replacement evidence is accepted, and the old counts are stale after cleanup.
- Confirmed reset/deletion is not approved.
- Ownership Backfill dry-run/evidence can classify `ai_folders` and `ai_images` into safe, blocked, manual-review, deferred, already-owned, and legacy-unclassified categories. Non-dry-run backfill remains high-risk and must use Admin/MFA, `Idempotency-Key`, reason, explicit supported domain scope, bounded batch limits, and exact typed confirmation `BACKFILL OWNERSHIP`.
- Access-Switch status and shadow diagnostics are read-only. Runtime enforcement remains blocked until durable switch state, shadow evidence, rollback criteria, and operator approval exist.

## Current Non-Goals And Blocked Claims

- No ungated ownership backfill is approved.
- No access-check switch or enforced Access-Switch mode is approved.
- No existing source asset ownership metadata rewrite is approved.
- No organization ownership claim is approved for old rows.
- No confirmed legacy media reset/deletion is approved.
- No live R2 listing/move/delete is approved.
- No tenant isolation or production readiness is claimed.

## Current Risk Areas

- Public gallery attribution remains user/profile based.
- Derivative/poster/thumb objects inherit ownership from parent rows and must not be inferred from R2 keys alone.
- Video, music, text assets, profile avatars, lifecycle exports, audit archives, and unknown media tables remain outside the first reset executor domain.
- Lifecycle/export/delete remains user-subject centered for current product behavior.
- Storage quota accounting remains user-centered.

## Current Commands

```bash
npm run dry-run:tenant-assets
npm run dry-run:tenant-assets:images
npm run test:tenant-assets
```

These commands are local/source/fixture checks. They do not call live endpoints, deploy, mutate production D1/R2, run live backfills, or switch live access checks. Admin evidence exports and dry-runs are operator aids only.

## Next Audit Starting Point

Use `docs/audits/NEXT_AUDIT_BASELINE.md`, then review:

- `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md`
- `docs/tenant-assets/POST_CLEANUP_TENANT_ISOLATION_DECISION_MATRIX.md`
- `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md`
- `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`
- `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md`
