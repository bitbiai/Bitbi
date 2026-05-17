# Asset Ownership Inventory

Date: 2026-05-17

Current release truth: latest auth D1 migration is `0056_add_ai_folder_image_ownership_metadata.sql`.

Phase 6.1 inventories ownership only. Phase 6.2 adds a focused source/fixture owner-map dry run for `ai_folders` and `ai_images`. Phase 6.3 adds the schema/access impact plan for that same domain. Phase 6.4 adds nullable owner metadata columns to `ai_folders` and `ai_images` only. These phases do not change routes, backfill rows, assign ownership on writes, move/list/delete R2 objects, mutate billing, change generation behavior, change lifecycle behavior, change quota accounting, or change public gallery behavior.

## Summary

| Domain | Current owner fields | Target owner fields | Current access | Risk | Future phase |
| --- | --- | --- | --- | --- | --- |
| Generated images (`ai_images`) | `user_id`, optional `folder_id`; nullable owner metadata present but unused | `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, ownership status/source/confidence metadata | Private user match; public `visibility='public'` | High | 6.5 new-write assignment next |
| Saved text/audio/video (`ai_text_assets`) | `user_id`, optional `folder_id`, `source_module` | same target owner fields plus parent/derivative owner evidence | Private user match; public source-specific galleries | High | 6.3 |
| Folders (`ai_folders`) | `user_id`, `status`; nullable owner metadata present but unused | `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, ownership status/source/confidence metadata | User match for create/rename/delete/move | High | 6.5 new-write assignment next |
| Async video jobs (`ai_video_jobs`) | `user_id`, `scope` | owner class plus org/admin classification | User/admin scope checks | High | 6.4 |
| Profiles/avatars (`profiles`, `PRIVATE_MEDIA`) | `user_id` | personal or organization publisher evidence | User-private; public only through gallery attribution routes | Medium | 6.6 |
| Favorites (`favorites`) | `user_id`, `item_type`, `item_id` | referencing user plus referenced asset owner class | User-private reference list | Medium | 6.6 |
| Storage quota (`user_asset_storage_usage`) | `user_id` | user or organization quota owner | Derived per-user counter | High | 6.5 |
| Lifecycle/export/delete (`data_lifecycle_*`) | `subject_user_id`, `r2_bucket`, `r2_key` | subject type plus org owner fields | Admin/support user-subject plans | High | 6.7 |
| News Pulse visuals (`news_pulse_items`) | platform content fields | `platform_background_asset` classification | Public/background cache | Medium | 6.8 or separate platform-content phase |

## Tables And Routes

### `ai_images`

- Source migrations: `0007_add_image_studio.sql`, `0017_add_ai_image_derivatives.sql`, `0019_add_ai_image_publication.sql`, `0046_add_asset_storage_quota.sql`.
- Source routes/libs: `workers/auth/src/routes/ai/images-write.js`, `assets-read.js`, `files-read.js`, `publication.js`, `gallery.js`, `workers/auth/src/lib/ai-image-derivatives.js`.
- Primary key: `id`.
- Current owner: `user_id`.
- Folder: `folder_id` references `ai_folders`.
- R2 fields: `r2_key`, `thumb_key`, `medium_key`.
- Visibility: `visibility`, `published_at`.
- Current private access: `WHERE id = ? AND user_id = ?`.
- Current public access: Mempics routes require `visibility = 'public'` and derivative readiness.
- Target: `personal_user_asset` or `organization_asset`.
- Gap: org-scoped image generation can consume org credits/attempts, but saved image rows do not carry an organization owner.
- Phase 6.2 dry-run rules classify user-only rows as medium-confidence personal candidates, require explicit owner-map evidence for organization assets, reject weak UI organization context, flag folder/user conflicts, flag missing folders, and mark public ambiguous images unsafe to migrate.
- Phase 6.4 adds nullable ownership metadata fields and future access-check constants/tests, but leaves runtime reads/writes unchanged and unassigned.

### `ai_text_assets`

- Source migrations: `0016_add_ai_text_assets.sql`, `0021_add_music_source_module.sql`, `0022_add_video_source_module.sql`, `0023_add_text_asset_publication.sql`, `0024_add_text_asset_poster.sql`, `0046_add_asset_storage_quota.sql`.
- Source routes/libs: `text-assets-write.js`, `music-generate.js`, `video-generate.js`, `assets-read.js`, `files-read.js`, `publication.js`, `audio-gallery.js`, `video-gallery.js`, `ai-text-assets.js`.
- Primary key: `id`.
- Current owner: `user_id`.
- Source modules: `text`, `embeddings`, `compare`, `live_agent`, `music`, `video`.
- R2 fields: `r2_key`, `poster_r2_key`.
- Metadata: `metadata_json`, `preview_text`, `mime_type`, `size_bytes`, `poster_size_bytes`.
- Current private access: `WHERE id = ? AND user_id = ?`.
- Current public access: Memvids/Memtracks routes require `visibility = 'public'` and `source_module` filter.
- Target: `personal_user_asset`, `organization_asset`, or `platform_admin_test_asset`.
- Gap: posters inherit ownership implicitly from parent rows and are not independently classified.

### `ai_folders`

- Source migrations: `0007_add_image_studio.sql`, `0009_add_folder_status.sql`.
- Source routes/libs: `folders-read.js`, `folders-write.js`, `lifecycle.js`.
- Primary key: `id`.
- Current owner: `user_id`.
- Current access: user match for list/create/rename/delete/move.
- Target: owner-bound folder with owner class and optional organization id.
- Gap: future org-owned assets must not be mixed into personal folders without explicit policy.
- Phase 6.2 dry-run rules keep folders owner-bound in the target model and treat weak org context as insufficient for tenant ownership.
- Phase 6.4 adds nullable metadata fields for this target and defers access/write behavior changes to later phases.

### `ai_video_jobs`

- Source migrations: `0029_add_ai_video_jobs.sql`, `0030_harden_ai_video_jobs_phase1b.sql`, `0049_add_admin_video_job_budget_metadata.sql`.
- Source routes/libs: `workers/auth/src/lib/ai-video-jobs.js`, `workers/auth/src/routes/admin-ai.js`, `workers/auth/src/routes/ai/video-generate.js`.
- Primary key: `id`.
- Current owner fields: `user_id`, `scope` (`admin` or `member`).
- R2 fields: `output_r2_key`, `poster_r2_key`.
- Current access: admin/member job surfaces scope by user and admin route.
- Target: `personal_user_asset`, `organization_asset`, or `platform_admin_test_asset`.
- Gap: admin-created output classification is not separated from user id ownership.

### `profiles` And Avatars

- Source migrations: `0005_add_profiles.sql`, `0018_add_profile_avatar_state.sql`, `0026_add_cursor_pagination_support.sql`.
- Source routes/libs: `profile.js`, `avatar.js`, `profile-avatar-state.js`, `gallery.js`, `audio-gallery.js`, `video-gallery.js`.
- Primary key: `user_id`.
- R2 binding/key: `PRIVATE_MEDIA`, `avatars/{userId}`.
- Current access: signed-in user for private avatar; public avatar is served only when linked to a published asset and matching version.
- Target: personal profile asset or future organization publisher profile.
- Gap: no organization publisher/avatar model exists.

### `favorites`

- Source migrations: `0008_add_favorites.sql`, `0025_add_media_favorite_types.sql`.
- Source route: `workers/auth/src/routes/favorites.js`.
- Current owner: `user_id`.
- Reference fields: `item_type`, `item_id`, `thumb_url`.
- Current access: user match.
- Target: external/reference record with referenced asset owner evidence if needed.
- Gap: favorites can reference public assets but do not record referenced owner class.

### `user_asset_storage_usage`

- Source migration: `0046_add_asset_storage_quota.sql`.
- Source libs/routes: `asset-storage-quota.js`, `quota.js`, `admin-storage.js`.
- Primary key: `user_id`.
- Current owner: user.
- Target: owner-class quota counters or recomputable summaries by user/org.
- Gap: organization storage quota is absent.

### Lifecycle/Export/Delete

- Source migrations: `0032_add_data_lifecycle_requests.sql`, `0033_harden_data_export_archives.sql`.
- Source libs/routes: `data-lifecycle.js`, `data-export-cleanup.js`, `admin-data-lifecycle.js`.
- Current subject: `subject_user_id`.
- R2 references: `r2_bucket`, `r2_key`.
- Current coverage: user profile, favorites, folders, images, text assets, video jobs, activity summaries, and export archive manifests.
- Target: subject type that can represent user or organization.
- Gap: organization-owned asset lifecycle behavior is deferred.

### News Pulse/OpenClaw Visuals

- Source migrations: `0043_add_news_pulse_items.sql`, `0045_add_news_pulse_visuals.sql`, `0050_add_news_pulse_visual_budget_metadata.sql`.
- Source libs/routes: `news-pulse-visuals.js`, `public-news-pulse.js`, `openclaw-news-pulse.js`.
- R2 binding/key: `USER_IMAGES`, `news-pulse/thumbs/{itemId}.webp`.
- Target: `platform_background_asset`.
- Gap: not part of member/org tenant asset migration, but needs explicit classification to avoid false customer ownership.

## R2 Inventory

| Binding | Key patterns | Current owner signal | Risk |
| --- | --- | --- | --- |
| `USER_IMAGES` | `users/{userId}/folders/...`, `users/{userId}/derivatives/...`, `users/{userId}/video-jobs/...`, `tmp/ai-generated/...`, `news-pulse/thumbs/...` | User id or platform prefix in key plus D1 metadata | Organization id is not encoded; key-only inference is unsafe. |
| `PRIVATE_MEDIA` | `avatars/{userId}` | User id in key and `profiles` row | Organization publisher assets are absent. |
| `AUDIT_ARCHIVE` | `data-exports/...`, `platform-budget-evidence/...` | Lifecycle/audit subject or platform budget scope | Audit archives are not customer-owned media. |

## Lifecycle And Quota Coverage

- Current lifecycle planning can reference `ai_images`, `ai_text_assets`, `ai_video_jobs`, avatars, folders, favorites, and R2 references for a user subject.
- Current lifecycle planning does not support an organization subject.
- Current quota accounting is per-user only.
- Future owner migration must update lifecycle/export/delete design before any tenant isolation claim.

## Tests Needed In Future Phases

- Phase 6.4 schema compatibility tests for additive ownership metadata on `ai_folders` and `ai_images`.
- Owner-map dry-run includes every existing row and marks ambiguous rows as legacy.
- Organization-owned asset routes reject non-members and insufficient roles.
- Personal assets remain accessible to their original user.
- Public galleries preserve current public/private behavior until organization attribution is explicitly implemented.
- Derivative/poster/covers inherit parent owner class.
- Lifecycle planning includes organization-owned assets only when the requester is authorized.
- R2 cleanup refuses keys whose owner class is ambiguous.
