import { nowIso, sha256Hex } from "./tokens.js";
import {
  TENANT_ASSET_MANUAL_REVIEW_STATUSES,
  serializeTenantAssetManualReviewMetadata,
} from "./tenant-asset-manual-review.js";
import {
  buildTenantAssetManualReviewQueueSummary,
  serializeTenantAssetManualReviewEvent,
  serializeTenantAssetManualReviewItem,
} from "./tenant-asset-manual-review-queue.js";

export const TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_DRY_RUN_ENDPOINT =
  "/api/admin/tenant-assets/manual-review/post-cleanup/dry-run";
export const TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_EVIDENCE_ENDPOINT =
  "/api/admin/tenant-assets/manual-review/post-cleanup/evidence";
export const TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_SUPERSEDE_ENDPOINT =
  "/api/admin/tenant-assets/manual-review/post-cleanup/supersede";

export const TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_VERSION =
  "tenant-asset-manual-review-post-cleanup-v1";
export const TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_SUPERSEDE_VERSION =
  "tenant-asset-manual-review-post-cleanup-supersede-v1";
export const MANUAL_REVIEW_SUPERSEDE_CONFIRMATION =
  "SUPERSEDE STALE REVIEW ITEMS";
export const POST_CLEANUP_EVIDENCE_PATH =
  "docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/";

export const MANUAL_REVIEW_POST_CLEANUP_CLASSIFICATIONS = Object.freeze([
  "active_current_review",
  "superseded_asset_missing",
  "superseded_after_manual_media_cleanup",
  "superseded_by_owner_metadata_present",
  "still_blocked_public_unsafe",
  "still_blocked_derivative_risk",
  "still_pending_manual_review",
  "still_deferred",
  "needs_legal_privacy_review",
  "unknown_requires_manual_review",
]);

const SAFE_SUPERSESSION_CLASSIFICATIONS = new Set([
  "superseded_asset_missing",
  "superseded_after_manual_media_cleanup",
  "superseded_by_owner_metadata_present",
]);
const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 1000;
const DEFAULT_SAMPLE_LIMIT = 25;
const MAX_SAMPLE_LIMIT = 100;
const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 100;
const MAX_REASON_LENGTH = 500;
const MAX_SAFE_ID_LENGTH = 180;
const ALLOWED_EXPORT_FORMATS = new Set(["json", "markdown", "html"]);
const TERMINAL_APPROVED_STATUSES = new Set([
  "approved_personal_user_asset",
  "approved_organization_asset",
  "approved_legacy_unclassified",
  "approved_platform_admin_test_asset",
  "rejected",
]);
const ITEM_SELECT_COLUMNS = `id, asset_domain, asset_id, related_asset_id, source_table, source_row_id,
  issue_category, review_status, severity, priority, legacy_owner_user_id,
  proposed_asset_owner_type, proposed_owning_user_id, proposed_owning_organization_id,
  proposed_ownership_status, proposed_ownership_source, proposed_ownership_confidence,
  evidence_source_path, evidence_report_generated_at, evidence_summary_json, safe_notes,
  assigned_to_user_id, reviewed_by_user_id, reviewed_at, created_by_user_id,
  created_at, updated_at, superseded_by_id, metadata_json`;
const EVENT_SELECT_COLUMNS = `id, review_item_id, event_type, old_status, new_status,
  actor_user_id, actor_email, reason, idempotency_key, request_hash, event_metadata_json, created_at`;

export class TenantAssetManualReviewPostCleanupError extends Error {
  constructor(message, { status = 400, code = "tenant_asset_manual_review_post_cleanup_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantAssetManualReviewPostCleanupError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function isMissingReviewTableError(error) {
  return /no such table:\s*ai_asset_manual_review_/i.test(String(error?.message || ""));
}

function isMissingAssetTableError(error) {
  return /no such table:\s*ai_(folders|images)/i.test(String(error?.message || ""));
}

function wrapMissingSchema(error) {
  if (isMissingReviewTableError(error) || isMissingAssetTableError(error)) {
    throw new TenantAssetManualReviewPostCleanupError("Manual-review post-cleanup source tables are unavailable.", {
      status: 409,
      code: "tenant_asset_manual_review_post_cleanup_schema_unavailable",
    });
  }
  throw error;
}

function normalizeLimit(value, { defaultValue = DEFAULT_SCAN_LIMIT, maxValue = MAX_SCAN_LIMIT, required = false, field = "limit" } = {}) {
  if ((value === undefined || value === null || value === "") && required) {
    throw new TenantAssetManualReviewPostCleanupError("A bounded batch limit is required.", {
      code: "tenant_asset_manual_review_post_cleanup_batch_limit_required",
      fields: { field },
    });
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    if (required) {
      throw new TenantAssetManualReviewPostCleanupError("A valid bounded batch limit is required.", {
        code: "tenant_asset_manual_review_post_cleanup_batch_limit_invalid",
        fields: { field },
      });
    }
    return defaultValue;
  }
  return Math.max(1, Math.min(maxValue, numeric));
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetManualReviewPostCleanupError("Invalid manual-review post-cleanup boolean option.", {
    code: "tenant_asset_manual_review_post_cleanup_boolean_invalid",
  });
}

function normalizeFormat(value) {
  const format = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_EXPORT_FORMATS.has(format)) {
    throw new TenantAssetManualReviewPostCleanupError("Unsupported manual-review post-cleanup evidence format.", {
      code: "tenant_asset_manual_review_post_cleanup_format_invalid",
      fields: { format },
    });
  }
  return format;
}

function normalizeSafeText(value, { maxLength = 160, required = false, field = "text" } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantAssetManualReviewPostCleanupError("Required manual-review post-cleanup field is missing.", {
        code: "tenant_asset_manual_review_post_cleanup_required",
        fields: { field },
      });
    }
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new TenantAssetManualReviewPostCleanupError("Manual-review post-cleanup field contains unsafe control characters.", {
      code: "tenant_asset_manual_review_post_cleanup_unsafe_text",
      fields: { field },
    });
  }
  return text.slice(0, maxLength);
}

function normalizeSafeId(value, { field = "id", required = false } = {}) {
  const text = normalizeSafeText(value, { maxLength: MAX_SAFE_ID_LENGTH, required, field });
  if (!text) return null;
  if (/[\u0000-\u001f\u007f/]/.test(text)) {
    throw new TenantAssetManualReviewPostCleanupError("Invalid manual-review post-cleanup identifier.", {
      code: "tenant_asset_manual_review_post_cleanup_id_invalid",
      fields: { field },
    });
  }
  return text;
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new TenantAssetManualReviewPostCleanupError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  const key = normalizeSafeText(value, { maxLength: 160, required: true, field: "Idempotency-Key" });
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new TenantAssetManualReviewPostCleanupError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

function normalizeSelectedItemIds(input) {
  const raw = Array.isArray(input?.selectedItemIds)
    ? input.selectedItemIds
    : Array.isArray(input?.selected_item_ids)
      ? input.selected_item_ids
      : [];
  const ids = [];
  for (const value of raw.slice(0, MAX_BATCH_LIMIT)) {
    ids.push(normalizeSafeId(value, { field: "selectedItemIds" }));
  }
  return Array.from(new Set(ids.filter(Boolean))).sort();
}

export function normalizePostCleanupDryRunOptions(input = {}) {
  return {
    limit: normalizeLimit(input.limit),
    sampleLimit: normalizeLimit(input.sampleLimit ?? input.sample_limit, {
      defaultValue: DEFAULT_SAMPLE_LIMIT,
      maxValue: MAX_SAMPLE_LIMIT,
    }),
    format: normalizeFormat(input.format),
  };
}

export function postCleanupDryRunOptionsFromSearch(searchParams, overrides = {}) {
  return normalizePostCleanupDryRunOptions({
    limit: searchParams.get("limit") ?? overrides.limit,
    sampleLimit: searchParams.get("sampleLimit") ?? searchParams.get("sample_limit") ?? overrides.sampleLimit,
    format: searchParams.get("format") ?? overrides.format,
  });
}

export function normalizePostCleanupSupersedeRequest(input = {}) {
  const dryRun = normalizeBoolean(input.dryRun ?? input.dry_run, true);
  const confirm = normalizeBoolean(input.confirm, false);
  const confirmation = normalizeSafeText(input.confirmation ?? input.confirmationPhrase, {
    maxLength: 80,
    required: true,
    field: "confirmation",
  });
  if (!confirm || confirmation !== MANUAL_REVIEW_SUPERSEDE_CONFIRMATION) {
    throw new TenantAssetManualReviewPostCleanupError("Manual-review supersession requires exact typed confirmation.", {
      code: "tenant_asset_manual_review_post_cleanup_confirmation_required",
      fields: { requiredConfirmation: MANUAL_REVIEW_SUPERSEDE_CONFIRMATION },
    });
  }
  const reason = normalizeSafeText(input.reason, {
    maxLength: MAX_REASON_LENGTH,
    required: true,
    field: "reason",
  });
  return {
    dryRun,
    confirm,
    confirmation,
    reason,
    batchLimit: normalizeLimit(input.batchLimit ?? input.batch_limit, {
      defaultValue: DEFAULT_BATCH_LIMIT,
      maxValue: MAX_BATCH_LIMIT,
      required: true,
      field: "batchLimit",
    }),
    selectedItemIds: normalizeSelectedItemIds(input),
  };
}

function hasOwnershipMetadata(row) {
  return Boolean(row?.asset_owner_type && row?.ownership_status && (row?.owning_user_id || row?.owning_organization_id));
}

function isPublicImage(row) {
  return String(row?.visibility || "private").toLowerCase() === "public" || Boolean(row?.published_at);
}

function hasDerivativeReference(row) {
  return Boolean(row?.thumb_key || row?.medium_key);
}

function sourceRefForItem(item) {
  const domain = String(item?.asset_domain || "");
  const table = String(item?.source_table || "");
  const id = normalizeSafeId(item?.source_row_id || item?.asset_id, { field: "assetId" });
  if (!id) return { table: null, id: null, supported: false };
  if (table === "ai_folders" || domain === "ai_folders") return { table: "ai_folders", id, supported: true };
  if (table === "ai_images" || ["ai_images", "public_gallery", "derivative", "relationship"].includes(domain)) {
    return { table: "ai_images", id, supported: true };
  }
  return { table: null, id, supported: false };
}

async function readSourceAsset(env, ref) {
  if (!ref?.supported || !ref.table || !ref.id) return null;
  if (ref.table === "ai_folders") {
    return env.DB.prepare(
      `SELECT id, user_id, status, asset_owner_type, owning_user_id, owning_organization_id,
              ownership_status, ownership_source, ownership_confidence, created_at
         FROM ai_folders
        WHERE id = ?
        LIMIT 1`
    ).bind(ref.id).first();
  }
  return env.DB.prepare(
    `SELECT id, user_id, folder_id, visibility, published_at, asset_owner_type,
            owning_user_id, owning_organization_id, ownership_status, ownership_source,
            ownership_confidence, thumb_key, medium_key, created_at
       FROM ai_images
      WHERE id = ?
      LIMIT 1`
  ).bind(ref.id).first();
}

function baseClassification({ item, ref, sourceAsset }) {
  const status = String(item?.review_status || "");
  const category = String(item?.issue_category || "");
  const assetExists = Boolean(sourceAsset?.id);
  const ownerMetadataPresent = hasOwnershipMetadata(sourceAsset);
  const publicReference = ref?.table === "ai_images" && isPublicImage(sourceAsset);
  const derivativeReference = ref?.table === "ai_images" && hasDerivativeReference(sourceAsset);

  if (status === "superseded") {
    return {
      classification: "superseded_after_manual_media_cleanup",
      reason: "review_status_already_superseded",
      supersessionEligible: false,
    };
  }
  if (!ref?.supported || !ref.id) {
    if (status === "deferred") {
      return {
        classification: "still_deferred",
        reason: "unsupported_or_deferred_domain_kept_current",
        supersessionEligible: false,
      };
    }
    return {
      classification: "unknown_requires_manual_review",
      reason: "no_resolvable_source_asset_reference",
      supersessionEligible: false,
    };
  }
  if (!assetExists) {
    return {
      classification: "superseded_asset_missing",
      reason: "referenced_source_asset_missing_from_current_d1",
      supersessionEligible: true,
    };
  }
  if (status === "deferred" || category === "safe_observe_only") {
    return {
      classification: "still_deferred",
      reason: "deferred_or_observe_only_review_row_kept_current",
      supersessionEligible: false,
    };
  }
  if (status === "needs_legal_privacy_review") {
    return {
      classification: "needs_legal_privacy_review",
      reason: "legal_privacy_review_status_kept_current",
      supersessionEligible: false,
    };
  }
  if (category === "public_unsafe" || status === "blocked_public_unsafe") {
    if (publicReference) {
      return {
        classification: "still_blocked_public_unsafe",
        reason: "current_source_asset_is_public_or_published",
        supersessionEligible: false,
      };
    }
    if (ownerMetadataPresent) {
      return {
        classification: "superseded_by_owner_metadata_present",
        reason: "public_risk_no_longer_current_and_owner_metadata_present",
        supersessionEligible: true,
      };
    }
    return {
      classification: "still_pending_manual_review",
      reason: "public_risk_no_longer_current_but_owner_metadata_missing",
      supersessionEligible: false,
    };
  }
  if (category === "derivative_risk" || status === "blocked_derivative_risk") {
    if (!ownerMetadataPresent && derivativeReference) {
      return {
        classification: "still_blocked_derivative_risk",
        reason: "current_source_asset_has_derivative_references_without_owner_metadata",
        supersessionEligible: false,
      };
    }
    if (ownerMetadataPresent) {
      return {
        classification: "superseded_by_owner_metadata_present",
        reason: "derivative_parent_owner_metadata_present",
        supersessionEligible: true,
      };
    }
    return {
      classification: "still_pending_manual_review",
      reason: "derivative_risk_no_longer_current_but_owner_metadata_missing",
      supersessionEligible: false,
    };
  }
  if (category === "relationship_review" || status === "blocked_relationship_conflict") {
    return {
      classification: "unknown_requires_manual_review",
      reason: "relationship_review_requires_human_validation",
      supersessionEligible: false,
    };
  }
  if (ownerMetadataPresent && !publicReference) {
    return {
      classification: "superseded_by_owner_metadata_present",
      reason: "current_source_asset_has_owner_metadata",
      supersessionEligible: true,
    };
  }
  if (status === "review_in_progress" || TERMINAL_APPROVED_STATUSES.has(status)) {
    return {
      classification: "active_current_review",
      reason: "review_row_is_current_or_terminal_operator_evidence",
      supersessionEligible: false,
    };
  }
  if (category === "metadata_missing" || category === "manual_review_needed" || category === "dual_read_unsafe") {
    return {
      classification: "still_pending_manual_review",
      reason: "current_source_asset_still_requires_manual_review",
      supersessionEligible: false,
    };
  }
  return {
    classification: "unknown_requires_manual_review",
    reason: "unmapped_current_review_row_kept_for_manual_review",
    supersessionEligible: false,
  };
}

function sourceAssetSummary(ref, sourceAsset) {
  return {
    sourceTable: ref?.table || null,
    assetExists: Boolean(sourceAsset?.id),
    ownershipMetadataPresent: hasOwnershipMetadata(sourceAsset),
    publicReference: ref?.table === "ai_images" && isPublicImage(sourceAsset),
    derivativeReference: ref?.table === "ai_images" && hasDerivativeReference(sourceAsset),
    ownerType: sourceAsset?.asset_owner_type || null,
    ownershipStatus: sourceAsset?.ownership_status || null,
    owningUserIdPresent: Boolean(sourceAsset?.owning_user_id),
    owningOrganizationIdPresent: Boolean(sourceAsset?.owning_organization_id),
  };
}

function serializeClassifiedItem(item) {
  return {
    id: item.id,
    assetDomain: item.assetDomain,
    assetId: item.assetId,
    relatedAssetId: item.relatedAssetId,
    issueCategory: item.issueCategory,
    reviewStatus: item.reviewStatus,
    classification: item.classification,
    reason: item.reason,
    supersessionEligible: item.supersessionEligible === true,
    sourceAsset: item.sourceAsset,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function classifyItem(env, row) {
  const serialized = serializeTenantAssetManualReviewItem(row);
  const ref = sourceRefForItem(row);
  let sourceAsset = null;
  if (ref.supported && ref.id) sourceAsset = await readSourceAsset(env, ref);
  const classification = baseClassification({ item: row, ref, sourceAsset });
  return {
    ...serialized,
    classification: classification.classification,
    reason: classification.reason,
    supersessionEligible: classification.supersessionEligible === true,
    sourceAsset: sourceAssetSummary(ref, sourceAsset),
  };
}

async function listReviewRowsForClassification(env, limit) {
  const result = await env.DB.prepare(
    `SELECT ${ITEM_SELECT_COLUMNS}
       FROM ai_asset_manual_review_items
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`
  ).bind(limit, 0).all();
  return result?.results || [];
}

function emptyCategoryCounts() {
  return Object.fromEntries(MANUAL_REVIEW_POST_CLEANUP_CLASSIFICATIONS.map((key) => [key, 0]));
}

function buildCategoryCounts(items) {
  const counts = emptyCategoryCounts();
  for (const item of items) {
    const classification = MANUAL_REVIEW_POST_CLEANUP_CLASSIFICATIONS.includes(item.classification)
      ? item.classification
      : "unknown_requires_manual_review";
    counts[classification] = (counts[classification] || 0) + 1;
  }
  return counts;
}

function activeCurrentCount(categoryCounts) {
  return MANUAL_REVIEW_POST_CLEANUP_CLASSIFICATIONS
    .filter((classification) => !SAFE_SUPERSESSION_CLASSIFICATIONS.has(classification))
    .reduce((sum, classification) => sum + Number(categoryCounts[classification] || 0), 0);
}

function buildSummary({ queueSummary, classifiedItems, scanLimit, totalReviewItems }) {
  const categoryCounts = buildCategoryCounts(classifiedItems);
  const eligibleSafeItems = classifiedItems.filter((item) => item.supersessionEligible === true);
  return {
    totalReviewItems,
    scannedReviewItems: classifiedItems.length,
    scanLimit,
    scanTruncated: Number(totalReviewItems || 0) > classifiedItems.length,
    activeCurrentItems: activeCurrentCount(categoryCounts),
    supersededCandidates: eligibleSafeItems.length,
    assetMissingCandidates: eligibleSafeItems.filter((item) => item.classification === "superseded_asset_missing").length,
    ownerMetadataResolvedCandidates: eligibleSafeItems.filter((item) => item.classification === "superseded_by_owner_metadata_present").length,
    manualCleanupSupersededCandidates: eligibleSafeItems.filter((item) => item.classification === "superseded_after_manual_media_cleanup").length,
    stillBlockedPublicUnsafe: categoryCounts.still_blocked_public_unsafe || 0,
    stillBlockedDerivativeRisk: categoryCounts.still_blocked_derivative_risk || 0,
    stillBlocked: Number(categoryCounts.still_blocked_public_unsafe || 0) + Number(categoryCounts.still_blocked_derivative_risk || 0),
    stillPendingManualReview: categoryCounts.still_pending_manual_review || 0,
    stillDeferred: categoryCounts.still_deferred || 0,
    needsLegalPrivacyReview: categoryCounts.needs_legal_privacy_review || 0,
    unknownRequiresManualReview: categoryCounts.unknown_requires_manual_review || 0,
    activeCurrentReview: categoryCounts.active_current_review || 0,
    historicalSupersededItems: classifiedItems.filter((item) => item.reviewStatus === "superseded").length,
    categoryCounts,
    eventsCount: Number(queueSummary?.totalEvents || 0),
    totalEvents: Number(queueSummary?.totalEvents || 0),
    latestImportAt: queueSummary?.mostRecentImportTimestamp || null,
    latestStatusAt: queueSummary?.latestStatusUpdateTimestamp || null,
    postCleanupEvidencePath: POST_CLEANUP_EVIDENCE_PATH,
    tenantIsolationClaimed: false,
    accessSwitchReadiness: "blocked",
    backfillReadiness: "blocked",
    resetReadiness: "blocked",
    d1Mutated: false,
    r2Mutated: false,
  };
}

export async function buildManualReviewPostCleanupDryRunReport(env, input = {}) {
  const options = normalizePostCleanupDryRunOptions(input);
  const generatedAt = nowIso();
  if (!env?.DB) {
    return {
      ok: false,
      available: false,
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_VERSION,
      generatedAt,
      source: "local_d1_read_only",
      code: "tenant_asset_manual_review_post_cleanup_db_unavailable",
      message: "D1 binding is unavailable.",
      tenantIsolationClaimed: false,
      d1Mutated: false,
      r2Mutated: false,
      summary: buildSummary({ queueSummary: {}, classifiedItems: [], scanLimit: options.limit, totalReviewItems: 0 }),
    };
  }
  try {
    const queueSummary = await buildTenantAssetManualReviewQueueSummary(env);
    const rows = await listReviewRowsForClassification(env, options.limit);
    const classifiedItems = [];
    for (const row of rows) {
      classifiedItems.push(await classifyItem(env, row));
    }
    const summary = buildSummary({
      queueSummary,
      classifiedItems,
      scanLimit: options.limit,
      totalReviewItems: Number(queueSummary?.totalReviewItems || rows.length),
    });
    const report = {
      ok: true,
      available: true,
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_VERSION,
      generatedAt,
      source: "local_d1_read_only_post_cleanup_classifier",
      sourceEndpoint: TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_DRY_RUN_ENDPOINT,
      dryRun: true,
      domain: "folders_images_manual_review_post_cleanup",
      postCleanupEvidencePath: POST_CLEANUP_EVIDENCE_PATH,
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      tenantIsolationClaimed: false,
      backfillPerformed: false,
      sourceAssetRowsMutated: false,
      reviewRowsMutated: false,
      d1Mutated: false,
      r2LiveListed: false,
      r2Mutated: false,
      productionReadiness: "blocked",
      options: {
        limit: options.limit,
        sampleLimit: options.sampleLimit,
      },
      summary,
      categoryCounts: summary.categoryCounts,
      safeSampleItems: classifiedItems
        .filter((item) => item.supersessionEligible === true)
        .slice(0, options.sampleLimit)
        .map(serializeClassifiedItem),
      activeSampleItems: classifiedItems
        .filter((item) => item.supersessionEligible !== true)
        .slice(0, options.sampleLimit)
        .map(serializeClassifiedItem),
      redaction: {
        rawPrivateR2KeysExposed: false,
        rawIdempotencyKeysExposed: false,
        rawRequestHashesExposed: false,
        secretsTokensCookiesExposed: false,
      },
      blockedClaims: [
        "tenant_isolation",
        "access_switch_readiness",
        "ownership_backfill_readiness",
        "confirmed_legacy_media_reset_readiness",
        "production_readiness",
      ],
      recommendedNextAction: summary.supersededCandidates > 0
        ? "Export this dry-run evidence, review safe candidates, then optionally run guarded supersession with exact confirmation."
        : "Keep review queue active; no safe supersession candidates were identified in this bounded scan.",
      limitations: [
        "This classifier reads current D1 review rows plus bounded ai_folders/ai_images metadata only.",
        "It never lists or mutates R2 and never deletes source assets.",
        "It does not approve Backfill, Access-Switch enforcement, Reset, tenant isolation, or production readiness.",
      ],
    };
    Object.defineProperty(report, "__classifiedItems", {
      value: classifiedItems,
      enumerable: false,
    });
    return report;
  } catch (error) {
    wrapMissingSchema(error);
  }
}

function escapeMarkdown(value) {
  return String(value ?? "not_recorded").replace(/\|/g, "\\|");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function exportManualReviewPostCleanupEvidenceJson(report) {
  return JSON.stringify(report, null, 2);
}

export function exportManualReviewPostCleanupEvidenceMarkdown(report) {
  const summary = report.summary || {};
  const lines = [
    "# Manual Review Queue Post-Cleanup Supersession Evidence",
    "",
    `Generated at: ${report.generatedAt || "unknown"}`,
    `Source endpoint: ${report.sourceEndpoint || TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_DRY_RUN_ENDPOINT}`,
    `Dry-run: ${report.dryRun === false ? "no" : "yes"}`,
    `Post-cleanup evidence path: ${report.postCleanupEvidencePath || POST_CLEANUP_EVIDENCE_PATH}`,
    "",
    "## No-Mutation Statement",
    "",
    "- D1 mutated: no",
    "- R2 listed: no",
    "- R2 mutated: no",
    "- Assets deleted: no",
    "- Tenant isolation claimed: no",
    "",
    "## Summary",
    "",
  ];
  for (const key of [
    "totalReviewItems",
    "activeCurrentItems",
    "supersededCandidates",
    "assetMissingCandidates",
    "ownerMetadataResolvedCandidates",
    "stillBlocked",
    "stillPendingManualReview",
    "stillDeferred",
    "unknownRequiresManualReview",
    "eventsCount",
    "latestImportAt",
    "latestStatusAt",
    "accessSwitchReadiness",
    "backfillReadiness",
    "resetReadiness",
  ]) {
    lines.push(`- ${key}: ${summary[key] ?? "not_recorded"}`);
  }
  lines.push("", "## Category Counts", "");
  for (const [key, count] of Object.entries(report.categoryCounts || summary.categoryCounts || {})) {
    lines.push(`- ${key}: ${count}`);
  }
  lines.push("", "## Safe Sample Items", "");
  const items = Array.isArray(report.safeSampleItems) ? report.safeSampleItems : [];
  if (!items.length) {
    lines.push("- None in bounded dry-run.");
  } else {
    lines.push("| Item | Domain | Category | Classification | Reason |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const item of items.slice(0, DEFAULT_SAMPLE_LIMIT)) {
      lines.push(`| ${escapeMarkdown(item.id)} | ${escapeMarkdown(item.assetDomain)} | ${escapeMarkdown(item.issueCategory)} | ${escapeMarkdown(item.classification)} | ${escapeMarkdown(item.reason)} |`);
    }
  }
  lines.push("", "## Redaction Statement", "");
  lines.push("- No raw private R2 keys, raw idempotency keys, raw request hashes, secrets, tokens, cookies, signed URLs, provider payloads, or Stripe payloads are included.");
  lines.push("", "## Blocked Claims", "");
  for (const claim of report.blockedClaims || []) lines.push(`- ${claim}`);
  lines.push("", "## Recommended Next Action", "");
  lines.push(report.recommendedNextAction || "Review dry-run evidence before any optional supersession.");
  lines.push("");
  return lines.join("\n");
}

export function exportManualReviewPostCleanupEvidenceHtml(report) {
  const markdown = exportManualReviewPostCleanupEvidenceMarkdown(report);
  const paragraphs = markdown.split("\n").map((line) => {
    if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
    if (line.startsWith("| ")) return `<pre>${escapeHtml(line)}</pre>`;
    if (!line.trim()) return "";
    return `<p>${escapeHtml(line)}</p>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Manual Review Queue Post-Cleanup Evidence</title>
  <style>
    body { font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; margin: 32px; }
    h1, h2 { line-height: 1.2; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; margin-top: 24px; }
    li { margin: 4px 0; }
    pre { white-space: pre-wrap; border: 1px solid #d1d5db; padding: 8px; border-radius: 6px; background: #f9fafb; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
${paragraphs}
</body>
</html>`;
}

async function listEventsForIdempotency(env, idempotencyKeyHash, limit = 200) {
  const result = await env.DB.prepare(
    `SELECT id, review_item_id, request_hash, created_at
       FROM ai_asset_manual_review_events
      WHERE idempotency_key = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`
  ).bind(idempotencyKeyHash, limit).all();
  return result?.results || [];
}

export async function buildPostCleanupSupersedeRequestHash(request) {
  return sha256Hex(JSON.stringify({
    operation: "tenant_asset_manual_review_post_cleanup_supersede",
    dryRun: request.dryRun,
    confirmation: request.confirmation,
    reason: request.reason,
    batchLimit: request.batchLimit,
    selectedItemIds: request.selectedItemIds,
  }));
}

async function buildSupersedeEventId({ reviewItemId, idempotencyKeyHash, requestHash }) {
  const hash = await sha256Hex(`post-cleanup-supersede|${reviewItemId}|${idempotencyKeyHash}|${requestHash}`);
  return `ta_mre_${hash.slice(0, 32)}`;
}

function buildSkippedByReason(items, selected) {
  const out = {};
  const selectedIds = selected ? new Set(selected.map((item) => item.id)) : null;
  for (const item of items) {
    if (selectedIds?.has(item.id)) continue;
    const reason = item.supersessionEligible === true ? "batch_limit_or_not_selected" : item.classification || "unknown";
    out[reason] = (out[reason] || 0) + 1;
  }
  return out;
}

function assertSafeSelectedItems({ requestedIds, safeItems }) {
  if (!requestedIds.length) return;
  const safeIds = new Set(safeItems.map((item) => item.id));
  const missing = requestedIds.filter((id) => !safeIds.has(id));
  if (missing.length) {
    throw new TenantAssetManualReviewPostCleanupError("Requested manual-review item is not currently a safe supersession candidate.", {
      status: 409,
      code: "tenant_asset_manual_review_post_cleanup_candidate_mismatch",
      fields: {
        requestedItemCount: requestedIds.length,
        matchedSafeCandidateCount: requestedIds.length - missing.length,
      },
    });
  }
}

export async function executeManualReviewPostCleanupSupersede(env, {
  request,
  adminUser,
  idempotencyKey,
} = {}) {
  const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const normalized = normalizePostCleanupSupersedeRequest(request || {});
  const idempotencyKeyHash = await sha256Hex(`tenant-asset-manual-review-post-cleanup-supersede:${safeIdempotencyKey}`);
  const requestHash = await buildPostCleanupSupersedeRequestHash(normalized);
  const dryRunReport = await buildManualReviewPostCleanupDryRunReport(env, {
    limit: Math.max(normalized.batchLimit, DEFAULT_SCAN_LIMIT),
    sampleLimit: normalized.batchLimit,
  });
  if (!dryRunReport.available) {
    throw new TenantAssetManualReviewPostCleanupError("Manual-review post-cleanup dry-run is unavailable.", {
      status: 409,
      code: dryRunReport.code || "tenant_asset_manual_review_post_cleanup_unavailable",
    });
  }

  let safeItems = Array.isArray(dryRunReport.__classifiedItems)
    ? dryRunReport.__classifiedItems
    : [
        ...(dryRunReport.safeSampleItems || []),
        ...(dryRunReport.activeSampleItems || []).filter((item) => item.supersessionEligible === true),
      ];
  safeItems = safeItems.filter((item) => SAFE_SUPERSESSION_CLASSIFICATIONS.has(item.classification));
  assertSafeSelectedItems({ requestedIds: normalized.selectedItemIds, safeItems });
  if (normalized.selectedItemIds.length) {
    const requested = new Set(normalized.selectedItemIds);
    safeItems = safeItems.filter((item) => requested.has(item.id));
  }
  const selected = safeItems.slice(0, normalized.batchLimit);

  if (normalized.dryRun) {
    return {
      ok: true,
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_SUPERSEDE_VERSION,
      generatedAt: nowIso(),
      dryRun: true,
      rowsConsidered: selected.length,
      rowsSuperseded: 0,
      rowsSkipped: Math.max(0, Number(dryRunReport.summary?.totalReviewItems || 0) - selected.length),
      skippedByReason: buildSkippedByReason([...(dryRunReport.safeSampleItems || []), ...(dryRunReport.activeSampleItems || [])], selected),
      eventRowsCreated: 0,
      idempotency: {
        required: true,
        storedAs: "sha256",
        persisted: false,
        replayed: false,
      },
      d1Mutated: false,
      r2Mutated: false,
      tenantIsolationClaimed: false,
      selectedItems: selected.map(serializeClassifiedItem),
      dryRunReport: {
        generatedAt: dryRunReport.generatedAt,
        summary: dryRunReport.summary,
      },
    };
  }

  let existingEvents = [];
  try {
    existingEvents = await listEventsForIdempotency(env, idempotencyKeyHash);
  } catch (error) {
    wrapMissingSchema(error);
  }
  if (existingEvents.length > 0) {
    if (existingEvents.some((event) => event.request_hash !== requestHash)) {
      throw new TenantAssetManualReviewPostCleanupError("Idempotency-Key was already used for a different manual-review supersession request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      ok: true,
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_SUPERSEDE_VERSION,
      generatedAt: nowIso(),
      dryRun: false,
      rowsConsidered: existingEvents.length,
      rowsSuperseded: existingEvents.length,
      rowsSkipped: 0,
      skippedByReason: { idempotent_replay: existingEvents.length },
      eventRowsCreated: 0,
      idempotency: {
        required: true,
        storedAs: "sha256",
        replayed: true,
        eventCount: existingEvents.length,
      },
      d1Mutated: false,
      r2Mutated: false,
      tenantIsolationClaimed: false,
    };
  }

  const timestamp = nowIso();
  const statements = [];
  for (const item of selected) {
    const eventId = await buildSupersedeEventId({
      reviewItemId: item.id,
      idempotencyKeyHash,
      requestHash,
    });
    const eventMetadataJson = serializeTenantAssetManualReviewMetadata({
      package: "OMEGA-P2-03",
      source: "manual_review_post_cleanup_supersession",
      classification: item.classification,
      reason: item.reason,
      accessChecksChanged: false,
      ownershipBackfillPerformed: false,
      sourceAssetMutation: false,
      r2Operation: false,
      tenantIsolationClaimed: false,
    });
    statements.push(
      env.DB.prepare(
        `UPDATE ai_asset_manual_review_items
            SET review_status = ?,
                reviewed_by_user_id = ?,
                reviewed_at = ?,
                updated_at = ?,
                superseded_by_id = ?
          WHERE id = ?
            AND review_status != ?`
      ).bind(
        "superseded",
        adminUser?.id || null,
        timestamp,
        timestamp,
        eventId,
        item.id,
        "superseded"
      ),
      env.DB.prepare(
        `INSERT INTO ai_asset_manual_review_events (
          id, review_item_id, event_type, old_status, new_status, actor_user_id,
          actor_email, reason, idempotency_key, request_hash, event_metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        eventId,
        item.id,
        "superseded",
        item.reviewStatus,
        "superseded",
        adminUser?.id || null,
        adminUser?.email || null,
        normalized.reason,
        idempotencyKeyHash,
        requestHash,
        eventMetadataJson,
        timestamp
      )
    );
  }
  try {
    if (statements.length) await env.DB.batch(statements);
  } catch (error) {
    wrapMissingSchema(error);
  }
  return {
    ok: true,
    reportVersion: TENANT_ASSET_MANUAL_REVIEW_POST_CLEANUP_SUPERSEDE_VERSION,
    generatedAt: nowIso(),
    dryRun: false,
    rowsConsidered: selected.length,
    rowsSuperseded: selected.length,
    rowsSkipped: Math.max(0, Number(dryRunReport.summary?.totalReviewItems || 0) - selected.length),
    skippedByReason: buildSkippedByReason([...(dryRunReport.safeSampleItems || []), ...(dryRunReport.activeSampleItems || [])], selected),
    eventRowsCreated: selected.length,
    idempotency: {
      required: true,
      storedAs: "sha256",
      replayed: false,
    },
    d1Mutated: selected.length > 0,
    r2Mutated: false,
    tenantIsolationClaimed: false,
    noBackfill: true,
    noAccessSwitch: true,
    noSourceAssetMutation: true,
    noR2Operation: true,
    allowedStatuses: TENANT_ASSET_MANUAL_REVIEW_STATUSES,
    selectedItems: selected.map(serializeClassifiedItem),
    events: selected.map((item) => serializeTenantAssetManualReviewEvent({
      id: item.supersededById || null,
      review_item_id: item.id,
      event_type: "superseded",
      old_status: item.reviewStatus,
      new_status: "superseded",
      actor_user_id: adminUser?.id || null,
      actor_email: adminUser?.email || null,
      reason: normalized.reason,
      idempotency_key: idempotencyKeyHash,
      request_hash: requestHash,
      event_metadata_json: "{}",
      created_at: timestamp,
    })).slice(0, MAX_SAMPLE_LIMIT),
  };
}
