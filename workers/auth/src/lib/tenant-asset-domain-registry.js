export const TENANT_ASSET_DOMAIN_EVIDENCE_REPORT_VERSION = "tenant-asset-domain-evidence-v1";
export const TENANT_ASSET_DOMAIN_EVIDENCE_ENDPOINT = "/api/admin/tenant-assets/domains/evidence";

const OWNER_METADATA_COLUMNS = [
  "asset_owner_type",
  "owning_user_id",
  "owning_organization_id",
  "created_by_user_id",
  "ownership_status",
  "ownership_source",
  "ownership_confidence",
  "ownership_metadata_json",
  "ownership_assigned_at",
];

export const TENANT_ASSET_DOMAIN_REGISTRY = Object.freeze([
  {
    id: "ai_folders",
    label: "AI folders",
    sourceTables: ["ai_folders"],
    r2Families: [],
    exposure: "private_member_workspace_metadata",
    ownerFields: ["user_id", ...OWNER_METADATA_COLUMNS],
    ownershipMetadataSupport: "yes_new_rows_only",
    runtimeAccessCheckSource: "legacy_user_id",
    manualReviewSupport: "yes",
    resetSupport: "dry_run_and_gated_executor_limited",
    quotaStorageAccountingSupport: "indirect_folder_rollup",
    adminVisibilitySupport: "yes",
    deletionResetRisk: "high",
    currentStatus: "implemented_but_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["sanitized owner-map evidence", "manual-review replay/conflict evidence", "remote migration verification"],
  },
  {
    id: "ai_images",
    label: "AI images",
    sourceTables: ["ai_images"],
    r2Families: ["USER_IMAGES:users/{userId}/...", "USER_IMAGES:derivative keys via thumb_key/medium_key"],
    exposure: "private_or_public_gallery",
    ownerFields: ["user_id", ...OWNER_METADATA_COLUMNS],
    ownershipMetadataSupport: "yes_new_rows_only",
    runtimeAccessCheckSource: "legacy_user_id",
    manualReviewSupport: "yes",
    resetSupport: "dry_run_and_gated_executor_limited",
    quotaStorageAccountingSupport: "yes_size_bytes",
    adminVisibilitySupport: "yes",
    deletionResetRisk: "high",
    currentStatus: "implemented_but_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["sanitized owner-map evidence", "manual-review replay/conflict evidence", "storage quota reconciliation evidence"],
  },
  {
    id: "ai_image_derivatives",
    label: "AI image derivatives",
    sourceTables: ["ai_images"],
    r2Families: ["USER_IMAGES:thumb_key", "USER_IMAGES:medium_key"],
    exposure: "derived_private_or_public_gallery",
    ownerFields: ["parent ai_images ownership signals"],
    ownershipMetadataSupport: "partial_parent_only",
    runtimeAccessCheckSource: "parent_ai_image_legacy_user_id",
    manualReviewSupport: "partial",
    resetSupport: "dry_run_only_derivative_cleanup_required",
    quotaStorageAccountingSupport: "partial_parent_size_only",
    adminVisibilitySupport: "partial_redacted_counts",
    deletionResetRisk: "high",
    currentStatus: "evidence_pending",
    proposedMigrationRequirements: ["Decide whether derivative artifacts need separate evidence rows or inherit parent ownership explicitly."],
    evidenceRequired: ["derivative count evidence", "parent-row readback", "cleanup queue proof before deletion claims"],
  },
  {
    id: "ai_text_assets",
    label: "AI text assets",
    sourceTables: ["ai_text_assets"],
    r2Families: ["USER_IMAGES:r2_key"],
    exposure: "private_or_public_member_asset",
    ownerFields: ["user_id"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "legacy_user_id",
    manualReviewSupport: "no",
    resetSupport: "deferred_existing_delete_paths_only",
    quotaStorageAccountingSupport: "yes_size_bytes",
    adminVisibilitySupport: "yes_assets_manager",
    deletionResetRisk: "high",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Add ownership metadata or a verified inheritance model for ai_text_assets before backfill/access-switch work."],
    evidenceRequired: ["text asset inventory", "poster and public-state evidence", "quota reconciliation evidence"],
  },
  {
    id: "text_asset_posters",
    label: "Text asset posters",
    sourceTables: ["ai_text_assets"],
    r2Families: ["USER_IMAGES:poster_r2_key"],
    exposure: "private_or_public_asset_poster",
    ownerFields: ["parent ai_text_assets.user_id"],
    ownershipMetadataSupport: "no_parent_legacy_only",
    runtimeAccessCheckSource: "parent_ai_text_assets_user_id",
    manualReviewSupport: "no",
    resetSupport: "deferred_existing_delete_paths_only",
    quotaStorageAccountingSupport: "yes_poster_size_bytes",
    adminVisibilitySupport: "partial_redacted_counts",
    deletionResetRisk: "medium",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Tie poster ownership explicitly to the parent text/music/video asset before reset claims."],
    evidenceRequired: ["poster reference counts", "safe redacted key-family evidence"],
  },
  {
    id: "member_music_audio_assets",
    label: "Member music/audio assets",
    sourceTables: ["ai_text_assets"],
    r2Families: ["USER_IMAGES:r2_key", "USER_IMAGES:poster_r2_key"],
    exposure: "private_or_memtracks_public_gallery",
    ownerFields: ["user_id"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "legacy_user_id",
    manualReviewSupport: "no",
    resetSupport: "deferred_existing_delete_paths_only",
    quotaStorageAccountingSupport: "yes_size_bytes_and_poster_size_bytes",
    adminVisibilitySupport: "yes_assets_manager",
    deletionResetRisk: "high",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Add or map ownership metadata for source_module=music rows."],
    evidenceRequired: ["music row counts", "public Memtracks counts", "quota reconciliation"],
  },
  {
    id: "member_video_assets",
    label: "Member video assets and generated outputs",
    sourceTables: ["ai_text_assets", "ai_video_jobs"],
    r2Families: ["USER_IMAGES:r2_key", "USER_IMAGES:poster_r2_key", "USER_IMAGES:output_r2_key"],
    exposure: "private_or_memvids_public_gallery",
    ownerFields: ["ai_text_assets.user_id", "ai_video_jobs.user_id or admin scope fields"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "legacy_user_id_or_job_scope",
    manualReviewSupport: "no",
    resetSupport: "deferred_existing_delete_paths_only",
    quotaStorageAccountingSupport: "partial",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "high",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Separate saved-video assets from generated job outputs and define ownership/status inheritance."],
    evidenceRequired: ["saved video row counts", "video job output counts", "public Memvids counts"],
  },
  {
    id: "generated_video_outputs",
    label: "Generated video job outputs",
    sourceTables: ["ai_video_jobs"],
    r2Families: ["USER_IMAGES:output_r2_key", "USER_IMAGES:poster_r2_key"],
    exposure: "admin_or_member_generated_output",
    ownerFields: ["ai_video_jobs.user_id or admin/platform job metadata"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "job_scope_and_output_route_policy",
    manualReviewSupport: "no",
    resetSupport: "deferred",
    quotaStorageAccountingSupport: "partial_job_metadata_only",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "high",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Define saved-output ownership, retention, quota, and cleanup linkage for generated video outputs."],
    evidenceRequired: ["video job output/poster counts", "safe route access evidence", "quota impact decision"],
  },
  {
    id: "public_gallery_references",
    label: "Public gallery references: Mempics, Memvids, Memtracks",
    sourceTables: ["ai_images", "ai_text_assets"],
    r2Families: ["USER_IMAGES public-by-reference objects"],
    exposure: "public_gallery",
    ownerFields: ["legacy creator/user_id attribution"],
    ownershipMetadataSupport: "partial_images_only",
    runtimeAccessCheckSource: "public_visibility_state",
    manualReviewSupport: "partial_images_only",
    resetSupport: "dry_run_only_depublish_required",
    quotaStorageAccountingSupport: "partial",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "blocked",
    currentStatus: "blocked",
    proposedMigrationRequirements: ["Define public gallery ownership/depublish policy before any reset or access-switch claim."],
    evidenceRequired: ["public Mempics/Memvids/Memtracks counts", "attribution/depublish review"],
  },
  {
    id: "public_gallery_mempics",
    label: "Public gallery references: Mempics",
    sourceTables: ["ai_images"],
    r2Families: ["USER_IMAGES public-by-reference objects"],
    exposure: "public_gallery_mempics",
    ownerFields: ["ai_images.user_id", "ai_images ownership metadata when present"],
    ownershipMetadataSupport: "partial_images_only",
    runtimeAccessCheckSource: "public_visibility_state",
    manualReviewSupport: "partial_images_only",
    resetSupport: "dry_run_only_depublish_required",
    quotaStorageAccountingSupport: "partial_parent_size_only",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "blocked",
    currentStatus: "evidence_pending",
    proposedMigrationRequirements: ["Define depublish/ownership policy for public Mempics before reset or access-switch claims."],
    evidenceRequired: ["public Mempics counts", "public depublish impact evidence"],
  },
  {
    id: "public_gallery_memvids",
    label: "Public gallery references: Memvids",
    sourceTables: ["ai_text_assets"],
    r2Families: ["USER_IMAGES saved video objects/posters"],
    exposure: "public_gallery_memvids",
    ownerFields: ["ai_text_assets.user_id"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "public_visibility_state",
    manualReviewSupport: "no",
    resetSupport: "blocked",
    quotaStorageAccountingSupport: "partial",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "blocked",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Add or map video asset ownership metadata and depublish review before reset/access-switch work."],
    evidenceRequired: ["public Memvids counts", "saved video ownership evidence"],
  },
  {
    id: "public_gallery_memtracks",
    label: "Public gallery references: Memtracks",
    sourceTables: ["ai_text_assets"],
    r2Families: ["USER_IMAGES saved audio objects/posters"],
    exposure: "public_gallery_memtracks",
    ownerFields: ["ai_text_assets.user_id"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "public_visibility_state",
    manualReviewSupport: "no",
    resetSupport: "blocked",
    quotaStorageAccountingSupport: "partial",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "blocked",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Add or map music asset ownership metadata and depublish review before reset/access-switch work."],
    evidenceRequired: ["public Memtracks counts", "saved audio ownership evidence"],
  },
  {
    id: "profile_avatars",
    label: "Profile avatars",
    sourceTables: ["profiles"],
    r2Families: ["PRIVATE_MEDIA:avatars/{userId}"],
    exposure: "private_served_through_profile_routes",
    ownerFields: ["profiles.user_id"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "profile_user_id",
    manualReviewSupport: "no",
    resetSupport: "deferred",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "partial_latest_avatar_view",
    deletionResetRisk: "medium",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Document avatar ownership/deletion evidence separately from AI asset ownership."],
    evidenceRequired: ["avatar count/readback", "private-media redaction evidence"],
  },
  {
    id: "private_media",
    label: "Private media route family",
    sourceTables: ["profiles", "private media route-specific metadata"],
    r2Families: ["PRIVATE_MEDIA"],
    exposure: "private",
    ownerFields: ["route-specific authenticated user linkage"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "route_specific_user_or_admin_lookup",
    manualReviewSupport: "no",
    resetSupport: "deferred",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "medium",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Inventory private media route metadata before adding ownership/backfill/access-switch claims."],
    evidenceRequired: ["private media route inventory", "redacted key-family evidence"],
  },
  {
    id: "public_media",
    label: "Public media route family",
    sourceTables: ["ai_images", "ai_text_assets", "news_pulse_items"],
    r2Families: ["USER_IMAGES"],
    exposure: "public_by_route_policy",
    ownerFields: ["D1 parent rows or platform attribution"],
    ownershipMetadataSupport: "partial",
    runtimeAccessCheckSource: "public route policy and D1 ready/public flags",
    manualReviewSupport: "partial_images_only",
    resetSupport: "blocked_without_depublish_policy",
    quotaStorageAccountingSupport: "partial",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "blocked",
    currentStatus: "evidence_pending",
    proposedMigrationRequirements: ["Separate public media ownership from private tenant asset access before access-switch work."],
    evidenceRequired: ["public route inventory", "public depublish policy", "redacted key-family counts"],
  },
  {
    id: "data_lifecycle_exports",
    label: "Data lifecycle exports",
    sourceTables: ["data_export_archives"],
    r2Families: ["AUDIT_ARCHIVE:data-exports/..."],
    exposure: "private_operator_export",
    ownerFields: ["request/user metadata inside lifecycle records"],
    ownershipMetadataSupport: "separate_lifecycle_model",
    runtimeAccessCheckSource: "admin_only_archive_read",
    manualReviewSupport: "not_applicable",
    resetSupport: "not_applicable",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "yes",
    deletionResetRisk: "high",
    currentStatus: "implemented_but_operator_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["archive cleanup evidence", "redacted export metadata", "rollback/retention review"],
  },
  {
    id: "audit_evidence_archives",
    label: "Audit and evidence archives",
    sourceTables: ["platform_budget_evidence_archives", "data_export_archives"],
    r2Families: ["AUDIT_ARCHIVE"],
    exposure: "private_operator_evidence",
    ownerFields: ["operator/admin actor metadata"],
    ownershipMetadataSupport: "separate_archive_model",
    runtimeAccessCheckSource: "admin_only",
    manualReviewSupport: "not_applicable",
    resetSupport: "not_applicable",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "yes",
    deletionResetRisk: "high",
    currentStatus: "implemented_but_operator_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["archive redaction evidence", "retention/expiry evidence"],
  },
  {
    id: "platform_admin_generated_assets",
    label: "Platform/admin generated assets",
    sourceTables: ["admin_ai_usage_attempts", "ai_video_jobs", "news_pulse_items"],
    r2Families: ["USER_IMAGES", "PRIVATE_MEDIA", "AUDIT_ARCHIVE"],
    exposure: "admin_or_public_platform_generated",
    ownerFields: ["admin actor or platform scope metadata"],
    ownershipMetadataSupport: "partial_budget_metadata_not_tenant_ownership",
    runtimeAccessCheckSource: "admin_or_public_route_policy",
    manualReviewSupport: "no",
    resetSupport: "deferred",
    quotaStorageAccountingSupport: "partial",
    adminVisibilitySupport: "partial",
    deletionResetRisk: "medium",
    currentStatus: "evidence_pending",
    proposedMigrationRequirements: ["Classify platform/admin generated artifacts separately from member tenant assets."],
    evidenceRequired: ["admin asset inventory", "safe platform-generated asset retention policy"],
  },
  {
    id: "storage_quota_usage",
    label: "Storage quota/accounting rows",
    sourceTables: ["user_asset_storage_usage", "ai_images", "ai_text_assets"],
    r2Families: [],
    exposure: "private_accounting_metadata",
    ownerFields: ["user_asset_storage_usage.user_id"],
    ownershipMetadataSupport: "separate_accounting_model",
    runtimeAccessCheckSource: "legacy_user_id_metadata",
    manualReviewSupport: "no",
    resetSupport: "dry_run_reconciliation_only",
    quotaStorageAccountingSupport: "yes",
    adminVisibilitySupport: "yes_reconciliation",
    deletionResetRisk: "medium",
    currentStatus: "implemented_but_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["recorded-vs-D1 metadata reconciliation", "missing byte metadata counts"],
  },
  {
    id: "manual_review_records",
    label: "Tenant asset manual-review records",
    sourceTables: ["ai_asset_manual_review_items", "ai_asset_manual_review_events"],
    r2Families: [],
    exposure: "private_operator_evidence",
    ownerFields: ["review item domain/asset id plus proposed owner metadata"],
    ownershipMetadataSupport: "review_state_only",
    runtimeAccessCheckSource: "not_runtime_access",
    manualReviewSupport: "yes",
    resetSupport: "not_applicable",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "yes",
    deletionResetRisk: "low",
    currentStatus: "implemented_but_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["same-key replay evidence", "same-key conflict evidence", "successful status update evidence"],
  },
  {
    id: "legacy_media_reset_records",
    label: "Legacy media reset action records",
    sourceTables: ["tenant_asset_media_reset_actions", "tenant_asset_media_reset_action_events"],
    r2Families: [],
    exposure: "private_operator_evidence",
    ownerFields: ["selected asset scope and admin actor metadata"],
    ownershipMetadataSupport: "not_ownership_source",
    runtimeAccessCheckSource: "not_runtime_access",
    manualReviewSupport: "not_applicable",
    resetSupport: "dry_run_available_confirmed_execution_default_off",
    quotaStorageAccountingSupport: "evidence_only",
    adminVisibilitySupport: "yes",
    deletionResetRisk: "blocked",
    currentStatus: "blocked",
    proposedMigrationRequirements: [],
    evidenceRequired: ["sanitized dry-run evidence", "future approved confirmation package"],
  },
  {
    id: "unknown_legacy_media",
    label: "Unknown or legacy media rows",
    sourceTables: ["unknown_or_future_tables"],
    r2Families: ["USER_IMAGES", "PRIVATE_MEDIA", "AUDIT_ARCHIVE"],
    exposure: "unknown",
    ownerFields: [],
    ownershipMetadataSupport: "unknown",
    runtimeAccessCheckSource: "unknown",
    manualReviewSupport: "no",
    resetSupport: "blocked",
    quotaStorageAccountingSupport: "unknown",
    adminVisibilitySupport: "no",
    deletionResetRisk: "blocked",
    currentStatus: "blocked",
    proposedMigrationRequirements: ["Run schema inventory before any future backfill/access-switch/reset package."],
    evidenceRequired: ["schema/table inventory", "R2 key-family inventory without live listing by Codex"],
  },
  {
    id: "r2_user_images",
    label: "R2 USER_IMAGES object family",
    sourceTables: ["ai_images", "ai_text_assets", "ai_video_jobs", "news_pulse_items"],
    r2Families: ["USER_IMAGES"],
    exposure: "mixed_private_public_by_reference",
    ownerFields: ["D1 parent rows only"],
    ownershipMetadataSupport: "partial_parent_only",
    runtimeAccessCheckSource: "D1 parent lookup",
    manualReviewSupport: "partial",
    resetSupport: "blocked_without_parent_evidence",
    quotaStorageAccountingSupport: "partial_d1_bytes_only",
    adminVisibilitySupport: "redacted_only",
    deletionResetRisk: "blocked",
    currentStatus: "evidence_pending",
    proposedMigrationRequirements: ["Do not list or mutate live R2 for ownership; map through D1 parents and redacted key hashes/counts."],
    evidenceRequired: ["D1 parent coverage", "redacted key-family counts", "quota reconciliation"],
  },
  {
    id: "r2_private_media",
    label: "R2 PRIVATE_MEDIA object family",
    sourceTables: ["profiles"],
    r2Families: ["PRIVATE_MEDIA"],
    exposure: "private",
    ownerFields: ["profile user_id and route-specific state"],
    ownershipMetadataSupport: "no",
    runtimeAccessCheckSource: "route_specific_user_or_admin_lookup",
    manualReviewSupport: "no",
    resetSupport: "deferred",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "redacted_only",
    deletionResetRisk: "medium",
    currentStatus: "deferred",
    proposedMigrationRequirements: ["Define private media ownership evidence outside folders/images work."],
    evidenceRequired: ["private media route inventory", "redacted avatar evidence"],
  },
  {
    id: "r2_audit_archive",
    label: "R2 AUDIT_ARCHIVE object family",
    sourceTables: ["data_export_archives", "platform_budget_evidence_archives"],
    r2Families: ["AUDIT_ARCHIVE"],
    exposure: "private_operator_archive",
    ownerFields: ["archive metadata and admin actor"],
    ownershipMetadataSupport: "separate_archive_model",
    runtimeAccessCheckSource: "admin_only_archive_metadata",
    manualReviewSupport: "not_applicable",
    resetSupport: "not_applicable",
    quotaStorageAccountingSupport: "no",
    adminVisibilitySupport: "yes_redacted",
    deletionResetRisk: "high",
    currentStatus: "implemented_but_operator_evidence_pending",
    proposedMigrationRequirements: [],
    evidenceRequired: ["archive prefix safety evidence", "retention policy evidence"],
  },
]);

function cloneDomain(domain) {
  return {
    ...domain,
    sourceTables: [...domain.sourceTables],
    r2Families: [...domain.r2Families],
    ownerFields: [...domain.ownerFields],
    proposedMigrationRequirements: [...domain.proposedMigrationRequirements],
    evidenceRequired: [...domain.evidenceRequired],
  };
}

async function countRows(env, query, bindings = []) {
  const row = await env.DB.prepare(query).bind(...bindings).first();
  return Number(row?.total || row?.count || 0);
}

async function rollupRows(env, query, bindings = []) {
  const result = await env.DB.prepare(query).bind(...bindings).all();
  const rollup = {};
  for (const row of result?.results || []) {
    rollup[String(row.key || "unknown")] = Number(row.count || 0);
  }
  return rollup;
}

async function optionalMetric(build) {
  try {
    return { available: true, ...(await build()) };
  } catch (error) {
    if (/no such table|no such column|Unhandled SQL/i.test(String(error?.message || error))) {
      return {
        available: false,
        reason: "schema_unavailable",
      };
    }
    throw error;
  }
}

function metadataMissingPredicate() {
  return "asset_owner_type IS NULL OR ownership_status IS NULL OR (owning_user_id IS NULL AND owning_organization_id IS NULL)";
}

async function buildDomainMetrics(env) {
  if (!env?.DB) return {};
  const missing = metadataMissingPredicate();
  const metrics = {};
  metrics.ai_folders = await optionalMetric(async () => ({
    totalRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_folders"),
    rowsMissingOwnershipMetadata: await countRows(env, `SELECT COUNT(*) AS total FROM ai_folders WHERE ${missing}`),
    activeRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_folders WHERE status = ?", ["active"]),
  }));
  metrics.ai_images = await optionalMetric(async () => ({
    totalRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images"),
    rowsMissingOwnershipMetadata: await countRows(env, `SELECT COUNT(*) AS total FROM ai_images WHERE ${missing}`),
    publicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE COALESCE(visibility, 'private') = ?", ["public"]),
    derivativeParentRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE thumb_key IS NOT NULL OR medium_key IS NOT NULL"),
    d1RecordedBytes: await countRows(env, "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM ai_images"),
  }));
  metrics.ai_image_derivatives = await optionalMetric(async () => ({
    thumbReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE thumb_key IS NOT NULL"),
    mediumReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE medium_key IS NOT NULL"),
  }));
  metrics.ai_text_assets = await optionalMetric(async () => ({
    totalRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets"),
    publicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE COALESCE(visibility, 'private') = ?", ["public"]),
    sourceModuleRollup: await rollupRows(env, "SELECT source_module AS key, COUNT(*) AS count FROM ai_text_assets GROUP BY source_module ORDER BY count DESC, key ASC"),
    d1RecordedBytes: await countRows(env, "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM ai_text_assets"),
    posterBytes: await countRows(env, "SELECT COALESCE(SUM(poster_size_bytes), 0) AS total FROM ai_text_assets"),
  }));
  metrics.text_asset_posters = await optionalMetric(async () => ({
    posterReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE poster_r2_key IS NOT NULL"),
  }));
  metrics.member_music_audio_assets = await optionalMetric(async () => ({
    totalRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ?", ["music"]),
    publicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["music", "public"]),
  }));
  metrics.member_video_assets = await optionalMetric(async () => ({
    savedVideoRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ?", ["video"]),
    publicSavedVideoRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["video", "public"]),
    videoJobRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs"),
    videoJobOutputReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs WHERE output_r2_key IS NOT NULL"),
    videoJobPosterReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs WHERE poster_r2_key IS NOT NULL"),
  }));
  metrics.generated_video_outputs = await optionalMetric(async () => ({
    videoJobRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs"),
    outputReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs WHERE output_r2_key IS NOT NULL"),
    posterReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs WHERE poster_r2_key IS NOT NULL"),
  }));
  metrics.public_gallery_references = await optionalMetric(async () => ({
    publicMempicsRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE COALESCE(visibility, 'private') = ?", ["public"]),
    publicMemtracksRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["music", "public"]),
    publicMemvidsRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["video", "public"]),
  }));
  metrics.public_gallery_mempics = await optionalMetric(async () => ({
    publicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE COALESCE(visibility, 'private') = ?", ["public"]),
  }));
  metrics.public_gallery_memvids = await optionalMetric(async () => ({
    publicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["video", "public"]),
  }));
  metrics.public_gallery_memtracks = await optionalMetric(async () => ({
    publicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["music", "public"]),
  }));
  metrics.storage_quota_usage = await optionalMetric(async () => ({
    usageRows: await countRows(env, "SELECT COUNT(*) AS total FROM user_asset_storage_usage"),
    recordedUsedBytes: await countRows(env, "SELECT COALESCE(SUM(used_bytes), 0) AS total FROM user_asset_storage_usage"),
  }));
  metrics.manual_review_records = await optionalMetric(async () => ({
    itemRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_items"),
    eventRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events"),
  }));
  metrics.legacy_media_reset_records = await optionalMetric(async () => ({
    actionRows: await countRows(env, "SELECT COUNT(*) AS total FROM tenant_asset_media_reset_actions"),
    eventRows: await countRows(env, "SELECT COUNT(*) AS total FROM tenant_asset_media_reset_action_events"),
  }));
  return metrics;
}

function summarizeDomains(domains) {
  const byStatus = {};
  const byRisk = {};
  for (const domain of domains) {
    byStatus[domain.currentStatus] = (byStatus[domain.currentStatus] || 0) + 1;
    byRisk[domain.deletionResetRisk] = (byRisk[domain.deletionResetRisk] || 0) + 1;
  }
  return {
    totalDomains: domains.length,
    byStatus,
    byRisk,
    domainsWithOwnershipMetadataSupport: domains.filter((domain) => String(domain.ownershipMetadataSupport).startsWith("yes")).length,
    domainsDeferredOrBlocked: domains.filter((domain) => ["deferred", "blocked"].includes(domain.currentStatus)).length,
  };
}

export async function buildTenantAssetDomainEvidenceReport(env, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const metrics = await buildDomainMetrics(env);
  const domains = TENANT_ASSET_DOMAIN_REGISTRY.map((domain) => ({
    ...cloneDomain(domain),
    metrics: metrics[domain.id] || null,
  }));
  return {
    ok: true,
    available: true,
    reportVersion: TENANT_ASSET_DOMAIN_EVIDENCE_REPORT_VERSION,
    generatedAt,
    source: "repo_registry_plus_local_d1_read_only",
    domain: "tenant_asset_cross_domain_inventory",
    runtimeBehaviorChanged: false,
    d1Mutated: false,
    r2LiveListed: false,
    r2ObjectsMutated: false,
    providerCallsMade: false,
    stripeCallsMade: false,
    cloudflareApiCallsMade: false,
    noBackfill: true,
    noAccessSwitch: true,
    tenantIsolationClaimed: false,
    ownershipBackfillReadiness: "blocked",
    accessSwitchReadiness: "blocked",
    confirmedResetReadiness: "blocked",
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    summary: summarizeDomains(domains),
    blockedClaims: [
      "tenant isolation is not claimed",
      "ownership backfill readiness remains blocked",
      "access-switch readiness remains blocked",
      "confirmed legacy media reset readiness remains blocked",
      "production readiness remains blocked",
      "live billing readiness remains blocked",
    ],
    domains,
    coverageGaps: domains
      .filter((domain) => ["no", "unknown", "partial_parent_only", "no_parent_legacy_only"].includes(domain.ownershipMetadataSupport))
      .map((domain) => ({
        domainId: domain.id,
        label: domain.label,
        gap: domain.ownershipMetadataSupport,
        proposedMigrationRequirements: domain.proposedMigrationRequirements,
        evidenceRequired: domain.evidenceRequired,
      })),
    proposedNextEvidenceRequired: [
      "Sanitized cross-domain D1 count evidence for public/private/gallery/media domains.",
      "Manual-review idempotency replay/conflict/status evidence for folders/images.",
      "Storage quota reconciliation evidence before any reset/delete/backfill claim.",
      "Remote migration and live read-only verification evidence before production readiness claims.",
    ],
    limitations: [
      "This report never lists or mutates R2 objects.",
      "D1 metrics are bounded metadata counts only and do not prove live R2 existence.",
      "Registry coverage does not approve ownership backfill, access-switching, confirmed reset, deletion, tenant isolation, or production readiness.",
    ],
  };
}

export function listTenantAssetDomainRegistry() {
  return TENANT_ASSET_DOMAIN_REGISTRY.map(cloneDomain);
}
