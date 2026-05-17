# AI Folders & Images Owner-Map Dry Run

Date: 2026-05-17

Current release truth: latest auth D1 migration is `0055_add_platform_budget_evidence_archives.sql`.

Phase 6.2 is dry-run only for `ai_folders` and `ai_images`. Phase 6.3 adds the schema/access impact plan in `AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md`. Neither phase adds a schema migration, rewrites D1 ownership rows, moves/deletes/copies/lists R2 objects, changes folder/image generation behavior, changes public gallery behavior, changes lifecycle/export/delete behavior, mutates credits or billing, calls providers, calls Stripe, calls Cloudflare APIs, or claims tenant isolation.

## Current Schema Summary

### `ai_folders`

- Defined by `0007_add_image_studio.sql` and `0009_add_folder_status.sql`.
- Columns: `id`, `user_id`, `name`, `slug`, `created_at`, `status`.
- Current owner field: `user_id`.
- Organization owner field: none.
- Parent folder field: none.
- Visibility/publication field: none; folders are private user containers.
- Current routes use `user_id` and `status = 'active'` for list/create/rename/delete/move checks.

### `ai_images`

- Defined by `0007_add_image_studio.sql`, `0017_add_ai_image_derivatives.sql`, `0019_add_ai_image_publication.sql`, and `0046_add_asset_storage_quota.sql`.
- Core columns: `id`, `user_id`, `folder_id`, `r2_key`, `prompt`, `model`, `steps`, `seed`, `created_at`.
- Derived/object fields: `thumb_key`, `medium_key`, mime/dimension fields, derivative status/version/timestamps, `size_bytes`.
- Publication fields: `visibility`, `published_at`.
- Organization owner field: none.
- Private routes check `id` plus `user_id`.
- Public Mempics routes select `visibility = 'public'` rows and join `profiles` by `ai_images.user_id`.

## Current Route And Access Summary

- Folder create/rename/delete: `workers/auth/src/routes/ai/folders-write.js`, guarded by the signed-in user's `session.user.id`.
- Folder listing: `workers/auth/src/routes/ai/folders-read.js`, reads folders and counts by `user_id`.
- Image save/generate/save-reference: `workers/auth/src/routes/ai/images-write.js`, persists `ai_images.user_id` and optional `folder_id`.
- Image move/delete: `workers/auth/src/routes/ai/bulk-images.js`, `bulk-assets.js`, and `lifecycle.js`, guarded by current `user_id`.
- Image file/derivative reads: `workers/auth/src/routes/ai/files-read.js`, guarded by current `user_id`.
- Public gallery: `workers/auth/src/routes/gallery.js`, reads public rows and uses user-profile publisher attribution.

`workers/auth/src/routes/media.js` is not present in the current tree; image serving evidence is in the AI file routes and public gallery route.

## Dry-Run Command

```bash
npm run dry-run:tenant-assets -- --domain folders-images
npm run dry-run:tenant-assets:images
npm run dry-run:tenant-assets -- --domain folders-images --format markdown --fixtures scripts/fixtures/tenant-assets/folders-images.json
npm run test:tenant-assets
```

Without fixtures, the focused dry run reports source/schema/rule readiness. With the synthetic fixture, it emits deterministic candidate classifications.

## Classification Rules

| Rule | Behavior |
| --- | --- |
| Strong org evidence required | Classify `organization_asset` only when explicit organization owner evidence exists in approved owner-map/fixture data. |
| Weak org context rejected | Ignore active organization UI/localStorage/selected organization hints for ownership. |
| User-only current model | Classify user-only rows as `personal_user_asset` with medium confidence, not as migration-complete. |
| Admin/test explicit | Classify `platform_admin_test_asset` only with explicit admin/test source evidence. |
| Folder/image conflict | Classify image/folder user mismatch as `ambiguous_owner`; if public, `unsafe_to_migrate`. |
| Missing folder | Classify an image pointing at a missing folder as `orphan_reference`. |
| Public ambiguous block | Mark public ambiguous images unsafe until attribution policy is reviewed. |
| Derivative parent clarity | Flag thumb/medium derivative ownership risk unless parent ownership confidence is high. |

## Output Fields

Each candidate includes:

- source table and safe fixture id
- current `user_id`
- current `folder_id`
- inferred owner class
- inferred organization id only when strong evidence exists
- confidence: `high`, `medium`, `low`, or `none`
- ambiguity reasons
- required future migration action
- blocked reason when unsafe
- sanitized R2 key field classes, not live object listings
- derivative ownership risk
- public gallery risk
- lifecycle/export/delete risk
- storage quota risk

## Confidence Model

- `high`: explicit organization owner evidence or equivalent approved owner-map signal.
- `medium`: current `user_id` is the only owner signal, or explicit admin/test source evidence exists.
- `low`: reserved for later local/staging evidence that is useful but incomplete.
- `none`: missing folder, user conflict, unsafe public ambiguity, or no safe owner evidence.

## Phase 6.2 Fixture Coverage

The synthetic fixture covers:

- personal folder/image
- organization folder/image with strong owner-map evidence
- weak UI organization evidence that must not become org ownership
- folder/image user conflict
- missing folder reference
- public ambiguous image marked unsafe
- derivative key with non-high-confidence parent ownership
- admin/test image source classification

## Migration Blockers

- No `asset_owner_type`, `owning_user_id`, `owning_organization_id`, or `created_by_user_id` columns exist on `ai_folders` or `ai_images`.
- R2 keys encode legacy user paths but do not prove tenant ownership.
- Public gallery attribution is user/profile-only.
- Data lifecycle/export/delete is user-subject-only.
- Storage quota is `user_asset_storage_usage` only.
- Real row ambiguity rates are unknown until a local/staging owner-map report is approved.

## Phase 6.3 Schema/Access Plan

Phase 6.3 turns this owner-map dry run into `docs/tenant-assets/AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md`.

- Proposed future columns use `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, `ownership_status`, `ownership_source`, `ownership_confidence`, `ownership_metadata_json`, and `ownership_assigned_at`.
- Existing `user_id` checks should remain in place until a future phase explicitly implements role-aware organization access checks.
- No migration, backfill, runtime access change, R2 movement, quota change, lifecycle change, or public gallery change was added.

## Recommended Phase 6.4

Phase 6.4 should be **Additive Ownership Metadata Schema for AI Folders & Images**:

- add the ownership metadata migration only
- keep existing writes and reads compatible
- do not backfill ownership
- do not change runtime access behavior
- add schema/currentness tests for the future migration
