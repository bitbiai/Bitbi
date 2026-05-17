import { buildTenantAssetManualReviewQueueSummary } from "./tenant-asset-manual-review-queue.js";

export const TENANT_ASSET_LEGACY_MEDIA_RESET_REPORT_VERSION =
  "tenant-asset-legacy-media-reset-dry-run-v1";
export const TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_ENDPOINT =
  "/api/admin/tenant-assets/legacy-media-reset/dry-run";
export const TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_EXPORT_ENDPOINT =
  "/api/admin/tenant-assets/legacy-media-reset/dry-run/export";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const ALLOWED_EXPORT_FORMATS = new Set(["json", "markdown"]);

export const LEGACY_MEDIA_RESET_CANDIDATE_CLASSIFICATIONS = Object.freeze([
  "candidate_safe_for_future_executor",
  "candidate_requires_depublish_or_gallery_review",
  "candidate_requires_derivative_cleanup",
  "candidate_requires_folder_child_handling",
  "candidate_requires_existing_delete_path",
  "candidate_requires_manual_review",
  "candidate_unknown_table_or_schema",
  "candidate_not_covered",
  "blocked_active_dependency",
  "blocked_unowned_or_org_unknown",
  "not_selected",
]);

export class TenantAssetLegacyMediaResetError extends Error {
  constructor(message, { status = 400, code = "tenant_asset_legacy_media_reset_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantAssetLegacyMediaResetError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, numeric));
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetLegacyMediaResetError("Invalid legacy media reset boolean option.", {
    code: "tenant_asset_legacy_media_reset_filter_invalid",
  });
}

function normalizeFormat(value) {
  const format = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_EXPORT_FORMATS.has(format)) {
    throw new TenantAssetLegacyMediaResetError("Unsupported legacy media reset export format.", {
      code: "tenant_asset_legacy_media_reset_format_invalid",
      fields: { format },
    });
  }
  return format;
}

export function normalizeLegacyMediaResetDryRunOptions(input = {}) {
  return {
    limit: normalizeLimit(input.limit),
    includeDetails: normalizeBoolean(input.includeDetails ?? input.include_details, false),
    includeImages: normalizeBoolean(input.includeImages ?? input.include_images, true),
    includeFolders: normalizeBoolean(input.includeFolders ?? input.include_folders, true),
    includePublic: normalizeBoolean(input.includePublic ?? input.include_public, true),
    includeDerivatives: normalizeBoolean(input.includeDerivatives ?? input.include_derivatives, true),
    includeVideos: normalizeBoolean(input.includeVideos ?? input.include_videos, true),
    includeMusic: normalizeBoolean(input.includeMusic ?? input.include_music, true),
    includeTextAssets: normalizeBoolean(input.includeTextAssets ?? input.include_text_assets, true),
    includeQuota: normalizeBoolean(input.includeQuota ?? input.include_quota, true),
    format: normalizeFormat(input.format),
  };
}

export function legacyMediaResetDryRunOptionsFromSearch(searchParams, overrides = {}) {
  return normalizeLegacyMediaResetDryRunOptions({
    limit: searchParams.get("limit") ?? overrides.limit,
    includeDetails: searchParams.get("includeDetails") ?? searchParams.get("include_details") ?? overrides.includeDetails,
    includeImages: searchParams.get("includeImages") ?? searchParams.get("include_images") ?? overrides.includeImages,
    includeFolders: searchParams.get("includeFolders") ?? searchParams.get("include_folders") ?? overrides.includeFolders,
    includePublic: searchParams.get("includePublic") ?? searchParams.get("include_public") ?? overrides.includePublic,
    includeDerivatives: searchParams.get("includeDerivatives") ?? searchParams.get("include_derivatives") ?? overrides.includeDerivatives,
    includeVideos: searchParams.get("includeVideos") ?? searchParams.get("include_videos") ?? overrides.includeVideos,
    includeMusic: searchParams.get("includeMusic") ?? searchParams.get("include_music") ?? overrides.includeMusic,
    includeTextAssets: searchParams.get("includeTextAssets") ?? searchParams.get("include_text_assets") ?? overrides.includeTextAssets,
    includeQuota: searchParams.get("includeQuota") ?? searchParams.get("include_quota") ?? overrides.includeQuota,
    format: searchParams.get("format") ?? overrides.format,
  });
}

function isMissingTableError(error, tableName = null) {
  const message = String(error?.message || error || "");
  if (!/no such table/i.test(message)) return false;
  return tableName ? message.includes(tableName) : true;
}

async function countRows(env, query, bindings = []) {
  const row = await env.DB.prepare(query).bind(...bindings).first();
  return Number(row?.total || row?.count || 0);
}

async function rollupRows(env, query) {
  const result = await env.DB.prepare(query).all();
  const rollup = {};
  for (const row of result?.results || []) {
    rollup[String(row.key || "unknown")] = Number(row.count || 0);
  }
  return rollup;
}

async function optionalSummary(tableName, build) {
  try {
    return await build();
  } catch (error) {
    if (isMissingTableError(error, tableName)) {
      return {
        available: false,
        coverage: "unknown_schema",
        classification: "candidate_unknown_table_or_schema",
        table: tableName,
        message: `${tableName} is unavailable in this environment; reset coverage was not claimed.`,
      };
    }
    throw error;
  }
}

function ownershipMissingPredicate() {
  return "asset_owner_type IS NULL OR ownership_status IS NULL OR (owning_user_id IS NULL AND owning_organization_id IS NULL)";
}

function serializeFolderDetail(row) {
  return {
    id: row.id,
    status: row.status || "active",
    ownershipMetadataPresent: Boolean(row.asset_owner_type && row.ownership_status && (row.owning_user_id || row.owning_organization_id)),
    ownerType: row.asset_owner_type || null,
    ownershipStatus: row.ownership_status || null,
    createdAt: row.created_at || null,
    classification: row.asset_owner_type && row.ownership_status
      ? "candidate_requires_folder_child_handling"
      : "candidate_requires_manual_review",
  };
}

function serializeImageDetail(row) {
  const isPublic = row.visibility === "public";
  const hasDerivative = Boolean(row.thumb_key || row.medium_key);
  return {
    id: row.id,
    assetDomain: "ai_images",
    visibility: row.visibility || "private",
    folderLinked: Boolean(row.folder_id),
    ownershipMetadataPresent: Boolean(row.asset_owner_type && row.ownership_status && (row.owning_user_id || row.owning_organization_id)),
    ownerType: row.asset_owner_type || null,
    ownershipStatus: row.ownership_status || null,
    hasDerivativeReference: hasDerivative,
    createdAt: row.created_at || null,
    classification: isPublic
      ? "candidate_requires_depublish_or_gallery_review"
      : (hasDerivative ? "candidate_requires_derivative_cleanup" : "candidate_requires_existing_delete_path"),
  };
}

async function listFolderDetails(env, limit) {
  const result = await env.DB.prepare(
    `SELECT id, status, asset_owner_type, owning_user_id, owning_organization_id, ownership_status, created_at
       FROM ai_folders
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(limit).all();
  return (result?.results || []).map(serializeFolderDetail);
}

async function listImageDetails(env, limit) {
  const result = await env.DB.prepare(
    `SELECT id, folder_id, visibility, asset_owner_type, owning_user_id, owning_organization_id,
            ownership_status, created_at, thumb_key, medium_key
       FROM ai_images
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(limit).all();
  return (result?.results || []).map(serializeImageDetail);
}

export async function summarizeLegacyFolderImageResetCandidates(env, options) {
  const missing = ownershipMissingPredicate();
  const [
    totalFolders,
    foldersWithNullOwnershipMetadata,
    foldersWithOwnershipMetadata,
    activeFolders,
    totalImages,
    imagesWithNullOwnershipMetadata,
    imagesWithOwnershipMetadata,
    folderLinkedImages,
    simplePrivateImages,
  ] = await Promise.all([
    options.includeFolders ? countRows(env, "SELECT COUNT(*) AS total FROM ai_folders") : 0,
    options.includeFolders ? countRows(env, `SELECT COUNT(*) AS total FROM ai_folders WHERE ${missing}`) : 0,
    options.includeFolders ? countRows(env, `SELECT COUNT(*) AS total FROM ai_folders WHERE NOT (${missing})`) : 0,
    options.includeFolders ? countRows(env, "SELECT COUNT(*) AS total FROM ai_folders WHERE status = ?", ["active"]) : 0,
    options.includeImages ? countRows(env, "SELECT COUNT(*) AS total FROM ai_images") : 0,
    options.includeImages ? countRows(env, `SELECT COUNT(*) AS total FROM ai_images WHERE ${missing}`) : 0,
    options.includeImages ? countRows(env, `SELECT COUNT(*) AS total FROM ai_images WHERE NOT (${missing})`) : 0,
    options.includeImages ? countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE folder_id IS NOT NULL") : 0,
    options.includeImages
      ? countRows(
        env,
        `SELECT COUNT(*) AS total
           FROM ai_images
          WHERE (${missing})
            AND COALESCE(visibility, 'private') != 'public'
            AND thumb_key IS NULL
            AND medium_key IS NULL`
      )
      : 0,
  ]);
  const details = options.includeDetails
    ? {
      folders: options.includeFolders ? await listFolderDetails(env, options.limit) : [],
      images: options.includeImages ? await listImageDetails(env, options.limit) : [],
    }
    : undefined;
  return {
    available: true,
    coverage: "covered_by_phase_6_21_dry_run",
    classifications: [
      "candidate_requires_manual_review",
      "candidate_requires_folder_child_handling",
      "candidate_requires_existing_delete_path",
      "blocked_unowned_or_org_unknown",
    ],
    totalFolders,
    activeFolders,
    foldersWithNullOwnershipMetadata,
    foldersWithOwnershipMetadata,
    totalImages,
    imagesWithNullOwnershipMetadata,
    imagesWithOwnershipMetadata,
    folderLinkedImages,
    simplePrivateImages,
    readyForFutureExecutorCount: simplePrivateImages,
    requiresManualReviewCount: foldersWithNullOwnershipMetadata + imagesWithNullOwnershipMetadata,
    details,
  };
}

export async function summarizeLegacyPublicGalleryResetCandidates(env, options) {
  if (!options.includePublic) {
    return { available: true, coverage: "not_selected", classification: "not_selected", totalPublicRows: 0 };
  }
  const [
    publicImageRows,
    publicTextRows,
    publicMusicRows,
    publicVideoRows,
  ] = await Promise.all([
    countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE COALESCE(visibility, 'private') = ?", ["public"]),
    optionalSummary("ai_text_assets", () =>
      countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE COALESCE(visibility, 'private') = ?", ["public"])
    ),
    optionalSummary("ai_text_assets", () =>
      countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["music", "public"])
    ),
    optionalSummary("ai_text_assets", () =>
      countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?", ["video", "public"])
    ),
  ]);
  const safePublicTextRows = Number(publicTextRows?.available === false ? 0 : publicTextRows);
  const safePublicMusicRows = Number(publicMusicRows?.available === false ? 0 : publicMusicRows);
  const safePublicVideoRows = Number(publicVideoRows?.available === false ? 0 : publicVideoRows);
  return {
    available: true,
    coverage: "covered_by_phase_6_21_dry_run",
    classification: "candidate_requires_depublish_or_gallery_review",
    totalPublicRows: publicImageRows + safePublicTextRows,
    publicImageRows,
    publicTextRows: publicTextRows?.available === false ? null : safePublicTextRows,
    publicMusicRows: publicMusicRows?.available === false ? null : safePublicMusicRows,
    publicVideoRows: publicVideoRows?.available === false ? null : safePublicVideoRows,
    noPublicStateChanged: true,
    warnings: [
      "Public/gallery rows cannot be silently deleted by this dry run.",
      "A future executor must deliberately depublish or delete public references and account for attribution/history impact.",
      "Current public/gallery content would disappear only if a later explicitly approved deletion executor runs.",
    ],
  };
}

export async function summarizeLegacyDerivativeResetCandidates(env, options) {
  if (!options.includeDerivatives) {
    return { available: true, coverage: "not_selected", classification: "not_selected", totalDerivativeReferences: 0 };
  }
  const [
    thumbReferences,
    mediumReferences,
    imagesWithDerivatives,
  ] = await Promise.all([
    countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE thumb_key IS NOT NULL"),
    countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE medium_key IS NOT NULL"),
    countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE thumb_key IS NOT NULL OR medium_key IS NOT NULL"),
  ]);
  return {
    available: true,
    coverage: "covered_by_phase_6_21_dry_run",
    classification: "candidate_requires_derivative_cleanup",
    imagesWithDerivatives,
    thumbReferences,
    mediumReferences,
    totalDerivativeReferences: thumbReferences + mediumReferences,
    inferredFromD1Only: true,
    r2ExistenceChecked: false,
    requirements: [
      "A future executor must clean parent and derivative references through existing lifecycle queue/delete logic.",
      "No live R2 existence check, list, move, or delete is performed by this dry run.",
    ],
  };
}

export async function summarizeLegacyTextAssetResetCandidates(env, options) {
  if (!options.includeTextAssets) {
    return { available: true, coverage: "not_selected", classification: "not_selected", totalTextAssetRows: 0 };
  }
  return optionalSummary("ai_text_assets", async () => {
    const [
      totalTextAssetRows,
      publicTextAssetRows,
      posterReferences,
      sourceModuleRollup,
    ] = await Promise.all([
      countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets"),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE COALESCE(visibility, 'private') = ?", ["public"]),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE poster_r2_key IS NOT NULL"),
      rollupRows(env, "SELECT source_module AS key, COUNT(*) AS count FROM ai_text_assets GROUP BY source_module ORDER BY count DESC, key ASC"),
    ]);
    return {
      available: true,
      coverage: "partially_covered",
      classification: "candidate_requires_existing_delete_path",
      totalTextAssetRows,
      publicTextAssetRows,
      posterReferences,
      sourceModuleRollup,
      notes: [
        "Text/audio/video assets share ai_text_assets and existing lifecycle delete paths, but Phase 6 ownership work did not add ownership metadata for this table.",
        "Do not claim text/music/video reset coverage complete without a future coverage phase or executor design.",
      ],
    };
  });
}

export async function summarizeLegacyMusicResetCandidates(env, options) {
  if (!options.includeMusic) {
    return { available: true, coverage: "not_selected", classification: "not_selected", totalMusicRows: 0 };
  }
  return optionalSummary("ai_text_assets", async () => ({
    available: true,
    coverage: "partially_covered",
    classification: "candidate_requires_existing_delete_path",
    totalMusicRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ?", ["music"]),
    publicMusicRows: await countRows(
      env,
      "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?",
      ["music", "public"]
    ),
    lifecycleCoverage: "ai_text_assets lifecycle delete paths exist, but ownership metadata reset coverage is not claimed in Phase 6.21.",
  }));
}

export async function summarizeLegacyVideoResetCandidates(env, options) {
  if (!options.includeVideos) {
    return { available: true, coverage: "not_selected", classification: "not_selected", totalVideoRows: 0 };
  }
  const textVideo = await optionalSummary("ai_text_assets", async () => ({
    totalSavedVideoRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ?", ["video"]),
    publicSavedVideoRows: await countRows(
      env,
      "SELECT COUNT(*) AS total FROM ai_text_assets WHERE source_module = ? AND COALESCE(visibility, 'private') = ?",
      ["video", "public"]
    ),
  }));
  const jobs = await optionalSummary("ai_video_jobs", async () => ({
    totalVideoJobRows: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs"),
    outputReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs WHERE output_r2_key IS NOT NULL"),
    posterReferences: await countRows(env, "SELECT COUNT(*) AS total FROM ai_video_jobs WHERE poster_r2_key IS NOT NULL"),
    scopeRollup: await rollupRows(env, "SELECT scope AS key, COUNT(*) AS count FROM ai_video_jobs GROUP BY scope ORDER BY count DESC, key ASC"),
    statusRollup: await rollupRows(env, "SELECT status AS key, COUNT(*) AS count FROM ai_video_jobs GROUP BY status ORDER BY count DESC, key ASC"),
  }));
  const totalVideoRows = Number(textVideo.totalSavedVideoRows || 0) + Number(jobs.totalVideoJobRows || 0);
  return {
    available: textVideo.available !== false || jobs.available !== false,
    coverage: "partially_covered",
    classification: "candidate_requires_existing_delete_path",
    totalVideoRows,
    savedVideoAssets: textVideo,
    videoJobs: jobs,
    notes: [
      "Video reset coverage is conservative because generated video jobs and saved video assets use different tables.",
      "A future phase must confirm which video job states are safe to retire before any executor can delete rows or queued artifacts.",
    ],
  };
}

export async function summarizeLegacyStorageQuotaImpact(env, options) {
  if (!options.includeQuota) {
    return { available: true, coverage: "not_selected", classification: "not_selected" };
  }
  const usage = await optionalSummary("user_asset_storage_usage", async () => ({
    usageRows: await countRows(env, "SELECT COUNT(*) AS total FROM user_asset_storage_usage"),
    recordedUsedBytes: await countRows(env, "SELECT COALESCE(SUM(used_bytes), 0) AS total FROM user_asset_storage_usage"),
  }));
  const imageBytes = await countRows(env, "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM ai_images");
  const textBytes = await optionalSummary("ai_text_assets", () =>
    countRows(env, "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM ai_text_assets")
  );
  const posterBytes = await optionalSummary("ai_text_assets", () =>
    countRows(env, "SELECT COALESCE(SUM(poster_size_bytes), 0) AS total FROM ai_text_assets")
  );
  const videoOutputBytes = await optionalSummary("ai_video_jobs", () =>
    countRows(env, "SELECT COALESCE(SUM(output_size_bytes), 0) AS total FROM ai_video_jobs")
  );
  const videoPosterBytes = await optionalSummary("ai_video_jobs", () =>
    countRows(env, "SELECT COALESCE(SUM(poster_size_bytes), 0) AS total FROM ai_video_jobs")
  );
  const estimatedD1ReferencedBytes =
    imageBytes +
    Number(textBytes?.available === false ? 0 : textBytes) +
    Number(posterBytes?.available === false ? 0 : posterBytes) +
    Number(videoOutputBytes?.available === false ? 0 : videoOutputBytes) +
    Number(videoPosterBytes?.available === false ? 0 : videoPosterBytes);
  return {
    available: true,
    coverage: "partially_covered",
    classification: "candidate_requires_existing_delete_path",
    usageRows: usage.available === false ? null : usage.usageRows,
    recordedUsedBytes: usage.available === false ? null : usage.recordedUsedBytes,
    estimatedD1ReferencedBytes,
    r2ObjectSizesChecked: false,
    requirements: [
      "A future executor must recalculate or verify quota after deletion.",
      "This dry run never calls R2 head/list and uses only D1-stored byte counts.",
    ],
  };
}

export async function summarizeLegacyManualReviewImpact(env) {
  try {
    const summary = await buildTenantAssetManualReviewQueueSummary(env);
    const imageReviewItems = await countRows(
      env,
      "SELECT COUNT(*) AS total FROM ai_asset_manual_review_items WHERE asset_domain IN (?, ?, ?, ?)",
      ["ai_images", "public_gallery", "derivative", "relationship"]
    );
    const folderReviewItems = await countRows(
      env,
      "SELECT COUNT(*) AS total FROM ai_asset_manual_review_items WHERE asset_domain = ?",
      ["ai_folders"]
    );
    return {
      available: true,
      coverage: "covered_by_phase_6_21_dry_run",
      totalReviewItems: summary.totalReviewItems,
      totalEvents: summary.totalEvents,
      folderReviewItems,
      imageRelatedReviewItems: imageReviewItems,
      reviewStatusRollup: summary.reviewStatusRollup,
      issueCategoryRollup: summary.issueCategoryRollup,
      obsoleteIfResetSucceeds: folderReviewItems + imageReviewItems,
      reviewRowsMutated: false,
      notes: [
        "A future reset may make some review items obsolete, but Phase 6.21 does not supersede or mutate review rows.",
      ],
    };
  } catch (error) {
    if (
      isMissingTableError(error, "ai_asset_manual_review_items") ||
      error?.code === "tenant_asset_manual_review_schema_unavailable"
    ) {
      return {
        available: false,
        coverage: "unknown_schema",
        classification: "candidate_unknown_table_or_schema",
        totalReviewItems: 0,
        totalEvents: 0,
        reviewRowsMutated: false,
        message: "Manual-review tables are unavailable; manual review impact is not claimed.",
      };
    }
    throw error;
  }
}

function buildDomainCoverage({
  folderImageCandidates,
  publicGalleryCandidates,
  derivativeCandidates,
  videoCandidates,
  musicCandidates,
  textAssetCandidates,
  quotaImpact,
  manualReviewImpact,
}) {
  return {
    ai_folders: {
      coverage: folderImageCandidates.available ? "covered_by_phase_6_21_dry_run" : "unknown_schema",
      table: "ai_folders",
      resetReadiness: "future_executor_required",
    },
    ai_images: {
      coverage: folderImageCandidates.available ? "covered_by_phase_6_21_dry_run" : "unknown_schema",
      table: "ai_images",
      resetReadiness: "future_executor_required",
    },
    public_gallery_mempics: {
      coverage: publicGalleryCandidates.coverage,
      resetReadiness: "depublish_or_gallery_review_required",
    },
    derivative_artifacts: {
      coverage: derivativeCandidates.coverage,
      resetReadiness: "derivative_cleanup_required",
    },
    ai_text_assets: {
      coverage: textAssetCandidates.coverage,
      resetReadiness: "future_phase_required",
    },
    music_assets: {
      coverage: musicCandidates.coverage,
      resetReadiness: "future_phase_required",
    },
    video_assets_and_jobs: {
      coverage: videoCandidates.coverage,
      resetReadiness: "future_phase_required",
    },
    storage_quota: {
      coverage: quotaImpact.coverage,
      resetReadiness: "recalculate_or_verify_after_future_executor",
    },
    manual_review_items: {
      coverage: manualReviewImpact.coverage,
      resetReadiness: "future_supersede_policy_required",
    },
    lifecycle_delete_paths: {
      coverage: "partially_covered",
      resetReadiness: "future_executor_must_reuse_existing_lifecycle_helpers",
    },
  };
}

function buildSummary(parts) {
  const {
    folderImageCandidates,
    publicGalleryCandidates,
    derivativeCandidates,
    videoCandidates,
    musicCandidates,
    textAssetCandidates,
    quotaImpact,
    manualReviewImpact,
  } = parts;
  const videoRows = Number(videoCandidates.totalVideoRows || 0);
  const musicRows = Number(musicCandidates.totalMusicRows || 0);
  const textRows = Number(textAssetCandidates.totalTextAssetRows || 0);
  const totalLegacyCandidateRows =
    Number(folderImageCandidates.foldersWithNullOwnershipMetadata || 0) +
    Number(folderImageCandidates.imagesWithNullOwnershipMetadata || 0) +
    textRows +
    videoRows;
  const requiresManualReviewCount =
    Number(folderImageCandidates.requiresManualReviewCount || 0) +
    Number(publicGalleryCandidates.totalPublicRows || 0) +
    Number(derivativeCandidates.imagesWithDerivatives || 0) +
    Number(manualReviewImpact.totalReviewItems || 0);
  const notSafeToDeleteCount =
    Number(publicGalleryCandidates.totalPublicRows || 0) +
    Number(derivativeCandidates.imagesWithDerivatives || 0);
  return {
    totalLegacyCandidateRows,
    totalFolders: Number(folderImageCandidates.totalFolders || 0),
    foldersWithNullOwnershipMetadata: Number(folderImageCandidates.foldersWithNullOwnershipMetadata || 0),
    foldersWithOwnershipMetadata: Number(folderImageCandidates.foldersWithOwnershipMetadata || 0),
    totalImages: Number(folderImageCandidates.totalImages || 0),
    imagesWithNullOwnershipMetadata: Number(folderImageCandidates.imagesWithNullOwnershipMetadata || 0),
    imagesWithOwnershipMetadata: Number(folderImageCandidates.imagesWithOwnershipMetadata || 0),
    publicGalleryRows: Number(publicGalleryCandidates.totalPublicRows || 0),
    derivativePosterThumbReferences: Number(derivativeCandidates.totalDerivativeReferences || 0),
    manualReviewItemsCurrentlyPresent: Number(manualReviewImpact.totalReviewItems || 0),
    manualReviewItemsPotentiallyObsoleteAfterReset: Number(manualReviewImpact.obsoleteIfResetSucceeds || 0),
    videoRecordsFound: videoRows,
    musicRecordsFound: musicRows,
    textAssetRecordsFound: textRows,
    estimatedStorageBytesReferencedFromD1: Number(quotaImpact.estimatedD1ReferencedBytes || 0),
    domainsNotCovered: [
      textAssetCandidates.coverage === "unknown_schema" ? "ai_text_assets" : null,
      videoCandidates.coverage === "unknown_schema" ? "video_assets_and_jobs" : null,
      musicCandidates.coverage === "unknown_schema" ? "music_assets" : null,
    ].filter(Boolean),
    blockedCount: notSafeToDeleteCount + Number(manualReviewImpact.totalReviewItems || 0),
    ready_for_executor_count: Number(folderImageCandidates.readyForFutureExecutorCount || 0),
    requires_manual_review_count: requiresManualReviewCount,
    not_safe_to_delete_count: notSafeToDeleteCount,
  };
}

export async function buildLegacyMediaResetDryRunReport(env, input = {}) {
  const options = normalizeLegacyMediaResetDryRunOptions(input);
  const generatedAt = new Date().toISOString();
  if (!env?.DB) {
    return {
      ok: false,
      available: false,
      reportVersion: TENANT_ASSET_LEGACY_MEDIA_RESET_REPORT_VERSION,
      generatedAt,
      source: "local_d1_read_only",
      domain: "legacy_personal_media_reset",
      code: "tenant_asset_legacy_media_reset_db_unavailable",
      message: "D1 binding is unavailable.",
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      tenantIsolationClaimed: false,
      ownershipBackfillPerformed: false,
      sourceAssetRowsMutated: false,
      reviewRowsMutated: false,
      r2LiveListed: false,
      r2ObjectsMutated: false,
      productionReadiness: "blocked",
    };
  }

  try {
    const folderImageCandidates = await summarizeLegacyFolderImageResetCandidates(env, options);
    const [
      publicGalleryCandidates,
      derivativeCandidates,
      textAssetCandidates,
      musicCandidates,
      videoCandidates,
      quotaImpact,
      manualReviewImpact,
    ] = await Promise.all([
      summarizeLegacyPublicGalleryResetCandidates(env, options),
      summarizeLegacyDerivativeResetCandidates(env, options),
      summarizeLegacyTextAssetResetCandidates(env, options),
      summarizeLegacyMusicResetCandidates(env, options),
      summarizeLegacyVideoResetCandidates(env, options),
      summarizeLegacyStorageQuotaImpact(env, options),
      summarizeLegacyManualReviewImpact(env),
    ]);
    const parts = {
      folderImageCandidates,
      publicGalleryCandidates,
      derivativeCandidates,
      textAssetCandidates,
      musicCandidates,
      videoCandidates,
      quotaImpact,
      manualReviewImpact,
    };
    return {
      ok: true,
      available: true,
      reportVersion: TENANT_ASSET_LEGACY_MEDIA_RESET_REPORT_VERSION,
      generatedAt,
      source: "local_d1_read_only",
      domain: "legacy_personal_media_reset",
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      tenantIsolationClaimed: false,
      ownershipBackfillPerformed: false,
      sourceAssetRowsMutated: false,
      reviewRowsMutated: false,
      r2LiveListed: false,
      r2ObjectsMutated: false,
      productionReadiness: "blocked",
      filters: options,
      summary: buildSummary(parts),
      domainCoverage: buildDomainCoverage(parts),
      folderImageCandidates,
      publicGalleryCandidates,
      derivativeCandidates,
      videoCandidates,
      musicCandidates,
      textAssetCandidates,
      quotaImpact,
      manualReviewImpact,
      blockedReasons: [
        "Phase 6.21 is dry-run only and has no deletion executor.",
        "Public/gallery rows require explicit depublish or gallery review before any future deletion.",
        "Derivative/poster/thumb cleanup requires existing lifecycle queue/delete logic; no R2 listing or mutation was performed.",
        "Manual-review rows are not superseded or mutated by this report.",
        "Backfill and access-switch decisions remain blocked.",
      ],
      futureExecutorRequirements: [
        "Default dryRun=true and require explicit confirm=true, bounded reason, and Idempotency-Key.",
        "Require admin auth, production MFA, same-origin writes, bounded JSON, and fail-closed rate limits.",
        "Use existing safe lifecycle/delete helpers and durable cleanup queue; never direct uncontrolled SQL or R2 deletion.",
        "Write audit evidence, verify no source/orphan rows remain, and recalculate or verify storage quota.",
        "Supersede manual-review items only in a separately approved phase.",
      ],
      recommendations: [
        "Review this dry-run evidence before deciding whether a reset executor is cleaner than ownership metadata backfill.",
        "Design a future executor before any deletion, depublish, R2 cleanup, quota recalculation, or manual-review supersede action.",
        "Keep tenant isolation, access switch, and production readiness blocked until reset or backfill evidence is separately reviewed.",
      ],
      limitations: [
        "Counts are D1-only and may not reflect live R2 object existence.",
        "No R2 list/head/delete/copy/move operation is performed.",
        "Video/music/text reset coverage is conservative and may require a coverage expansion before executor work.",
        "This report does not mutate source asset rows, review rows, ownership metadata, public visibility, quota records, or access checks.",
      ],
    };
  } catch (error) {
    if (isMissingTableError(error, "ai_folders") || isMissingTableError(error, "ai_images")) {
      return {
        ok: false,
        available: false,
        reportVersion: TENANT_ASSET_LEGACY_MEDIA_RESET_REPORT_VERSION,
        generatedAt,
        source: "local_d1_read_only",
        domain: "legacy_personal_media_reset",
        code: "tenant_asset_legacy_media_reset_schema_unavailable",
        message: "Core folders/images tables are unavailable; legacy reset dry-run cannot classify core candidates.",
        runtimeBehaviorChanged: false,
        accessChecksChanged: false,
        tenantIsolationClaimed: false,
        ownershipBackfillPerformed: false,
        sourceAssetRowsMutated: false,
        reviewRowsMutated: false,
        r2LiveListed: false,
        r2ObjectsMutated: false,
        productionReadiness: "blocked",
      };
    }
    throw error;
  }
}

export function serializeLegacyMediaResetDryRunReport(report) {
  return report;
}

export function exportLegacyMediaResetDryRunReportJson(report) {
  return JSON.stringify(report, null, 2);
}

export function exportLegacyMediaResetDryRunReportMarkdown(report) {
  const summary = report.summary || {};
  const lines = [
    "# Legacy Personal Media Reset Dry Run",
    "",
    `Generated at: ${report.generatedAt || "unknown"}`,
    `Source: ${report.source || "local_d1_read_only"}`,
    `Domain: ${report.domain || "legacy_personal_media_reset"}`,
    `Production readiness: ${report.productionReadiness || "blocked"}`,
    `Runtime behavior changed: ${report.runtimeBehaviorChanged === true ? "yes" : "no"}`,
    `Access checks changed: ${report.accessChecksChanged === true ? "yes" : "no"}`,
    `Ownership backfill performed: ${report.ownershipBackfillPerformed === true ? "yes" : "no"}`,
    `Source asset rows mutated: ${report.sourceAssetRowsMutated === true ? "yes" : "no"}`,
    `Review rows mutated: ${report.reviewRowsMutated === true ? "yes" : "no"}`,
    `R2 live listed: ${report.r2LiveListed === true ? "yes" : "no"}`,
    `R2 objects mutated: ${report.r2ObjectsMutated === true ? "yes" : "no"}`,
    "",
    "## Summary",
  ];
  for (const key of [
    "totalLegacyCandidateRows",
    "totalFolders",
    "foldersWithNullOwnershipMetadata",
    "totalImages",
    "imagesWithNullOwnershipMetadata",
    "publicGalleryRows",
    "derivativePosterThumbReferences",
    "manualReviewItemsCurrentlyPresent",
    "videoRecordsFound",
    "musicRecordsFound",
    "textAssetRecordsFound",
    "estimatedStorageBytesReferencedFromD1",
    "ready_for_executor_count",
    "requires_manual_review_count",
    "not_safe_to_delete_count",
  ]) {
    lines.push(`- ${key}: ${summary[key] ?? "not_recorded"}`);
  }
  lines.push("", "## Domain Coverage");
  for (const [domain, coverage] of Object.entries(report.domainCoverage || {})) {
    lines.push(`- ${domain}: ${coverage.coverage || "unknown"} (${coverage.resetReadiness || "not_recorded"})`);
  }
  lines.push("", "## Blocked Reasons");
  for (const reason of report.blockedReasons || []) lines.push(`- ${reason}`);
  lines.push("", "## Future Executor Requirements");
  for (const requirement of report.futureExecutorRequirements || []) lines.push(`- ${requirement}`);
  lines.push("", "## Limitations");
  for (const limitation of report.limitations || []) lines.push(`- ${limitation}`);
  lines.push("");
  return lines.join("\n");
}
