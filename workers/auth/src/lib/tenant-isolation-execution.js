import { enqueueAdminAuditEvent } from "./activity.js";
import {
  buildPersonalUserAssetOwnershipFields,
  TENANT_ASSET_OWNERSHIP_CONFIDENCE,
  TENANT_ASSET_OWNERSHIP_SOURCE,
  TENANT_ASSET_OWNERSHIP_STATUS,
} from "./tenant-asset-ownership.js";
import {
  TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION,
  buildTenantAssetReadDiagnosticsReport,
} from "./tenant-asset-read-diagnostics.js";
import { buildTenantAssetOwnershipEvidenceReport } from "./tenant-asset-evidence-report.js";
import {
  buildLegacyMediaResetDryRunReport,
  normalizeLegacyMediaResetDryRunOptions,
} from "./tenant-asset-legacy-media-reset.js";
import {
  LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION_GATE,
  isLegacyMediaResetConfirmedExecutionEnabled,
} from "./tenant-asset-legacy-media-reset-executor.js";
import { nowIso } from "./tokens.js";

export const TENANT_ISOLATION_OWNERSHIP_BACKFILL_DRY_RUN_ENDPOINT =
  "/api/admin/tenant-assets/ownership-backfill/dry-run";
export const TENANT_ISOLATION_OWNERSHIP_BACKFILL_EVIDENCE_ENDPOINT =
  "/api/admin/tenant-assets/ownership-backfill/evidence";
export const TENANT_ISOLATION_OWNERSHIP_BACKFILL_EXECUTE_ENDPOINT =
  "/api/admin/tenant-assets/ownership-backfill/execute";
export const TENANT_ISOLATION_ACCESS_SWITCH_STATUS_ENDPOINT =
  "/api/admin/tenant-assets/access-switch/status";
export const TENANT_ISOLATION_ACCESS_SWITCH_SHADOW_ENDPOINT =
  "/api/admin/tenant-assets/access-switch/shadow-diagnostics";
export const TENANT_ISOLATION_ACCESS_SWITCH_EVIDENCE_ENDPOINT =
  "/api/admin/tenant-assets/access-switch/evidence";
export const TENANT_ISOLATION_LEGACY_MEDIA_RESET_STATUS_ENDPOINT =
  "/api/admin/tenant-assets/legacy-media-reset/status";
export const TENANT_ISOLATION_LEGACY_MEDIA_RESET_EVIDENCE_ENDPOINT =
  "/api/admin/tenant-assets/legacy-media-reset/evidence";
export const TENANT_ISOLATION_EXECUTION_EVIDENCE_ENDPOINT =
  "/api/admin/tenant-assets/tenant-isolation/evidence";

export const OWNERSHIP_BACKFILL_CONFIRMATION = "BACKFILL OWNERSHIP";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ALLOWED_FORMATS = new Set(["json", "markdown", "html"]);
export const POST_CLEANUP_REBASELINE_STATUS = Object.freeze({
  REQUIRED: "post_cleanup_rebaseline_required",
  PENDING: "post_cleanup_evidence_pending",
  COLLECTED: "post_cleanup_evidence_collected",
});
const SUPPORTED_BACKFILL_DOMAINS = Object.freeze(["ai_folders", "ai_images"]);
const EXACT_BACKFILL_WRITE_DOMAIN = "ai_images";
const EXACT_BACKFILL_WRITE_LIMIT = 1;
const DEFERRED_BACKFILL_DOMAINS = Object.freeze([
  "ai_image_derivatives",
  "ai_text_assets",
  "member_music_audio_assets",
  "member_video_assets",
  "profile_avatars",
  "public_gallery_mempics",
  "public_gallery_memvids",
  "public_gallery_memtracks",
  "r2_user_images",
  "r2_private_media",
  "r2_audit_archive",
]);

export class TenantIsolationExecutionError extends Error {
  constructor(message, { status = 400, code = "tenant_isolation_execution_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantIsolationExecutionError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function normalizeLimit(value, { defaultValue = DEFAULT_LIMIT, maxValue = MAX_LIMIT } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return defaultValue;
  return Math.max(1, Math.min(maxValue, numeric));
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantIsolationExecutionError("Invalid tenant isolation boolean option.", {
    code: "tenant_isolation_boolean_invalid",
  });
}

function normalizeFormat(value) {
  const format = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    throw new TenantIsolationExecutionError("Unsupported tenant isolation evidence format.", {
      code: "tenant_isolation_evidence_format_invalid",
      fields: { format },
    });
  }
  return format;
}

function postCleanupRebaseline({
  status = POST_CLEANUP_REBASELINE_STATUS.PENDING,
  source = "current_request",
  evidenceType = "read_only",
} = {}) {
  return {
    status,
    source,
    evidenceType,
    manualMediaCleanupReported: true,
    oldCountsSuperseded: true,
    staleEvidenceDecisionPath: "docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md",
    liveEvidenceRequired: status !== POST_CLEANUP_REBASELINE_STATUS.COLLECTED,
    tenantIsolationClaimed: false,
  };
}

function normalizeSafeText(value, { field = "text", maxLength = 500, required = false } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantIsolationExecutionError("Required tenant isolation field is missing.", {
        code: "tenant_isolation_required",
        fields: { field },
      });
    }
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new TenantIsolationExecutionError("Tenant isolation field contains unsafe control characters.", {
      code: "tenant_isolation_unsafe_text",
      fields: { field },
    });
  }
  return text.slice(0, maxLength);
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new TenantIsolationExecutionError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

function normalizeBackfillDomains(input) {
  const explicit = Array.isArray(input?.domains) && input.domains.length
    ? input.domains
    : SUPPORTED_BACKFILL_DOMAINS;
  const domains = [];
  const deferred = [];
  for (const raw of explicit) {
    const domain = String(raw || "").trim();
    if (SUPPORTED_BACKFILL_DOMAINS.includes(domain)) domains.push(domain);
    else if (DEFERRED_BACKFILL_DOMAINS.includes(domain)) deferred.push(domain);
    else {
      throw new TenantIsolationExecutionError("Unsupported ownership backfill domain.", {
        code: "tenant_isolation_backfill_domain_invalid",
        fields: { domain },
      });
    }
  }
  return {
    domains: Array.from(new Set(domains)).sort(),
    deferredDomains: Array.from(new Set(deferred)).sort(),
  };
}

function normalizeCandidateAssetIds(input) {
  if (!Array.isArray(input?.candidateAssetIds) && !Array.isArray(input?.candidate_asset_ids)) return [];
  const rawItems = Array.isArray(input.candidateAssetIds) ? input.candidateAssetIds : input.candidate_asset_ids;
  const ids = [];
  for (const raw of rawItems) {
    const id = String(raw || "").trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
      throw new TenantIsolationExecutionError("Invalid ownership backfill candidate asset id.", {
        code: "tenant_isolation_backfill_candidate_asset_id_invalid",
      });
    }
    ids.push(id);
  }
  return Array.from(new Set(ids)).sort();
}

function ownershipMissing(row) {
  return !(row?.asset_owner_type && row?.ownership_status && (row?.owning_user_id || row?.owning_organization_id));
}

function hasSafeLegacyUser(row) {
  const userId = String(row?.user_id || "").trim();
  return userId && !/[\u0000-\u001f\u007f]/.test(userId) && userId.length <= 128;
}

function isPublicImage(row) {
  return String(row?.visibility || "private").toLowerCase() === "public" || Boolean(row?.published_at);
}

function summarizeOwner(row) {
  return {
    legacyUserIdPresent: Boolean(row?.user_id),
    ownershipMetadataPresent: !ownershipMissing(row),
    ownerType: row?.asset_owner_type || null,
    ownershipStatus: row?.ownership_status || null,
    owningUserIdPresent: Boolean(row?.owning_user_id),
    owningOrganizationIdPresent: Boolean(row?.owning_organization_id),
  };
}

function byId(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.id) map.set(row.id, row);
  }
  return map;
}

function classifyFolder(row) {
  if (!ownershipMissing(row)) return { classification: "already_owned", reason: "ownership_metadata_present" };
  if (!hasSafeLegacyUser(row)) return { classification: "blocked_missing_evidence", reason: "legacy_user_id_missing" };
  return { classification: "safe_to_backfill", reason: "legacy_user_id_can_seed_personal_owner" };
}

function classifyImage(row, foldersById) {
  if (!ownershipMissing(row)) return { classification: "already_owned", reason: "ownership_metadata_present" };
  if (!hasSafeLegacyUser(row)) return { classification: "blocked_missing_evidence", reason: "legacy_user_id_missing" };
  if (isPublicImage(row)) return { classification: "blocked_public_unsafe", reason: "public_gallery_reference_requires_review" };
  if (row.folder_id) {
    const folder = foldersById.get(row.folder_id);
    if (!folder) return { classification: "blocked_missing_evidence", reason: "referenced_folder_missing" };
    if (folder.user_id && folder.user_id !== row.user_id) {
      return { classification: "needs_manual_review", reason: "folder_image_legacy_user_conflict" };
    }
  }
  return { classification: "safe_to_backfill", reason: "private_image_legacy_user_can_seed_personal_owner" };
}

function serializeBackfillCandidate({ row, domain, classification, reason }) {
  return {
    domain,
    assetId: String(row?.id || "").slice(0, 128),
    classification,
    reason,
    status: row?.status || row?.visibility || null,
    folderId: row?.folder_id || null,
    publicReference: domain === "ai_images" ? isPublicImage(row) : false,
    ownerSignal: summarizeOwner(row),
    recommendedAction: classification === "safe_to_backfill"
      ? `Eligible for guarded ${OWNERSHIP_BACKFILL_CONFIRMATION} execution in this domain only.`
      : "Keep blocked or route through manual review before ownership metadata is written.",
  };
}

function rollupCandidates(items) {
  const rollup = {};
  for (const item of items || []) {
    rollup[item.classification] = (rollup[item.classification] || 0) + 1;
  }
  return {
    safe_to_backfill: rollup.safe_to_backfill || 0,
    needs_manual_review: rollup.needs_manual_review || 0,
    blocked_public_unsafe: rollup.blocked_public_unsafe || 0,
    blocked_missing_evidence: rollup.blocked_missing_evidence || 0,
    deferred_domain: rollup.deferred_domain || 0,
    already_owned: rollup.already_owned || 0,
    legacy_unclassified: rollup.legacy_unclassified || 0,
    ...rollup,
  };
}

async function listOwnershipRows(env, limit) {
  const [foldersResult, imagesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, status, asset_owner_type, owning_user_id, owning_organization_id,
              created_by_user_id, ownership_status, ownership_source, ownership_confidence,
              ownership_assigned_at, created_at
         FROM ai_folders
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    ).bind(limit).all(),
    env.DB.prepare(
      `SELECT id, user_id, folder_id, visibility, published_at, asset_owner_type,
              owning_user_id, owning_organization_id, created_by_user_id, ownership_status,
              ownership_source, ownership_confidence, ownership_assigned_at, created_at
         FROM ai_images
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    ).bind(limit).all(),
  ]);
  return {
    folders: foldersResult?.results || [],
    images: imagesResult?.results || [],
  };
}

export function normalizeOwnershipBackfillDryRunOptions(input = {}) {
  const normalized = normalizeBackfillDomains(input);
  return {
    limit: normalizeLimit(input.limit),
    includeDetails: normalizeBoolean(input.includeDetails ?? input.include_details, true),
    format: normalizeFormat(input.format),
    ...normalized,
  };
}

export function tenantIsolationOptionsFromSearch(searchParams, overrides = {}) {
  return {
    limit: searchParams.get("limit") ?? overrides.limit,
    includeDetails: searchParams.get("includeDetails") ?? searchParams.get("include_details") ?? overrides.includeDetails,
    format: searchParams.get("format") ?? overrides.format,
    domains: searchParams.getAll("domain").length ? searchParams.getAll("domain") : overrides.domains,
  };
}

function unavailableReport({ generatedAt, code, message, options }) {
  return {
    ok: false,
    available: false,
    reportVersion: "tenant-isolation-ownership-backfill-v1",
    generatedAt,
    source: "local_d1_read_only",
    productionReadiness: "blocked",
    tenantIsolationClaimed: false,
    backfillPerformed: false,
    d1Mutated: false,
    r2LiveListed: false,
    r2ObjectsMutated: false,
    postCleanupRebaseline: postCleanupRebaseline({
      status: POST_CLEANUP_REBASELINE_STATUS.PENDING,
      source: "unavailable_d1_read",
      evidenceType: "pending",
    }),
    options,
    code,
    message,
    summary: {
      totalCandidates: 0,
      rowsWritten: 0,
      classifications: rollupCandidates([]),
    },
  };
}

export async function buildOwnershipBackfillDryRunReport(env, input = {}) {
  const options = normalizeOwnershipBackfillDryRunOptions(input);
  const generatedAt = nowIso();
  if (!env?.DB) {
    return unavailableReport({
      generatedAt,
      options,
      code: "tenant_isolation_backfill_db_unavailable",
      message: "D1 binding is unavailable.",
    });
  }
  try {
    const { folders, images } = await listOwnershipRows(env, options.limit);
    const foldersById = byId(folders);
    const candidates = [];
    if (options.domains.includes("ai_folders")) {
      for (const row of folders) {
        candidates.push(serializeBackfillCandidate({
          row,
          domain: "ai_folders",
          ...classifyFolder(row),
        }));
      }
    }
    if (options.domains.includes("ai_images")) {
      for (const row of images) {
        candidates.push(serializeBackfillCandidate({
          row,
          domain: "ai_images",
          ...classifyImage(row, foldersById),
        }));
      }
    }
    for (const domain of options.deferredDomains) {
      candidates.push({
        domain,
        assetId: null,
        classification: "deferred_domain",
        reason: "domain_schema_or_policy_not_supported_for_p2_backfill",
        publicReference: false,
        ownerSignal: { legacyUserIdPresent: false, ownershipMetadataPresent: false },
        recommendedAction: "Keep deferred until a domain-specific schema/policy package exists.",
      });
    }
    const diagnostics = buildTenantAssetReadDiagnosticsReport({
      folders,
      images,
      generatedAt,
      source: "local_d1_read_only_shadow_only",
      limit: options.limit,
      includePublic: true,
      includeRelationships: true,
    });
    const classifications = rollupCandidates(candidates);
    return {
      ok: true,
      available: true,
      reportVersion: "tenant-isolation-ownership-backfill-v1",
      generatedAt,
      source: "local_d1_read_only",
      productionReadiness: "blocked",
      tenantIsolationClaimed: false,
      ownershipBackfillReadiness: "blocked_until_operator_evidence_review",
      backfillPerformed: false,
      d1Mutated: false,
      r2LiveListed: false,
      r2ObjectsMutated: false,
      postCleanupRebaseline: postCleanupRebaseline({
        status: POST_CLEANUP_REBASELINE_STATUS.COLLECTED,
        source: "current_d1_read_only_backfill_dry_run",
        evidenceType: "ownership_backfill_dry_run",
      }),
      options: {
        limit: options.limit,
        domains: options.domains,
        deferredDomains: options.deferredDomains,
      },
      summary: {
        totalCandidates: candidates.length,
        safeCandidates: classifications.safe_to_backfill,
        rowsWritten: 0,
        classifications,
        diagnosticMismatchCount: Number(diagnostics.summary?.simulatedDualReadUnsafeCount || 0),
        manualReviewCount: Number(diagnostics.summary?.needsManualReviewCount || 0),
      },
      candidates: options.includeDetails ? candidates.slice(0, options.limit) : [],
      warnings: [
        "Dry-run only: no ownership metadata was written.",
        "Backfill can change future access decisions if access-switch enforcement is later enabled.",
        "Unsafe, public, missing-evidence, manual-review, and deferred-domain rows remain blocked.",
      ],
      requiredExecutionConfirmation: OWNERSHIP_BACKFILL_CONFIRMATION,
    };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) {
      return unavailableReport({
        generatedAt,
        options,
        code: "tenant_isolation_backfill_schema_unavailable",
        message: "Required ai_folders/ai_images ownership schema is unavailable.",
      });
    }
    throw error;
  }
}

export function normalizeOwnershipBackfillExecuteRequest(input = {}) {
  const dryRun = normalizeBoolean(input.dryRun ?? input.dry_run, true);
  const confirm = normalizeBoolean(input.confirm, false);
  const confirmation = normalizeSafeText(input.confirmation ?? input.confirmationPhrase, {
    field: "confirmation",
    maxLength: 80,
    required: true,
  });
  if (!confirm || confirmation !== OWNERSHIP_BACKFILL_CONFIRMATION) {
    throw new TenantIsolationExecutionError("Ownership backfill requires exact typed confirmation.", {
      code: "tenant_isolation_backfill_confirmation_required",
      fields: { requiredConfirmation: OWNERSHIP_BACKFILL_CONFIRMATION },
    });
  }
  const reason = normalizeSafeText(input.reason, {
    field: "reason",
    maxLength: 500,
    required: true,
  });
  const normalized = {
    dryRun,
    confirm,
    confirmation,
    reason,
    batchLimit: normalizeLimit(input.batchLimit ?? input.batch_limit ?? input.limit, {
      defaultValue: 25,
      maxValue: 50,
    }),
    candidateAssetIds: normalizeCandidateAssetIds(input),
    ...normalizeBackfillDomains(input),
  };
  if (!normalized.dryRun) {
    const exactDomainOnly =
      normalized.domains.length === 1 && normalized.domains[0] === EXACT_BACKFILL_WRITE_DOMAIN;
    const exactBatchOnly = normalized.batchLimit === EXACT_BACKFILL_WRITE_LIMIT;
    const exactCandidateOnly = normalized.candidateAssetIds.length === 1;
    if (!exactDomainOnly || !exactBatchOnly || !exactCandidateOnly) {
      throw new TenantIsolationExecutionError("Ownership backfill writes require one exact ai_images candidate.", {
        status: 409,
        code: "tenant_isolation_backfill_exact_candidate_required",
        fields: {
          requiredDomain: EXACT_BACKFILL_WRITE_DOMAIN,
          requestedDomains: normalized.domains,
          requiredBatchLimit: EXACT_BACKFILL_WRITE_LIMIT,
          requestedBatchLimit: normalized.batchLimit,
          requiredCandidateAssetIds: 1,
          requestedCandidateAssetIds: normalized.candidateAssetIds.length,
        },
      });
    }
  }
  return normalized;
}

function ownershipUpdateBindings(row, domain, adminUser, now) {
  const fields = buildPersonalUserAssetOwnershipFields({
    userId: row.user_id,
    assignedAt: now,
    metadata: {
      source: "admin_tenant_isolation_ownership_backfill",
      domain,
      legacyUserIdSignalPresent: true,
      actorUserIdPresent: Boolean(adminUser?.id),
    },
  });
  return [
    fields.assetOwnerType,
    fields.owningUserId,
    fields.owningOrganizationId,
    fields.createdByUserId,
    TENANT_ASSET_OWNERSHIP_STATUS.CURRENT,
    TENANT_ASSET_OWNERSHIP_SOURCE.LEGACY_DEFAULT,
    TENANT_ASSET_OWNERSHIP_CONFIDENCE.MEDIUM,
    fields.ownershipMetadataJson,
    fields.ownershipAssignedAt,
  ];
}

async function updateBackfillRow(env, { row, domain, adminUser, now }) {
  const bindings = ownershipUpdateBindings(row, domain, adminUser, now);
  if (domain === "ai_folders") {
    const result = await env.DB.prepare(
      `UPDATE ai_folders
          SET asset_owner_type = ?,
              owning_user_id = ?,
              owning_organization_id = ?,
              created_by_user_id = ?,
              ownership_status = ?,
              ownership_source = ?,
              ownership_confidence = ?,
              ownership_metadata_json = ?,
              ownership_assigned_at = ?
        WHERE id = ?
          AND user_id = ?
          AND (asset_owner_type IS NULL OR ownership_status IS NULL OR (owning_user_id IS NULL AND owning_organization_id IS NULL))`
    ).bind(...bindings, row.id, row.user_id).run();
    return Number(result?.meta?.changes || 0);
  }
  const result = await env.DB.prepare(
    `UPDATE ai_images
        SET asset_owner_type = ?,
            owning_user_id = ?,
            owning_organization_id = ?,
            created_by_user_id = ?,
            ownership_status = ?,
            ownership_source = ?,
            ownership_confidence = ?,
            ownership_metadata_json = ?,
            ownership_assigned_at = ?
      WHERE id = ?
        AND user_id = ?
        AND COALESCE(visibility, 'private') != 'public'
        AND (asset_owner_type IS NULL OR ownership_status IS NULL OR (owning_user_id IS NULL AND owning_organization_id IS NULL))`
  ).bind(...bindings, row.id, row.user_id).run();
  return Number(result?.meta?.changes || 0);
}

export async function executeOwnershipBackfill(env, {
  request,
  adminUser,
  idempotencyKey,
  correlationId = null,
  requestInfo = null,
} = {}) {
  normalizeIdempotencyKey(idempotencyKey);
  const normalized = normalizeOwnershipBackfillExecuteRequest(request);
  const dryRunReport = await buildOwnershipBackfillDryRunReport(env, {
    limit: normalized.batchLimit,
    domains: normalized.domains,
    includeDetails: true,
  });
  let candidates = (dryRunReport.candidates || []).filter((item) => item.classification === "safe_to_backfill");
  if (normalized.candidateAssetIds.length) {
    const requested = new Set(normalized.candidateAssetIds);
    candidates = candidates.filter((item) => requested.has(item.assetId));
    if (candidates.length !== requested.size) {
      throw new TenantIsolationExecutionError("Requested ownership backfill candidate is not currently classified safe.", {
        status: 409,
        code: "tenant_isolation_backfill_candidate_mismatch",
        fields: {
          requestedCandidateCount: requested.size,
          matchedSafeCandidateCount: candidates.length,
          domains: normalized.domains,
        },
      });
    }
  }
  const selected = candidates.slice(0, normalized.batchLimit);
  let rowsWritten = 0;
  const now = nowIso();
  if (!normalized.dryRun && selected.length) {
    const { folders, images } = await listOwnershipRows(env, normalized.batchLimit);
    const folderMap = byId(folders);
    const imageMap = byId(images);
    for (const item of selected) {
      const row = item.domain === "ai_folders" ? folderMap.get(item.assetId) : imageMap.get(item.assetId);
      if (!row) continue;
      rowsWritten += await updateBackfillRow(env, {
        row,
        domain: item.domain,
        adminUser,
        now,
      });
    }
  }
  await enqueueAdminAuditEvent(
    env,
    {
      adminUserId: adminUser?.id,
      action: normalized.dryRun
        ? "tenant_isolation_ownership_backfill_dry_run_requested"
        : "tenant_isolation_ownership_backfill_executed",
      targetUserId: null,
      meta: {
        dryRun: normalized.dryRun,
      domains: normalized.domains,
      candidateAssetIds: normalized.candidateAssetIds,
      rowsConsidered: selected.length,
      rowsWritten,
        rowsBlocked: Math.max(0, Number(dryRunReport.summary?.totalCandidates || 0) - selected.length),
        tenantIsolationClaimed: false,
        productionReadiness: "blocked",
      },
    },
    { correlationId, requestInfo, allowDirectFallback: true }
  );
  return {
    ok: true,
    dryRun: normalized.dryRun,
    executionMode: normalized.dryRun ? "dry_run_only" : "safe_rows_only",
    productionReadiness: "blocked",
    tenantIsolationClaimed: false,
    accessChecksChanged: false,
    r2LiveListed: false,
    r2ObjectsMutated: false,
    postCleanupRebaseline: dryRunReport.postCleanupRebaseline || postCleanupRebaseline({
      status: normalized.dryRun
        ? POST_CLEANUP_REBASELINE_STATUS.COLLECTED
        : POST_CLEANUP_REBASELINE_STATUS.PENDING,
      source: "ownership_backfill_execute_report",
      evidenceType: normalized.dryRun ? "execution_endpoint_dry_run" : "guarded_safe_rows_only",
    }),
    rowsConsidered: selected.length,
    rowsWritten,
    rowsBlocked: Math.max(0, Number(dryRunReport.summary?.totalCandidates || 0) - selected.length),
    candidateAssetIds: normalized.candidateAssetIds,
    blockedReasons: dryRunReport.summary?.classifications || {},
    evidence: {
      generatedAt: dryRunReport.generatedAt,
      reportVersion: dryRunReport.reportVersion,
      idempotencyKeyRequired: true,
      rawIdempotencyKeyExposed: false,
      confirmationRequired: OWNERSHIP_BACKFILL_CONFIRMATION,
    },
    dryRunReport: {
      summary: dryRunReport.summary,
      warnings: dryRunReport.warnings,
    },
  };
}

export async function buildAccessSwitchStatus(env) {
  const evidence = await buildTenantAssetOwnershipEvidenceReport(env, {
    limit: 50,
    includeDetails: false,
  });
  const summary = evidence?.summary || {};
  return {
    ok: true,
    reportVersion: "tenant-isolation-access-switch-status-v1",
    generatedAt: nowIso(),
    source: "repo_config_and_local_d1_shadow_evidence",
    currentMode: "off",
    sourceOfTruth: "legacy_user_id_runtime_access_checks",
    runtimeSwitchRepoSupported: false,
    liveSwitchEnabled: false,
    shadowDiagnosticsAvailable: evidence?.available === true,
    killSwitch: {
      supported: "not_persisted_in_repo",
      rollbackMode: "keep_legacy_user_id_access_checks",
    },
    mismatchCounts: {
      unsafe: Number(summary.simulatedDualReadUnsafeCount || 0),
      manualReview: Number(summary.needsManualReviewCount || 0),
      metadataMissing: Number(summary.foldersWithNullOwnershipMetadata || 0) + Number(summary.imagesWithNullOwnershipMetadata || 0),
    },
    enabledActions: ["shadow_diagnostics", "evidence_export"],
    disabledActions: {
      shadow: "Shadow mode is diagnostic-only because runtime access decisions still use legacy user_id checks.",
      enforced: "Enforced access-switch is blocked: no durable feature flag/state model and unresolved shadow evidence.",
      off: "Already off; legacy runtime access checks remain active.",
    },
    tenantIsolationClaimed: false,
    postCleanupRebaseline: postCleanupRebaseline({
      status: POST_CLEANUP_REBASELINE_STATUS.PENDING,
      source: "access_switch_status_only",
      evidenceType: "status_pending_shadow_diagnostics",
    }),
    productionReadiness: "blocked",
  };
}

export async function buildAccessSwitchShadowDiagnostics(env, input = {}) {
  const limit = normalizeLimit(input.limit);
  let folders = [];
  let images = [];
  try {
    ({ folders, images } = await listOwnershipRows(env, limit));
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || error))) throw error;
    return {
      ok: false,
      available: false,
      reportVersion: "tenant-isolation-access-switch-shadow-v1",
      generatedAt: nowIso(),
      source: "local_d1_read_only_shadow_diagnostics",
      currentMode: "off",
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      r2LiveListed: false,
      r2ObjectsMutated: false,
      tenantIsolationClaimed: false,
      postCleanupRebaseline: postCleanupRebaseline({
        status: POST_CLEANUP_REBASELINE_STATUS.PENDING,
        source: "access_switch_shadow_unavailable",
        evidenceType: "pending",
      }),
      productionReadiness: "blocked",
      code: "tenant_isolation_access_switch_schema_unavailable",
      summary: {
        mismatchCount: 0,
        enforcedModeAllowed: false,
      },
      samples: [],
      disabledActions: {
        enforced: "Blocked because required ownership metadata schema is unavailable.",
      },
    };
  }
  const diagnostics = buildTenantAssetReadDiagnosticsReport({
    folders,
    images,
    generatedAt: nowIso(),
    source: "local_d1_shadow_diagnostics_only",
    limit,
    includePublic: true,
    includeRelationships: true,
  });
  const all = [
    ...diagnostics.folderDiagnostics,
    ...diagnostics.imageDiagnostics,
    ...diagnostics.relationshipDiagnostics,
    ...diagnostics.publicGalleryDiagnostics,
    ...diagnostics.derivativeDiagnostics,
  ];
  const mismatchItems = all.filter((item) => ![
    TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW,
    TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_DENY,
    TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NOT_APPLICABLE,
  ].includes(item.classification));
  return {
    ok: true,
    reportVersion: "tenant-isolation-access-switch-shadow-v1",
    generatedAt: diagnostics.generatedAt,
    source: "local_d1_read_only_shadow_diagnostics",
    currentMode: "off",
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    r2LiveListed: false,
    r2ObjectsMutated: false,
    tenantIsolationClaimed: false,
    postCleanupRebaseline: postCleanupRebaseline({
      status: POST_CLEANUP_REBASELINE_STATUS.COLLECTED,
      source: "current_d1_read_only_shadow_diagnostics",
      evidenceType: "access_switch_shadow_diagnostics",
    }),
    productionReadiness: "blocked",
    summary: {
      ...diagnostics.summary,
      mismatchCount: mismatchItems.length,
      enforcedModeAllowed: false,
    },
    samples: mismatchItems.slice(0, Math.min(25, limit)).map((item) => ({
      domain: item.domain,
      assetId: item.sourceId,
      mismatchType: item.classification,
      severity: item.severity,
      reason: item.reason,
      legacyAccessResult: item.legacyUserId ? "legacy_user_id_signal_present" : "legacy_user_id_signal_missing",
      ownershipMetadataAccessResult: item.ownerType && item.ownershipStatus ? "metadata_signal_present" : "metadata_missing_or_unsafe",
      recommendation: item.recommendation,
    })),
    disabledActions: {
      enforced: "Blocked until shadow diagnostics show no unresolved unsafe/manual-review/missing-metadata mismatches and a durable switch model exists.",
    },
  };
}

export async function buildLegacyMediaResetStatus(env) {
  let dryRunSummary = null;
  try {
    const dryRun = await buildLegacyMediaResetDryRunReport(env, normalizeLegacyMediaResetDryRunOptions({
      limit: 25,
      includeDetails: false,
    }));
    dryRunSummary = dryRun?.summary || null;
  } catch (error) {
    dryRunSummary = { unavailable: true, error: "dry_run_unavailable" };
  }
  const gateEnabled = isLegacyMediaResetConfirmedExecutionEnabled(env);
  return {
    ok: true,
    reportVersion: "tenant-isolation-legacy-media-reset-status-v1",
    generatedAt: nowIso(),
    dryRunAvailable: true,
    confirmedExecutionGate: {
      name: LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION_GATE,
      enabled: gateEnabled,
      valueExposed: false,
    },
    sanitizedEvidenceStatus: "pending_blocking",
    confirmedReadiness: "blocked",
    dangerousOperationsApproved: false,
    productionReadiness: "blocked",
    tenantIsolationClaimed: false,
    postCleanupRebaseline: postCleanupRebaseline({
      status: POST_CLEANUP_REBASELINE_STATUS.PENDING,
      source: "legacy_media_reset_status_only",
      evidenceType: "reset_status_pending_sanitized_dry_run",
    }),
    ownershipBackfillReadiness: "blocked",
    accessSwitchReadiness: "blocked",
    r2LiveListed: false,
    r2ObjectsMutated: false,
    dryRunSummary,
    disabledReasons: [
      ...(gateEnabled ? [] : ["confirmed execution gate disabled"]),
      "sanitized evidence is not accepted as complete",
      "ownership backfill/access-switch evidence must be reviewed before reset",
      "tenant isolation is not claimed",
    ],
  };
}

export async function buildLegacyMediaResetEvidence(env, input = {}) {
  const format = normalizeFormat(input.format);
  const dryRun = await buildLegacyMediaResetDryRunReport(env, normalizeLegacyMediaResetDryRunOptions({
    limit: input.limit,
    includeDetails: normalizeBoolean(input.includeDetails ?? input.include_details, true),
    format: format === "html" ? "json" : format,
  }));
  const status = await buildLegacyMediaResetStatus(env);
  return {
    ok: true,
    reportVersion: "tenant-isolation-legacy-media-reset-evidence-v1",
    generatedAt: nowIso(),
    status,
    postCleanupRebaseline: status.postCleanupRebaseline,
    dryRun,
    redaction: {
      noRawR2Keys: true,
      noRawIdempotencyKeys: true,
      noSecrets: true,
    },
  };
}

export async function buildTenantIsolationEvidencePacket(env, input = {}) {
  const [backfill, accessStatus, accessShadow, reset] = await Promise.all([
    buildOwnershipBackfillDryRunReport(env, { limit: input.limit, includeDetails: true }),
    buildAccessSwitchStatus(env),
    buildAccessSwitchShadowDiagnostics(env, { limit: input.limit }),
    buildLegacyMediaResetEvidence(env, { limit: input.limit, includeDetails: false }),
  ]);
  return {
    ok: true,
    reportVersion: "tenant-isolation-execution-control-evidence-v1",
    generatedAt: nowIso(),
    productionReadiness: "blocked",
    tenantIsolationClaimed: false,
    postCleanupRebaseline: postCleanupRebaseline({
      status: POST_CLEANUP_REBASELINE_STATUS.PENDING,
      source: "combined_packet_requires_live_operator_review",
      evidenceType: "combined_read_only_packet",
    }),
    ownershipBackfillReadiness: "blocked_until_operator_evidence_review",
    accessSwitchReadiness: "blocked",
    confirmedLegacyMediaResetReadiness: "blocked",
    noDeployRun: true,
    noRemoteMigrationRun: true,
    r2LiveListed: false,
    r2ObjectsMutated: false,
    backfill,
    accessSwitch: {
      status: accessStatus,
      shadowDiagnostics: accessShadow,
    },
    legacyMediaReset: reset,
    warning: "Do not execute reset before ownership backfill and access-switch evidence are reviewed.",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownList(items) {
  return (items || []).map((item) => `- ${item}`).join("\n") || "- None reported.";
}

export function exportTenantIsolationEvidenceJson(report) {
  return JSON.stringify(report, null, 2);
}

export function exportTenantIsolationEvidenceMarkdown(report, { title = "Tenant Isolation Execution Evidence" } = {}) {
  const summary = report.summary || report.backfill?.summary || report.status?.dryRunSummary || {};
  const lines = [
    `# ${title}`,
    "",
    `Generated at: ${report.generatedAt || "unknown"}`,
    `Production readiness: ${report.productionReadiness || "blocked"}`,
    `Tenant isolation claimed: ${report.tenantIsolationClaimed === true ? "yes" : "no"}`,
    `Post-cleanup rebaseline: ${report.postCleanupRebaseline?.status || "not_reported"}`,
    `R2 live listed: ${report.r2LiveListed === true ? "yes" : "no"}`,
    "",
    "## Summary",
  ];
  for (const [key, value] of Object.entries(summary || {}).slice(0, 40)) {
    if (value && typeof value === "object") continue;
    lines.push(`- ${key}: ${value}`);
  }
  if (report.warnings?.length) {
    lines.push("", "## Warnings", markdownList(report.warnings));
  }
  if (report.disabledReasons?.length) {
    lines.push("", "## Disabled Reasons", markdownList(report.disabledReasons));
  }
  lines.push("", "## Redaction", "- No raw private R2 keys, raw idempotency keys, cookies, auth headers, Stripe/provider payloads, tokens, or secrets are included.", "");
  return lines.join("\n");
}

export function exportTenantIsolationEvidenceHtml(report, { title = "Tenant Isolation Execution Evidence" } = {}) {
  const markdown = exportTenantIsolationEvidenceMarkdown(report, { title });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; line-height: 1.5; color: #111827; }
    pre { white-space: pre-wrap; background: #f8fafc; border: 1px solid #dbe3ef; border-radius: 8px; padding: 1rem; }
    @media print { body { margin: 0.75in; } }
  </style>
</head>
<body>
  <pre>${escapeHtml(markdown)}</pre>
</body>
</html>`;
}
