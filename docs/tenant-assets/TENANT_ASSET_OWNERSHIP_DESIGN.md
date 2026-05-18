# Tenant Asset Ownership Design

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current tenant asset ownership design baseline. Historical phase detail is preserved in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` and tenant evidence docs.

## Current State

- Organizations, memberships, organization credits, and org-scoped generation attempts exist.
- Durable saved media is still largely user-centered.
- `ai_folders` and `ai_images` have nullable ownership metadata columns from `0056_add_ai_folder_image_ownership_metadata.sql`.
- New personal folder/image writes assign high-confidence personal ownership metadata.
- Existing legacy rows may still be null, mixed, ambiguous, or unsafe; do not assume tenant isolation.
- Runtime folder/image access checks have not switched to ownership metadata.
- Ownership backfill remains blocked.

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

## Current Evidence State

- Main folder/image owner-map evidence exists and requires manual review.
- Manual-review operator evidence exists with decision `operator_evidence_collected_needs_more_idempotency`.
- Legacy media reset dry-run evidence exists but is rejected unsafe because the committed live evidence contains a raw idempotency key.
- Confirmed reset/deletion is not approved.

## Current Non-Goals And Blocked Claims

- No ownership backfill is approved.
- No access-check switch is approved.
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

These commands are local/source/fixture checks. They do not call live endpoints, deploy, mutate D1/R2, run backfills, or switch access checks.

## Next Audit Starting Point

Use `docs/audits/NEXT_AUDIT_BASELINE.md`, then review:

- `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md`
- `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`
- `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md`
