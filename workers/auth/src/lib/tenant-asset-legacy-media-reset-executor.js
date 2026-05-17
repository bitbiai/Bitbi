import { listAiImageObjectKeys } from "./ai-image-derivatives.js";
import {
  releaseUserAssetStorage,
  sumAssetStorageBytes,
} from "./asset-storage-quota.js";
import {
  TenantAssetLegacyMediaResetError,
  buildLegacyMediaResetDryRunReport,
  normalizeLegacyMediaResetDryRunOptions,
} from "./tenant-asset-legacy-media-reset.js";
import { serializeTenantAssetManualReviewMetadata } from "./tenant-asset-manual-review.js";
import { nowIso, sha256Hex } from "./tokens.js";

export const TENANT_ASSET_LEGACY_MEDIA_RESET_EXECUTE_ENDPOINT =
  "/api/admin/tenant-assets/legacy-media-reset/execute";
export const TENANT_ASSET_LEGACY_MEDIA_RESET_ACTIONS_ENDPOINT =
  "/api/admin/tenant-assets/legacy-media-reset/actions";
export const TENANT_ASSET_LEGACY_MEDIA_RESET_EXECUTOR_VERSION =
  "tenant-asset-legacy-media-reset-executor-v1";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_REASON_LENGTH = 500;
const MAX_RESPONSE_ITEMS = 50;
const ACTION_EVENT_TYPES = Object.freeze([
  "created",
  "dry_run_completed",
  "execution_started",
  "public_refs_retired",
  "derivative_cleanup_completed",
  "source_rows_retired",
  "storage_verified",
  "review_items_superseded",
  "failed",
  "completed",
]);
const ACTION_STATUSES = Object.freeze([
  "dry_run_completed",
  "created",
  "running",
  "partial",
  "failed",
  "completed",
  "blocked",
  "replayed",
]);
const FIRST_PASS_DOMAINS = Object.freeze([
  "ai_images",
  "ai_folders",
  "ai_image_derivatives",
  "public_gallery_references",
]);
const DEFERRED_DOMAINS = Object.freeze([
  "manual_review_items_supersession",
  "ai_text_assets",
  "music_assets",
  "video_assets",
  "profile_avatars",
  "data_lifecycle_exports",
  "audit_archive",
]);
const ACTION_EXPORT_FORMATS = new Set(["json", "markdown"]);

export class TenantAssetLegacyMediaResetExecutorError extends TenantAssetLegacyMediaResetError {
  constructor(message, { status = 400, code = "tenant_asset_legacy_media_reset_executor_error", fields = {} } = {}) {
    super(message, { status, code, fields });
    this.name = "TenantAssetLegacyMediaResetExecutorError";
  }
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetLegacyMediaResetExecutorError("Invalid legacy media reset boolean option.", {
    code: "tenant_asset_legacy_media_reset_invalid_boolean",
  });
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, numeric));
}

function normalizeSafeText(value, { maxLength = 160, required = false, field = "text" } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantAssetLegacyMediaResetExecutorError("Required legacy media reset field is missing.", {
        code: "tenant_asset_legacy_media_reset_required",
        fields: { field },
      });
    }
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset field contains unsafe control characters.", {
      code: "tenant_asset_legacy_media_reset_unsafe_text",
      fields: { field },
    });
  }
  return text.slice(0, maxLength);
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new TenantAssetLegacyMediaResetExecutorError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  const key = normalizeSafeText(value, { maxLength: 160, required: true, field: "Idempotency-Key" });
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new TenantAssetLegacyMediaResetExecutorError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

function normalizeDomain(value) {
  const domain = String(value || "").trim();
  if (FIRST_PASS_DOMAINS.includes(domain)) return domain;
  if (DEFERRED_DOMAINS.includes(domain)) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset domain is deferred for a future phase.", {
      code: "tenant_asset_legacy_media_reset_domain_deferred",
      fields: { domain },
    });
  }
  throw new TenantAssetLegacyMediaResetExecutorError("Unsupported legacy media reset domain.", {
    code: "tenant_asset_legacy_media_reset_domain_invalid",
    fields: { domain },
  });
}

function normalizeDomains(input, flags) {
  const explicit = Array.isArray(input?.domains) ? input.domains : [];
  const domains = explicit.length > 0
    ? explicit.map(normalizeDomain)
    : [
        flags.includeImages ? "ai_images" : null,
        flags.includeFolders ? "ai_folders" : null,
        flags.includeDerivatives ? "ai_image_derivatives" : null,
        flags.includePublic ? "public_gallery_references" : null,
      ].filter(Boolean);
  return Array.from(new Set(domains)).sort();
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJson(value = {}) {
  return serializeTenantAssetManualReviewMetadata(value);
}

function isMissingResetTableError(error) {
  return /no such table:\s*tenant_asset_media_reset_/i.test(String(error?.message || error));
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || error || "");
  return /no such table/i.test(message) && (!tableName || message.includes(tableName));
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function dedupe(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function keyTypeCountsForImageRows(rows) {
  const counts = { original: 0, thumb: 0, medium: 0 };
  for (const row of rows) {
    if (row.r2_key) counts.original += 1;
    if (row.thumb_key) counts.thumb += 1;
    if (row.medium_key) counts.medium += 1;
  }
  return counts;
}

function cleanupKeysForImageRows(rows) {
  return dedupe(rows.flatMap((row) => listAiImageObjectKeys(row)));
}

function summarizeImages(rows) {
  return rows.slice(0, MAX_RESPONSE_ITEMS).map((row) => ({
    id: row.id,
    assetDomain: "ai_images",
    userId: row.user_id || null,
    folderId: row.folder_id || null,
    visibility: row.visibility || "private",
    publicReference: (row.visibility || "private") === "public",
    derivativeReferenceCount: Number(Boolean(row.thumb_key)) + Number(Boolean(row.medium_key)),
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at || null,
  }));
}

function summarizeFolders(rows) {
  return rows.slice(0, MAX_RESPONSE_ITEMS).map((row) => ({
    id: row.id,
    assetDomain: "ai_folders",
    userId: row.user_id || null,
    status: row.status || "active",
    selectedChildImageCount: Number(row.selectedChildImageCount || 0),
    remainingImageChildCount: Number(row.remainingImageChildCount || 0),
    textChildCount: row.textChildCount == null ? null : Number(row.textChildCount || 0),
    createdAt: row.created_at || null,
  }));
}

function buildRollup(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = String(row?.[key] || "unknown");
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

export function normalizeLegacyMediaResetActionRequest(input = {}) {
  const dryRun = normalizeBoolean(input.dryRun ?? input.dry_run, true);
  const confirm = normalizeBoolean(input.confirm, false);
  const includeFolders = normalizeBoolean(input.includeFolders ?? input.include_folders, true);
  const includeImages = normalizeBoolean(input.includeImages ?? input.include_images, true);
  const includePublic = normalizeBoolean(input.includePublic ?? input.include_public, true);
  const includeDerivatives = normalizeBoolean(input.includeDerivatives ?? input.include_derivatives, true);
  const includeManualReviewSupersession = normalizeBoolean(
    input.includeManualReviewSupersession ?? input.include_manual_review_supersession,
    false
  );
  if (includeManualReviewSupersession) {
    throw new TenantAssetLegacyMediaResetExecutorError("Manual-review supersession is deferred for a future reset phase.", {
      code: "tenant_asset_legacy_media_reset_manual_review_supersession_deferred",
      fields: { domain: "manual_review_items_supersession" },
    });
  }
  const flags = { includeFolders, includeImages, includePublic, includeDerivatives };
  const domains = normalizeDomains(input, flags);
  const reason = normalizeSafeText(input.reason, {
    maxLength: MAX_REASON_LENGTH,
    required: dryRun === false,
    field: "reason",
  });
  if (dryRun === false && !confirm) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset execution requires confirm=true.", {
      code: "tenant_asset_legacy_media_reset_confirmation_required",
    });
  }
  const inputAcknowledgements = input.acknowledgements && typeof input.acknowledgements === "object"
    ? input.acknowledgements
    : {};
  const acknowledgeNoCreditRefund = normalizeBoolean(
    input.acknowledgeNoCreditRefund ?? inputAcknowledgements.acknowledgeNoCreditRefund,
    false
  );
  const acknowledgeIrreversibleDeletion = normalizeBoolean(
    input.acknowledgeIrreversibleDeletion ?? inputAcknowledgements.acknowledgeIrreversibleDeletion,
    false
  );
  const acknowledgePublicContentRemoval = normalizeBoolean(
    input.acknowledgePublicContentRemoval ?? inputAcknowledgements.acknowledgePublicContentRemoval,
    false
  );
  if (dryRun === false && !acknowledgeNoCreditRefund) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset execution requires acknowledgeNoCreditRefund=true.", {
      code: "tenant_asset_legacy_media_reset_no_credit_ack_required",
    });
  }
  if (dryRun === false && !acknowledgeIrreversibleDeletion) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset execution requires acknowledgeIrreversibleDeletion=true.", {
      code: "tenant_asset_legacy_media_reset_irreversible_ack_required",
    });
  }
  return {
    dryRun,
    confirm,
    reason,
    domains,
    limit: normalizeLimit(input.limit),
    includeFolders,
    includeImages,
    includePublic,
    includeDerivatives,
    includeManualReviewSupersession,
    evidenceReportGeneratedAt: normalizeSafeText(input.evidenceReportGeneratedAt, {
      maxLength: 80,
      field: "evidenceReportGeneratedAt",
    }),
    confirmLatestEvidence: normalizeBoolean(input.confirmLatestEvidence, false),
    operatorAttestation: input.operatorAttestation && typeof input.operatorAttestation === "object"
      ? JSON.parse(safeJson(input.operatorAttestation))
      : {},
    acknowledgements: {
      acknowledgePublicContentRemoval,
      acknowledgeNoCreditRefund,
      acknowledgeIrreversibleDeletion,
    },
  };
}

export async function buildLegacyMediaResetRequestHash(request) {
  const normalized = {
    operation: "legacy_media_reset_execute",
    dryRun: request.dryRun === true,
    confirm: request.dryRun ? false : request.confirm === true,
    domains: request.domains,
    limit: request.limit,
    includeFolders: request.includeFolders,
    includeImages: request.includeImages,
    includePublic: request.includePublic,
    includeDerivatives: request.includeDerivatives,
    includeManualReviewSupersession: request.includeManualReviewSupersession,
    evidenceReportGeneratedAt: request.evidenceReportGeneratedAt || null,
    confirmLatestEvidence: request.confirmLatestEvidence === true,
    reason: request.dryRun ? null : request.reason,
    acknowledgements: request.dryRun ? {} : request.acknowledgements,
  };
  return sha256Hex(JSON.stringify(normalized));
}

export async function buildLegacyMediaResetActionId({ idempotencyKeyHash, requestHash }) {
  const hash = await sha256Hex(`tenant-asset-media-reset-action|${idempotencyKeyHash}|${requestHash}`);
  return `tamra_${hash.slice(0, 32)}`;
}

async function buildLegacyMediaResetActionEventId({ actionId, eventType, createdAt, sequence = 0 }) {
  const hash = await sha256Hex(`tenant-asset-media-reset-action-event|${actionId}|${eventType}|${createdAt}|${sequence}`);
  return `tamre_${hash.slice(0, 32)}`;
}

async function countRows(env, query, bindings = []) {
  const row = await env.DB.prepare(query).bind(...bindings).first();
  return Number(row?.total || row?.count || 0);
}

async function loadLegacyImageRows(env, request) {
  if (!request.domains.includes("ai_images")) return [];
  const missing = "asset_owner_type IS NULL OR ownership_status IS NULL OR (owning_user_id IS NULL AND owning_organization_id IS NULL)";
  const result = await env.DB.prepare(
    `SELECT id, user_id, folder_id, visibility, published_at, r2_key, thumb_key, medium_key, size_bytes, created_at
       FROM ai_images
      WHERE ${missing}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(request.limit).all();
  const rows = result?.results || [];
  return rows.filter((row) => {
    const isPublic = (row.visibility || "private") === "public";
    const hasDerivatives = Boolean(row.thumb_key || row.medium_key);
    if (isPublic && (!request.includePublic || !request.domains.includes("public_gallery_references"))) return false;
    if (hasDerivatives && (!request.includeDerivatives || !request.domains.includes("ai_image_derivatives"))) return false;
    return true;
  });
}

async function loadLegacyFolderRows(env, request, selectedImageRows) {
  if (!request.domains.includes("ai_folders")) return [];
  const selectedImageIds = new Set(selectedImageRows.map((row) => row.id));
  const missing = "asset_owner_type IS NULL OR ownership_status IS NULL OR (owning_user_id IS NULL AND owning_organization_id IS NULL)";
  const result = await env.DB.prepare(
    `SELECT id, user_id, status, created_at
       FROM ai_folders
      WHERE ${missing}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(request.limit).all();
  const rows = [];
  for (const row of result?.results || []) {
    const childImages = await env.DB.prepare(
      "SELECT id FROM ai_images WHERE folder_id = ?"
    ).bind(row.id).all();
    let textChildCount = 0;
    try {
      textChildCount = await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE folder_id = ?", [row.id]);
    } catch (error) {
      if (isMissingTableError(error, "ai_text_assets")) {
        textChildCount = null;
      } else {
        throw error;
      }
    }
    const childImageIds = (childImages?.results || []).map((entry) => entry.id);
    const selectedChildImageCount = childImageIds.filter((id) => selectedImageIds.has(id)).length;
    const remainingImageChildCount = childImageIds.length - selectedChildImageCount;
    if (remainingImageChildCount > 0 || textChildCount !== 0) {
      continue;
    }
    rows.push({
      ...row,
      selectedChildImageCount,
      remainingImageChildCount,
      textChildCount,
    });
  }
  return rows;
}

function buildPlanSummary({ imageRows, folderRows, dryRunReport }) {
  const publicRows = imageRows.filter((row) => (row.visibility || "private") === "public");
  const derivativeRows = imageRows.filter((row) => row.thumb_key || row.medium_key);
  const r2KeyTypeCounts = keyTypeCountsForImageRows(imageRows);
  return {
    proposedSourceRowRetireCount: imageRows.length + folderRows.length,
    proposedImageRetireCount: imageRows.length,
    proposedFolderRetireCount: folderRows.length,
    publicReferenceRetireCount: publicRows.length,
    derivativeReferenceRetireCount: Number(r2KeyTypeCounts.thumb || 0) + Number(r2KeyTypeCounts.medium || 0),
    r2KeyTypeCounts,
    selectedUserCount: new Set([...imageRows, ...folderRows].map((row) => row.user_id).filter(Boolean)).size,
    dryRunCandidateRows: Number(dryRunReport?.summary?.totalLegacyCandidateRows || 0),
    blockedByDryRunCount: Number(dryRunReport?.summary?.blockedCount || 0),
    videoRecordsDeferred: Number(dryRunReport?.summary?.videoRecordsFound || 0),
    musicRecordsDeferred: Number(dryRunReport?.summary?.musicRecordsFound || 0),
    textAssetRecordsDeferred: Number(dryRunReport?.summary?.textAssetRecordsFound || 0),
  };
}

async function buildEvidenceSnapshotHash(payload) {
  return sha256Hex(JSON.stringify(payload));
}

export async function planLegacyMediaResetAction(env, input = {}) {
  const request = normalizeLegacyMediaResetActionRequest(input);
  const dryRunReport = await buildLegacyMediaResetDryRunReport(env, normalizeLegacyMediaResetDryRunOptions({
    limit: request.limit,
    includeDetails: false,
    includeImages: request.includeImages,
    includeFolders: request.includeFolders,
    includePublic: request.includePublic,
    includeDerivatives: request.includeDerivatives,
    includeVideos: true,
    includeMusic: true,
    includeTextAssets: true,
    includeQuota: true,
  }));
  if (!dryRunReport?.available) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset dry-run evidence is unavailable.", {
      status: 409,
      code: dryRunReport?.code || "tenant_asset_legacy_media_reset_dry_run_unavailable",
    });
  }
  const imageRows = await loadLegacyImageRows(env, request);
  const folderRows = await loadLegacyFolderRows(env, request, imageRows);
  const summary = buildPlanSummary({ imageRows, folderRows, dryRunReport });
  if (request.dryRun === false && summary.publicReferenceRetireCount > 0 && !request.acknowledgements.acknowledgePublicContentRemoval) {
    throw new TenantAssetLegacyMediaResetExecutorError("Public/gallery reset execution requires acknowledgePublicContentRemoval=true.", {
      code: "tenant_asset_legacy_media_reset_public_ack_required",
    });
  }
  if (request.dryRun === false && request.evidenceReportGeneratedAt && !request.confirmLatestEvidence) {
    throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset execution requires confirmLatestEvidence=true when using a prior evidence timestamp.", {
      status: 409,
      code: "tenant_asset_legacy_media_reset_evidence_changed",
      fields: {
        evidenceReportGeneratedAt: request.evidenceReportGeneratedAt,
        currentEvidenceReportGeneratedAt: dryRunReport.generatedAt || null,
      },
    });
  }
  const evidenceSnapshot = {
    reportVersion: dryRunReport.reportVersion,
    generatedAt: dryRunReport.generatedAt,
    summary: dryRunReport.summary,
    selectedDomains: request.domains,
    planSummary: summary,
  };
  const plan = {
    reportVersion: TENANT_ASSET_LEGACY_MEDIA_RESET_EXECUTOR_VERSION,
    generatedAt: nowIso(),
    dryRun: true,
    execute: false,
    source: "server_side_legacy_media_reset_dry_run",
    selectedDomains: request.domains,
    allowedDomains: FIRST_PASS_DOMAINS,
    deferredDomains: DEFERRED_DOMAINS,
    evidence: {
      reportVersion: dryRunReport.reportVersion,
      generatedAt: dryRunReport.generatedAt,
      snapshotHash: await buildEvidenceSnapshotHash(evidenceSnapshot),
    },
    summary,
    proposedItems: {
      images: summarizeImages(imageRows),
      folders: summarizeFolders(folderRows),
    },
    noBackfill: true,
    noAccessSwitch: true,
    noBillingOrCreditMutation: true,
    noProviderCalls: true,
    noStripeCalls: true,
    noCloudflareApiCalls: true,
    r2LiveListed: false,
    r2ObjectsMutated: false,
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    tenantIsolationClaimed: false,
    productionReadiness: "blocked",
    blockedReasons: [
      "video_music_text_profile_avatar_domains_deferred",
      "ownership_backfill_blocked",
      "access_switch_blocked",
      ...(summary.proposedSourceRowRetireCount === 0 ? ["no_first_pass_candidates_selected"] : []),
    ],
  };
  Object.defineProperty(plan, "__request", { value: request, enumerable: false });
  Object.defineProperty(plan, "__imageRows", { value: imageRows, enumerable: false });
  Object.defineProperty(plan, "__folderRows", { value: folderRows, enumerable: false });
  Object.defineProperty(plan, "__cleanupKeys", { value: cleanupKeysForImageRows(imageRows), enumerable: false });
  Object.defineProperty(plan, "__dryRunReport", { value: dryRunReport, enumerable: false });
  return plan;
}

async function findActionByIdempotency(env, idempotencyKeyHash) {
  return env.DB.prepare(
    `SELECT id, dry_run, status, requested_domains_json, normalized_request_hash, idempotency_key_hash,
            operator_user_id, operator_email, reason, acknowledgements_json, evidence_report_generated_at,
            evidence_snapshot_hash, before_summary_json, result_summary_json, error_summary_json,
            created_at, updated_at, completed_at
       FROM tenant_asset_media_reset_actions
      WHERE idempotency_key_hash = ?
      ORDER BY created_at ASC, id ASC
      LIMIT 1`
  ).bind(idempotencyKeyHash).first();
}

async function readActionRow(env, actionId) {
  return env.DB.prepare(
    `SELECT id, dry_run, status, requested_domains_json, normalized_request_hash, idempotency_key_hash,
            operator_user_id, operator_email, reason, acknowledgements_json, evidence_report_generated_at,
            evidence_snapshot_hash, before_summary_json, result_summary_json, error_summary_json,
            created_at, updated_at, completed_at
       FROM tenant_asset_media_reset_actions
      WHERE id = ?
      LIMIT 1`
  ).bind(actionId).first();
}

async function listActionEventRows(env, actionId, limit = 100) {
  const result = await env.DB.prepare(
    `SELECT id, action_id, event_type, status, domain, item_count, r2_key_type_counts_json,
            safe_summary_json, error_summary_json, actor_user_id, actor_email, created_at
       FROM tenant_asset_media_reset_action_events
      WHERE action_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`
  ).bind(actionId, Math.max(1, Math.min(200, Number(limit) || 100))).all();
  return result?.results || [];
}

export function serializeLegacyMediaResetAction(row) {
  if (!row) return null;
  return {
    id: row.id,
    dryRun: Number(row.dry_run) === 1,
    status: row.status,
    requestedDomains: Object.freeze(parseJsonObject(row.requested_domains_json).domains || []),
    operatorUserId: row.operator_user_id || null,
    operatorEmail: row.operator_email || null,
    reason: row.reason || null,
    acknowledgements: parseJsonObject(row.acknowledgements_json),
    evidenceReportGeneratedAt: row.evidence_report_generated_at || null,
    evidenceSnapshotHashPresent: Boolean(row.evidence_snapshot_hash),
    beforeSummary: parseJsonObject(row.before_summary_json),
    resultSummary: parseJsonObject(row.result_summary_json),
    errorSummary: parseJsonObject(row.error_summary_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    idempotency: {
      required: true,
      storedAs: "sha256",
      rawKeyExposed: false,
    },
    safety: {
      noBackfill: true,
      noAccessSwitch: true,
      noBillingOrCreditMutation: true,
      noProviderCalls: true,
      noStripeCalls: true,
      noCloudflareApiCalls: true,
      r2LiveListed: false,
      tenantIsolationClaimed: false,
      productionReadiness: "blocked",
    },
  };
}

export function serializeLegacyMediaResetActionEvent(row) {
  return {
    id: row.id,
    actionId: row.action_id,
    eventType: row.event_type,
    status: row.status || null,
    domain: row.domain || null,
    itemCount: Number(row.item_count || 0),
    r2KeyTypeCounts: parseJsonObject(row.r2_key_type_counts_json),
    safeSummary: parseJsonObject(row.safe_summary_json),
    errorSummary: parseJsonObject(row.error_summary_json),
    actorUserId: row.actor_user_id || null,
    actorEmail: row.actor_email || null,
    createdAt: row.created_at,
  };
}

export async function recordLegacyMediaResetActionEvent(env, {
  actionId,
  eventType,
  status = null,
  domain = null,
  itemCount = 0,
  r2KeyTypeCounts = {},
  safeSummary = {},
  errorSummary = null,
  actorUser = null,
  createdAt = nowIso(),
  sequence = 0,
} = {}) {
  if (!ACTION_EVENT_TYPES.includes(eventType)) {
    throw new TenantAssetLegacyMediaResetExecutorError("Unsupported legacy media reset action event type.", {
      code: "tenant_asset_legacy_media_reset_event_type_invalid",
      fields: { eventType },
    });
  }
  const id = await buildLegacyMediaResetActionEventId({ actionId, eventType, createdAt, sequence });
  await env.DB.prepare(
    `INSERT INTO tenant_asset_media_reset_action_events (
       id, action_id, event_type, status, domain, item_count, r2_key_type_counts_json,
       safe_summary_json, error_summary_json, actor_user_id, actor_email, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    actionId,
    eventType,
    status,
    domain,
    Number(itemCount || 0),
    safeJson(r2KeyTypeCounts),
    safeJson(safeSummary),
    errorSummary ? safeJson(errorSummary) : null,
    actorUser?.id || null,
    actorUser?.email || null,
    createdAt
  ).run();
  return id;
}

async function insertActionRow(env, {
  actionId,
  request,
  requestHash,
  idempotencyKeyHash,
  plan,
  adminUser,
  now,
}) {
  await env.DB.prepare(
    `INSERT INTO tenant_asset_media_reset_actions (
       id, dry_run, status, requested_domains_json, normalized_request_hash, idempotency_key_hash,
       operator_user_id, operator_email, reason, acknowledgements_json, evidence_report_generated_at,
       evidence_snapshot_hash, before_summary_json, result_summary_json, error_summary_json,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    actionId,
    request.dryRun ? 1 : 0,
    "running",
    safeJson({ domains: request.domains }),
    requestHash,
    idempotencyKeyHash,
    adminUser?.id || null,
    adminUser?.email || null,
    request.reason || null,
    safeJson(request.acknowledgements),
    plan.evidence?.generatedAt || null,
    plan.evidence?.snapshotHash || null,
    safeJson(plan.summary),
    safeJson({ pending: true }),
    null,
    now,
    now,
    null
  ).run();
}

async function updateActionStatus(env, actionId, {
  status,
  resultSummary = null,
  errorSummary = null,
  completedAt = null,
  updatedAt = nowIso(),
} = {}) {
  if (!ACTION_STATUSES.includes(status)) {
    throw new TenantAssetLegacyMediaResetExecutorError("Unsupported legacy media reset action status.", {
      code: "tenant_asset_legacy_media_reset_status_invalid",
      fields: { status },
    });
  }
  await env.DB.prepare(
    `UPDATE tenant_asset_media_reset_actions
        SET status = ?,
            result_summary_json = ?,
            error_summary_json = ?,
            updated_at = ?,
            completed_at = ?
      WHERE id = ?`
  ).bind(
    status,
    resultSummary ? safeJson(resultSummary) : safeJson({}),
    errorSummary ? safeJson(errorSummary) : null,
    updatedAt,
    completedAt,
    actionId
  ).run();
}

async function insertCleanupQueueRows(env, cleanupKeys, createdAt) {
  const keys = dedupe(cleanupKeys);
  if (keys.length === 0) return 0;
  let queued = 0;
  for (let index = 0; index < keys.length; index += 50) {
    const chunk = keys.slice(index, index + 50);
    const values = chunk.map(() => "(?, 'pending', ?)").join(", ");
    const result = await env.DB.prepare(
      `INSERT INTO r2_cleanup_queue (r2_key, status, created_at) VALUES ${values}`
    ).bind(...chunk.flatMap((key) => [key, createdAt])).run();
    queued += Number(result?.meta?.changes || chunk.length);
  }
  return queued;
}

async function clearPendingCleanupEntries(env, cleanupKeys) {
  const keys = dedupe(cleanupKeys);
  for (let index = 0; index < keys.length; index += 50) {
    const chunk = keys.slice(index, index + 50);
    await env.DB.prepare(
      `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${placeholders(chunk)}) AND status = 'pending'`
    ).bind(...chunk).run();
  }
}

async function attemptInlineCleanup(env, cleanupKeys) {
  const keys = dedupe(cleanupKeys);
  const cleaned = [];
  let failedCount = 0;
  if (!env?.USER_IMAGES || typeof env.USER_IMAGES.delete !== "function") {
    return { attemptedCount: 0, cleanedCount: 0, failedCount: keys.length, cleanedKeys: [] };
  }
  for (const key of keys) {
    try {
      await env.USER_IMAGES.delete(key);
      cleaned.push(key);
    } catch {
      failedCount += 1;
    }
  }
  if (cleaned.length > 0) {
    try {
      await clearPendingCleanupEntries(env, cleaned);
    } catch {}
  }
  return {
    attemptedCount: keys.length,
    cleanedCount: cleaned.length,
    failedCount,
    cleanedKeys: cleaned,
  };
}

async function retirePublicReferences(env, imageRows) {
  const publicRows = imageRows.filter((row) => (row.visibility || "private") === "public");
  let retired = 0;
  for (let index = 0; index < publicRows.length; index += 50) {
    const chunk = publicRows.slice(index, index + 50);
    const result = await env.DB.prepare(
      `UPDATE ai_images
          SET visibility = 'private',
              published_at = NULL
        WHERE id IN (${placeholders(chunk)})
          AND COALESCE(visibility, 'private') = 'public'`
    ).bind(...chunk.map((row) => row.id)).run();
    retired += Number(result?.meta?.changes || 0);
  }
  return retired;
}

async function deleteImageRows(env, imageRows) {
  let deleted = 0;
  const byUser = new Map();
  for (const row of imageRows) {
    if (!row.user_id || !row.id) continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row.id);
  }
  for (const [userId, ids] of byUser.entries()) {
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50);
      const result = await env.DB.prepare(
        `DELETE FROM ai_images
          WHERE user_id = ?
            AND id IN (${placeholders(chunk)})`
      ).bind(userId, ...chunk).run();
      deleted += Number(result?.meta?.changes || 0);
    }
  }
  return deleted;
}

async function countFolderChildren(env, folderId) {
  const imageCount = await countRows(env, "SELECT COUNT(*) AS total FROM ai_images WHERE folder_id = ?", [folderId]);
  let textCount = 0;
  try {
    textCount = await countRows(env, "SELECT COUNT(*) AS total FROM ai_text_assets WHERE folder_id = ?", [folderId]);
  } catch (error) {
    if (isMissingTableError(error, "ai_text_assets")) textCount = 0;
    else throw error;
  }
  return { imageCount, textCount };
}

async function deleteFolderRows(env, folderRows) {
  let deleted = 0;
  for (const row of folderRows) {
    const children = await countFolderChildren(env, row.id);
    if (children.imageCount > 0 || children.textCount > 0) continue;
    const result = await env.DB.prepare(
      `DELETE FROM ai_folders
        WHERE id = ?
          AND user_id = ?
          AND NOT EXISTS (SELECT 1 FROM ai_images WHERE folder_id = ?)
          AND NOT EXISTS (SELECT 1 FROM ai_text_assets WHERE folder_id = ?)`
    ).bind(row.id, row.user_id, row.id, row.id).run();
    deleted += Number(result?.meta?.changes || 0);
  }
  return deleted;
}

async function releaseStorageForDeletedImages(env, imageRows) {
  let userCount = 0;
  const byUser = new Map();
  for (const row of imageRows) {
    if (!row.user_id) continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  for (const [userId, rows] of byUser.entries()) {
    const bytes = sumAssetStorageBytes(rows);
    if (!bytes) continue;
    await releaseUserAssetStorage(env, { userId, bytes });
    userCount += 1;
  }
  return userCount;
}

function buildResultSummary({
  plan,
  publicRefsRetired,
  cleanupQueuedCount,
  cleanupResult,
  imagesDeleted,
  foldersDeleted,
  quotaUsersVerified,
}) {
  const r2KeyTypeCounts = plan.summary.r2KeyTypeCounts || {};
  return {
    requestedDomains: plan.selectedDomains,
    publicRefsRetired,
    derivativeReferencesRetired: Number(r2KeyTypeCounts.thumb || 0) + Number(r2KeyTypeCounts.medium || 0),
    sourceRowsRetired: imagesDeleted + foldersDeleted,
    imagesRetired: imagesDeleted,
    foldersRetired: foldersDeleted,
    r2CleanupQueuedCount: cleanupQueuedCount,
    r2CleanupAttemptedCount: cleanupResult.attemptedCount,
    r2CleanupSucceededCount: cleanupResult.cleanedCount,
    r2CleanupFailedCount: cleanupResult.failedCount,
    r2KeyTypeCounts,
    storageQuotaVerification: quotaUsersVerified > 0 ? "released_from_d1_usage_rows" : "not_applicable_or_pending",
    quotaUsersVerified,
    manualReviewItemsSuperseded: 0,
    noBackfill: true,
    noAccessSwitch: true,
    noBillingOrCreditMutation: true,
    tenantIsolationClaimed: false,
    productionReadiness: "blocked",
  };
}

async function executeSelectedRows(env, {
  actionId,
  plan,
  adminUser,
  now,
}) {
  const imageRows = plan.__imageRows || [];
  const folderRows = plan.__folderRows || [];
  const cleanupKeys = plan.__cleanupKeys || [];
  const r2KeyTypeCounts = plan.summary.r2KeyTypeCounts || {};
  const publicRefsRetired = await retirePublicReferences(env, imageRows);
  if (publicRefsRetired > 0) {
    await recordLegacyMediaResetActionEvent(env, {
      actionId,
      eventType: "public_refs_retired",
      status: "running",
      domain: "public_gallery_references",
      itemCount: publicRefsRetired,
      safeSummary: { publicRefsRetired },
      actorUser: adminUser,
      createdAt: nowIso(),
      sequence: 10,
    });
  }
  const cleanupQueuedCount = await insertCleanupQueueRows(env, cleanupKeys, now);
  if (cleanupQueuedCount > 0) {
    await recordLegacyMediaResetActionEvent(env, {
      actionId,
      eventType: "derivative_cleanup_completed",
      status: "running",
      domain: "ai_image_derivatives",
      itemCount: cleanupQueuedCount,
      r2KeyTypeCounts,
      safeSummary: { cleanupQueuedCount, cleanupMode: "queued_known_d1_keys" },
      actorUser: adminUser,
      createdAt: nowIso(),
      sequence: 20,
    });
  }
  const imagesDeleted = await deleteImageRows(env, imageRows);
  const foldersDeleted = await deleteFolderRows(env, folderRows);
  await recordLegacyMediaResetActionEvent(env, {
    actionId,
    eventType: "source_rows_retired",
    status: "running",
    domain: "ai_images_ai_folders",
    itemCount: imagesDeleted + foldersDeleted,
    safeSummary: { imagesDeleted, foldersDeleted },
    actorUser: adminUser,
    createdAt: nowIso(),
    sequence: 30,
  });
  const cleanupResult = await attemptInlineCleanup(env, cleanupKeys);
  const quotaUsersVerified = await releaseStorageForDeletedImages(env, imageRows);
  await recordLegacyMediaResetActionEvent(env, {
    actionId,
    eventType: "storage_verified",
    status: "running",
    domain: "storage_quota",
    itemCount: quotaUsersVerified,
    safeSummary: { quotaUsersVerified, mode: "release_d1_recorded_bytes" },
    actorUser: adminUser,
    createdAt: nowIso(),
    sequence: 40,
  });
  return buildResultSummary({
    plan,
    publicRefsRetired,
    cleanupQueuedCount,
    cleanupResult,
    imagesDeleted,
    foldersDeleted,
    quotaUsersVerified,
  });
}

export async function executeLegacyMediaResetAction(env, {
  request,
  adminUser,
  idempotencyKey,
} = {}) {
  const normalizedRequest = normalizeLegacyMediaResetActionRequest(request);
  const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const idempotencyKeyHash = await sha256Hex(`tenant-asset-legacy-media-reset:${safeIdempotencyKey}`);
  const requestHash = await buildLegacyMediaResetRequestHash(normalizedRequest);

  if (normalizedRequest.dryRun) {
    const plan = await planLegacyMediaResetAction(env, normalizedRequest);
    return {
      ...plan,
      idempotency: {
        required: true,
        stored: false,
        storedAs: "sha256",
        rawKeyExposed: false,
      },
    };
  }

  let existingAction = null;
  try {
    existingAction = await findActionByIdempotency(env, idempotencyKeyHash);
  } catch (error) {
    if (isMissingResetTableError(error)) {
      throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset action tables are unavailable.", {
        status: 409,
        code: "tenant_asset_legacy_media_reset_schema_unavailable",
      });
    }
    throw error;
  }
  if (existingAction?.id) {
    if (existingAction.normalized_request_hash !== requestHash) {
      throw new TenantAssetLegacyMediaResetExecutorError("Idempotency-Key was already used for a different legacy media reset request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      reportVersion: TENANT_ASSET_LEGACY_MEDIA_RESET_EXECUTOR_VERSION,
      generatedAt: nowIso(),
      dryRun: false,
      execute: false,
      replayed: true,
      action: serializeLegacyMediaResetAction({ ...existingAction, status: "replayed" }),
      events: (await listActionEventRows(env, existingAction.id)).map(serializeLegacyMediaResetActionEvent),
      noBackfill: true,
      noAccessSwitch: true,
      r2LiveListed: false,
      tenantIsolationClaimed: false,
      productionReadiness: "blocked",
    };
  }

  const plan = await planLegacyMediaResetAction(env, normalizedRequest);
  const now = nowIso();
  const actionId = await buildLegacyMediaResetActionId({ idempotencyKeyHash, requestHash });
  try {
    await insertActionRow(env, {
      actionId,
      request: normalizedRequest,
      requestHash,
      idempotencyKeyHash,
      plan,
      adminUser,
      now,
    });
    await recordLegacyMediaResetActionEvent(env, {
      actionId,
      eventType: "created",
      status: "created",
      domain: "legacy_personal_media_reset",
      itemCount: plan.summary.proposedSourceRowRetireCount,
      safeSummary: { selectedDomains: plan.selectedDomains },
      actorUser: adminUser,
      createdAt: now,
      sequence: 0,
    });
    await recordLegacyMediaResetActionEvent(env, {
      actionId,
      eventType: "execution_started",
      status: "running",
      domain: "legacy_personal_media_reset",
      itemCount: plan.summary.proposedSourceRowRetireCount,
      safeSummary: { dryRun: false, confirmationRequired: true },
      actorUser: adminUser,
      createdAt: nowIso(),
      sequence: 1,
    });
    const resultSummary = await executeSelectedRows(env, {
      actionId,
      plan,
      adminUser,
      now,
    });
    const completedAt = nowIso();
    const status = resultSummary.r2CleanupFailedCount > 0 ? "partial" : "completed";
    await updateActionStatus(env, actionId, {
      status,
      resultSummary,
      completedAt,
      updatedAt: completedAt,
    });
    await recordLegacyMediaResetActionEvent(env, {
      actionId,
      eventType: "completed",
      status,
      domain: "legacy_personal_media_reset",
      itemCount: resultSummary.sourceRowsRetired,
      r2KeyTypeCounts: resultSummary.r2KeyTypeCounts,
      safeSummary: resultSummary,
      actorUser: adminUser,
      createdAt: completedAt,
      sequence: 99,
    });
  } catch (error) {
    const failedAt = nowIso();
    const errorSummary = {
      code: error?.code || "tenant_asset_legacy_media_reset_execution_failed",
      message: error?.message || "Legacy media reset execution failed.",
    };
    try {
      await updateActionStatus(env, actionId, {
        status: "failed",
        resultSummary: {},
        errorSummary,
        completedAt: failedAt,
        updatedAt: failedAt,
      });
      await recordLegacyMediaResetActionEvent(env, {
        actionId,
        eventType: "failed",
        status: "failed",
        domain: "legacy_personal_media_reset",
        errorSummary,
        actorUser: adminUser,
        createdAt: failedAt,
        sequence: 98,
      });
    } catch {}
    if (isMissingResetTableError(error)) {
      throw new TenantAssetLegacyMediaResetExecutorError("Legacy media reset action tables are unavailable.", {
        status: 409,
        code: "tenant_asset_legacy_media_reset_schema_unavailable",
      });
    }
    throw error;
  }

  const action = await readActionRow(env, actionId);
  return {
    reportVersion: TENANT_ASSET_LEGACY_MEDIA_RESET_EXECUTOR_VERSION,
    generatedAt: nowIso(),
    dryRun: false,
    execute: true,
    replayed: false,
    action: serializeLegacyMediaResetAction(action),
    events: (await listActionEventRows(env, actionId)).map(serializeLegacyMediaResetActionEvent),
    noBackfill: true,
    noAccessSwitch: true,
    noBillingOrCreditMutation: true,
    noProviderCalls: true,
    noStripeCalls: true,
    noCloudflareApiCalls: true,
    r2LiveListed: false,
    tenantIsolationClaimed: false,
    productionReadiness: "blocked",
  };
}

function normalizeReadOptions(input = {}) {
  return {
    limit: Math.max(1, Math.min(100, Number(input.limit) || 25)),
    offset: Math.max(0, Math.min(1000, Number(input.offset) || 0)),
    status: input.status ? normalizeSafeText(input.status, { maxLength: 40, field: "status" }) : null,
    format: ACTION_EXPORT_FORMATS.has(String(input.format || "json").toLowerCase())
      ? String(input.format || "json").toLowerCase()
      : "json",
  };
}

export function legacyMediaResetActionOptionsFromSearch(searchParams, overrides = {}) {
  return normalizeReadOptions({
    limit: searchParams.get("limit") ?? overrides.limit,
    offset: searchParams.get("offset") ?? overrides.offset,
    status: searchParams.get("status") ?? overrides.status,
    format: searchParams.get("format") ?? overrides.format,
  });
}

export async function listLegacyMediaResetActions(env, input = {}) {
  const options = normalizeReadOptions(input);
  const filters = [];
  const bindings = [];
  if (options.status) {
    filters.push("status = ?");
    bindings.push(options.status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await env.DB.prepare(
    `SELECT id, dry_run, status, requested_domains_json, normalized_request_hash, idempotency_key_hash,
            operator_user_id, operator_email, reason, acknowledgements_json, evidence_report_generated_at,
            evidence_snapshot_hash, before_summary_json, result_summary_json, error_summary_json,
            created_at, updated_at, completed_at
       FROM tenant_asset_media_reset_actions
       ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`
  ).bind(...bindings, options.limit, options.offset).all();
  return {
    items: (result?.results || []).map(serializeLegacyMediaResetAction),
    limit: options.limit,
    offset: options.offset,
  };
}

export async function getLegacyMediaResetAction(env, actionId, { includeEvents = false } = {}) {
  const row = await readActionRow(env, actionId);
  if (!row) return null;
  return {
    action: serializeLegacyMediaResetAction(row),
    ...(includeEvents ? { events: (await listActionEventRows(env, actionId)).map(serializeLegacyMediaResetActionEvent) } : {}),
  };
}

export async function getLegacyMediaResetActionEvidence(env, actionId) {
  const row = await readActionRow(env, actionId);
  if (!row) return null;
  const events = await listActionEventRows(env, actionId, 200);
  const serializedEvents = events.map(serializeLegacyMediaResetActionEvent);
  const eventTypeRollup = buildRollup(serializedEvents, "eventType");
  return {
    reportVersion: `${TENANT_ASSET_LEGACY_MEDIA_RESET_EXECUTOR_VERSION}-evidence`,
    generatedAt: nowIso(),
    action: serializeLegacyMediaResetAction(row),
    events: serializedEvents,
    summary: {
      totalEvents: serializedEvents.length,
      eventTypeRollup,
      sourceRowsRetired: parseJsonObject(row.result_summary_json).sourceRowsRetired || 0,
      publicRefsRetired: parseJsonObject(row.result_summary_json).publicRefsRetired || 0,
      derivativeReferencesRetired: parseJsonObject(row.result_summary_json).derivativeReferencesRetired || 0,
      r2CleanupQueuedCount: parseJsonObject(row.result_summary_json).r2CleanupQueuedCount || 0,
      r2CleanupFailedCount: parseJsonObject(row.result_summary_json).r2CleanupFailedCount || 0,
      accessSwitchReady: false,
      backfillReady: false,
      tenantIsolationClaimed: false,
      productionReadiness: "blocked",
    },
    safety: {
      noBackfill: true,
      noAccessSwitch: true,
      noBillingOrCreditMutation: true,
      noProviderCalls: true,
      noStripeCalls: true,
      noCloudflareApiCalls: true,
      r2LiveListed: false,
      rawR2KeysExposed: false,
      rawIdempotencyKeyExposed: false,
    },
  };
}

export function exportLegacyMediaResetActionEvidence(report, { format = "json" } = {}) {
  if (format === "markdown") {
    const lines = [
      "# Legacy Media Reset Action Evidence",
      "",
      `Generated at: ${report.generatedAt || "unknown"}`,
      `Action id: ${report.action?.id || "unknown"}`,
      `Status: ${report.action?.status || "unknown"}`,
      `Source rows retired: ${report.summary?.sourceRowsRetired ?? 0}`,
      `Public refs retired: ${report.summary?.publicRefsRetired ?? 0}`,
      `Derivative refs retired: ${report.summary?.derivativeReferencesRetired ?? 0}`,
      `R2 cleanup queued: ${report.summary?.r2CleanupQueuedCount ?? 0}`,
      `R2 cleanup failed: ${report.summary?.r2CleanupFailedCount ?? 0}`,
      `Access switch ready: ${report.summary?.accessSwitchReady === true ? "yes" : "no"}`,
      `Backfill ready: ${report.summary?.backfillReady === true ? "yes" : "no"}`,
      `Tenant isolation claimed: ${report.summary?.tenantIsolationClaimed === true ? "yes" : "no"}`,
      `Production readiness: ${report.summary?.productionReadiness || "blocked"}`,
      "",
      "## Event Rollup",
    ];
    for (const [eventType, count] of Object.entries(report.summary?.eventTypeRollup || {})) {
      lines.push(`- ${eventType}: ${count}`);
    }
    lines.push("", "Safety: no ownership backfill, access switch, live R2 listing, provider call, Stripe call, Cloudflare API call, or credit/billing mutation is represented by this evidence.", "");
    return lines.join("\n");
  }
  return JSON.stringify(report, null, 2);
}
