import { nowIso, sha256Hex } from "./tokens.js";
import {
  buildTenantAssetOwnershipEvidenceReport,
  normalizeTenantAssetEvidenceReportOptions,
} from "./tenant-asset-evidence-report.js";
import {
  normalizeTenantAssetManualReviewIssueCategory,
  normalizeTenantAssetManualReviewPriority,
  normalizeTenantAssetManualReviewSeverity,
  normalizeTenantAssetManualReviewStatus,
  serializeTenantAssetManualReviewMetadata,
} from "./tenant-asset-manual-review.js";

export const TENANT_ASSET_MANUAL_REVIEW_IMPORT_ENDPOINT =
  "/api/admin/tenant-assets/folders-images/manual-review/import";
export const TENANT_ASSET_MANUAL_REVIEW_IMPORT_VERSION =
  "tenant-asset-manual-review-import-v1";

const DEFAULT_IMPORT_LIMIT = 50;
const MAX_IMPORT_LIMIT = 100;
const MAX_REASON_LENGTH = 500;
const MAX_SAFE_NOTES_LENGTH = 500;
const MAX_RESPONSE_ITEMS = 100;
const ALLOWED_SOURCE = "current_evidence_report";

export class TenantAssetManualReviewImportError extends Error {
  constructor(message, { status = 400, code = "tenant_asset_manual_review_import_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantAssetManualReviewImportError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetManualReviewImportError("Invalid manual-review import boolean option.", {
    code: "tenant_asset_manual_review_import_invalid_boolean",
  });
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_IMPORT_LIMIT;
  return Math.max(1, Math.min(MAX_IMPORT_LIMIT, numeric));
}

function normalizeSafeText(value, { maxLength = 160, required = false, field = "text" } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantAssetManualReviewImportError("Required manual-review import field is missing.", {
        code: "tenant_asset_manual_review_import_required",
        fields: { field },
      });
    }
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new TenantAssetManualReviewImportError("Manual-review import field contains unsafe control characters.", {
      code: "tenant_asset_manual_review_import_unsafe_text",
      fields: { field },
    });
  }
  return text.slice(0, maxLength);
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new TenantAssetManualReviewImportError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  const key = normalizeSafeText(value, { maxLength: 160, required: true, field: "Idempotency-Key" });
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new TenantAssetManualReviewImportError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

export function normalizeTenantAssetManualReviewImportRequest(input = {}) {
  const dryRun = normalizeBoolean(input.dryRun ?? input.dry_run, true);
  const confirm = normalizeBoolean(input.confirm, false);
  const source = normalizeSafeText(input.source || ALLOWED_SOURCE, {
    maxLength: 80,
    field: "source",
  }) || ALLOWED_SOURCE;
  if (source !== ALLOWED_SOURCE) {
    throw new TenantAssetManualReviewImportError("Unsupported manual-review import source.", {
      code: "tenant_asset_manual_review_import_source_invalid",
      fields: { source },
    });
  }
  const reason = normalizeSafeText(input.reason, {
    maxLength: MAX_REASON_LENGTH,
    required: dryRun === false,
    field: "reason",
  });
  if (dryRun === false && !confirm) {
    throw new TenantAssetManualReviewImportError("Manual-review import execution requires confirm=true.", {
      code: "tenant_asset_manual_review_import_confirmation_required",
    });
  }
  return {
    domain: "folders_images",
    dryRun,
    confirm,
    limit: normalizeLimit(input.limit),
    includePublic: normalizeBoolean(input.includePublic ?? input.include_public, true),
    includeRelationships: normalizeBoolean(input.includeRelationships ?? input.include_relationships, true),
    includeDerivatives: normalizeBoolean(input.includeDerivatives ?? input.include_derivatives, true),
    source,
    reason,
  };
}

function isMissingReviewTableError(error) {
  return /no such table:\s*ai_asset_manual_review_/i.test(String(error?.message || ""));
}

function normalizeRequiredIssueCategory(value) {
  const normalized = normalizeTenantAssetManualReviewIssueCategory(value);
  if (!normalized) {
    throw new TenantAssetManualReviewImportError("Unsupported manual-review issue category.", {
      code: "tenant_asset_manual_review_import_category_invalid",
      fields: { issueCategory: value },
    });
  }
  return normalized;
}

function normalizeRequiredStatus(value) {
  const normalized = normalizeTenantAssetManualReviewStatus(value);
  if (!normalized) {
    throw new TenantAssetManualReviewImportError("Unsupported manual-review status.", {
      code: "tenant_asset_manual_review_import_status_invalid",
      fields: { reviewStatus: value },
    });
  }
  return normalized;
}

function normalizeRequiredSeverity(value) {
  const normalized = normalizeTenantAssetManualReviewSeverity(value);
  if (!normalized) {
    throw new TenantAssetManualReviewImportError("Unsupported manual-review severity.", {
      code: "tenant_asset_manual_review_import_severity_invalid",
      fields: { severity: value },
    });
  }
  return normalized;
}

function normalizeRequiredPriority(value) {
  const normalized = normalizeTenantAssetManualReviewPriority(value);
  if (!normalized) {
    throw new TenantAssetManualReviewImportError("Unsupported manual-review priority.", {
      code: "tenant_asset_manual_review_import_priority_invalid",
      fields: { priority: value },
    });
  }
  return normalized;
}

function safeId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function hasRisk(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "not_applicable" && text !== "not_public");
}

function domainFromItemType(itemType) {
  if (itemType === "folder") return "ai_folders";
  if (itemType === "image") return "ai_images";
  if (itemType === "relationship") return "relationship";
  if (itemType === "public_gallery") return "public_gallery";
  if (itemType === "derivative") return "derivative";
  return "ai_images";
}

function sourceTableForDomain(assetDomain) {
  if (assetDomain === "ai_folders") return "ai_folders";
  if (assetDomain === "ai_images" || assetDomain === "public_gallery" || assetDomain === "derivative") return "ai_images";
  return null;
}

function issueCategoryForEvidenceItem(item) {
  const itemType = String(item?.itemType || "");
  const classification = String(item?.classification || "");
  if (itemType === "public_gallery" || (hasRisk(item?.publicGalleryRisk) && item?.publicGalleryRisk !== "legacy_public_attribution_only")) {
    return "public_unsafe";
  }
  if (itemType === "derivative" || hasRisk(item?.derivativeRisk)) {
    return "derivative_risk";
  }
  if (itemType === "relationship" || classification === "relationship_conflict" || classification === "orphan_reference") {
    return "relationship_review";
  }
  if (classification === "metadata_missing") return "metadata_missing";
  if (classification === "same_allow") return "safe_observe_only";
  if (
    classification === "unsafe_to_switch" ||
    classification === "legacy_allows_metadata_denies" ||
    classification === "legacy_denies_metadata_allows"
  ) {
    return "dual_read_unsafe";
  }
  return "manual_review_needed";
}

function reviewMapping(category) {
  switch (category) {
    case "public_unsafe":
      return { reviewStatus: "blocked_public_unsafe", severity: "critical", priority: "high" };
    case "derivative_risk":
      return { reviewStatus: "blocked_derivative_risk", severity: "warning", priority: "medium" };
    case "dual_read_unsafe":
      return { reviewStatus: "pending_review", severity: "critical", priority: "high" };
    case "relationship_review":
      return { reviewStatus: "pending_review", severity: "warning", priority: "medium" };
    case "safe_observe_only":
      return { reviewStatus: "deferred", severity: "info", priority: "low" };
    case "metadata_missing":
    case "legacy_unclassified":
    case "future_org_ownership_review":
    case "manual_review_needed":
    default:
      return { reviewStatus: "pending_review", severity: "warning", priority: "medium" };
  }
}

function safeNotesForCategory(category) {
  switch (category) {
    case "public_unsafe":
      return "Public/gallery attribution and visibility must be reviewed before any ownership access switch.";
    case "derivative_risk":
      return "Parent image ownership must be reviewed before derivative/poster/thumb inheritance.";
    case "dual_read_unsafe":
      return "Simulated ownership access is unsafe or divergent; keep runtime access checks unchanged.";
    case "relationship_review":
      return "Folder/image relationship ownership needs review before migration planning.";
    case "safe_observe_only":
      return "Matching metadata is observation evidence only and does not prove tenant isolation.";
    case "metadata_missing":
      return "Existing row has no ownership metadata; classify before any backfill or access switch.";
    default:
      return "Review before any future import, ownership backfill, or access-check migration.";
  }
}

function extractEvidenceItems(report) {
  return [
    ...(Array.isArray(report.folderEvidence) ? report.folderEvidence : []),
    ...(Array.isArray(report.imageEvidence) ? report.imageEvidence : []),
    ...(Array.isArray(report.relationshipEvidence) ? report.relationshipEvidence : []),
    ...(Array.isArray(report.publicGalleryEvidence) ? report.publicGalleryEvidence : []),
    ...(Array.isArray(report.derivativeEvidence) ? report.derivativeEvidence : []),
    ...(Array.isArray(report.manualReviewQueue) ? report.manualReviewQueue : []),
  ];
}

export function buildManualReviewDedupeKey({
  assetDomain,
  assetId,
  relatedAssetId = null,
  issueCategory,
  evidenceSourcePath = ALLOWED_SOURCE,
}) {
  return [
    assetDomain || "not_recorded",
    assetId || "aggregate",
    relatedAssetId || "none",
    issueCategory,
    evidenceSourcePath || ALLOWED_SOURCE,
  ].join("|");
}

export async function buildManualReviewItemId(dedupeKey) {
  const hash = await sha256Hex(dedupeKey);
  return `ta_mri_${hash.slice(0, 32)}`;
}

async function buildManualReviewEventId({ reviewItemId, idempotencyKeyHash, requestHash }) {
  const hash = await sha256Hex(`created|${reviewItemId}|${idempotencyKeyHash}|${requestHash}`);
  return `ta_mre_${hash.slice(0, 32)}`;
}

export async function buildManualReviewItemFromEvidenceItem(item, {
  evidenceSourcePath = ALLOWED_SOURCE,
  evidenceReportGeneratedAt = null,
  sourceInputType = "current_evidence_report",
} = {}) {
  const issueCategory = normalizeRequiredIssueCategory(issueCategoryForEvidenceItem(item));
  const mapping = reviewMapping(issueCategory);
  const assetDomain = domainFromItemType(item?.itemType);
  const assetId = safeId(item?.itemId);
  const relatedAssetId = safeId(item?.relatedItemId || item?.relatedAssetId);
  const dedupeKey = buildManualReviewDedupeKey({
    assetDomain,
    assetId,
    relatedAssetId,
    issueCategory,
    evidenceSourcePath,
  });
  const id = await buildManualReviewItemId(dedupeKey);
  const evidenceSummaryJson = serializeTenantAssetManualReviewMetadata({
    classification: item?.classification || "not_recorded",
    sourceItemType: item?.itemType || "not_recorded",
    severity: item?.severity || mapping.severity,
    publicGalleryRisk: item?.publicGalleryRisk || "not_recorded",
    relationshipRisk: item?.relationshipRisk || "not_recorded",
    derivativeRisk: item?.derivativeRisk || "not_recorded",
  });
  const metadataJson = serializeTenantAssetManualReviewMetadata({
    importPhase: "6.15",
    dedupeKey,
    sourceInputType,
    recommendedNextAction: item?.recommendedNextAction || "Review before any future import executor.",
    runtimeAccessChecksChanged: false,
    ownershipBackfillPerformed: false,
    r2LiveListed: false,
  });
  return {
    id,
    dedupeKey,
    asset_domain: assetDomain,
    asset_id: assetId,
    related_asset_id: relatedAssetId,
    source_table: sourceTableForDomain(assetDomain),
    source_row_id: assetId,
    issue_category: issueCategory,
    review_status: normalizeRequiredStatus(mapping.reviewStatus),
    severity: normalizeRequiredSeverity(mapping.severity),
    priority: normalizeRequiredPriority(mapping.priority),
    legacy_owner_user_id: null,
    proposed_asset_owner_type: null,
    proposed_owning_user_id: null,
    proposed_owning_organization_id: null,
    proposed_ownership_status: "pending_review",
    proposed_ownership_source: null,
    proposed_ownership_confidence: null,
    evidence_source_path: evidenceSourcePath,
    evidence_report_generated_at: evidenceReportGeneratedAt,
    evidence_summary_json: evidenceSummaryJson,
    safe_notes: safeNotesForCategory(issueCategory).slice(0, MAX_SAFE_NOTES_LENGTH),
    assigned_to_user_id: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    superseded_by_id: null,
    metadata_json: metadataJson,
  };
}

function rollup(items, key) {
  const out = {};
  for (const item of items) {
    const value = item?.[key] || "unknown";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function serializeReviewItem(item, { includeDedupeKey = false } = {}) {
  return {
    id: item.id,
    assetDomain: item.asset_domain,
    assetId: item.asset_id,
    relatedAssetId: item.related_asset_id,
    issueCategory: item.issue_category,
    reviewStatus: item.review_status,
    severity: item.severity,
    priority: item.priority,
    sourceTable: item.source_table,
    sourceRowId: item.source_row_id,
    evidenceSourcePath: item.evidence_source_path,
    evidenceReportGeneratedAt: item.evidence_report_generated_at,
    safeNotes: item.safe_notes,
    ...(includeDedupeKey ? { dedupeKey: item.dedupeKey } : {}),
  };
}

export async function buildTenantAssetManualReviewImportRequestHash(request) {
  const normalized = {
    domain: "folders_images",
    dryRun: request.dryRun,
    confirm: request.dryRun ? false : request.confirm === true,
    limit: request.limit,
    includePublic: request.includePublic,
    includeRelationships: request.includeRelationships,
    includeDerivatives: request.includeDerivatives,
    source: request.source,
    reason: request.dryRun ? null : request.reason,
  };
  return sha256Hex(JSON.stringify(normalized));
}

async function buildCandidatesFromEvidenceReport(report) {
  const evidenceItems = extractEvidenceItems(report);
  const candidates = [];
  const seen = new Set();
  for (const item of evidenceItems) {
    const candidate = await buildManualReviewItemFromEvidenceItem(item, {
      evidenceSourcePath: ALLOWED_SOURCE,
      evidenceReportGeneratedAt: report.generatedAt || null,
      sourceInputType: "current_evidence_report",
    });
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
  }
  return candidates;
}

async function readExistingItem(env, itemId) {
  return env.DB.prepare(
    `SELECT id, review_status, issue_category, evidence_source_path
       FROM ai_asset_manual_review_items
      WHERE id = ?
      LIMIT 1`
  ).bind(itemId).first();
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

async function annotateExistingItems(env, candidates) {
  let existingCount = 0;
  const annotated = [];
  try {
    for (const candidate of candidates) {
      const existing = await readExistingItem(env, candidate.id);
      if (existing?.id) existingCount += 1;
      annotated.push({ ...candidate, existing: Boolean(existing?.id) });
    }
  } catch (error) {
    if (isMissingReviewTableError(error)) {
      throw new TenantAssetManualReviewImportError("Manual-review state tables are unavailable.", {
        status: 409,
        code: "tenant_asset_manual_review_schema_unavailable",
      });
    }
    throw error;
  }
  return { candidates: annotated, existingCount };
}

function buildSummary({ candidates, existingCount = 0, createdCount = 0, eventsCreatedCount = 0, idempotencyReplayCount = 0 }) {
  return {
    proposedReviewItemCount: candidates.length,
    existingReviewItemCount: existingCount,
    skippedExistingCount: existingCount,
    createdReviewItemCount: createdCount,
    createdReviewEventCount: eventsCreatedCount,
    idempotencyReplayEventCount: idempotencyReplayCount,
    categoryRollup: rollup(candidates, "issue_category"),
    severityRollup: rollup(candidates, "severity"),
    priorityRollup: rollup(candidates, "priority"),
  };
}

export async function planTenantAssetManualReviewImport(env, request = {}) {
  const normalizedRequest = normalizeTenantAssetManualReviewImportRequest(request);
  const filters = normalizeTenantAssetEvidenceReportOptions({
    limit: normalizedRequest.limit,
    includeDetails: true,
    includePublic: normalizedRequest.includePublic,
    includeRelationships: normalizedRequest.includeRelationships,
    includeDerivatives: normalizedRequest.includeDerivatives,
    format: "json",
  });
  const evidenceReport = await buildTenantAssetOwnershipEvidenceReport(env, filters);
  if (!evidenceReport?.available) {
    throw new TenantAssetManualReviewImportError("Current tenant asset evidence report is unavailable.", {
      status: 409,
      code: evidenceReport?.code || "tenant_asset_manual_review_evidence_unavailable",
    });
  }
  const candidates = await buildCandidatesFromEvidenceReport(evidenceReport);
  const annotated = await annotateExistingItems(env, candidates);
  const plan = {
    reportVersion: TENANT_ASSET_MANUAL_REVIEW_IMPORT_VERSION,
    generatedAt: nowIso(),
    source: ALLOWED_SOURCE,
    domain: "folders_images",
    dryRun: true,
    execute: false,
    itemLevelImportReady: candidates.length > 0,
    noMutation: true,
    noBackfill: true,
    noAccessSwitch: true,
    noSourceAssetMutation: true,
    noR2Operation: true,
    evidence: {
      generatedAt: evidenceReport.generatedAt || null,
      limit: filters.limit,
      includePublic: filters.includePublic,
      includeRelationships: filters.includeRelationships,
      includeDerivatives: filters.includeDerivatives,
      productionReadiness: evidenceReport.productionReadiness || "blocked",
    },
    summary: buildSummary({
      candidates: annotated.candidates,
      existingCount: annotated.existingCount,
    }),
    proposedItems: annotated.candidates.slice(0, MAX_RESPONSE_ITEMS).map((item) => serializeReviewItem(item, { includeDedupeKey: true })),
    blockedReasons: [
      "dry_run_only",
      "ownership_backfill_blocked",
      "access_check_switch_blocked",
    ],
    limitations: [
      "This plan reads current local D1 evidence and review-state rows only.",
      "Dry-run mode writes no review items or events.",
      "Review item creation does not approve ownership backfill or access-check switching.",
    ],
  };
  Object.defineProperty(plan, "__candidates", {
    value: annotated.candidates,
    enumerable: false,
  });
  return plan;
}

async function buildReviewItemAndEventStatements(env, {
  candidate,
  adminUser,
  reason,
  idempotencyKeyHash,
  requestHash,
  now,
}) {
  const eventId = await buildManualReviewEventId({
    reviewItemId: candidate.id,
    idempotencyKeyHash,
    requestHash,
  });
  const eventMetadataJson = serializeTenantAssetManualReviewMetadata({
    importPhase: "6.15",
    source: ALLOWED_SOURCE,
    issueCategory: candidate.issue_category,
    severity: candidate.severity,
    priority: candidate.priority,
    accessChecksChanged: false,
    ownershipBackfillPerformed: false,
    sourceAssetMutation: false,
    r2Operation: false,
  });
  return [
    env.DB.prepare(
      `INSERT INTO ai_asset_manual_review_items (
        id, asset_domain, asset_id, related_asset_id, source_table, source_row_id,
        issue_category, review_status, severity, priority, legacy_owner_user_id,
        proposed_asset_owner_type, proposed_owning_user_id, proposed_owning_organization_id,
        proposed_ownership_status, proposed_ownership_source, proposed_ownership_confidence,
        evidence_source_path, evidence_report_generated_at, evidence_summary_json, safe_notes,
        assigned_to_user_id, reviewed_by_user_id, reviewed_at, created_by_user_id,
        created_at, updated_at, superseded_by_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      candidate.id,
      candidate.asset_domain,
      candidate.asset_id,
      candidate.related_asset_id,
      candidate.source_table,
      candidate.source_row_id,
      candidate.issue_category,
      candidate.review_status,
      candidate.severity,
      candidate.priority,
      candidate.legacy_owner_user_id,
      candidate.proposed_asset_owner_type,
      candidate.proposed_owning_user_id,
      candidate.proposed_owning_organization_id,
      candidate.proposed_ownership_status,
      candidate.proposed_ownership_source,
      candidate.proposed_ownership_confidence,
      candidate.evidence_source_path,
      candidate.evidence_report_generated_at,
      candidate.evidence_summary_json,
      candidate.safe_notes,
      candidate.assigned_to_user_id,
      candidate.reviewed_by_user_id,
      candidate.reviewed_at,
      adminUser?.id || null,
      now,
      now,
      candidate.superseded_by_id,
      candidate.metadata_json
    ),
    env.DB.prepare(
      `INSERT INTO ai_asset_manual_review_events (
        id, review_item_id, event_type, old_status, new_status, actor_user_id,
        actor_email, reason, idempotency_key, request_hash, event_metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      eventId,
      candidate.id,
      "created",
      null,
      candidate.review_status,
      adminUser?.id || null,
      adminUser?.email || null,
      reason,
      idempotencyKeyHash,
      requestHash,
      eventMetadataJson,
      now
    ),
  ];
}

export async function executeTenantAssetManualReviewImport(env, {
  request,
  adminUser,
  idempotencyKey,
} = {}) {
  const normalizedRequest = normalizeTenantAssetManualReviewImportRequest({
    ...request,
    dryRun: false,
  });
  const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const idempotencyKeyHash = await sha256Hex(`tenant-asset-manual-review-import:${safeIdempotencyKey}`);
  const requestHash = await buildTenantAssetManualReviewImportRequestHash(normalizedRequest);
  let existingEvents = [];
  try {
    existingEvents = await listEventsForIdempotency(env, idempotencyKeyHash);
  } catch (error) {
    if (isMissingReviewTableError(error)) {
      throw new TenantAssetManualReviewImportError("Manual-review state tables are unavailable.", {
        status: 409,
        code: "tenant_asset_manual_review_schema_unavailable",
      });
    }
    throw error;
  }
  if (existingEvents.length > 0) {
    if (existingEvents.some((event) => event.request_hash !== requestHash)) {
      throw new TenantAssetManualReviewImportError("Idempotency-Key was already used for a different manual-review import request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_IMPORT_VERSION,
      generatedAt: nowIso(),
      source: ALLOWED_SOURCE,
      domain: "folders_images",
      dryRun: false,
      execute: true,
      idempotency: {
        required: true,
        storedAs: "sha256",
        replayed: true,
        eventCount: existingEvents.length,
      },
      noBackfill: true,
      noAccessSwitch: true,
      noSourceAssetMutation: true,
      noR2Operation: true,
      summary: {
        proposedReviewItemCount: 0,
        existingReviewItemCount: existingEvents.length,
        skippedExistingCount: existingEvents.length,
        createdReviewItemCount: 0,
        createdReviewEventCount: 0,
        idempotencyReplayEventCount: existingEvents.length,
        categoryRollup: {},
        severityRollup: {},
        priorityRollup: {},
      },
      proposedItems: [],
      createdItems: [],
      blockedReasons: [
        "idempotent_replay",
        "ownership_backfill_blocked",
        "access_check_switch_blocked",
      ],
    };
  }

  const plan = await planTenantAssetManualReviewImport(env, normalizedRequest);
  const now = nowIso();
  let createdCount = 0;
  let eventsCreatedCount = 0;
  let skippedExistingCount = 0;
  const createdItems = [];
  const statements = [];
  const itemsToCreate = [];
  const candidates = Array.isArray(plan.__candidates) ? plan.__candidates : [];
  for (const itemToCreate of candidates) {
    const existing = await readExistingItem(env, itemToCreate.id);
    if (existing?.id) {
      skippedExistingCount += 1;
      continue;
    }
    statements.push(...await buildReviewItemAndEventStatements(env, {
      candidate: itemToCreate,
      adminUser,
      reason: normalizedRequest.reason,
      idempotencyKeyHash,
      requestHash,
      now,
    }));
    itemsToCreate.push(itemToCreate);
  }
  try {
    if (statements.length > 0) {
      await env.DB.batch(statements);
      createdCount = itemsToCreate.length;
      eventsCreatedCount = itemsToCreate.length;
      createdItems.push(...itemsToCreate.map((item) => serializeReviewItem(item)));
    }
  } catch (error) {
    if (isMissingReviewTableError(error)) {
      throw new TenantAssetManualReviewImportError("Manual-review state tables are unavailable.", {
        status: 409,
        code: "tenant_asset_manual_review_schema_unavailable",
      });
    }
    throw error;
  }

  return {
    reportVersion: TENANT_ASSET_MANUAL_REVIEW_IMPORT_VERSION,
    generatedAt: nowIso(),
    source: ALLOWED_SOURCE,
    domain: "folders_images",
    dryRun: false,
    execute: true,
    idempotency: {
      required: true,
      storedAs: "sha256",
      replayed: false,
    },
    noBackfill: true,
    noAccessSwitch: true,
    noSourceAssetMutation: true,
    noR2Operation: true,
    evidence: plan.evidence,
    summary: buildSummary({
      candidates,
      existingCount: skippedExistingCount,
      createdCount,
      eventsCreatedCount,
    }),
    proposedItems: candidates.slice(0, MAX_RESPONSE_ITEMS).map((item) => serializeReviewItem(item)),
    createdItems,
    blockedReasons: [
      "review_rows_only",
      "ownership_backfill_blocked",
      "access_check_switch_blocked",
    ],
    limitations: [
      "Execution creates review queue rows and created events only.",
      "No ai_folders or ai_images rows are updated.",
      "No R2 objects are listed, moved, rewritten, or deleted.",
    ],
  };
}

export async function importTenantAssetManualReviewItems(env, {
  request,
  adminUser,
  idempotencyKey,
} = {}) {
  const normalizedRequest = normalizeTenantAssetManualReviewImportRequest(request);
  if (normalizedRequest.dryRun) {
    normalizeIdempotencyKey(idempotencyKey);
    return planTenantAssetManualReviewImport(env, normalizedRequest);
  }
  return executeTenantAssetManualReviewImport(env, {
    request: normalizedRequest,
    adminUser,
    idempotencyKey,
  });
}

export function serializeManualReviewImportResult(result) {
  return {
    ...result,
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    tenantIsolationClaimed: false,
    backfillPerformed: false,
    sourceAssetRowsMutated: false,
    r2LiveListed: false,
    productionReadiness: "blocked",
  };
}

export async function listManualReviewItems(env, { limit = 50 } = {}) {
  const appliedLimit = normalizeLimit(limit);
  const result = await env.DB.prepare(
    `SELECT id, asset_domain, asset_id, related_asset_id, issue_category,
      review_status, severity, priority, evidence_source_path, evidence_report_generated_at,
      safe_notes, created_at, updated_at
     FROM ai_asset_manual_review_items
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(appliedLimit).all();
  return result?.results || [];
}

export async function getManualReviewItem(env, id) {
  const safeItemId = safeId(id);
  if (!safeItemId) return null;
  return env.DB.prepare(
    `SELECT id, asset_domain, asset_id, related_asset_id, issue_category,
      review_status, severity, priority, evidence_source_path, evidence_report_generated_at,
      safe_notes, created_at, updated_at
     FROM ai_asset_manual_review_items
     WHERE id = ?
     LIMIT 1`
  ).bind(safeItemId).first();
}
