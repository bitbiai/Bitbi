#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TENANT_ASSET_OWNER_TYPES,
  TENANT_ASSET_OWNERSHIP_CONFIDENCES,
  TENANT_ASSET_OWNERSHIP_SOURCES,
  TENANT_ASSET_OWNERSHIP_STATUSES,
} from "../workers/auth/src/lib/tenant-asset-ownership.js";
import {
  buildTenantAssetReadDiagnosticsReport,
  TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATIONS,
} from "../workers/auth/src/lib/tenant-asset-read-diagnostics.js";

export const TENANT_ASSET_OWNER_CLASSES = Object.freeze([
  ...TENANT_ASSET_OWNER_TYPES,
]);

const FOLDERS_IMAGES_OWNERSHIP_MIGRATION =
  "workers/auth/migrations/0056_add_ai_folder_image_ownership_metadata.sql";

export const FOLDERS_IMAGES_OWNER_MAP_CLASSES = Object.freeze([
  "personal_user_asset",
  "organization_asset",
  "platform_admin_test_asset",
  "legacy_unclassified_asset",
  "ambiguous_owner",
  "orphan_reference",
  "unsafe_to_migrate",
]);

const ASSET_DOMAINS = Object.freeze([
  {
    id: "ai_images",
    label: "Generated image assets",
    table: "ai_images",
    primaryKey: "id",
    currentOwnerFields: ["user_id"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id", "created_by_user_id"],
    r2KeyFields: ["r2_key", "thumb_key", "medium_key"],
    routeFiles: [
      "workers/auth/src/routes/ai/images-write.js",
      "workers/auth/src/routes/ai/assets-read.js",
      "workers/auth/src/routes/ai/files-read.js",
      "workers/auth/src/routes/ai/publication.js",
      "workers/auth/src/routes/gallery.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0007_add_image_studio.sql",
      "workers/auth/migrations/0017_add_ai_image_derivatives.sql",
      "workers/auth/migrations/0019_add_ai_image_publication.sql",
      "workers/auth/migrations/0046_add_asset_storage_quota.sql",
      FOLDERS_IMAGES_OWNERSHIP_MIGRATION,
    ],
    bucket: "USER_IMAGES",
    keyPatterns: ["users/{userId}/folders/{folderSlug}/{timestamp}-{random}.png", "users/{userId}/derivatives/v{version}/{imageId}/{variant}.webp"],
    currentAccess: "user_id equality for private reads/writes; visibility='public' for public Mempics.",
    targetClass: "personal_user_asset or organization_asset",
    risk: "high",
    findings: ["missing_owning_organization_id", "public_gallery_user_attribution_only", "derivative_owner_inferred_from_parent"],
    futurePhase: "Phase 6.15 adds the admin-approved manual-review import executor for review rows/events only; access/backfill work remains blocked.",
  },
  {
    id: "ai_text_assets",
    label: "Saved text/audio/video assets",
    table: "ai_text_assets",
    primaryKey: "id",
    currentOwnerFields: ["user_id"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id", "created_by_user_id"],
    r2KeyFields: ["r2_key", "poster_r2_key"],
    routeFiles: [
      "workers/auth/src/routes/ai/text-assets-write.js",
      "workers/auth/src/routes/ai/music-generate.js",
      "workers/auth/src/routes/ai/video-generate.js",
      "workers/auth/src/routes/ai/assets-read.js",
      "workers/auth/src/routes/ai/files-read.js",
      "workers/auth/src/routes/ai/publication.js",
      "workers/auth/src/routes/audio-gallery.js",
      "workers/auth/src/routes/video-gallery.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0016_add_ai_text_assets.sql",
      "workers/auth/migrations/0021_add_music_source_module.sql",
      "workers/auth/migrations/0022_add_video_source_module.sql",
      "workers/auth/migrations/0023_add_text_asset_publication.sql",
      "workers/auth/migrations/0024_add_text_asset_poster.sql",
      "workers/auth/migrations/0046_add_asset_storage_quota.sql",
    ],
    bucket: "USER_IMAGES",
    keyPatterns: ["users/{userId}/folders/{folderSlug}/{text|audio|video}/{timestamp}-{random}-{fileName}", "users/{userId}/derivatives/v1/{assetId}/poster.{ext}"],
    currentAccess: "user_id equality for private reads/writes; visibility='public' plus source_module filters for Memvids/Memtracks.",
    targetClass: "personal_user_asset or organization_asset",
    risk: "high",
    findings: ["missing_owning_organization_id", "public_gallery_user_attribution_only", "poster_owner_inferred_from_parent"],
    futurePhase: "Later tenant asset phase after folders/images schema and access behavior are proven.",
  },
  {
    id: "ai_folders",
    label: "AI asset folders",
    table: "ai_folders",
    primaryKey: "id",
    currentOwnerFields: ["user_id"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id", "created_by_user_id"],
    r2KeyFields: [],
    routeFiles: [
      "workers/auth/src/routes/ai/folders-read.js",
      "workers/auth/src/routes/ai/folders-write.js",
      "workers/auth/src/routes/ai/lifecycle.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0007_add_image_studio.sql",
      "workers/auth/migrations/0009_add_folder_status.sql",
      FOLDERS_IMAGES_OWNERSHIP_MIGRATION,
    ],
    bucket: null,
    keyPatterns: [],
    currentAccess: "user_id equality; folder ownership guards image/text asset moves and deletes.",
    targetClass: "personal_user_asset or organization_asset",
    risk: "high",
    findings: ["folder_user_owned_only", "folder_mixed_owner_future_risk"],
    futurePhase: "Phase 6.15 adds the admin-approved manual-review import executor for review rows/events only; access/backfill work remains blocked.",
  },
  {
    id: "ai_video_jobs",
    label: "Async video job outputs",
    table: "ai_video_jobs",
    primaryKey: "id",
    currentOwnerFields: ["user_id", "scope"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id", "created_by_user_id"],
    r2KeyFields: ["output_r2_key", "poster_r2_key"],
    routeFiles: [
      "workers/auth/src/lib/ai-video-jobs.js",
      "workers/auth/src/routes/admin-ai.js",
      "workers/auth/src/routes/ai/video-generate.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0029_add_ai_video_jobs.sql",
      "workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql",
      "workers/auth/migrations/0049_add_admin_video_job_budget_metadata.sql",
    ],
    bucket: "USER_IMAGES",
    keyPatterns: ["users/{userId}/video-jobs/{jobId}/output.mp4", "users/{userId}/video-jobs/{jobId}/poster.{ext}"],
    currentAccess: "user_id plus scope for member/admin job surfaces; no organization owner column.",
    targetClass: "personal_user_asset, organization_asset, or platform_admin_test_asset",
    risk: "high",
    findings: ["admin_test_asset_classification_needed", "missing_owning_organization_id"],
    futurePhase: "Later tenant asset phase after folders/images metadata and access behavior are proven.",
  },
  {
    id: "profiles_avatars",
    label: "Profile avatars",
    table: "profiles",
    primaryKey: "user_id",
    currentOwnerFields: ["user_id"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id", "created_by_user_id"],
    r2KeyFields: ["avatars/{userId}"],
    routeFiles: [
      "workers/auth/src/routes/avatar.js",
      "workers/auth/src/routes/profile.js",
      "workers/auth/src/lib/profile-avatar-state.js",
      "workers/auth/src/routes/gallery.js",
      "workers/auth/src/routes/audio-gallery.js",
      "workers/auth/src/routes/video-gallery.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0005_add_profiles.sql",
      "workers/auth/migrations/0018_add_profile_avatar_state.sql",
      "workers/auth/migrations/0026_add_cursor_pagination_support.sql",
    ],
    bucket: "PRIVATE_MEDIA",
    keyPatterns: ["avatars/{userId}"],
    currentAccess: "private avatar route requires the signed-in user; public gallery avatar routes expose avatar only for published assets.",
    targetClass: "personal_user_asset or external_reference_asset",
    risk: "medium",
    findings: ["public_profile_attribution_user_only", "organization_publisher_avatar_policy_missing"],
    futurePhase: "Later public-gallery attribution phase after folders/images diagnostics are reviewed.",
  },
  {
    id: "favorites",
    label: "Favorites and public asset references",
    table: "favorites",
    primaryKey: "id",
    currentOwnerFields: ["user_id", "item_type", "item_id"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id", "created_by_user_id", "referenced_asset_owner_type"],
    r2KeyFields: ["thumb_url"],
    routeFiles: ["workers/auth/src/routes/favorites.js"],
    migrationFiles: [
      "workers/auth/migrations/0008_add_favorites.sql",
      "workers/auth/migrations/0025_add_media_favorite_types.sql",
    ],
    bucket: null,
    keyPatterns: ["public URL reference only"],
    currentAccess: "user_id equality; referenced public assets are not tenant-attributed in the row.",
    targetClass: "external_reference_asset",
    risk: "medium",
    findings: ["favorites_reference_owner_not_recorded"],
    futurePhase: "Later gallery/favorites attribution phase after folders/images diagnostics are reviewed.",
  },
  {
    id: "user_asset_storage_usage",
    label: "Asset storage quota counters",
    table: "user_asset_storage_usage",
    primaryKey: "user_id",
    currentOwnerFields: ["user_id"],
    targetOwnerFields: ["asset_owner_type", "owning_user_id", "owning_organization_id"],
    r2KeyFields: [],
    routeFiles: [
      "workers/auth/src/lib/asset-storage-quota.js",
      "workers/auth/src/routes/ai/quota.js",
      "workers/auth/src/routes/admin-storage.js",
    ],
    migrationFiles: ["workers/auth/migrations/0046_add_asset_storage_quota.sql"],
    bucket: null,
    keyPatterns: [],
    currentAccess: "per-user counter recomputed from user-owned ai_images and ai_text_assets.",
    targetClass: "personal_user_asset or organization_asset",
    risk: "high",
    findings: ["quota_accounting_user_only", "organization_storage_quota_missing"],
    futurePhase: "Future phase after folders/images manual-review import planning addresses quota ownership.",
  },
  {
    id: "data_lifecycle",
    label: "Lifecycle/export/delete planning",
    table: "data_lifecycle_requests and data_lifecycle_request_items",
    primaryKey: "id",
    currentOwnerFields: ["subject_user_id", "r2_bucket", "r2_key"],
    targetOwnerFields: ["subject_type", "subject_user_id", "subject_organization_id", "asset_owner_type"],
    r2KeyFields: ["r2_bucket", "r2_key"],
    routeFiles: [
      "workers/auth/src/lib/data-lifecycle.js",
      "workers/auth/src/lib/data-export-cleanup.js",
      "workers/auth/src/routes/admin-data-lifecycle.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0032_add_data_lifecycle_requests.sql",
      "workers/auth/migrations/0033_harden_data_export_archives.sql",
    ],
    bucket: "AUDIT_ARCHIVE",
    keyPatterns: ["data-exports/{subjectUserId}/{requestId}/{archiveId}.json"],
    currentAccess: "admin/support workflow centered on subject_user_id; organization lifecycle plans are deferred.",
    targetClass: "audit_archive_asset",
    risk: "high",
    findings: ["lifecycle_user_only", "organization_export_delete_gap"],
    futurePhase: "Future phase after folders/images manual-review import planning addresses lifecycle owner mapping.",
  },
  {
    id: "news_pulse_visuals",
    label: "News Pulse generated visuals",
    table: "news_pulse_items",
    primaryKey: "id",
    currentOwnerFields: ["platform/background content source"],
    targetOwnerFields: ["asset_owner_type", "source_domain"],
    r2KeyFields: ["visual_object_key"],
    routeFiles: [
      "workers/auth/src/lib/news-pulse-visuals.js",
      "workers/auth/src/routes/public-news-pulse.js",
      "workers/auth/src/routes/openclaw-news-pulse.js",
    ],
    migrationFiles: [
      "workers/auth/migrations/0043_add_news_pulse_items.sql",
      "workers/auth/migrations/0045_add_news_pulse_visuals.sql",
      "workers/auth/migrations/0050_add_news_pulse_visual_budget_metadata.sql",
    ],
    bucket: "USER_IMAGES",
    keyPatterns: ["news-pulse/thumbs/{itemId}.webp"],
    currentAccess: "public content cache; not user or organization owned.",
    targetClass: "platform_background_asset",
    risk: "medium",
    findings: ["platform_background_asset_classification_needed"],
    futurePhase: "Out-of-scope for folders/images manual-review import dry-run phases.",
  },
]);

const R2_BINDINGS = Object.freeze([
  {
    binding: "USER_IMAGES",
    bucket: "bitbi-user-images",
    keyPatterns: [
      "users/{userId}/folders/{folderSlug}/...",
      "users/{userId}/derivatives/v{version}/...",
      "users/{userId}/video-jobs/{jobId}/...",
      "tmp/ai-generated/{userId}/{tempId}",
      "tmp/ai-generated/music-covers/{userId}/{assetId}-{random}.png",
      "news-pulse/thumbs/{itemId}.webp",
    ],
    ownerSignal: "Mostly encoded user id or platform prefix; D1 row remains source of truth.",
    migrationRisk: "R2 keys alone are not sufficient for tenant ownership because organization id is not encoded.",
  },
  {
    binding: "PRIVATE_MEDIA",
    bucket: "bitbi-private-media",
    keyPatterns: ["avatars/{userId}"],
    ownerSignal: "Encoded user id only.",
    migrationRisk: "Public gallery avatar attribution remains user/profile based.",
  },
  {
    binding: "AUDIT_ARCHIVE",
    bucket: "bitbi-audit-archive",
    keyPatterns: [
      "data-exports/{subjectUserId}/{requestId}/{archiveId}.json",
      "platform-budget-evidence/platform_admin_lab_budget/{archiveId}.json",
      "platform-budget-evidence/platform_admin_lab_budget/{archiveId}.md",
    ],
    ownerSignal: "Audit/lifecycle subject or platform budget scope.",
    migrationRisk: "Audit archives are not tenant-owned media; keep as audit_archive_asset.",
  },
]);

const ROUTE_DOMAINS = Object.freeze([
  {
    id: "member_private_assets",
    routes: [
      "GET /api/ai/assets",
      "GET /api/ai/images",
      "GET /api/ai/images/:id/file",
      "GET /api/ai/images/:id/thumb",
      "GET /api/ai/images/:id/medium",
      "GET /api/ai/text-assets/:id/file",
      "GET /api/ai/text-assets/:id/poster",
    ],
    currentAccess: "requires signed-in user and user_id match.",
    tenantGap: "No owning_organization_id or asset_owner_type branch.",
  },
  {
    id: "member_asset_writes",
    routes: [
      "POST /api/ai/images/save",
      "POST /api/ai/audio/save",
      "PATCH /api/ai/images/:id/publication",
      "PATCH /api/ai/text-assets/:id/publication",
      "PATCH /api/ai/assets/bulk-move",
      "POST /api/ai/assets/bulk-delete",
    ],
    currentAccess: "requires signed-in user and user_id match.",
    tenantGap: "Future organization-owned assets need role/tenant checks before write/move/delete.",
  },
  {
    id: "public_gallery",
    routes: [
      "GET /api/gallery/mempics",
      "GET /api/gallery/mempics/:id/:version/file",
      "GET /api/gallery/memvids",
      "GET /api/gallery/memtracks",
    ],
    currentAccess: "visibility='public' and source_module filters; publisher attribution joins profiles by user_id.",
    tenantGap: "Organization attribution and tenant-public policy are absent.",
  },
  {
    id: "admin_storage",
    routes: ["GET /api/admin/users/:id/storage", "admin user asset rename/move/visibility/delete routes"],
    currentAccess: "admin can inspect/mutate assets by target user id.",
    tenantGap: "Admin inspection is user-centered and does not surface tenant ownership ambiguity.",
  },
  {
    id: "data_lifecycle",
    routes: ["POST /api/admin/data-lifecycle/requests", "POST /api/admin/data-lifecycle/requests/:id/plan"],
    currentAccess: "admin/support subject_user_id workflow.",
    tenantGap: "No organization subject owner-map or tenant asset lifecycle plan.",
  },
]);

const FUTURE_PHASES = Object.freeze([
  {
    phase: "6.2",
    title: "Low-risk owner-map dry run for folders and image assets",
    scope: "Implemented as source/fixture owner-map rules for ai_folders/ai_images only; no schema and no backfill.",
  },
  {
    phase: "6.3",
    title: "AI folders/images schema and access impact plan",
    scope: "Implemented as proposed metadata fields, access impact matrix, write-path rules, and backfill policy; no migration.",
  },
  {
    phase: "6.4",
    title: "Additive ownership metadata schema for folders/images",
    scope: "Add columns and compatibility tests only; no backfill and no runtime access behavior change.",
  },
  {
    phase: "6.5",
    title: "Write-path metadata assignment",
    scope: "Assign owner metadata for new personal folder/image writes after schema exists; no historical backfill and no access-check switch.",
  },
  {
    phase: "6.6",
    title: "Ownership metadata read diagnostics and dual-read safety checks",
    scope: "Implemented as fixture/source read diagnostics comparing existing user_id access with new ownership metadata; no authorization switch.",
  },
  {
    phase: "6.7",
    title: "Tenant asset ownership admin evidence report",
    scope: "Implemented as bounded admin-only folders/images evidence report and JSON/Markdown export; no access switch or backfill.",
  },
  {
    phase: "6.8",
    title: "Tenant asset ownership evidence collection runbook",
    scope: "Implemented as operator runbook/template/checklist for collecting Phase 6.7 evidence; no access switch or backfill.",
  },
  {
    phase: "6.9",
    title: "Main owner-map evidence packaging",
    scope: "Package main-only evidence status and pending-marker requirements; no live endpoint calls, access switch, or backfill.",
  },
  {
    phase: "6.10",
    title: "Operator-run main evidence review and decision",
    scope: "Implemented as a reviewed main evidence decision requiring manual review; access switch and backfill stay blocked.",
  },
  {
    phase: "6.11",
    title: "Manual review workflow design",
    scope: "Implemented as manual-review workflow design and main evidence review plan; no access switch or backfill.",
  },
  {
    phase: "6.12",
    title: "Manual review state schema design",
    scope: "Implemented as future review-state tables/indexes/transitions/API/UI design only; no migration, review rows, access switch, or backfill.",
  },
  {
    phase: "6.13",
    title: "Additive manual review state schema",
    scope: "Implemented as additive review-state tables only; no review-row import, access switch, or backfill.",
  },
  {
    phase: "6.14",
    title: "Manual review item import dry run",
    scope: "Implemented as local-only proposed review-item/bucket planning from evidence; no review rows, access switch, or backfill.",
  },
  {
    phase: "6.15",
    title: "Admin-approved manual review item import executor",
    scope: "Implemented as a dry-run-by-default admin import endpoint that can create only review items/events when confirmed; no ownership backfill or access switch.",
  },
]);

const FOLDERS_IMAGES_SCHEMA_SUMMARY = Object.freeze({
  folders: Object.freeze({
    table: "ai_folders",
    primaryKey: "id",
    ownerColumns: ["user_id"],
    organizationColumns: [],
    parentColumns: [],
    visibilityColumns: [],
    timestampColumns: ["created_at"],
    lifecycleColumns: ["status"],
    currentAccess: "User-scoped queries use user_id and status='active'. Folders are private user containers.",
    sourceMigrations: ["0007_add_image_studio.sql", "0009_add_folder_status.sql"],
    sourceRoutes: [
      "workers/auth/src/routes/ai/folders-read.js",
      "workers/auth/src/routes/ai/folders-write.js",
      "workers/auth/src/routes/ai/lifecycle.js",
    ],
  }),
  images: Object.freeze({
    table: "ai_images",
    primaryKey: "id",
    ownerColumns: ["user_id"],
    organizationColumns: [],
    folderColumns: ["folder_id"],
    generationColumns: ["prompt", "model", "steps", "seed"],
    r2KeyFields: ["r2_key", "thumb_key", "medium_key"],
    derivativeFields: [
      "thumb_key",
      "medium_key",
      "thumb_mime_type",
      "medium_mime_type",
      "thumb_width",
      "thumb_height",
      "medium_width",
      "medium_height",
      "derivatives_status",
      "derivatives_version",
    ],
    publicationColumns: ["visibility", "published_at"],
    storageColumns: ["size_bytes"],
    timestampColumns: ["created_at", "published_at", "derivatives_ready_at"],
    currentAccess: "Private image reads/writes use user_id equality. Public Mempics use visibility='public' and profile joins by user_id.",
    sourceMigrations: [
      "0007_add_image_studio.sql",
      "0017_add_ai_image_derivatives.sql",
      "0019_add_ai_image_publication.sql",
      "0046_add_asset_storage_quota.sql",
    ],
    sourceRoutes: [
      "workers/auth/src/routes/ai/images-write.js",
      "workers/auth/src/routes/ai/assets-read.js",
      "workers/auth/src/routes/ai/files-read.js",
      "workers/auth/src/routes/ai/publication.js",
      "workers/auth/src/routes/gallery.js",
    ],
  }),
});

const FOLDERS_IMAGES_OWNER_MAP_RULES = Object.freeze([
  {
    id: "strong_org_evidence_required",
    summary: "Classify as organization_asset only when an explicit organization id appears in approved owner-map or fixture evidence.",
  },
  {
    id: "weak_org_context_rejected",
    summary: "Do not infer organization ownership from UI selected organization, active organization localStorage, folder name, or R2 key alone.",
  },
  {
    id: "user_only_personal_candidate",
    summary: "A row with only user_id ownership is a personal_user_asset candidate with medium confidence, not a completed migration.",
  },
  {
    id: "admin_test_explicit",
    summary: "Classify platform_admin_test_asset only with explicit admin/test source evidence.",
  },
  {
    id: "folder_image_conflict",
    summary: "Image and folder user_id mismatch is ambiguous_owner; if public, it becomes unsafe_to_migrate.",
  },
  {
    id: "missing_folder",
    summary: "An image pointing at a missing folder is orphan_reference.",
  },
  {
    id: "public_ambiguous_block",
    summary: "Public images with ambiguous ownership are unsafe_to_migrate until attribution policy is approved.",
  },
  {
    id: "derivative_parent_clarity",
    summary: "thumb_key and medium_key inherit parent ownership and are risky when parent ownership confidence is not high.",
  },
]);

const FOLDERS_IMAGES_PROPOSED_OWNER_VALUES = Object.freeze({
  assetOwnerTypes: TENANT_ASSET_OWNER_TYPES,
  ownershipStatuses: TENANT_ASSET_OWNERSHIP_STATUSES,
  ownershipSources: TENANT_ASSET_OWNERSHIP_SOURCES,
  ownershipConfidences: TENANT_ASSET_OWNERSHIP_CONFIDENCES,
});

const FOLDERS_IMAGES_PROPOSED_SCHEMA = Object.freeze({
  ai_folders: {
    proposedFields: [
      "asset_owner_type",
      "owning_user_id",
      "owning_organization_id",
      "created_by_user_id",
      "ownership_status",
      "ownership_source",
      "ownership_confidence",
      "ownership_metadata_json",
      "ownership_assigned_at",
    ],
    currentlyMissingFields: [
      "asset_owner_type",
      "owning_user_id",
      "owning_organization_id",
      "created_by_user_id",
      "ownership_status",
      "ownership_source",
      "ownership_confidence",
      "ownership_metadata_json",
      "ownership_assigned_at",
    ],
    futureIndexTargets: [
      {
        purpose: "personal folder listing",
        columns: ["owning_user_id", "asset_owner_type", "status", "name"],
      },
      {
        purpose: "organization folder listing",
        columns: ["owning_organization_id", "asset_owner_type", "status", "name"],
      },
      {
        purpose: "migration review queues",
        columns: ["ownership_status", "asset_owner_type", "created_at"],
      },
    ],
  },
  ai_images: {
    proposedFields: [
      "asset_owner_type",
      "owning_user_id",
      "owning_organization_id",
      "created_by_user_id",
      "ownership_status",
      "ownership_source",
      "ownership_confidence",
      "ownership_metadata_json",
      "ownership_assigned_at",
    ],
    currentlyMissingFields: [
      "asset_owner_type",
      "owning_user_id",
      "owning_organization_id",
      "created_by_user_id",
      "ownership_status",
      "ownership_source",
      "ownership_confidence",
      "ownership_metadata_json",
      "ownership_assigned_at",
    ],
    futureIndexTargets: [
      {
        purpose: "personal image listing",
        columns: ["owning_user_id", "asset_owner_type", "folder_id", "created_at", "id"],
      },
      {
        purpose: "organization image listing",
        columns: ["owning_organization_id", "asset_owner_type", "folder_id", "created_at", "id"],
      },
      {
        purpose: "public gallery owner-aware listing",
        columns: ["visibility", "asset_owner_type", "published_at", "created_at", "id"],
      },
      {
        purpose: "migration review queues",
        columns: ["ownership_status", "asset_owner_type", "created_at"],
      },
    ],
  },
});

const FOLDERS_IMAGES_ACCESS_IMPACT_MATRIX = Object.freeze([
  {
    id: "image_list_read",
    routes: ["GET /api/ai/images", "GET /api/ai/assets"],
    currentAccessBasis: "Signed-in user plus ai_images.user_id = session.user.id.",
    proposedAccessBasis: "Personal assets keep owning_user_id check; organization assets require active organization membership and allowed read role.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal image list unchanged", "organization member can list org images", "non-member cannot list org images"],
  },
  {
    id: "image_create_save",
    routes: ["POST /api/ai/generate-image", "POST /api/ai/images/save"],
    currentAccessBasis: "Generation and save use session user; saved ai_images row stores user_id and optional user-owned folder_id.",
    proposedAccessBasis: "Future writes assign owner metadata from explicit personal or organization context before insert.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal save writes personal metadata", "org-context save writes organization metadata", "weak org context rejected"],
  },
  {
    id: "image_update_move",
    routes: ["PATCH /api/ai/images/:id/rename", "POST /api/ai/images/bulk-move", "POST /api/ai/assets/bulk-move"],
    currentAccessBasis: "Image and destination folder are both matched by user_id.",
    proposedAccessBasis: "Asset and folder owner metadata must match; organization moves require membership and mutation role.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["cannot move personal image into org folder", "cannot move org image into personal folder", "org admin can move org image"],
  },
  {
    id: "image_delete",
    routes: ["DELETE /api/ai/images/:id", "POST /api/ai/images/bulk-delete", "POST /api/ai/assets/bulk-delete"],
    currentAccessBasis: "Deletes match ai_images.user_id and enqueue/delete USER_IMAGES keys.",
    proposedAccessBasis: "Personal owner or organization mutation role; cleanup keys remain derived from the owned row.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.7",
    testsRequired: ["personal delete unchanged", "org delete requires role", "cleanup queue remains owner-safe"],
  },
  {
    id: "image_publication",
    routes: ["PATCH /api/ai/images/:id/publication"],
    currentAccessBasis: "Signed-in user plus ai_images.user_id = session.user.id.",
    proposedAccessBasis: "Personal owner or organization publisher role; publication must not change ownership.",
    changeRisk: "medium",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["publication keeps owner metadata", "org publication requires publisher role", "ambiguous public rows stay unsafe"],
  },
  {
    id: "image_media_serving",
    routes: ["GET /api/ai/images/:id/file", "GET /api/ai/images/:id/thumb", "GET /api/ai/images/:id/medium"],
    currentAccessBasis: "Signed-in user plus ai_images.user_id = session.user.id.",
    proposedAccessBasis: "Personal owner or organization read membership; derivative generation inherits parent owner.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal media unchanged", "org media member access", "non-member denied", "derivative inherits parent owner"],
  },
  {
    id: "folder_list_read",
    routes: ["GET /api/ai/folders"],
    currentAccessBasis: "Signed-in user plus ai_folders.user_id = session.user.id.",
    proposedAccessBasis: "Personal folder owner or organization membership; counts must be owner-scope filtered.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal folder counts unchanged", "org folder counts use org scope", "mixed owner folder hidden/rejected"],
  },
  {
    id: "folder_create_update_delete",
    routes: ["POST /api/ai/folders", "PATCH /api/ai/folders/:id", "DELETE /api/ai/folders/:id"],
    currentAccessBasis: "Signed-in user plus ai_folders.user_id for rename/delete.",
    proposedAccessBasis: "Future create assigns personal/org owner metadata; update/delete require matching owner scope and role.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal folder create unchanged", "org folder create with org context", "folder delete scope-safe"],
  },
  {
    id: "public_gallery_images",
    routes: ["GET /api/gallery/mempics", "GET /api/gallery/mempics/:id/:version/file", "GET /api/gallery/mempics/:id/:version/thumb", "GET /api/gallery/mempics/:id/:version/medium"],
    currentAccessBasis: "visibility = public plus user-profile publisher join.",
    proposedAccessBasis: "Public visibility remains required; publisher attribution branches by asset_owner_type and organization publisher policy.",
    changeRisk: "medium",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal public gallery unchanged", "org publisher attribution", "unsafe ambiguous public rows excluded or reviewed"],
  },
  {
    id: "avatar_from_saved_image",
    routes: ["POST /api/profile/avatar with image_id"],
    currentAccessBasis: "Signed-in user plus saved image thumb selected by ai_images.user_id.",
    proposedAccessBasis: "Personal image owner or explicit organization avatar policy; do not silently allow org assets as personal avatars.",
    changeRisk: "medium",
    phase63BehaviorChange: "no",
    futurePhase: "6.6",
    testsRequired: ["personal image avatar unchanged", "org image avatar policy explicit"],
  },
  {
    id: "admin_storage_inspection",
    routes: ["GET /api/admin/users/:id/storage", "admin user asset/folder rename, move, visibility, delete"],
    currentAccessBasis: "Admin selects target user; queries and mutations are target-user centered.",
    proposedAccessBasis: "Admin inspection must surface owner class and ambiguity; future mutations must choose user or organization scope explicitly.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.9",
    testsRequired: ["admin sees owner metadata", "admin cannot accidentally mutate org asset through user-only scope"],
  },
  {
    id: "data_lifecycle_export_delete",
    routes: ["POST /api/admin/data-lifecycle/requests", "POST /api/admin/data-lifecycle/requests/:id/plan"],
    currentAccessBasis: "Admin lifecycle requests are subject_user_id centered.",
    proposedAccessBasis: "Organization-owned assets require organization subject lifecycle plans and created-by/user membership policy.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.7",
    testsRequired: ["personal lifecycle unchanged", "org lifecycle plan includes org-owned images/folders", "ambiguous rows require review"],
  },
  {
    id: "storage_quota",
    routes: ["asset save/delete helpers", "GET /api/ai/folders", "GET /api/ai/assets", "GET /api/admin/users/:id/storage"],
    currentAccessBasis: "user_asset_storage_usage by user_id.",
    proposedAccessBasis: "Personal quota remains per user; organization assets require organization storage counters before byte reassignment.",
    changeRisk: "high",
    phase63BehaviorChange: "no",
    futurePhase: "6.7",
    testsRequired: ["personal quota unchanged", "org quota counters separate", "no byte double-count during transition"],
  },
]);

const FOLDERS_IMAGES_WRITE_PATH_RULES = Object.freeze([
  {
    id: "personal_generation",
    rule: "Personal member image generation and save writes personal_user_asset, owning_user_id = session user, created_by_user_id = session user.",
  },
  {
    id: "org_scoped_generation",
    rule: "Org-scoped image generation and save writes organization_asset only from explicit validated organization context and created_by_user_id = session user.",
  },
  {
    id: "admin_charged_image_test",
    rule: "Admin charged image tests should remain platform_admin_test_asset with selected organization reference in metadata unless product explicitly turns retained outputs into organization assets.",
  },
  {
    id: "admin_unmetered_image_test",
    rule: "Explicit unmetered admin image tests write platform_admin_test_asset and stay out of customer lifecycle/billing promises.",
  },
  {
    id: "folder_personal_context",
    rule: "Folders created without explicit organization context write personal_user_asset.",
  },
  {
    id: "folder_org_context",
    rule: "Folders created with validated organization context write organization_asset and require active membership.",
  },
  {
    id: "publication_no_owner_change",
    rule: "Publishing or unpublishing an image never changes ownership metadata.",
  },
  {
    id: "derivatives_inherit_parent",
    rule: "Thumb and medium derivatives inherit parent ai_images ownership; derivative rows/keys must not be treated as independent owner evidence.",
  },
  {
    id: "legacy_default",
    rule: "Existing rows without reliable evidence remain legacy_unclassified_asset or personal candidates until a reviewed owner-map backfill phase.",
  },
]);

const FOLDERS_IMAGES_BACKFILL_POLICY = Object.freeze([
  "Every backfill must be dry-run-first with reviewed row counts and ambiguity rates.",
  "Do not infer organization ownership from active organization UI context, folder names, R2 key shape, or current user memberships alone.",
  "Rows with explicit future organization metadata may become organization_asset.",
  "User-only legacy rows remain personal candidates or legacy_unclassified_asset until policy approval.",
  "Public ambiguous rows are unsafe_to_migrate.",
  "Folder/image owner conflicts become ambiguous.",
  "Images with missing folders become orphan_reference.",
  "Derivative mismatches require review and must not drive parent ownership.",
  "Deleted or anonymized user rows require lifecycle/legal review before any ownership assignment.",
]);

function readText(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return "";
  }
}

function fileExists(repoRoot, relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function buildFoldersImagesWritePathAssignment(repoRoot) {
  const foldersWrite = readText(repoRoot, "workers/auth/src/routes/ai/folders-write.js");
  const imagesWrite = readText(repoRoot, "workers/auth/src/routes/ai/images-write.js");
  const folderPersonalAssigned = (
    foldersWrite.includes("buildPersonalUserAssetOwnershipFields") &&
    foldersWrite.includes("ownership_metadata_json") &&
    foldersWrite.includes("ai_folders.create")
  );
  const imagePersonalAssigned = (
    imagesWrite.includes("buildPersonalUserAssetOwnershipFields") &&
    imagesWrite.includes("ownership_metadata_json") &&
    imagesWrite.includes("ai_images.save")
  );
  return {
    status: folderPersonalAssigned && imagePersonalAssigned
      ? "write_paths_assigned_for_new_rows"
      : "write_paths_not_assigned",
    assigned: [
      ...(folderPersonalAssigned ? [{
        id: "folder_personal_context",
        route: "POST /api/ai/folders",
        table: "ai_folders",
        ownerClass: "personal_user_asset",
        source: "new_write_personal",
        confidence: "high",
      }] : []),
      ...(imagePersonalAssigned ? [{
        id: "image_save_personal_context",
        route: "POST /api/ai/images/save",
        table: "ai_images",
        ownerClass: "personal_user_asset",
        source: "new_write_personal",
        confidence: "high",
      }] : []),
    ],
    notAssigned: [
      {
        id: "org_scoped_folder_context",
        reason: "No intentional server-verified org-scoped folder creation path exists yet.",
      },
      {
        id: "org_scoped_image_save_context",
        reason: "Saved image rows do not yet receive a server-verified organization owner context; weak client hints are ignored.",
      },
      {
        id: "admin_platform_image_output",
        reason: "Admin image test output is not persisted to ai_images by this phase.",
      },
      {
        id: "legacy_existing_rows",
        reason: "Existing ai_folders and ai_images rows remain null/unclassified until a future dry-run-first backfill phase.",
      },
    ],
    accessChecksChanged: false,
    publicGalleryChanged: false,
    r2KeyBehaviorChanged: false,
    backfillStarted: false,
  };
}

function evidenceForDomain(repoRoot, domain) {
  const migrationEvidence = domain.migrationFiles.map((file) => ({
    file,
    exists: fileExists(repoRoot, file),
    mentionsTable: readText(repoRoot, file).includes(domain.table.split(" ")[0]),
    mentionsOrganizationId: /\borganization_id\b|\bowning_organization_id\b/.test(readText(repoRoot, file)),
  }));
  const routeEvidence = domain.routeFiles.map((file) => {
    const text = readText(repoRoot, file);
    return {
      file,
      exists: Boolean(text),
      mentionsTable: text.includes(domain.table.split(" ")[0]),
      userOwnedGuard: /\buser_id\s*=\s*\?|\buserId\b|session\.user\.id/.test(text),
      organizationGuard: /\borganization_id\b|\borganizationId\b|requireOrgRole/.test(text),
      r2Access: /USER_IMAGES|PRIVATE_MEDIA|AUDIT_ARCHIVE/.test(text),
    };
  });
  return { migrationEvidence, routeEvidence };
}

function buildFindings(domain) {
  return domain.findings.map((code) => ({
    id: `${domain.id}.${code}`,
    code,
    severity: domain.risk === "high" ? "high" : "medium",
    domainId: domain.id,
    table: domain.table,
    summary: findingSummary(code),
    dryRunSignal: dryRunSignal(code),
    futurePhase: domain.futurePhase,
  }));
}

function findingSummary(code) {
  const summaries = {
    missing_owning_organization_id: "Asset row has no durable organization owner field.",
    public_gallery_user_attribution_only: "Public gallery attribution is derived from user profile only.",
    derivative_owner_inferred_from_parent: "Derivative object ownership is inferred from parent image metadata.",
    poster_owner_inferred_from_parent: "Poster object ownership is inferred from parent saved asset metadata.",
    folder_user_owned_only: "Folder rows are user-owned and cannot separate personal vs organization assets.",
    folder_mixed_owner_future_risk: "Future tenant assets could be mixed in a folder unless owner boundaries are explicit.",
    admin_test_asset_classification_needed: "Admin-created/test outputs need explicit platform_admin_test_asset classification.",
    public_profile_attribution_user_only: "Published assets expose user profile attribution and no organization publisher.",
    organization_publisher_avatar_policy_missing: "No organization avatar/publisher policy exists for public galleries.",
    favorites_reference_owner_not_recorded: "Favorite rows store item references but not referenced owner/tenant class.",
    quota_accounting_user_only: "Storage usage is tracked per user and cannot report organization quota.",
    organization_storage_quota_missing: "Organization storage quota accounting is not represented.",
    lifecycle_user_only: "Lifecycle/export/delete planning is centered on subject_user_id.",
    organization_export_delete_gap: "Organization-owned asset export/delete behavior is not implemented.",
    platform_background_asset_classification_needed: "Platform background/generated content needs explicit owner class.",
  };
  return summaries[code] || "Tenant ownership review required.";
}

function dryRunSignal(code) {
  if (code.includes("organization") || code.includes("owning_organization")) {
    return "Count rows without organization owner metadata once a local or main-only evidence source is approved.";
  }
  if (code.includes("gallery") || code.includes("publisher")) {
    return "List public rows whose attribution is user-only and lacks an organization/publisher class.";
  }
  if (code.includes("quota")) {
    return "Compare summed asset bytes by target owner class against user_asset_storage_usage.";
  }
  if (code.includes("lifecycle")) {
    return "List lifecycle plan item coverage by subject type and asset table.";
  }
  return "Verify source row and R2 key owner class before any migration.";
}

function normalizeMaybeId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 128) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function readJsonFile(filePath) {
  if (!filePath) return null;
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function resolveFixturePath(repoRoot, fixturePath) {
  if (!fixturePath) return null;
  if (path.isAbsolute(fixturePath)) return fixturePath;
  return path.join(repoRoot, fixturePath);
}

function getNestedObject(value, key) {
  const object = value?.[key];
  return object && typeof object === "object" && !Array.isArray(object) ? object : {};
}

function getStrongOrganizationId(row) {
  return normalizeMaybeId(row?.owning_organization_id)
    || normalizeMaybeId(row?.owningOrganizationId)
    || normalizeMaybeId(row?.organization_id)
    || normalizeMaybeId(row?.organizationId)
    || normalizeMaybeId(getNestedObject(row, "ownerMap").owningOrganizationId)
    || normalizeMaybeId(getNestedObject(row, "ownerMap").owning_organization_id)
    || normalizeMaybeId(getNestedObject(row, "owner_map").owningOrganizationId)
    || normalizeMaybeId(getNestedObject(row, "owner_map").owning_organization_id)
    || normalizeMaybeId(getNestedObject(row, "ownerEvidence").owningOrganizationId)
    || normalizeMaybeId(getNestedObject(row, "ownerEvidence").owning_organization_id)
    || normalizeMaybeId(getNestedObject(row, "ownerEvidence").organizationId)
    || normalizeMaybeId(getNestedObject(row, "ownerEvidence").organization_id);
}

function getWeakOrganizationEvidence(row) {
  return normalizeMaybeId(row?.activeOrganizationId)
    || normalizeMaybeId(row?.active_organization_id)
    || normalizeMaybeId(row?.selectedOrganizationId)
    || normalizeMaybeId(row?.selected_organization_id)
    || normalizeMaybeId(row?.localStorageOrganizationId)
    || normalizeMaybeId(row?.local_storage_organization_id)
    || normalizeMaybeId(row?.uiOrganizationId)
    || normalizeMaybeId(row?.ui_organization_id)
    || normalizeMaybeId(row?.weakOrganizationId)
    || normalizeMaybeId(row?.weak_organization_id);
}

function hasAdminTestEvidence(row) {
  const values = [
    row?.source_domain,
    row?.sourceDomain,
    row?.generation_source,
    row?.generationSource,
    row?.created_by_role,
    row?.createdByRole,
    row?.scope,
  ].map((value) => String(value || "").toLowerCase());
  return values.some((value) => value.includes("admin") || value.includes("test"));
}

function isPublicRow(row) {
  return String(row?.visibility || "").toLowerCase() === "public"
    || row?.is_public === true
    || row?.isPublic === true;
}

function hasUnsafeKeyCharacters(key) {
  return (
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.includes("//") ||
    key.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(key)
  );
}

function sanitizeR2Key(value) {
  const key = String(value || "").trim();
  if (!key) {
    return { present: false, keyClass: "missing" };
  }
  let keyClass = "present";
  if (key.startsWith("users/")) keyClass = "users/{userId}/...";
  else if (key.startsWith("tmp/ai-generated/")) keyClass = "tmp/ai-generated/{userId}/...";
  else if (key.startsWith("news-pulse/")) keyClass = "news-pulse/...";
  else if (key.startsWith("avatars/")) keyClass = "avatars/{userId}";
  else if (key.startsWith("data-exports/")) keyClass = "data-exports/...";
  else if (key.startsWith("platform-budget-evidence/")) keyClass = "platform-budget-evidence/...";
  return {
    present: true,
    keyClass,
    unsafeCharacters: hasUnsafeKeyCharacters(key),
  };
}

function relatedR2Fields(row, fields) {
  const out = {};
  for (const field of fields) {
    out[field] = sanitizeR2Key(row?.[field]);
  }
  return out;
}

function hasDerivativeKey(row) {
  return Boolean(row?.thumb_key || row?.medium_key);
}

function buildCandidateBase({ table, id, index, userId, folderId = null }) {
  return {
    candidateId: `${table}:${normalizeMaybeId(id) || `fixture-${index}`}`,
    sourceTable: table,
    sourceId: normalizeMaybeId(id) || null,
    currentUserOwner: normalizeMaybeId(userId),
    currentFolderId: normalizeMaybeId(folderId),
  };
}

function requiredActionForClass(ownerClass) {
  const actions = {
    personal_user_asset: "Add explicit personal owner metadata only after schema and owner-map proof.",
    organization_asset: "Use explicit organization owner metadata in a future additive schema; do not infer from UI context.",
    platform_admin_test_asset: "Keep separate from customer/org assets and exclude from customer lifecycle promises unless designed.",
    legacy_unclassified_asset: "Keep row legacy/unclassified until stronger local or main-only evidence exists.",
    ambiguous_owner: "Resolve owner conflict manually or through a later approved owner-map phase before migration.",
    orphan_reference: "Review missing folder/source references before any migration.",
    unsafe_to_migrate: "Block from automated migration until ownership and public attribution are reviewed.",
  };
  return actions[ownerClass] || "Review before migration.";
}

function publicGalleryRiskForRow(row, ownerClass) {
  if (!isPublicRow(row)) return "none";
  if (ownerClass === "personal_user_asset") return "user_profile_attribution_only";
  if (ownerClass === "organization_asset") return "organization_publisher_policy_missing";
  return "public_owner_ambiguous";
}

function lifecycleRiskForClass(ownerClass) {
  if (ownerClass === "organization_asset") return "organization_lifecycle_not_implemented";
  if (ownerClass === "ambiguous_owner" || ownerClass === "orphan_reference" || ownerClass === "unsafe_to_migrate") {
    return "owner_map_required_before_lifecycle";
  }
  return "user_subject_lifecycle_only";
}

function storageQuotaRiskForClass(ownerClass) {
  if (ownerClass === "organization_asset") return "organization_storage_quota_missing";
  if (ownerClass === "ambiguous_owner" || ownerClass === "orphan_reference" || ownerClass === "unsafe_to_migrate") {
    return "quota_owner_unclear";
  }
  return "user_storage_quota_only";
}

function classifyFolderOwner(row, index = 0) {
  const strongOrgId = getStrongOrganizationId(row);
  const weakOrgId = getWeakOrganizationEvidence(row);
  const ambiguityReasons = [];
  let ownerClass = "legacy_unclassified_asset";
  let confidence = "none";
  let inferredOwningOrganizationId = null;
  let blockedReason = null;

  if (strongOrgId) {
    ownerClass = "organization_asset";
    confidence = "high";
    inferredOwningOrganizationId = strongOrgId;
    ambiguityReasons.push("explicit_organization_owner_evidence");
  } else if (normalizeMaybeId(row?.user_id) || normalizeMaybeId(row?.userId)) {
    ownerClass = "personal_user_asset";
    confidence = "medium";
    ambiguityReasons.push("user_id_only_current_model");
  } else {
    ambiguityReasons.push("missing_user_owner");
    blockedReason = "folder_has_no_safe_user_or_org_owner_evidence";
  }

  if (weakOrgId && !strongOrgId) {
    ambiguityReasons.push("weak_org_signal_ignored");
  }

  return {
    ...buildCandidateBase({
      table: "ai_folders",
      id: row?.id,
      index,
      userId: row?.user_id ?? row?.userId,
    }),
    inferredOwnerClass: ownerClass,
    inferredOwningOrganizationId,
    confidence,
    ambiguityReasons,
    requiredFutureMigrationAction: requiredActionForClass(ownerClass),
    blockedReason,
    relatedR2KeyFields: {},
    relatedDerivativeFields: {},
    publicGalleryRisk: "none",
    lifecycleExportDeleteRisk: lifecycleRiskForClass(ownerClass),
    storageQuotaRisk: storageQuotaRiskForClass(ownerClass),
  };
}

function classifyImageOwner(row, folderRowsById, folderCandidatesById, index = 0) {
  const imageUserId = normalizeMaybeId(row?.user_id ?? row?.userId);
  const folderId = normalizeMaybeId(row?.folder_id ?? row?.folderId);
  const folder = folderId ? folderRowsById.get(folderId) : null;
  const folderCandidate = folderId ? folderCandidatesById.get(folderId) : null;
  const strongOrgId = getStrongOrganizationId(row) || getStrongOrganizationId(folder);
  const weakOrgId = getWeakOrganizationEvidence(row) || getWeakOrganizationEvidence(folder);
  const ambiguityReasons = [];
  let ownerClass = "legacy_unclassified_asset";
  let confidence = "none";
  let inferredOwningOrganizationId = null;
  let blockedReason = null;

  if (folderId && !folder) {
    ownerClass = "orphan_reference";
    confidence = "none";
    blockedReason = "image_references_missing_folder";
    ambiguityReasons.push("missing_folder_reference");
  } else {
    const folderUserId = normalizeMaybeId(folder?.user_id ?? folder?.userId);
    const hasFolderUserConflict = Boolean(folderUserId && imageUserId && folderUserId !== imageUserId);
    if (hasFolderUserConflict) {
      ownerClass = isPublicRow(row) ? "unsafe_to_migrate" : "ambiguous_owner";
      confidence = "none";
      blockedReason = isPublicRow(row)
        ? "public_image_has_folder_user_conflict"
        : "folder_user_conflicts_with_image_user";
      ambiguityReasons.push("folder_image_user_conflict");
      if (isPublicRow(row)) ambiguityReasons.push("public_owner_ambiguity");
    } else if (hasAdminTestEvidence(row)) {
      ownerClass = "platform_admin_test_asset";
      confidence = "medium";
      ambiguityReasons.push("admin_test_source_evidence");
    } else if (strongOrgId) {
      ownerClass = "organization_asset";
      confidence = "high";
      inferredOwningOrganizationId = strongOrgId;
      ambiguityReasons.push("explicit_organization_owner_evidence");
      if (folderCandidate?.inferredOwnerClass === "personal_user_asset") {
        ambiguityReasons.push("folder_currently_user_owned");
      }
    } else if (imageUserId) {
      ownerClass = "personal_user_asset";
      confidence = "medium";
      ambiguityReasons.push("user_id_only_current_model");
    } else {
      ambiguityReasons.push("missing_user_owner");
      blockedReason = "image_has_no_safe_user_or_org_owner_evidence";
    }
  }

  if (weakOrgId && !strongOrgId) {
    ambiguityReasons.push("weak_org_signal_ignored");
  }

  const derivativeRisk = hasDerivativeKey(row) && confidence !== "high"
    ? "derivative_parent_ownership_not_high_confidence"
    : "inherits_parent_owner";
  if (derivativeRisk !== "inherits_parent_owner") {
    ambiguityReasons.push("derivative_parent_ownership_unclear");
  }

  return {
    ...buildCandidateBase({
      table: "ai_images",
      id: row?.id,
      index,
      userId: imageUserId,
      folderId,
    }),
    inferredOwnerClass: ownerClass,
    inferredOwningOrganizationId,
    confidence,
    ambiguityReasons,
    requiredFutureMigrationAction: requiredActionForClass(ownerClass),
    blockedReason,
    relatedR2KeyFields: relatedR2Fields(row, ["r2_key", "thumb_key", "medium_key"]),
    relatedDerivativeFields: {
      thumb_key: sanitizeR2Key(row?.thumb_key),
      medium_key: sanitizeR2Key(row?.medium_key),
      derivativeOwnershipRisk: derivativeRisk,
    },
    publicGalleryRisk: publicGalleryRiskForRow(row, ownerClass),
    lifecycleExportDeleteRisk: lifecycleRiskForClass(ownerClass),
    storageQuotaRisk: storageQuotaRiskForClass(ownerClass),
  };
}

function summarizeCandidates(candidates) {
  const byOwnerClass = {};
  const byConfidence = {};
  const ambiguityReasons = {};
  for (const candidate of candidates) {
    byOwnerClass[candidate.inferredOwnerClass] = (byOwnerClass[candidate.inferredOwnerClass] || 0) + 1;
    byConfidence[candidate.confidence] = (byConfidence[candidate.confidence] || 0) + 1;
    for (const reason of candidate.ambiguityReasons || []) {
      ambiguityReasons[reason] = (ambiguityReasons[reason] || 0) + 1;
    }
  }
  return {
    candidateCount: candidates.length,
    byOwnerClass,
    byConfidence,
    ambiguityReasons,
    blockedCandidateCount: candidates.filter((candidate) => candidate.blockedReason).length,
    publicRiskCandidateCount: candidates.filter((candidate) => candidate.publicGalleryRisk && candidate.publicGalleryRisk !== "none").length,
    derivativeRiskCandidateCount: candidates.filter((candidate) => (
      candidate.relatedDerivativeFields?.derivativeOwnershipRisk === "derivative_parent_ownership_not_high_confidence"
    )).length,
  };
}

function buildFoldersImagesSourceEvidence(repoRoot) {
  const domains = ASSET_DOMAINS
    .filter((domain) => domain.id === "ai_folders" || domain.id === "ai_images")
    .map((domain) => ({
      ...domain,
      evidence: evidenceForDomain(repoRoot, domain),
      readiness: "blocked_needs_owner_map",
    }));
  return {
    domains,
    findings: domains.flatMap(buildFindings),
  };
}

export function buildFoldersImagesOwnerMapDryRunReport(repoRoot = process.cwd(), options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const fixturePath = resolveFixturePath(repoRoot, options.fixturePath);
  const fixture = fixturePath ? readJsonFile(fixturePath) : null;
  const folders = Array.isArray(fixture?.folders) ? fixture.folders : [];
  const images = Array.isArray(fixture?.images) ? fixture.images : [];
  const { domains, findings } = buildFoldersImagesSourceEvidence(repoRoot);
  const ownershipMigrationExists = fileExists(repoRoot, FOLDERS_IMAGES_OWNERSHIP_MIGRATION);
  const schemaReadinessStatus = ownershipMigrationExists ? "schema_added_not_backfilled" : "ready_for_schema";
  const writePathAssignment = buildFoldersImagesWritePathAssignment(repoRoot);
  const proposedSchema = Object.fromEntries(
    Object.entries(FOLDERS_IMAGES_PROPOSED_SCHEMA).map(([table, schema]) => [
      table,
      {
        ...schema,
        currentlyMissingFields: ownershipMigrationExists ? [] : schema.currentlyMissingFields,
        migrationFile: ownershipMigrationExists ? FOLDERS_IMAGES_OWNERSHIP_MIGRATION : null,
      },
    ])
  );
  const folderRowsById = new Map();
  const folderCandidatesById = new Map();
  const candidates = [];

  folders.forEach((folder, index) => {
    const folderId = normalizeMaybeId(folder?.id);
    if (folderId) folderRowsById.set(folderId, folder);
    const candidate = classifyFolderOwner(folder, index);
    candidates.push(candidate);
    if (folderId) folderCandidatesById.set(folderId, candidate);
  });

  images.forEach((image, index) => {
    candidates.push(classifyImageOwner(image, folderRowsById, folderCandidatesById, index));
  });

  const summary = summarizeCandidates(candidates);
  const readDiagnostics = buildTenantAssetReadDiagnosticsReport({
    folders,
    images,
    generatedAt,
    source: fixturePath ? "source_fixture_dry_run" : "repo_source_read_only",
    limit: options.limit || 100,
    includePublic: true,
    includeRelationships: true,
  });
  const manualReviewSignalCount = readDiagnostics.summary.needsManualReviewCount
    + readDiagnostics.summary.simulatedDualReadUnsafeCount
    + readDiagnostics.summary.metadataConflictCount
    + readDiagnostics.summary.relationshipConflictCount
    + readDiagnostics.summary.publicImagesWithMissingOrAmbiguousOwnership
    + readDiagnostics.summary.derivativeOwnershipRisks;
  const evidenceSummaryFile = "docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md";
  const evidenceDecisionFile = "docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md";
  const evidencePendingFile = "docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md";
  const manualReviewWorkflowFile = "docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md";
  const manualReviewPlanFile = "docs/tenant-assets/evidence/2026-05-17-main-folders-images-manual-review-plan.md";
  const manualReviewPlannerScript = "scripts/plan-tenant-asset-manual-review.mjs";
  const manualReviewImportDryRunScript = "scripts/dry-run-tenant-asset-manual-review-import.mjs";
  const manualReviewImportFixture = "scripts/fixtures/tenant-assets/folders-images-review-import-evidence.json";
  const manualReviewImportExecutorHelper = "workers/auth/src/lib/tenant-asset-manual-review-import.js";
  const manualReviewStateSchemaDesignFile = "docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md";
  const manualReviewStateSchemaMigrationFile = "workers/auth/migrations/0057_add_ai_asset_manual_review_state.sql";
  const realMainEvidenceFound = fileExists(repoRoot, evidenceSummaryFile);
  const evidenceDecisionReviewed = fileExists(repoRoot, evidenceDecisionFile);
  const manualReviewWorkflowDesigned = fileExists(repoRoot, manualReviewWorkflowFile)
    && fileExists(repoRoot, manualReviewPlanFile)
    && fileExists(repoRoot, manualReviewPlannerScript);
  const manualReviewStateSchemaDesigned = fileExists(repoRoot, manualReviewStateSchemaDesignFile);
  const manualReviewStateSchemaMigrationExists = fileExists(repoRoot, manualReviewStateSchemaMigrationFile);
  const manualReviewImportDryRunReady = fileExists(repoRoot, manualReviewImportDryRunScript);
  const manualReviewImportExecutorAdded = fileExists(repoRoot, manualReviewImportExecutorHelper);
  const mainEvidenceStatus = realMainEvidenceFound
    ? "needs_manual_review"
    : evidenceDecisionReviewed || fileExists(repoRoot, evidencePendingFile)
      ? "pending_main_evidence"
      : "not_recorded";
  const mainEvidenceNextPhase = realMainEvidenceFound
    ? manualReviewImportExecutorAdded
      ? "Phase 6.16 — Manual Review Item Import Operator Evidence"
      : manualReviewImportDryRunReady
      ? "Phase 6.15 — Operator Provides JSON Evidence for Item-level Review Import"
      : manualReviewStateSchemaMigrationExists
      ? "Phase 6.14 — Manual Review Item Import Dry Run for AI Folders & Images"
      : manualReviewStateSchemaDesigned
      ? "Phase 6.13 — Additive Manual Review State Schema for AI Folders & Images"
      : manualReviewWorkflowDesigned
        ? "Phase 6.12 — Manual Review State Schema Design for AI Folders & Images"
      : "Phase 6.11 — Manual Review Workflow Design for AI Folders & Images Owner-Map Issues"
    : "Phase 6.11 — Operator Collects Main Evidence Export for AI Folders & Images";

  return {
    reportVersion: "tenant-folders-images-owner-map-dry-run-v1",
    phase: "6.2",
    generatedAt,
    source: fixturePath ? "repo_source_and_fixture_read_only" : "repo_source_read_only",
    mutationMode: "dry_run_only",
    productionReadiness: "blocked",
    tenantIsolationReadiness: "blocked",
    budgetScope: "not_applicable",
    ownerMapClasses: FOLDERS_IMAGES_OWNER_MAP_CLASSES,
    readDiagnosticClasses: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATIONS,
    domain: "folders-images",
    scope: {
      tables: ["ai_folders", "ai_images"],
      excluded: ["ai_text_assets", "ai_video_jobs", "member/org billing ledgers", "public gallery behavior changes", "R2 object listing"],
    },
    schemaSummary: FOLDERS_IMAGES_SCHEMA_SUMMARY,
    schemaReadiness: {
      status: schemaReadinessStatus,
      migrationAdded: ownershipMigrationExists,
      migrationFile: ownershipMigrationExists ? FOLDERS_IMAGES_OWNERSHIP_MIGRATION : null,
      executableSqlEmitted: false,
      proposedOwnerValues: FOLDERS_IMAGES_PROPOSED_OWNER_VALUES,
      proposedSchema,
      currentlyMissingFields: Object.fromEntries(
        Object.entries(proposedSchema).map(([table, schema]) => [table, schema.currentlyMissingFields || []])
      ),
      readinessByTable: {
        ai_folders: schemaReadinessStatus,
        ai_images: schemaReadinessStatus,
      },
      migrationReadiness: [
        schemaReadinessStatus,
        "access_checks_not_changed",
        writePathAssignment.status,
        "read_diagnostics_added",
        "dual_read_safety_simulated",
        "backfill_not_started",
        "owner_map_not_complete",
      ],
    },
    writePathAssignment,
    accessImpactMatrix: FOLDERS_IMAGES_ACCESS_IMPACT_MATRIX,
    futureWritePathRules: FOLDERS_IMAGES_WRITE_PATH_RULES,
    backfillPolicy: FOLDERS_IMAGES_BACKFILL_POLICY,
    readDiagnostics,
    rules: FOLDERS_IMAGES_OWNER_MAP_RULES,
    fixture: {
      provided: Boolean(fixturePath),
      path: fixturePath ? path.relative(repoRoot, fixturePath) : null,
      folderCount: folders.length,
      imageCount: images.length,
    },
    summary: {
      folderCandidateCount: folders.length,
      imageCandidateCount: images.length,
      ...summary,
      sourceDomainCount: domains.length,
      sourceFindingCount: findings.length,
    },
    mutationSafety: {
      d1Writes: false,
      r2Writes: false,
      r2Deletes: false,
      r2Moves: false,
      cloudflareApiCalls: false,
      stripeApiCalls: false,
      providerCalls: false,
      emittedCommands: [],
      remoteQueries: false,
      backfillSqlEmitted: false,
    },
    sourceEvidence: {
      domains,
      findings,
      routeDomains: ROUTE_DOMAINS.filter((domain) => (
        domain.id === "member_private_assets" ||
        domain.id === "member_asset_writes" ||
        domain.id === "public_gallery" ||
        domain.id === "admin_storage" ||
        domain.id === "data_lifecycle"
      )),
      r2Bindings: R2_BINDINGS.filter((binding) => binding.binding === "USER_IMAGES"),
    },
    candidates,
    risks: {
      lifecycleExportDelete: "Current lifecycle/export/delete planning remains subject_user_id centered and has no organization subject path.",
      storageQuota: "Current storage quota is user_asset_storage_usage by user_id only.",
      publicGallery: "Mempics public attribution joins profiles by ai_images.user_id; organization publisher policy is absent.",
      r2Keys: "USER_IMAGES keys are owner hints, not tenant ownership proof; no live R2 listing is performed.",
    },
    schemaAccessImpact: {
      routesNeedingFutureAccessUpdates: FOLDERS_IMAGES_ACCESS_IMPACT_MATRIX.map((entry) => entry.id),
      writePathsAssignedForNewRows: writePathAssignment.assigned.map((entry) => entry.id),
      writePathsStillNotAssigned: writePathAssignment.notAssigned.map((entry) => entry.id),
      writePathsNeedingFutureOwnershipAssignment: FOLDERS_IMAGES_WRITE_PATH_RULES
        .map((entry) => entry.id)
        .filter((id) => id !== "folder_personal_context" && id !== "personal_generation"),
      lifecycleExportDeleteGap: "organization-owned folder/image lifecycle plans are not implemented",
      storageQuotaGap: "organization storage counters are not implemented",
      publicGalleryGap: "organization publisher attribution is not implemented",
      phase63BehaviorChange: false,
      phase64BehaviorChange: false,
      phase65AccessBehaviorChange: false,
      phase66AccessBehaviorChange: false,
      readDiagnosticsAdded: true,
      dualReadSafetySimulated: true,
      adminEvidenceReportReady: true,
      adminEvidenceEndpoint: "/api/admin/tenant-assets/folders-images/evidence",
      adminEvidenceExportEndpoint: "/api/admin/tenant-assets/folders-images/evidence/export",
      adminEvidenceExportFormats: ["json", "markdown"],
      readDiagnosticsSummary: {
        simulatedDualReadSafeCount: readDiagnostics.summary.simulatedDualReadSafeCount,
        simulatedDualReadUnsafeCount: readDiagnostics.summary.simulatedDualReadUnsafeCount,
        metadataMissingCount: (
          readDiagnostics.summary.foldersWithNullOwnershipMetadata +
          readDiagnostics.summary.imagesWithNullOwnershipMetadata
        ),
        needsManualReviewCount: readDiagnostics.summary.needsManualReviewCount,
        relationshipConflictCount: readDiagnostics.summary.relationshipConflictCount,
        publicUnsafeCount: readDiagnostics.summary.publicImagesWithMissingOrAmbiguousOwnership,
        derivativeRiskCount: readDiagnostics.summary.derivativeOwnershipRisks,
      },
      manualReviewRollup: {
        needsManualReviewCount: readDiagnostics.summary.needsManualReviewCount,
        unsafeToSwitchCount: readDiagnostics.summary.simulatedDualReadUnsafeCount,
        metadataConflictCount: readDiagnostics.summary.metadataConflictCount,
        relationshipConflictCount: readDiagnostics.summary.relationshipConflictCount,
        publicUnsafeCount: readDiagnostics.summary.publicImagesWithMissingOrAmbiguousOwnership,
        derivativeRiskCount: readDiagnostics.summary.derivativeOwnershipRisks,
        totalReviewSignals: manualReviewSignalCount,
      },
    },
    adminEvidenceReport: {
      status: "admin_evidence_report_ready",
      readOnly: true,
      endpoint: "/api/admin/tenant-assets/folders-images/evidence",
      exportEndpoint: "/api/admin/tenant-assets/folders-images/evidence/export",
      exportFormats: ["json", "markdown"],
      routePolicyRequired: true,
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      backfillPerformed: false,
      r2LiveListed: false,
      manualReviewRollup: {
        needsManualReviewCount: readDiagnostics.summary.needsManualReviewCount,
        unsafeToSwitchCount: readDiagnostics.summary.simulatedDualReadUnsafeCount,
        metadataConflictCount: readDiagnostics.summary.metadataConflictCount,
        relationshipConflictCount: readDiagnostics.summary.relationshipConflictCount,
        publicUnsafeCount: readDiagnostics.summary.publicImagesWithMissingOrAmbiguousOwnership,
        derivativeRiskCount: readDiagnostics.summary.derivativeOwnershipRisks,
        totalReviewSignals: manualReviewSignalCount,
      },
    },
    mainEvidencePackage: {
      status: mainEvidenceStatus,
      directory: "docs/tenant-assets/evidence/",
      index: "docs/tenant-assets/evidence/README.md",
      evidenceSummaryFile: realMainEvidenceFound ? evidenceSummaryFile : null,
      pendingFile: evidencePendingFile,
      decisionFile: evidenceDecisionFile,
      decisionReviewed: evidenceDecisionReviewed,
      realMainEvidenceFoundInRepo: realMainEvidenceFound,
      activeWorkflow: "main_only",
      accessSwitchDecision: "blocked",
      backfillDecision: "blocked",
      manualReviewDecision: realMainEvidenceFound ? "required" : "pending_real_main_evidence",
      accessChecksChanged: false,
      backfillPerformed: false,
      r2LiveListed: false,
      recommendedNextPhase: mainEvidenceNextPhase,
    },
    manualReviewWorkflow: {
      status: manualReviewWorkflowDesigned ? "manual_review_workflow_designed" : "not_recorded",
      workflowDoc: manualReviewWorkflowDesigned ? manualReviewWorkflowFile : null,
      planDoc: manualReviewWorkflowDesigned ? manualReviewPlanFile : null,
      plannerScript: manualReviewWorkflowDesigned ? manualReviewPlannerScript : null,
      designOnly: true,
      reviewExecutionAdded: manualReviewImportExecutorAdded,
      endpointAdded: manualReviewImportExecutorAdded,
      adminUiAdded: false,
      migrationAdded: false,
      accessChecksChanged: false,
      backfillPerformed: false,
      r2LiveListed: false,
      issueCategories: [
        "metadata_missing",
        "public_unsafe",
        "derivative_risk",
        "dual_read_unsafe",
        "manual_review_needed",
        "relationship_review",
        "legacy_unclassified",
        "future_org_ownership_review",
        "platform_admin_test_review",
        "safe_observe_only",
      ],
      reviewStatuses: [
        "pending_review",
        "review_in_progress",
        "approved_personal_user_asset",
        "approved_organization_asset",
        "approved_legacy_unclassified",
        "approved_platform_admin_test_asset",
        "blocked_public_unsafe",
        "blocked_derivative_risk",
        "blocked_relationship_conflict",
        "blocked_missing_evidence",
        "needs_legal_privacy_review",
        "deferred",
        "rejected",
        "superseded",
      ],
      recommendedNextPhase: manualReviewStateSchemaDesigned
        ? manualReviewImportExecutorAdded
          ? "Phase 6.16 — Manual Review Item Import Operator Evidence"
          : manualReviewImportDryRunReady
          ? "Phase 6.15 — Operator Provides JSON Evidence for Item-level Review Import"
          : manualReviewStateSchemaMigrationExists
          ? "Phase 6.14 — Manual Review Item Import Dry Run for AI Folders & Images"
          : "Phase 6.13 — Additive Manual Review State Schema for AI Folders & Images"
        : "Phase 6.12 — Manual Review State Schema Design for AI Folders & Images",
    },
    manualReviewStateSchema: {
      status: manualReviewStateSchemaMigrationExists
        ? "manual_review_state_schema_added"
        : manualReviewStateSchemaDesigned
        ? "manual_review_state_schema_designed"
        : "not_recorded",
      designDoc: manualReviewStateSchemaDesigned ? manualReviewStateSchemaDesignFile : null,
      expectedFutureMigration: manualReviewStateSchemaMigrationExists ? null : manualReviewStateSchemaMigrationFile,
      migrationFile: manualReviewStateSchemaMigrationExists ? manualReviewStateSchemaMigrationFile : null,
      migrationAdded: manualReviewStateSchemaMigrationExists,
      reviewTablesPresent: manualReviewStateSchemaMigrationExists,
      reviewRowsCreated: false,
      reviewRowsImported: false,
      reviewRowsNotImported: true,
      reviewItemImportAdded: manualReviewImportExecutorAdded,
      reviewItemImportExecutorAdded: manualReviewImportExecutorAdded,
      reviewItemImportExecutorHelper: manualReviewImportExecutorAdded ? manualReviewImportExecutorHelper : null,
      reviewItemImportDryRunReady: manualReviewImportDryRunReady,
      reviewItemImportDryRunScript: manualReviewImportDryRunReady ? manualReviewImportDryRunScript : null,
      reviewItemImportDryRunFixture: fileExists(repoRoot, manualReviewImportFixture) ? manualReviewImportFixture : null,
      endpointAdded: manualReviewImportExecutorAdded,
      importEndpoint: manualReviewImportExecutorAdded
        ? "/api/admin/tenant-assets/folders-images/manual-review/import"
        : null,
      adminUiAdded: false,
      accessChecksChanged: false,
      backfillPerformed: false,
      backfillNotStarted: true,
      r2LiveListed: false,
      futureImportRequired: !manualReviewImportExecutorAdded,
      futureImportExecutionRequiresAdminApproval: manualReviewImportExecutorAdded,
      stateRowsExpectedAfterMigration: 0,
      proposedTables: [
        "ai_asset_manual_review_items",
        "ai_asset_manual_review_events",
      ],
      proposedIndexes: [
        "idx_ai_asset_manual_review_items_domain_asset",
        "idx_ai_asset_manual_review_items_status",
        "idx_ai_asset_manual_review_items_category",
        "idx_ai_asset_manual_review_items_severity",
        "idx_ai_asset_manual_review_items_priority",
        "idx_ai_asset_manual_review_items_created_at",
        "idx_ai_asset_manual_review_items_evidence_source",
        "idx_ai_asset_manual_review_events_item",
        "idx_ai_asset_manual_review_events_idempotency",
      ],
      futureActions: [
        "create_review_item_from_evidence",
        "assign_review_item",
        "add_review_note",
        "mark_approved_personal",
        "mark_approved_organization",
        "mark_approved_legacy",
        "mark_blocked_public_unsafe",
        "mark_blocked_derivative_risk",
        "mark_needs_legal_privacy_review",
        "mark_deferred",
        "mark_superseded",
      ],
      recommendedNextPhase: manualReviewStateSchemaMigrationExists
        ? manualReviewImportExecutorAdded
          ? "Phase 6.16 — Manual Review Item Import Operator Evidence"
          : manualReviewImportDryRunReady
          ? "Phase 6.15 — Operator Provides JSON Evidence for Item-level Review Import"
          : "Phase 6.14 — Manual Review Item Import Dry Run for AI Folders & Images"
        : "Phase 6.13 — Additive Manual Review State Schema for AI Folders & Images",
    },
    manualReviewImportDryRun: {
      status: manualReviewImportDryRunReady ? "manual_review_import_dry_run_ready" : "not_recorded",
      script: manualReviewImportDryRunReady ? manualReviewImportDryRunScript : null,
      packageScript: manualReviewImportDryRunReady ? "tenant-assets:dry-run-review-import" : null,
      realMainEvidenceInput: realMainEvidenceFound ? evidenceSummaryFile : null,
      syntheticJsonFixture: fileExists(repoRoot, manualReviewImportFixture) ? manualReviewImportFixture : null,
      markdownSummaryItemLevelImportReady: false,
      requiresJsonEvidenceForItemImport: true,
      proposedReviewItemsCreated: false,
      reviewRowsCreated: false,
      reviewRowsImported: false,
      executableSqlEmitted: false,
      backfillPerformed: false,
      accessChecksChanged: false,
      r2LiveListed: false,
      endpointAdded: false,
      adminUiAdded: false,
      dedupeKeyDesign: "asset_domain + asset_id + related_asset_id + issue_category + evidence_source_path; aggregate-only buckets use issue_category + evidence_source_path + evidence timestamp",
      recommendedNextPhase: manualReviewImportDryRunReady
        ? manualReviewImportExecutorAdded
          ? "Phase 6.16 — Manual Review Item Import Operator Evidence"
          : "Phase 6.15 — Operator Provides JSON Evidence for Item-level Review Import"
        : "Phase 6.14 — Manual Review Item Import Dry Run for AI Folders & Images",
    },
    manualReviewImportExecutor: {
      status: manualReviewImportExecutorAdded ? "manual_review_import_executor_added" : "not_recorded",
      endpoint: manualReviewImportExecutorAdded
        ? "/api/admin/tenant-assets/folders-images/manual-review/import"
        : null,
      helper: manualReviewImportExecutorAdded ? manualReviewImportExecutorHelper : null,
      defaultDryRun: true,
      executeRequiresConfirm: true,
      executeRequiresReason: true,
      idempotencyRequired: true,
      routePolicyRequired: true,
      writesReviewItemsAndEventsOnly: true,
      reviewRowsCreatedByDryRun: false,
      sourceAssetRowsMutated: false,
      ownershipBackfillPerformed: false,
      accessChecksChanged: false,
      r2LiveListed: false,
      providerCalls: false,
      stripeCalls: false,
      cloudflareCalls: false,
      adminUiAdded: false,
      migrationAdded: false,
      recommendedNextPhase: manualReviewImportExecutorAdded
        ? "Phase 6.16 — Manual Review Item Import Operator Evidence"
        : "Phase 6.15 — Admin-approved Manual Review Item Import Executor",
    },
    blockedUntil: [
      writePathAssignment.status === "write_paths_assigned_for_new_rows"
        ? "Read diagnostics compare existing user_id access with new ownership metadata before any access-check switch."
        : "Write paths assign ownership metadata for new rows.",
      manualReviewStateSchemaMigrationExists
        ? manualReviewImportExecutorAdded
          ? "Confirmed review-item import operator evidence is collected before any review-status workflow, ownership backfill, or access-check switch."
          : manualReviewImportDryRunReady
          ? "Item-level JSON evidence is provided before any review-item import executor is approved."
          : "Manual-review item import remains future and must start as dry-run evidence planning without ownership mutation."
        : manualReviewStateSchemaDesigned
        ? "Additive manual-review state tables are added in a future approved migration without importing review rows."
        : "Manual review state schema is designed for real-row owner-map metadata-missing, public unsafe, derivative-risk, dual-read-unsafe, and manual-review findings.",
      "Organization ownership is backed by explicit row-level evidence, not UI active organization context.",
      "Public gallery attribution and lifecycle/export/delete impacts are designed.",
      "Operator evidence is reviewed before any backfill.",
    ],
    limitations: [
      "No live D1 rows are queried.",
      "No live R2 objects are listed.",
      "Fixture data is synthetic and deterministic.",
      "Source-only mode reports domain/rule readiness, not row counts.",
      "No runtime access behavior changes are made.",
    ],
    recommendedNextPhase: writePathAssignment.status === "write_paths_assigned_for_new_rows"
      ? mainEvidenceNextPhase
      : ownershipMigrationExists
        ? "Phase 6.5 — Write-path Ownership Assignment for New AI Folders & Images"
      : "Phase 6.4 — Additive Ownership Metadata Schema for AI Folders & Images",
  };
}

export function buildTenantAssetOwnershipDryRunReport(repoRoot = process.cwd(), options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const assetDomains = ASSET_DOMAINS.map((domain) => ({
    ...domain,
    evidence: evidenceForDomain(repoRoot, domain),
    readiness: domain.risk === "high" ? "blocked_needs_owner_map" : "review_required",
  }));
  const findings = assetDomains.flatMap(buildFindings);
  const missingOrganizationOwnerDomains = assetDomains.filter((domain) => (
    domain.targetOwnerFields.includes("owning_organization_id") &&
    !domain.currentOwnerFields.includes("organization_id")
  ));
  const lifecycleGaps = findings.filter((finding) => finding.code.includes("lifecycle") || finding.code.includes("export_delete"));

  return {
    reportVersion: "tenant-asset-ownership-dry-run-v1",
    phase: "6.1",
    generatedAt,
    source: "repo_source_read_only",
    mutationMode: "dry_run_only",
    productionReadiness: "blocked",
    tenantIsolationReadiness: "blocked",
    ownerClasses: TENANT_ASSET_OWNER_CLASSES,
    summary: {
      assetDomainCount: assetDomains.length,
      routeDomainCount: ROUTE_DOMAINS.length,
      r2BindingCount: R2_BINDINGS.length,
      highRiskDomainCount: assetDomains.filter((domain) => domain.risk === "high").length,
      missingOrganizationOwnerDomainCount: missingOrganizationOwnerDomains.length,
      lifecycleGapCount: lifecycleGaps.length,
      futurePhaseCount: FUTURE_PHASES.length,
    },
    mutationSafety: {
      d1Writes: false,
      r2Writes: false,
      r2Deletes: false,
      r2Moves: false,
      cloudflareApiCalls: false,
      stripeApiCalls: false,
      providerCalls: false,
      emittedCommands: [],
      remoteQueries: false,
    },
    assetDomains,
    routeDomains: ROUTE_DOMAINS,
    r2Bindings: R2_BINDINGS,
    findings,
    lifecycleGaps,
    blockedUntil: [
      "Read-only diagnostics prove new ownership metadata matches legacy access behavior where present.",
    "Manual review workflow and future review-state schema are defined for real-row owner-map metadata-missing, public unsafe, derivative-risk, dual-read-unsafe, and manual-review findings.",
      "R2 key ownership is reconciled against D1 rows without object moves or deletes.",
      "Lifecycle/export/delete plans support organization subjects.",
      "Operator evidence is reviewed before any non-destructive backfill.",
    ],
    limitations: [
      "This phase reads repository source and migration files only.",
      "No live D1 rows or R2 objects are listed.",
      "Counts are structural inventory counts, not production data counts.",
      "Ambiguous legacy rows remain legacy_unclassified_asset until a later owner-map dry run uses approved local or main-only evidence data.",
    ],
    futurePhases: FUTURE_PHASES,
  };
}

export function renderTenantAssetOwnershipMarkdown(report) {
  const lines = [
    "# Tenant Asset Ownership Dry Run",
    "",
    `Generated at: ${report.generatedAt}`,
    `Source: ${report.source}`,
    `Mutation mode: ${report.mutationMode}`,
    `Tenant isolation readiness: ${report.tenantIsolationReadiness}`,
    "",
    "## Summary",
    "",
    `- Asset domains: ${report.summary.assetDomainCount}`,
    `- High-risk domains: ${report.summary.highRiskDomainCount}`,
    `- Domains missing organization owner fields: ${report.summary.missingOrganizationOwnerDomainCount}`,
    `- Lifecycle gaps: ${report.summary.lifecycleGapCount}`,
    "",
    "## Asset Domains",
    "",
    "| Domain | Table | Current owner | Target class | Risk | Readiness |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.assetDomains.map((domain) => (
      `| ${domain.id} | ${domain.table} | ${domain.currentOwnerFields.join(", ")} | ${domain.targetClass} | ${domain.risk} | ${domain.readiness} |`
    )),
    "",
    "## Safety",
    "",
    "- No D1 writes.",
    "- No R2 writes, moves, or deletes.",
    "- No Cloudflare, Stripe, or provider calls.",
  ];
  return `${lines.join("\n")}\n`;
}

export function renderFoldersImagesOwnerMapMarkdown(report) {
  const lines = [
    "# AI Folders & Images Owner-Map Dry Run",
    "",
    `Generated at: ${report.generatedAt}`,
    `Source: ${report.source}`,
    `Mutation mode: ${report.mutationMode}`,
    `Tenant isolation readiness: ${report.tenantIsolationReadiness}`,
    "",
    "## Summary",
    "",
    `- Folder candidates: ${report.summary.folderCandidateCount}`,
    `- Image candidates: ${report.summary.imageCandidateCount}`,
    `- Blocked candidates: ${report.summary.blockedCandidateCount}`,
    `- Public-risk candidates: ${report.summary.publicRiskCandidateCount}`,
    `- Derivative-risk candidates: ${report.summary.derivativeRiskCandidateCount}`,
    `- Schema readiness: ${report.schemaReadiness?.status || "not_reported"}`,
    `- Ownership migration added: ${report.schemaReadiness?.migrationAdded ? "yes" : "no"}`,
    `- Write path assignment: ${report.writePathAssignment?.status || "not_reported"}`,
    `- Phase 6.3 behavior change: ${report.schemaAccessImpact?.phase63BehaviorChange === false ? "no" : "review"}`,
    `- Phase 6.4 behavior change: ${report.schemaAccessImpact?.phase64BehaviorChange === false ? "no" : "review"}`,
    `- Phase 6.5 access behavior change: ${report.schemaAccessImpact?.phase65AccessBehaviorChange === false ? "no" : "review"}`,
    `- Phase 6.6 access behavior change: ${report.schemaAccessImpact?.phase66AccessBehaviorChange === false ? "no" : "review"}`,
    `- Read diagnostics added: ${report.schemaAccessImpact?.readDiagnosticsAdded ? "yes" : "no"}`,
    `- Admin evidence report ready: ${report.schemaAccessImpact?.adminEvidenceReportReady ? "yes" : "no"}`,
    `- Simulated dual-read safe items: ${report.readDiagnostics?.summary?.simulatedDualReadSafeCount ?? 0}`,
    `- Simulated dual-read unsafe items: ${report.readDiagnostics?.summary?.simulatedDualReadUnsafeCount ?? 0}`,
    "",
    "## Proposed Schema Fields",
    "",
    "| Table | Remaining missing fields | Migration file |",
    "| --- | --- | --- |",
    ...Object.entries(report.schemaReadiness?.proposedSchema || {}).map(([table, plan]) => (
      `| ${table} | ${(plan.currentlyMissingFields || []).join(", ") || "none"} | ${plan.migrationFile || "not added"} |`
    )),
    "",
    "## Write Path Assignment",
    "",
    "| Write path | Route | Table | Owner class | Source |",
    "| --- | --- | --- | --- | --- |",
    ...(report.writePathAssignment?.assigned || []).map((entry) => (
      `| ${entry.id} | ${entry.route} | ${entry.table} | ${entry.ownerClass} | ${entry.source} |`
    )),
    "",
    "Remaining gaps:",
    "",
    ...(report.writePathAssignment?.notAssigned || []).map((entry) => `- ${entry.id}: ${entry.reason}`),
    "",
    "## Access Impact",
    "",
    "| Area | Current basis | Future basis | Phase 6.3 behavior change |",
    "| --- | --- | --- | --- |",
    ...report.accessImpactMatrix.map((entry) => (
      `| ${entry.id} | ${entry.currentAccessBasis} | ${entry.proposedAccessBasis} | ${entry.phase63BehaviorChange} |`
    )),
    "",
    "## Owner Classes",
    "",
    "| Owner class | Count |",
    "| --- | ---: |",
    ...Object.entries(report.summary.byOwnerClass || {}).map(([ownerClass, count]) => `| ${ownerClass} | ${count} |`),
    "",
    "## Classification Rules",
    "",
    ...report.rules.map((rule) => `- ${rule.id}: ${rule.summary}`),
    "",
    "## Candidates",
    "",
    "| Candidate | Table | Current user | Folder | Class | Confidence | Blocked reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.candidates.map((candidate) => (
      `| ${candidate.candidateId} | ${candidate.sourceTable} | ${candidate.currentUserOwner || ""} | ${candidate.currentFolderId || ""} | ${candidate.inferredOwnerClass} | ${candidate.confidence} | ${candidate.blockedReason || ""} |`
    )),
    "",
    "## Read Diagnostics",
    "",
    "| Domain | Item | Classification | Severity | Reason |",
    "| --- | --- | --- | --- | --- |",
    ...[
      ...(report.readDiagnostics?.folderDiagnostics || []),
      ...(report.readDiagnostics?.imageDiagnostics || []),
      ...(report.readDiagnostics?.relationshipDiagnostics || []),
      ...(report.readDiagnostics?.publicGalleryDiagnostics || []),
      ...(report.readDiagnostics?.derivativeDiagnostics || []),
    ].map((item) => (
      `| ${item.domain} | ${item.sourceId || item.id} | ${item.classification} | ${item.severity} | ${item.reason} |`
    )),
    "",
    "## Admin Evidence Report",
    "",
    `- Status: ${report.adminEvidenceReport?.status || "not_ready"}`,
    `- Endpoint: ${report.adminEvidenceReport?.endpoint || "not_added"}`,
    `- Export endpoint: ${report.adminEvidenceReport?.exportEndpoint || "not_added"}`,
    `- Export formats: ${(report.adminEvidenceReport?.exportFormats || []).join(", ") || "none"}`,
    `- Manual review signals: ${report.adminEvidenceReport?.manualReviewRollup?.totalReviewSignals ?? 0}`,
    "",
    "## Main Evidence Package",
    "",
    `- Status: ${report.mainEvidencePackage?.status || "not_recorded"}`,
    `- Directory: ${report.mainEvidencePackage?.directory || "not_recorded"}`,
    `- Active workflow: ${report.mainEvidencePackage?.activeWorkflow || "main_only"}`,
    `- Evidence summary file: ${report.mainEvidencePackage?.evidenceSummaryFile || "not_recorded"}`,
    `- Decision file: ${report.mainEvidencePackage?.decisionFile || "not_recorded"}`,
    `- Decision reviewed: ${report.mainEvidencePackage?.decisionReviewed ? "yes" : "no"}`,
    `- Real main evidence found in repo: ${report.mainEvidencePackage?.realMainEvidenceFoundInRepo ? "yes" : "no"}`,
    `- Access switch decision: ${report.mainEvidencePackage?.accessSwitchDecision || "blocked"}`,
    `- Backfill decision: ${report.mainEvidencePackage?.backfillDecision || "blocked"}`,
    `- Manual review decision: ${report.mainEvidencePackage?.manualReviewDecision || "pending_real_main_evidence"}`,
    `- Recommended next phase: ${report.mainEvidencePackage?.recommendedNextPhase || report.recommendedNextPhase || "not_recorded"}`,
    "",
    "## Manual Review Workflow",
    "",
    `- Status: ${report.manualReviewWorkflow?.status || "not_recorded"}`,
    `- Workflow doc: ${report.manualReviewWorkflow?.workflowDoc || "not_recorded"}`,
    `- Plan doc: ${report.manualReviewWorkflow?.planDoc || "not_recorded"}`,
    `- Planner script: ${report.manualReviewWorkflow?.plannerScript || "not_recorded"}`,
    `- Design only: ${report.manualReviewWorkflow?.designOnly ? "yes" : "no"}`,
    `- Review execution added: ${report.manualReviewWorkflow?.reviewExecutionAdded ? "yes" : "no"}`,
    `- Recommended next phase: ${report.manualReviewWorkflow?.recommendedNextPhase || report.recommendedNextPhase || "not_recorded"}`,
    "",
    "## Manual Review State Schema",
    "",
    `- Status: ${report.manualReviewStateSchema?.status || "not_recorded"}`,
    `- Design doc: ${report.manualReviewStateSchema?.designDoc || "not_recorded"}`,
    `- Expected future migration: ${report.manualReviewStateSchema?.expectedFutureMigration || "not_recorded"}`,
    `- Migration added: ${report.manualReviewStateSchema?.migrationAdded ? "yes" : "no"}`,
    `- Review rows created: ${report.manualReviewStateSchema?.reviewRowsCreated ? "yes" : "no"}`,
    `- Import dry run ready: ${report.manualReviewStateSchema?.reviewItemImportDryRunReady ? "yes" : "no"}`,
    `- Import dry run script: ${report.manualReviewStateSchema?.reviewItemImportDryRunScript || "not_recorded"}`,
    `- Proposed tables: ${(report.manualReviewStateSchema?.proposedTables || []).join(", ") || "none"}`,
    `- Proposed indexes: ${(report.manualReviewStateSchema?.proposedIndexes || []).join(", ") || "none"}`,
    `- Recommended next phase: ${report.manualReviewStateSchema?.recommendedNextPhase || report.recommendedNextPhase || "not_recorded"}`,
    "",
    "## Manual Review Import Dry Run",
    "",
    `- Status: ${report.manualReviewImportDryRun?.status || "not_recorded"}`,
    `- Script: ${report.manualReviewImportDryRun?.script || "not_recorded"}`,
    `- Package script: ${report.manualReviewImportDryRun?.packageScript || "not_recorded"}`,
    `- Markdown summary item-level import ready: ${report.manualReviewImportDryRun?.markdownSummaryItemLevelImportReady ? "yes" : "no"}`,
    `- Requires JSON evidence for item import: ${report.manualReviewImportDryRun?.requiresJsonEvidenceForItemImport ? "yes" : "no"}`,
    `- Review rows imported: ${report.manualReviewImportDryRun?.reviewRowsImported ? "yes" : "no"}`,
    `- Executable SQL emitted: ${report.manualReviewImportDryRun?.executableSqlEmitted ? "yes" : "no"}`,
    `- Dedupe key design: ${report.manualReviewImportDryRun?.dedupeKeyDesign || "not_recorded"}`,
    `- Recommended next phase: ${report.manualReviewImportDryRun?.recommendedNextPhase || report.recommendedNextPhase || "not_recorded"}`,
    "",
    "## Manual Review Import Executor",
    "",
    `- Status: ${report.manualReviewImportExecutor?.status || "not_recorded"}`,
    `- Endpoint: ${report.manualReviewImportExecutor?.endpoint || "not_recorded"}`,
    `- Defaults to dry-run: ${report.manualReviewImportExecutor?.defaultDryRun ? "yes" : "no"}`,
    `- Execution requires confirmation: ${report.manualReviewImportExecutor?.executeRequiresConfirm ? "yes" : "no"}`,
    `- Idempotency required: ${report.manualReviewImportExecutor?.idempotencyRequired ? "yes" : "no"}`,
    `- Writes review rows/events only: ${report.manualReviewImportExecutor?.writesReviewItemsAndEventsOnly ? "yes" : "no"}`,
    `- Source asset rows mutated: ${report.manualReviewImportExecutor?.sourceAssetRowsMutated ? "yes" : "no"}`,
    `- Recommended next phase: ${report.manualReviewImportExecutor?.recommendedNextPhase || report.recommendedNextPhase || "not_recorded"}`,
    "",
    "## Safety",
    "",
    "- This dry-run performs no D1 writes.",
    "- Phase 6.15 executor writes only manual-review rows/events when explicitly confirmed by an admin.",
    "- No R2 writes, moves, deletes, copies, or live listings.",
    "- No Cloudflare, Stripe, GitHub, or provider calls.",
    "- No owner backfill SQL is emitted.",
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    markdown: false,
    format: "json",
    domain: null,
    fixtures: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--markdown") {
      args.markdown = true;
      args.format = "markdown";
    } else if (arg === "--format") {
      args.format = String(argv[index + 1] || "json").trim().toLowerCase();
      index += 1;
    } else if (arg.startsWith("--format=")) {
      args.format = arg.slice("--format=".length).trim().toLowerCase();
    } else if (arg === "--domain") {
      args.domain = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg.startsWith("--domain=")) {
      args.domain = arg.slice("--domain=".length).trim();
    } else if (arg === "--fixtures") {
      args.fixtures = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg.startsWith("--fixtures=")) {
      args.fixtures = arg.slice("--fixtures=".length).trim();
    }
  }
  if (args.format !== "json" && args.format !== "markdown") {
    throw new Error("Unsupported format. Use json or markdown.");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (args.domain === "folders-images") {
    const report = buildFoldersImagesOwnerMapDryRunReport(repoRoot, {
      fixturePath: args.fixtures,
    });
    if (args.markdown || args.format === "markdown") {
      process.stdout.write(renderFoldersImagesOwnerMapMarkdown(report));
      return;
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const report = buildTenantAssetOwnershipDryRunReport(repoRoot);
  if (args.markdown || args.format === "markdown") {
    process.stdout.write(renderTenantAssetOwnershipMarkdown(report));
    return;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
