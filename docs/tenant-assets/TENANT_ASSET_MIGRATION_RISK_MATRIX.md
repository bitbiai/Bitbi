# Tenant Asset Migration Risk Matrix

Date: 2026-05-17

Current release truth: latest auth D1 migration is `0055_add_platform_budget_evidence_archives.sql`.

Phase 6.1 adds risk evidence only. Phase 6.2 adds a focused owner-map dry run for `ai_folders` and `ai_images`. Phase 6.3 adds the schema/access impact plan without adding the migration. These phases do not migrate ownership, rewrite rows, move/list/delete R2 objects, call providers, call Stripe, mutate Cloudflare, change access checks, change generation/gallery/lifecycle/quota behavior, or claim full tenant isolation.

| Risk | Severity | Evidence source | Affected tables/routes | Proposed mitigation | Safe dry-run signal | Future phase |
| --- | --- | --- | --- | --- | --- | --- |
| Ownership ambiguity | High | `ai_images.user_id`, `ai_text_assets.user_id`, `ai_folders.user_id` have no org owner column. Phase 6.2 fixture dry-run shows user-only rows are only medium-confidence personal candidates. Phase 6.3 proposes additive owner metadata but does not add it. | `ai_images`, `ai_text_assets`, `ai_folders`, private asset routes. | Add owner class and owner-map proof before writing. | Count rows lacking target owner classification. | 6.4 schema, later backfill |
| Org-billed asset stored as user-owned | High | Org-scoped generation attempts and credit ledgers exist separately from saved asset rows. | `ai_usage_attempts`, `usage_events`, `ai_images`, `ai_text_assets`. | Link future saved assets to owning org or mark personal explicitly. | Compare org attempt/usage rows to saved asset creation evidence where available. | 6.5 write-path metadata |
| Public asset attribution is user-only | High | Public routes join `profiles` by asset `user_id`. | `/api/gallery/mempics`, `/api/gallery/memvids`, `/api/gallery/memtracks`. | Add publisher owner class and organization publisher policy. | List public rows with no organization attribution field. | 6.6 |
| R2 key orphan/owner mismatch | High | R2 keys encode user ids but D1 is source of truth. | `USER_IMAGES`, `PRIVATE_MEDIA`, lifecycle cleanup. | Build bounded owner-map and orphan report before any object action. | Report key patterns and missing D1/R2 reconciliation status. | 6.8 |
| Derivative/poster mismatch | High | Derivative/poster keys are separate R2 objects and owner is inferred; Phase 6.2 flags image `thumb_key`/`medium_key` when parent confidence is not high. | `thumb_key`, `medium_key`, `poster_r2_key`, video job poster keys. | Store or derive explicit parent owner evidence. | Count parent rows with derivative/poster fields by owner class. | 6.5 |
| Folder ownership mismatch | High | Folders are user-owned and can contain multiple asset types; Phase 6.2 flags folder/image user conflicts as ambiguous or unsafe when public. Phase 6.3 recommends one owner scope per folder. | `ai_folders`, move/delete lifecycle. | Make folders owner-bound before moving org assets into them. | Identify folders with mixed future owner candidates. | 6.4/6.5 |
| Lifecycle/export/delete mismatch | High | Lifecycle is centered on `subject_user_id`. | `data_lifecycle_requests`, `data_lifecycle_request_items`, `data_export_archives`. | Add organization subject design before tenant-owned asset claims. | Report lack of `subject_organization_id` path. | 6.7 |
| Quota/accounting mismatch | High | `user_asset_storage_usage` is per-user only. | `user_asset_storage_usage`, `asset-storage-quota.js`. | Add owner-aware quota model or recompute by owner class. | Compare source asset bytes to user-only quota rows. | 6.5 |
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

- no schema write
- no R2 list/move/delete
- no generation behavior change
- no runtime access-check or public gallery change
- synthetic fixtures classify personal, strong-org, weak-org-rejected, admin-test, ambiguous, orphan, public-unsafe, and derivative-risk examples
- Phase 6.3 followed with schema/access-check impact planning, not broad backfill

## Phase 6.3 Result

Phase 6.3 adds `AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md` and dry-run schema/access readiness output:

- proposed additive ownership metadata for `ai_folders` and `ai_images`
- no migration file
- no ownership row rewrite
- no runtime access-check, public gallery, lifecycle, quota, or R2 behavior change
- next phase should add schema only, with no backfill
