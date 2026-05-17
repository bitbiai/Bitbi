# AI Folders & Images Owner-Map Dry Run

Date: 2026-05-17

Current release truth: latest auth D1 migration is `0056_add_ai_folder_image_ownership_metadata.sql`.

Phase 6.2 is dry-run only for `ai_folders` and `ai_images`. Phase 6.3 adds the schema/access impact plan in `AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md`. Phase 6.4 adds nullable ownership metadata columns and schema compatibility checks. Phase 6.5 assigns those columns only for new personal folder/image writes. Phase 6.6 adds read-only ownership metadata diagnostics and simulated dual-read safety checks to the same dry-run output. Phase 6.7 adds an admin-only bounded evidence report/export over those diagnostics. Phase 6.8 adds the runbook/template/checklist for collecting operator evidence from those endpoints. Phase 6.9 adds the main-only evidence package directory. Phase 6.10 reviews the real main evidence summary and records `needs_manual_review`; access-check switching and ownership backfill remain blocked. Phase 6.11 adds manual-review workflow design and a local planner for those high-risk findings. These phases do not backfill ownership, move/delete/copy/list R2 objects, change folder/image access checks, change public gallery behavior, change lifecycle/export/delete behavior, mutate credits or billing, call providers, call Stripe, call Cloudflare APIs, or claim tenant isolation.

## Current Schema Summary

### `ai_folders`

- Defined by `0007_add_image_studio.sql` and `0009_add_folder_status.sql`.
- Core columns: `id`, `user_id`, `name`, `slug`, `created_at`, `status`.
- Phase 6.4 nullable metadata columns: `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, `ownership_status`, `ownership_source`, `ownership_confidence`, `ownership_metadata_json`, `ownership_assigned_at`.
- Current owner field: `user_id`.
- Active organization owner assignment: none yet; `owning_organization_id` exists but is not backfilled or assigned by current folder writes. New folder writes are marked personal with high-confidence write-path metadata.
- Parent folder field: none.
- Visibility/publication field: none; folders are private user containers.
- Current routes use `user_id` and `status = 'active'` for list/create/rename/delete/move checks.

### `ai_images`

- Defined by `0007_add_image_studio.sql`, `0017_add_ai_image_derivatives.sql`, `0019_add_ai_image_publication.sql`, and `0046_add_asset_storage_quota.sql`.
- Core columns: `id`, `user_id`, `folder_id`, `r2_key`, `prompt`, `model`, `steps`, `seed`, `created_at`.
- Derived/object fields: `thumb_key`, `medium_key`, mime/dimension fields, derivative status/version/timestamps, `size_bytes`.
- Publication fields: `visibility`, `published_at`.
- Active organization owner assignment: none yet; `owning_organization_id` exists but is not backfilled or assigned by the saved-image write path. New saved-image rows are marked personal with high-confidence write-path metadata.
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
- `low`: reserved for later local/main evidence that is useful but incomplete.
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

## Current Schema Foundation

- Phase 6.4 migration `0056_add_ai_folder_image_ownership_metadata.sql` adds nullable `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, `ownership_status`, `ownership_source`, `ownership_confidence`, `ownership_metadata_json`, and `ownership_assigned_at` columns on `ai_folders` and `ai_images`.
- The focused dry-run now reports `schema_added_not_backfilled`, `write_paths_assigned_for_new_rows`, `access_checks_not_changed`, `backfill_not_started`, and `owner_map_not_complete`.
- Existing rows are not backfilled and current route access still uses existing `user_id` checks.

## Phase 6.5 Write-Path Assignment

- New `POST /api/ai/folders` rows are assigned `personal_user_asset` ownership metadata from the authenticated user.
- New `POST /api/ai/images/save` rows are assigned `personal_user_asset` ownership metadata from the authenticated user.
- Weak client organization hints are ignored; organization-owned saved-image/folder assignment requires a future server-verified org-scoped write path.
- No existing rows are updated, no R2 keys are listed/moved/deleted, and gallery/media/lifecycle/quota behavior is unchanged.

## Phase 6.6 Read Diagnostics

The focused dry run now embeds `readDiagnostics` from `workers/auth/src/lib/tenant-asset-read-diagnostics.js`.

- Safe personal rows with matching `user_id` and `owning_user_id` classify as `same_allow`.
- Old/null rows classify as `metadata_missing` and remain supported by legacy `user_id` access.
- `user_id` / `owning_user_id` mismatches classify as `metadata_conflict`.
- Missing folders classify as `orphan_reference`; folder/image owner mismatches classify as `relationship_conflict`.
- Public rows with missing, ambiguous, or conflicting metadata classify as `unsafe_to_switch`.
- Organization and platform-admin-test rows classify as `needs_manual_review` until role-aware policies exist.
- Derivative keys inherit parent ownership only in target design; diagnostics flag derivative risk when parent ownership is missing or conflicted.
- Diagnostics never authorize requests, backfill rows, list R2, or change runtime access checks.

## Phase 6.7 Admin Evidence Report

The focused dry run now reports the admin evidence surface as ready:

- Evidence endpoint: `GET /api/admin/tenant-assets/folders-images/evidence`.
- Export endpoint: `GET /api/admin/tenant-assets/folders-images/evidence/export`.
- Export formats: JSON and Markdown.
- Evidence is bounded, local-D1-only, sanitized, and read-only.
- Manual-review rollups surface unsafe-to-switch, metadata-conflict, relationship-conflict, public-unsafe, and derivative-risk signals.

The admin report does not apply backfills, switch access checks, update rows, list R2, expose prompts/private R2 keys, call providers, call Stripe, mutate credits, or claim tenant isolation.

## Phase 6.8 Evidence Collection

Phase 6.8 adds operator evidence collection docs only:

- `TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md`
- `TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md`
- `TENANT_ASSET_OWNERSHIP_MAIN_ONLY_CHECKLIST.md`

The docs tell operators how to collect bounded live/main evidence from the Phase 6.7 report/export endpoints, interpret high-risk counts, and record explicit no-mutation statements. They add no endpoint, UI, migration, access switch, backfill, D1/R2 mutation, R2 listing, provider call, Stripe call, or tenant-isolation claim.

## Phase 6.9 Main Evidence Package

Phase 6.9 adds main-only evidence packaging:

- `docs/tenant-assets/evidence/README.md`
- `docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md`
- `scripts/summarize-tenant-asset-evidence.mjs`

No real operator-exported main evidence was present in the repository when Phase 6.9 was prepared. The summarizer reads a local operator-provided JSON export and emits a bounded Markdown summary only; it does not call live endpoints or mutate D1/R2.

## Phase 6.10 Evidence Decision

Phase 6.10 adds `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md`.

The decision reviews `docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md` and records `needs_manual_review`. The summary reports 75 metadata-missing rows, 21 public unsafe rows, 63 derivative ownership risks, 42 simulated dual-read unsafe rows, and 90 manual-review rows. Synthetic fixtures are not evidence. Access-check switching and backfill remain blocked, and no runtime route, D1/R2, R2 listing, provider, Stripe, Cloudflare, credit, billing, lifecycle, quota, gallery, or media behavior changed.

## Phase 6.11 Manual Review Workflow

Phase 6.11 adds `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md`, `docs/tenant-assets/evidence/2026-05-17-main-folders-images-manual-review-plan.md`, and `npm run tenant-assets:plan-manual-review`.

The workflow turns the Phase 6.10 high-risk counts into design-only review categories: metadata missing, public unsafe, derivative risk, dual-read unsafe, manual review needed, relationship review, legacy unclassified, future org ownership review, platform admin test review, and safe observe only. It does not execute review outcomes, update rows, emit backfill SQL, switch access checks, list/mutate R2, or claim tenant isolation.

## Remaining Migration Blockers

- Existing pre-Phase-6.5 rows remain null/unclassified until a future owner-map/backfill phase.
- Organization-scoped saved-image/folder ownership assignment is not implemented because the current write paths do not provide reliable server-verified org ownership evidence.
- R2 keys encode legacy user paths but do not prove tenant ownership.
- Public gallery attribution is user/profile-only.
- Data lifecycle/export/delete is user-subject-only.
- Storage quota is `user_asset_storage_usage` only.
- Real main evidence now shows nonzero high-risk counts; manual review is required before any access-check switch, old-row backfill, or tenant-isolation claim.

## Phase 6.3 Schema/Access Plan

Phase 6.3 turns this owner-map dry run into `docs/tenant-assets/AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md`.

- Proposed future columns use `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, `ownership_status`, `ownership_source`, `ownership_confidence`, `ownership_metadata_json`, and `ownership_assigned_at`.
- Existing `user_id` checks should remain in place until a future phase explicitly implements role-aware organization access checks.
- Phase 6.5 adds new-write personal metadata assignment only; no backfill, runtime access change, R2 movement, quota change, lifecycle change, or public gallery change was added.

## Recommended Phase 6.12

Phase 6.12 should be **Manual Review State Schema Design for AI Folders & Images**. It should decide whether an additive review-state table is needed for operator review records while still avoiding access-check switching, old-row ownership backfill, repair execution, and R2 mutation.
