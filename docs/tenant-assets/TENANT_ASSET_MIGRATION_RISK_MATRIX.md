# Tenant Asset Migration Risk Matrix

Date: 2026-05-17

Current release truth: latest auth D1 migration is `0056_add_ai_folder_image_ownership_metadata.sql`.

Phase 6.1 adds risk evidence only. Phase 6.2 adds a focused owner-map dry run for `ai_folders` and `ai_images`. Phase 6.3 adds the schema/access impact plan. Phase 6.4 adds nullable ownership metadata columns for those two tables only. Phase 6.5 assigns metadata only for new personal folder/image writes. Phase 6.6 adds read-only simulated dual-read diagnostics. Phase 6.7 exposes those diagnostics through a bounded admin evidence report/export. Phase 6.8 adds the operator evidence runbook/template/checklist for collecting that report on main/live. Phase 6.9 adds a main-only evidence package directory and pending marker because no real operator export was present in-repo. These phases do not backfill ownership, assign organization ownership, move/list/delete R2 objects, call providers, call Stripe, mutate Cloudflare, change access checks, change generation/gallery/lifecycle/quota behavior, or claim full tenant isolation.

| Risk | Severity | Evidence source | Affected tables/routes | Proposed mitigation | Safe dry-run signal | Future phase |
| --- | --- | --- | --- | --- | --- | --- |
| Ownership ambiguity | High | `ai_images.user_id`, `ai_text_assets.user_id`, `ai_folders.user_id` remain the active access owner signal. Phase 6.2 fixture dry-run shows user-only rows are only medium-confidence personal candidates. Phase 6.5 assigns high-confidence personal owner metadata only for new folder/image writes; Phase 6.6 flags old/null and conflicting rows; Phase 6.7 surfaces bounded admin evidence without changing access; Phase 6.9 records main evidence as pending in-repo. | `ai_images`, `ai_text_assets`, `ai_folders`, private asset routes. | Prove owner-map before backfill and keep read diagnostics clean before access changes. | Count rows lacking target owner classification and simulated dual-read conflicts. | 6.10 main evidence review |
| Org-billed asset stored as user-owned | High | Org-scoped generation attempts and credit ledgers exist separately from saved asset rows. Phase 6.5 ignores weak client org hints and does not create org-owned saved images without server-verified evidence. | `ai_usage_attempts`, `usage_events`, `ai_images`, `ai_text_assets`. | Link future saved assets to owning org only from server-verified org context, or mark personal explicitly. | Compare org attempt/usage rows to saved asset creation evidence where available. | Future org write-path phase |
| Public asset attribution is user-only | High | Public routes join `profiles` by asset `user_id`. | `/api/gallery/mempics`, `/api/gallery/memvids`, `/api/gallery/memtracks`. | Add publisher owner class and organization publisher policy. | List public rows with no organization attribution field. | 6.6 |
| R2 key orphan/owner mismatch | High | R2 keys encode user ids but D1 is source of truth. | `USER_IMAGES`, `PRIVATE_MEDIA`, lifecycle cleanup. | Build bounded owner-map and orphan report before any object action. | Report key patterns and missing D1/R2 reconciliation status. | 6.8 |
| Derivative/poster mismatch | High | Derivative/poster keys are separate R2 objects and owner is inferred; Phase 6.5 records derivative inheritance in new saved-image metadata but does not move or rewrite objects. | `thumb_key`, `medium_key`, `poster_r2_key`, video job poster keys. | Store or derive explicit parent owner evidence. | Count parent rows with derivative/poster fields by owner class. | 6.6/6.8 |
| Folder ownership mismatch | High | Folders are user-owned and can contain multiple asset types; Phase 6.5 marks new personal folders only and does not reclassify old folders or allow org-owned folders. | `ai_folders`, move/delete lifecycle. | Make folders owner-bound before moving org assets into them. | Identify folders with mixed future owner candidates. | 6.6 diagnostics |
| Lifecycle/export/delete mismatch | High | Lifecycle is centered on `subject_user_id`. | `data_lifecycle_requests`, `data_lifecycle_request_items`, `data_export_archives`. | Add organization subject design before tenant-owned asset claims. | Report lack of `subject_organization_id` path. | 6.7 |
| Quota/accounting mismatch | High | `user_asset_storage_usage` is per-user only. Phase 6.5 does not change quota accounting. | `user_asset_storage_usage`, `asset-storage-quota.js`. | Add owner-aware quota model or recompute by owner class. | Compare source asset bytes to user-only quota rows. | 6.7 |
| Admin test asset classification | Medium | Admin video jobs and admin-saved lab outputs can use user ids. | `ai_video_jobs`, `ai_text_assets`, admin AI routes. | Add `platform_admin_test_asset` class and exclude from customer ownership. | List admin scope rows and admin-created sources. | 6.4 |
| Legacy asset classification | High | Older rows lack org context and may predate current flows. | All saved media tables. | Preserve as `legacy_unclassified_asset` until proof exists. | Count rows with no deterministic owner-map candidate. | 6.3 |
| Favorites/share references | Medium | Favorites store `item_type`, `item_id`, `thumb_url` only. | `favorites`, public gallery references. | Record referenced owner class only if needed for tenant export/delete. | List favorite types that point to public generated assets. | 6.6 |
| Irreversible deletion risk | Critical | Cleanup helpers can delete approved prefixes; broad owner-map is not proven. | `r2_cleanup_queue`, lifecycle cleanup, export cleanup. | Keep destructive cleanup blocked until owner-map proof and explicit approval. | Verify dry-run emits no delete/move/backfill commands. | 6.10 |

## Highest-Risk Current Gaps

1. **No durable organization owner on saved assets.** This blocks full tenant isolation even where org-scoped generation and billing evidence exists.
2. **Public attribution is user/profile-only.** Organization-published assets need an explicit product and privacy policy.
3. **Lifecycle planning is user-subject only.** Organization-owned export/delete cannot be promised.
4. **R2 keys are not enough.** `users/{userId}/...` paths are legacy owner hints, not tenant ownership proof.
5. **Quota is user-only.** Organization storage limits and accounting need a separate model.

## Phase 6.2 Result

Phase 6.2 implements the `ai_folders` and `ai_images` owner-map dry-run as source/fixture evidence only:

- schema write deferred to later Phase 6.4
- no R2 list/move/delete
- no generation behavior change
- no runtime access-check or public gallery change
- synthetic fixtures classify personal, strong-org, weak-org-rejected, admin-test, ambiguous, orphan, public-unsafe, and derivative-risk examples
- Phase 6.3 followed with schema/access-check impact planning, not broad backfill

## Phase 6.3 Result

Phase 6.3 adds `AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md` and dry-run schema/access readiness output:

- proposed additive ownership metadata for `ai_folders` and `ai_images`
- migration deferred to Phase 6.4
- no ownership row rewrite
- no runtime access-check, public gallery, lifecycle, quota, or R2 behavior change
- next phase should add schema only, with no backfill

## Phase 6.4 Result

Phase 6.4 adds migration `0056_add_ai_folder_image_ownership_metadata.sql` and helper constants:

- nullable ownership metadata columns on `ai_folders` and `ai_images`
- simple owner/status indexes for future lookup/review
- no backfill or ownership row rewrite
- no runtime access-check, public gallery, lifecycle, quota, R2, generation, or billing behavior change
- next phase should assign ownership metadata on new writes only

## Phase 6.5 Result

Phase 6.5 updates only new folder/image write paths:

- new personal `ai_folders` rows receive high-confidence `personal_user_asset` metadata
- new personal `ai_images` saves receive high-confidence `personal_user_asset` metadata
- client-supplied organization hints are ignored for ownership assignment
- existing rows remain null/unclassified; no backfill or ownership rewrite occurred
- access checks, public gallery behavior, lifecycle/export/delete, quota accounting, billing/credits, and R2 keys remain unchanged
- Phase 6.6 adds read-only ownership metadata diagnostics before any access switch or backfill

## Phase 6.6 Result

Phase 6.6 adds diagnostics only:

- simulated dual-read classes for folders/images: `same_allow`, `metadata_missing`, `metadata_conflict`, `relationship_conflict`, `orphan_reference`, `unsafe_to_switch`, and `needs_manual_review`
- public missing/conflicting rows remain unsafe for ownership-based access
- organization-owned and platform-admin-test fixture rows remain manual-review items because role-aware policies are not implemented
- derivative keys are not listed in R2 and inherit parent ownership only as target design evidence
- no access checks, ownership rows, R2 objects, quota, lifecycle, gallery, billing, credits, or provider behavior changed

## Phase 6.7 Result

Phase 6.7 adds admin evidence only:

- `GET /api/admin/tenant-assets/folders-images/evidence` returns bounded local-D1 ownership diagnostics for operators
- `GET /api/admin/tenant-assets/folders-images/evidence/export` supports sanitized JSON and Markdown exports
- report rollups surface metadata-missing rows, unsafe-to-switch rows, relationship conflicts, public-gallery risk, derivative risk, and manual-review counts
- reports do not backfill ownership, update rows, authorize requests, list R2, expose prompts/private R2 keys, change access checks, or claim tenant isolation

## Phase 6.8 Result

Phase 6.8 adds evidence collection guidance only:

- `TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md` defines operator steps for the Phase 6.7 endpoints
- `TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md` records summary counts, sanitization checks, and explicit no-mutation confirmations
- `TENANT_ASSET_OWNERSHIP_MAIN_ONLY_CHECKLIST.md` covers main-only collection discipline
- no endpoint, UI, migration, access switch, old-row rewrite, ownership backfill, R2 listing/mutation, provider call, Stripe call, Cloudflare mutation, credit/billing mutation, or tenant-isolation claim is added

## Phase 6.9 Result

Phase 6.9 adds main-only evidence packaging only:

- `docs/tenant-assets/evidence/README.md` defines the evidence package directory and safety rules
- `docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md` records that no real main evidence export was present in-repo
- `npm run tenant-assets:summarize-evidence` can summarize a future reviewed JSON export without calling live endpoints
- decision remains blocked for access-switch and backfill work until operator-run main evidence is collected and reviewed
- no endpoint, UI, migration, access switch, old-row rewrite, ownership backfill, R2 listing/mutation, provider call, Stripe call, Cloudflare mutation, credit/billing mutation, or tenant-isolation claim is added
