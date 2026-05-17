import {
  TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATIONS,
  buildTenantAssetReadDiagnosticsReport,
} from "./tenant-asset-read-diagnostics.js";

export const TENANT_ASSET_OWNERSHIP_EVIDENCE_REPORT_VERSION = "tenant-asset-ownership-evidence-report-v1";
export const TENANT_ASSET_OWNERSHIP_EVIDENCE_ENDPOINT = "/api/admin/tenant-assets/folders-images/evidence";
export const TENANT_ASSET_OWNERSHIP_EVIDENCE_EXPORT_ENDPOINT = "/api/admin/tenant-assets/folders-images/evidence/export";

const DEFAULT_EVIDENCE_LIMIT = 50;
const MAX_EVIDENCE_LIMIT = 100;
const ALLOWED_FORMATS = new Set(["json", "markdown"]);
const ALLOWED_SEVERITIES = new Set(["critical", "warning", "info"]);

export class TenantAssetEvidenceReportError extends Error {
  constructor(message, { status = 400, code = "tenant_asset_evidence_report_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantAssetEvidenceReportError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function normalizeLimit(value, { defaultValue = DEFAULT_EVIDENCE_LIMIT, maxValue = MAX_EVIDENCE_LIMIT } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return defaultValue;
  return Math.max(1, Math.min(maxValue, numeric));
}

function parseBoolean(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetEvidenceReportError("Invalid tenant asset evidence boolean filter.", {
    status: 400,
    code: "tenant_asset_evidence_filter_invalid",
  });
}

function normalizeClassification(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATIONS.includes(text)) {
    throw new TenantAssetEvidenceReportError("Unsupported tenant asset evidence classification filter.", {
      status: 400,
      code: "tenant_asset_evidence_filter_invalid",
      fields: { classification: text },
    });
  }
  return text;
}

function normalizeSeverity(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!ALLOWED_SEVERITIES.has(text)) {
    throw new TenantAssetEvidenceReportError("Unsupported tenant asset evidence severity filter.", {
      status: 400,
      code: "tenant_asset_evidence_filter_invalid",
      fields: { severity: text },
    });
  }
  return text;
}

export function normalizeTenantAssetEvidenceReportOptions(input = {}) {
  return {
    limit: normalizeLimit(input.limit),
    includeDetails: parseBoolean(input.includeDetails ?? input.include_details, true),
    includePublic: parseBoolean(input.includePublic ?? input.include_public, true),
    includeRelationships: parseBoolean(input.includeRelationships ?? input.include_relationships, true),
    includeDerivatives: parseBoolean(input.includeDerivatives ?? input.include_derivatives, true),
    classification: normalizeClassification(input.classification),
    severity: normalizeSeverity(input.severity),
    format: normalizeTenantAssetEvidenceExportFormat(input.format),
  };
}

export function normalizeTenantAssetEvidenceExportFormat(value) {
  const format = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    throw new TenantAssetEvidenceReportError("Unsupported tenant asset evidence export format.", {
      status: 400,
      code: "tenant_asset_evidence_format_invalid",
      fields: { format },
    });
  }
  return format;
}

export function tenantAssetEvidenceOptionsFromSearch(searchParams, overrides = {}) {
  return normalizeTenantAssetEvidenceReportOptions({
    limit: searchParams.get("limit") ?? overrides.limit,
    includeDetails: searchParams.get("includeDetails") ?? searchParams.get("include_details") ?? overrides.includeDetails,
    includePublic: searchParams.get("includePublic") ?? searchParams.get("include_public") ?? overrides.includePublic,
    includeRelationships: searchParams.get("includeRelationships") ?? searchParams.get("include_relationships") ?? overrides.includeRelationships,
    includeDerivatives: searchParams.get("includeDerivatives") ?? searchParams.get("include_derivatives") ?? overrides.includeDerivatives,
    classification: searchParams.get("classification") ?? overrides.classification,
    severity: searchParams.get("severity") ?? overrides.severity,
    format: searchParams.get("format") ?? overrides.format,
  });
}

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

async function listFolderRows(env, limit) {
  const result = await env.DB.prepare(
    `SELECT id, user_id, status, asset_owner_type, owning_user_id, owning_organization_id,
      created_by_user_id, ownership_status, ownership_source, ownership_confidence,
      ownership_assigned_at, created_at
     FROM ai_folders
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(limit).all();
  return result?.results || [];
}

async function listImageRows(env, limit) {
  const result = await env.DB.prepare(
    `SELECT id, user_id, folder_id, visibility, published_at, r2_key, thumb_key, medium_key,
      asset_owner_type, owning_user_id, owning_organization_id, created_by_user_id,
      ownership_status, ownership_source, ownership_confidence, ownership_assigned_at, created_at
     FROM ai_images
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(limit).all();
  return result?.results || [];
}

function rollupBy(items, key) {
  const rollup = {};
  for (const item of items || []) {
    const value = item?.[key] || "unknown";
    rollup[value] = (rollup[value] || 0) + 1;
  }
  return rollup;
}

function filterItems(items, { classification, severity } = {}) {
  return (items || []).filter((item) => (
    (!classification || item.classification === classification) &&
    (!severity || item.severity === severity)
  ));
}

function summarizeOwnerSignal(item) {
  return {
    legacyOwnerPresent: Boolean(item?.legacyUserId),
    ownershipMetadataPresent: Boolean(item?.ownerType || item?.owningUserId || item?.owningOrganizationId || item?.ownershipStatus),
    ownerType: item?.ownerType || null,
    ownershipStatus: item?.ownershipStatus || null,
    owningUserIdPresent: Boolean(item?.owningUserId),
    owningOrganizationIdPresent: Boolean(item?.owningOrganizationId),
  };
}

function evidenceItem(item, type) {
  return {
    itemType: type,
    itemId: item?.sourceId || null,
    classification: item?.classification || "not_applicable",
    severity: item?.severity || "info",
    legacyOwnerSignal: {
      basis: item?.evidence?.legacyAccessBasis || (type === "folder" ? "ai_folders.user_id" : "ai_images.user_id"),
      userIdPresent: Boolean(item?.legacyUserId),
    },
    ownershipMetadataSignal: summarizeOwnerSignal(item),
    publicGalleryRisk: item?.public === true
      ? (item?.classification === "same_allow" ? "legacy_public_attribution_only" : "unsafe_for_ownership_switch")
      : "not_public",
    relationshipRisk: type === "relationship"
      ? item?.reason || "not_applicable"
      : "not_applicable",
    derivativeRisk: type === "derivative"
      ? item?.reason || "not_applicable"
      : "not_applicable",
    recommendedNextAction: item?.recommendation || "Review before any future access-check migration.",
    futurePhase: "Phase 6.8",
  };
}

function manualReviewItems(items) {
  return (items || [])
    .filter((item) => ["critical", "warning"].includes(item.severity))
    .map((item) => evidenceItem(item, item.domain || "diagnostic"));
}

export function summarizeTenantAssetOwnershipDiagnostics(diagnostics) {
  const allItems = [
    ...diagnostics.folderDiagnostics,
    ...diagnostics.imageDiagnostics,
    ...diagnostics.relationshipDiagnostics,
    ...diagnostics.publicGalleryDiagnostics,
    ...diagnostics.derivativeDiagnostics,
  ];
  return {
    classificationRollup: rollupBy(allItems, "classification"),
    severityRollup: rollupBy(allItems, "severity"),
    dualReadSafetyRollup: {
      safe: diagnostics.summary.simulatedDualReadSafeCount,
      unsafe: diagnostics.summary.simulatedDualReadUnsafeCount,
      needsManualReview: diagnostics.summary.needsManualReviewCount,
      metadataMissing: diagnostics.summary.foldersWithNullOwnershipMetadata + diagnostics.summary.imagesWithNullOwnershipMetadata,
      metadataConflicts: diagnostics.summary.metadataConflictCount,
      relationshipConflicts: diagnostics.summary.relationshipConflictCount,
    },
  };
}

export function serializeTenantAssetOwnershipEvidenceReport(report) {
  if (!report?.available) return report;
  const diagnostics = report.diagnostics;
  const filteredFolders = filterItems(diagnostics.folderDiagnostics, report.filters);
  const filteredImages = filterItems(diagnostics.imageDiagnostics, report.filters);
  const filteredRelationships = filterItems(diagnostics.relationshipDiagnostics, report.filters);
  const filteredPublic = filterItems(diagnostics.publicGalleryDiagnostics, report.filters);
  const filteredDerivatives = report.filters.includeDerivatives === false
    ? []
    : filterItems(diagnostics.derivativeDiagnostics, report.filters);
  const allFiltered = [
    ...filteredFolders,
    ...filteredImages,
    ...filteredRelationships,
    ...filteredPublic,
    ...filteredDerivatives,
  ];

  return {
    ok: true,
    available: true,
    reportVersion: TENANT_ASSET_OWNERSHIP_EVIDENCE_REPORT_VERSION,
    generatedAt: report.generatedAt,
    source: "local_d1_read_only",
    domain: "folders_images",
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    tenantIsolationClaimed: false,
    backfillPerformed: false,
    r2LiveListed: false,
    productionReadiness: "blocked",
    filters: report.filters,
    summary: diagnostics.summary,
    ...summarizeTenantAssetOwnershipDiagnostics(diagnostics),
    folderEvidence: report.filters.includeDetails ? filteredFolders.map((item) => evidenceItem(item, "folder")) : [],
    imageEvidence: report.filters.includeDetails ? filteredImages.map((item) => evidenceItem(item, "image")) : [],
    relationshipEvidence: report.filters.includeDetails && report.filters.includeRelationships
      ? filteredRelationships.map((item) => evidenceItem(item, "relationship"))
      : [],
    publicGalleryEvidence: report.filters.includeDetails && report.filters.includePublic
      ? filteredPublic.map((item) => evidenceItem(item, "public_gallery"))
      : [],
    derivativeEvidence: report.filters.includeDetails && report.filters.includeDerivatives
      ? filteredDerivatives.map((item) => evidenceItem(item, "derivative"))
      : [],
    manualReviewQueue: report.filters.includeDetails ? manualReviewItems(allFiltered) : [],
    recommendations: [
      "Do not switch ai_folders or ai_images reads to ownership metadata until unsafe, conflict, missing-metadata, and manual-review evidence is resolved or accepted.",
      "Keep legacy user_id access checks as the runtime authorization model until an explicit future access-check phase.",
      "Use this report as operator evidence only; it does not approve tenant isolation or production readiness.",
    ],
    limitations: [
      "The report reads local D1 rows only and never lists live R2 objects.",
      "Private object keys are summarized by key class and raw prompts are not queried.",
      "Organization ownership access remains disabled.",
      "Existing null ownership rows remain supported by legacy access checks.",
    ],
  };
}

function unavailableReport({ generatedAt, code, message, filters }) {
  return {
    ok: false,
    available: false,
    reportVersion: TENANT_ASSET_OWNERSHIP_EVIDENCE_REPORT_VERSION,
    generatedAt,
    source: "local_d1_read_only",
    domain: "folders_images",
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    tenantIsolationClaimed: false,
    backfillPerformed: false,
    r2LiveListed: false,
    productionReadiness: "blocked",
    filters,
    code,
    message,
    summary: {
      totalFoldersScanned: 0,
      totalImagesScanned: 0,
    },
    recommendations: [
      "Apply the Phase 6.4 additive ownership metadata schema before collecting real-row evidence.",
    ],
    limitations: [
      "The report could not read required local D1 tables.",
      "No repair, backfill, R2 listing, or access-check migration was attempted.",
    ],
  };
}

export async function buildTenantAssetOwnershipEvidenceReport(env, options = {}) {
  const filters = normalizeTenantAssetEvidenceReportOptions(options);
  const generatedAt = new Date().toISOString();
  if (!env?.DB) {
    return unavailableReport({
      generatedAt,
      filters,
      code: "tenant_asset_evidence_db_unavailable",
      message: "D1 binding is unavailable.",
    });
  }

  try {
    const [folders, images] = await Promise.all([
      listFolderRows(env, filters.limit),
      listImageRows(env, filters.limit),
    ]);
    const diagnostics = buildTenantAssetReadDiagnosticsReport({
      folders,
      images,
      generatedAt,
      source: "local_d1_read_only",
      limit: filters.limit,
      includePublic: filters.includePublic,
      includeRelationships: filters.includeRelationships,
    });
    return serializeTenantAssetOwnershipEvidenceReport({
      available: true,
      generatedAt,
      filters,
      diagnostics,
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return unavailableReport({
        generatedAt,
        filters,
        code: "tenant_asset_evidence_schema_unavailable",
        message: "Required folders/images ownership schema is unavailable.",
      });
    }
    throw error;
  }
}

export function exportTenantAssetOwnershipEvidenceReportJson(report) {
  return JSON.stringify(report, null, 2);
}

export function exportTenantAssetOwnershipEvidenceReportMarkdown(report) {
  const lines = [
    "# Tenant Asset Ownership Evidence Report",
    "",
    `Generated at: ${report.generatedAt || "unknown"}`,
    `Source: ${report.source || "local_d1_read_only"}`,
    `Domain: ${report.domain || "folders_images"}`,
    `Production readiness: ${report.productionReadiness || "blocked"}`,
    `Runtime behavior changed: ${report.runtimeBehaviorChanged === true ? "yes" : "no"}`,
    `Access checks changed: ${report.accessChecksChanged === true ? "yes" : "no"}`,
    `Backfill performed: ${report.backfillPerformed === true ? "yes" : "no"}`,
    `R2 live listed: ${report.r2LiveListed === true ? "yes" : "no"}`,
    "",
    "## Summary",
  ];
  const summary = report.summary || {};
  for (const key of [
    "totalFoldersScanned",
    "totalImagesScanned",
    "foldersWithOwnershipMetadata",
    "imagesWithOwnershipMetadata",
    "foldersWithNullOwnershipMetadata",
    "imagesWithNullOwnershipMetadata",
    "simulatedDualReadSafeCount",
    "simulatedDualReadUnsafeCount",
    "needsManualReviewCount",
    "metadataConflictCount",
    "relationshipConflictCount",
  ]) {
    lines.push(`- ${key}: ${summary[key] ?? 0}`);
  }
  lines.push("", "## Classification Rollup");
  for (const [key, value] of Object.entries(report.classificationRollup || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("", "## Manual Review Queue");
  const queue = (report.manualReviewQueue || []).slice(0, 25);
  if (!queue.length) {
    lines.push("- None in bounded report.");
  } else {
    for (const item of queue) {
      lines.push(`- ${item.itemType}:${item.itemId || "unknown"} ${item.severity} ${item.classification} - ${item.recommendedNextAction}`);
    }
  }
  lines.push("", "## Limitations");
  for (const limitation of report.limitations || []) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");
  return lines.join("\n");
}
