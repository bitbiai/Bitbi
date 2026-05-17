import {
  TENANT_ASSET_MANUAL_REVIEW_ISSUE_CATEGORIES,
  TENANT_ASSET_MANUAL_REVIEW_PRIORITIES,
  TENANT_ASSET_MANUAL_REVIEW_SEVERITIES,
  TENANT_ASSET_MANUAL_REVIEW_STATUSES,
  normalizeTenantAssetManualReviewIssueCategory,
  normalizeTenantAssetManualReviewPriority,
  normalizeTenantAssetManualReviewSeverity,
  normalizeTenantAssetManualReviewStatus,
  serializeTenantAssetManualReviewMetadata,
} from "./tenant-asset-manual-review.js";

export const TENANT_ASSET_MANUAL_REVIEW_QUEUE_REPORT_VERSION =
  "tenant-asset-manual-review-queue-report-v1";
export const TENANT_ASSET_MANUAL_REVIEW_ITEMS_ENDPOINT =
  "/api/admin/tenant-assets/folders-images/manual-review/items";
export const TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_ENDPOINT =
  "/api/admin/tenant-assets/folders-images/manual-review/evidence";
export const TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_EXPORT_ENDPOINT =
  "/api/admin/tenant-assets/folders-images/manual-review/evidence/export";

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_EVENT_LIMIT = 50;
const DEFAULT_EVIDENCE_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const MAX_OFFSET = 10_000;
const MAX_SAFE_ID_LENGTH = 180;
const ALLOWED_ASSET_DOMAINS = new Set([
  "ai_folders",
  "ai_images",
  "relationship",
  "public_gallery",
  "derivative",
]);
const ALLOWED_EXPORT_FORMATS = new Set(["json", "markdown"]);
const BLOCKING_CATEGORIES = new Set([
  "metadata_missing",
  "public_unsafe",
  "derivative_risk",
  "dual_read_unsafe",
  "manual_review_needed",
  "relationship_review",
]);
const TERMINAL_APPROVED_STATUSES = new Set([
  "approved_personal_user_asset",
  "approved_organization_asset",
  "approved_legacy_unclassified",
  "approved_platform_admin_test_asset",
]);
const TERMINAL_BLOCKED_STATUSES = new Set([
  "blocked_public_unsafe",
  "blocked_derivative_risk",
  "blocked_relationship_conflict",
  "blocked_missing_evidence",
]);

export class TenantAssetManualReviewQueueError extends Error {
  constructor(message, { status = 400, code = "tenant_asset_manual_review_queue_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantAssetManualReviewQueueError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function isMissingReviewTableError(error) {
  return /no such table:\s*ai_asset_manual_review_/i.test(String(error?.message || ""));
}

function wrapMissingSchema(error) {
  if (isMissingReviewTableError(error)) {
    throw new TenantAssetManualReviewQueueError("Manual-review state tables are unavailable.", {
      status: 409,
      code: "tenant_asset_manual_review_schema_unavailable",
    });
  }
  throw error;
}

function normalizeLimit(value, { defaultValue = DEFAULT_LIST_LIMIT, maxValue = MAX_LIST_LIMIT } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return defaultValue;
  return Math.max(1, Math.min(maxValue, numeric));
}

function normalizeOffset(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.min(MAX_OFFSET, numeric));
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetManualReviewQueueError("Invalid manual-review queue boolean option.", {
    code: "tenant_asset_manual_review_queue_filter_invalid",
  });
}

function normalizeSafeId(value, { field = "id", required = false } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantAssetManualReviewQueueError("Required manual-review queue identifier is missing.", {
        status: 400,
        code: "tenant_asset_manual_review_queue_required",
        fields: { field },
      });
    }
    return null;
  }
  if (text.length > MAX_SAFE_ID_LENGTH || /[\u0000-\u001f\u007f/]/.test(text)) {
    throw new TenantAssetManualReviewQueueError("Invalid manual-review queue identifier.", {
      status: 400,
      code: "tenant_asset_manual_review_queue_filter_invalid",
      fields: { field },
    });
  }
  return text;
}

function normalizeTimestamp(value, field) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(text) || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TenantAssetManualReviewQueueError("Invalid manual-review queue timestamp filter.", {
      code: "tenant_asset_manual_review_queue_filter_invalid",
      fields: { field },
    });
  }
  return text;
}

function normalizeAssetDomain(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!ALLOWED_ASSET_DOMAINS.has(text)) {
    throw new TenantAssetManualReviewQueueError("Unsupported manual-review asset domain filter.", {
      code: "tenant_asset_manual_review_queue_filter_invalid",
      fields: { assetDomain: text },
    });
  }
  return text;
}

function normalizeFormat(value) {
  const text = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_EXPORT_FORMATS.has(text)) {
    throw new TenantAssetManualReviewQueueError("Unsupported manual-review evidence export format.", {
      code: "tenant_asset_manual_review_queue_format_invalid",
      fields: { format: text },
    });
  }
  return text;
}

function normalizeAllowlistedFilter(value, normalizer, field) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = normalizer(text);
  if (!normalized) {
    throw new TenantAssetManualReviewQueueError("Unsupported manual-review queue filter.", {
      code: "tenant_asset_manual_review_queue_filter_invalid",
      fields: { [field]: text },
    });
  }
  return normalized;
}

export function normalizeTenantAssetManualReviewQueueOptions(input = {}) {
  return {
    limit: normalizeLimit(input.limit),
    offset: normalizeOffset(input.offset),
    reviewStatus: normalizeAllowlistedFilter(
      input.reviewStatus ?? input.review_status,
      normalizeTenantAssetManualReviewStatus,
      "reviewStatus"
    ),
    issueCategory: normalizeAllowlistedFilter(
      input.issueCategory ?? input.issue_category,
      normalizeTenantAssetManualReviewIssueCategory,
      "issueCategory"
    ),
    severity: normalizeAllowlistedFilter(input.severity, normalizeTenantAssetManualReviewSeverity, "severity"),
    priority: normalizeAllowlistedFilter(input.priority, normalizeTenantAssetManualReviewPriority, "priority"),
    assetDomain: normalizeAssetDomain(input.assetDomain ?? input.asset_domain),
    assetId: normalizeSafeId(input.assetId ?? input.asset_id, { field: "assetId" }),
    createdFrom: normalizeTimestamp(input.createdFrom ?? input.created_from, "createdFrom"),
    createdTo: normalizeTimestamp(input.createdTo ?? input.created_to, "createdTo"),
    includeEvents: normalizeBoolean(input.includeEvents ?? input.include_events, false),
  };
}

export function normalizeTenantAssetManualReviewEvidenceOptions(input = {}) {
  return {
    limit: normalizeLimit(input.limit, { defaultValue: DEFAULT_EVIDENCE_LIMIT }),
    includeItems: normalizeBoolean(input.includeItems ?? input.include_items, true),
    format: normalizeFormat(input.format),
  };
}

export function tenantAssetManualReviewQueueOptionsFromSearch(searchParams) {
  return normalizeTenantAssetManualReviewQueueOptions({
    limit: searchParams.get("limit"),
    offset: searchParams.get("offset"),
    reviewStatus: searchParams.get("reviewStatus") ?? searchParams.get("review_status"),
    issueCategory: searchParams.get("issueCategory") ?? searchParams.get("issue_category"),
    severity: searchParams.get("severity"),
    priority: searchParams.get("priority"),
    assetDomain: searchParams.get("assetDomain") ?? searchParams.get("asset_domain"),
    assetId: searchParams.get("assetId") ?? searchParams.get("asset_id"),
    createdFrom: searchParams.get("createdFrom") ?? searchParams.get("created_from"),
    createdTo: searchParams.get("createdTo") ?? searchParams.get("created_to"),
    includeEvents: searchParams.get("includeEvents") ?? searchParams.get("include_events"),
  });
}

export function tenantAssetManualReviewEvidenceOptionsFromSearch(searchParams, overrides = {}) {
  return normalizeTenantAssetManualReviewEvidenceOptions({
    limit: searchParams.get("limit") ?? overrides.limit,
    includeItems: searchParams.get("includeItems") ?? searchParams.get("include_items") ?? overrides.includeItems,
    format: searchParams.get("format") ?? overrides.format,
  });
}

function buildItemWhere(options) {
  const clauses = [];
  const bindings = [];
  if (options.reviewStatus) {
    clauses.push("review_status = ?");
    bindings.push(options.reviewStatus);
  }
  if (options.issueCategory) {
    clauses.push("issue_category = ?");
    bindings.push(options.issueCategory);
  }
  if (options.severity) {
    clauses.push("severity = ?");
    bindings.push(options.severity);
  }
  if (options.priority) {
    clauses.push("priority = ?");
    bindings.push(options.priority);
  }
  if (options.assetDomain) {
    clauses.push("asset_domain = ?");
    bindings.push(options.assetDomain);
  }
  if (options.assetId) {
    clauses.push("asset_id = ?");
    bindings.push(options.assetId);
  }
  if (options.createdFrom) {
    clauses.push("created_at >= ?");
    bindings.push(options.createdFrom);
  }
  if (options.createdTo) {
    clauses.push("created_at <= ?");
    bindings.push(options.createdTo);
  }
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    bindings,
  };
}

function parseSafeMetadataJson(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return JSON.parse(serializeTenantAssetManualReviewMetadata(parsed));
  } catch {
    return { unavailable: true };
  }
}

export function serializeTenantAssetManualReviewItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetDomain: row.asset_domain,
    assetId: row.asset_id || null,
    relatedAssetId: row.related_asset_id || null,
    sourceTable: row.source_table || null,
    sourceRowId: row.source_row_id || null,
    issueCategory: row.issue_category,
    reviewStatus: row.review_status,
    severity: row.severity,
    priority: row.priority,
    legacyOwnerUserIdPresent: Boolean(row.legacy_owner_user_id),
    proposedOwnership: {
      assetOwnerType: row.proposed_asset_owner_type || null,
      owningUserIdPresent: Boolean(row.proposed_owning_user_id),
      owningOrganizationIdPresent: Boolean(row.proposed_owning_organization_id),
      ownershipStatus: row.proposed_ownership_status || null,
      ownershipSource: row.proposed_ownership_source || null,
      ownershipConfidence: row.proposed_ownership_confidence || null,
    },
    evidenceSourcePath: row.evidence_source_path || null,
    evidenceReportGeneratedAt: row.evidence_report_generated_at || null,
    evidenceSummary: parseSafeMetadataJson(row.evidence_summary_json),
    safeNotes: row.safe_notes || null,
    assignedToUserIdPresent: Boolean(row.assigned_to_user_id),
    reviewedByUserIdPresent: Boolean(row.reviewed_by_user_id),
    reviewedAt: row.reviewed_at || null,
    createdByUserIdPresent: Boolean(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    supersededById: row.superseded_by_id || null,
    metadataSummary: parseSafeMetadataJson(row.metadata_json),
  };
}

export function serializeTenantAssetManualReviewEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    reviewItemId: row.review_item_id,
    eventType: row.event_type,
    oldStatus: row.old_status || null,
    newStatus: row.new_status || null,
    actorUserIdPresent: Boolean(row.actor_user_id),
    actorEmailPresent: Boolean(row.actor_email),
    reasonPresent: Boolean(row.reason),
    idempotencyKeyStoredAsHash: Boolean(row.idempotency_key),
    requestHashStored: Boolean(row.request_hash),
    eventMetadataSummary: parseSafeMetadataJson(row.event_metadata_json),
    createdAt: row.created_at || null,
  };
}

const ITEM_SELECT_COLUMNS = `id, asset_domain, asset_id, related_asset_id, source_table, source_row_id,
  issue_category, review_status, severity, priority, legacy_owner_user_id,
  proposed_asset_owner_type, proposed_owning_user_id, proposed_owning_organization_id,
  proposed_ownership_status, proposed_ownership_source, proposed_ownership_confidence,
  evidence_source_path, evidence_report_generated_at, evidence_summary_json, safe_notes,
  assigned_to_user_id, reviewed_by_user_id, reviewed_at, created_by_user_id,
  created_at, updated_at, superseded_by_id, metadata_json`;

const EVENT_SELECT_COLUMNS = `id, review_item_id, event_type, old_status, new_status,
  actor_user_id, actor_email, reason, idempotency_key, request_hash, event_metadata_json, created_at`;

export async function listTenantAssetManualReviewEvents(env, { reviewItemId = null, limit = DEFAULT_EVENT_LIMIT } = {}) {
  const safeReviewItemId = reviewItemId
    ? normalizeSafeId(reviewItemId, { field: "reviewItemId", required: true })
    : null;
  const appliedLimit = normalizeLimit(limit, { defaultValue: DEFAULT_EVENT_LIMIT });
  const whereSql = safeReviewItemId ? "WHERE review_item_id = ?" : "";
  const bindings = safeReviewItemId ? [safeReviewItemId, appliedLimit] : [appliedLimit];
  try {
    const result = await env.DB.prepare(
      `SELECT ${EVENT_SELECT_COLUMNS}
         FROM ai_asset_manual_review_events
         ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    ).bind(...bindings).all();
    return {
      available: true,
      events: (result?.results || []).map(serializeTenantAssetManualReviewEvent),
      limit: appliedLimit,
    };
  } catch (error) {
    wrapMissingSchema(error);
  }
}

export async function listTenantAssetManualReviewItems(env, input = {}) {
  const options = normalizeTenantAssetManualReviewQueueOptions(input);
  const { whereSql, bindings } = buildItemWhere(options);
  try {
    const [rowsResult, countResult] = await Promise.all([
      env.DB.prepare(
        `SELECT ${ITEM_SELECT_COLUMNS}
           FROM ai_asset_manual_review_items
           ${whereSql}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`
      ).bind(...bindings, options.limit, options.offset).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total
           FROM ai_asset_manual_review_items
           ${whereSql}`
      ).bind(...bindings).first(),
    ]);
    const items = (rowsResult?.results || []).map(serializeTenantAssetManualReviewItem);
    if (options.includeEvents) {
      for (const item of items) {
        const eventPage = await listTenantAssetManualReviewEvents(env, {
          reviewItemId: item.id,
          limit: 10,
        });
        item.events = eventPage.events;
      }
    }
    return {
      available: true,
      filters: options,
      total: Number(countResult?.total || 0),
      limit: options.limit,
      offset: options.offset,
      items,
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      backfillPerformed: false,
      sourceAssetRowsMutated: false,
      reviewStatusesChanged: false,
      r2LiveListed: false,
    };
  } catch (error) {
    wrapMissingSchema(error);
  }
}

export async function getTenantAssetManualReviewItem(env, id, { includeEvents = false } = {}) {
  const safeItemId = normalizeSafeId(id, { field: "id", required: true });
  try {
    const row = await env.DB.prepare(
      `SELECT ${ITEM_SELECT_COLUMNS}
         FROM ai_asset_manual_review_items
        WHERE id = ?
        LIMIT 1`
    ).bind(safeItemId).first();
    if (!row?.id) return null;
    const item = serializeTenantAssetManualReviewItem(row);
    if (includeEvents) {
      item.events = (await listTenantAssetManualReviewEvents(env, {
        reviewItemId: item.id,
        limit: DEFAULT_EVENT_LIMIT,
      })).events;
    }
    return item;
  } catch (error) {
    wrapMissingSchema(error);
  }
}

async function countRows(env, query, bindings = []) {
  const row = await env.DB.prepare(query).bind(...bindings).first();
  return Number(row?.total || row?.count || 0);
}

async function rollupRows(env, columnName, allowedValues) {
  const result = await env.DB.prepare(
    `SELECT ${columnName} AS key, COUNT(*) AS count
       FROM ai_asset_manual_review_items
      GROUP BY ${columnName}
      ORDER BY count DESC, key ASC`
  ).all();
  const out = {};
  for (const value of allowedValues) out[value] = 0;
  for (const row of result?.results || []) {
    const key = String(row.key || "unknown");
    out[key] = Number(row.count || 0);
  }
  return out;
}

async function sourceEvidencePathRows(env) {
  const result = await env.DB.prepare(
    `SELECT evidence_source_path AS key, COUNT(*) AS count
       FROM ai_asset_manual_review_items
      WHERE evidence_source_path IS NOT NULL
      GROUP BY evidence_source_path
      ORDER BY count DESC, key ASC
      LIMIT 25`
  ).all();
  return (result?.results || []).map((row) => ({
    evidenceSourcePath: row.key || null,
    count: Number(row.count || 0),
  }));
}

function hasStatusChangeEvidence(summary) {
  return Boolean(
    Number(summary?.statusChangedEventsCount || 0) ||
    Number(summary?.deferredEventsCount || 0) ||
    Number(summary?.rejectedEventsCount || 0) ||
    Number(summary?.supersededEventsCount || 0)
  );
}

export async function buildTenantAssetManualReviewQueueSummary(env) {
  try {
    const [
      totalReviewItems,
      totalEvents,
      createdEventsCount,
      statusChangedEventsCount,
      deferredEventsCount,
      rejectedEventsCount,
      supersededEventsCount,
      latestCreatedEvent,
      latestStatusEvent,
      reviewStatusRollup,
      issueCategoryRollup,
      severityRollup,
      priorityRollup,
      sourceEvidencePaths,
    ] = await Promise.all([
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_items"),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events"),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events WHERE event_type = ?", ["created"]),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events WHERE event_type = ?", ["status_changed"]),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events WHERE event_type = ?", ["deferred"]),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events WHERE event_type = ?", ["rejected"]),
      countRows(env, "SELECT COUNT(*) AS total FROM ai_asset_manual_review_events WHERE event_type = ?", ["superseded"]),
      env.DB.prepare(
        `SELECT MAX(created_at) AS latest
           FROM ai_asset_manual_review_events
          WHERE event_type = ?`
      ).bind("created").first(),
      env.DB.prepare(
        `SELECT MAX(created_at) AS latest
           FROM ai_asset_manual_review_events
          WHERE event_type IN (?, ?, ?, ?)`
      ).bind("status_changed", "deferred", "rejected", "superseded").first(),
      rollupRows(env, "review_status", TENANT_ASSET_MANUAL_REVIEW_STATUSES),
      rollupRows(env, "issue_category", TENANT_ASSET_MANUAL_REVIEW_ISSUE_CATEGORIES),
      rollupRows(env, "severity", TENANT_ASSET_MANUAL_REVIEW_SEVERITIES),
      rollupRows(env, "priority", TENANT_ASSET_MANUAL_REVIEW_PRIORITIES),
      sourceEvidencePathRows(env),
    ]);
    const blockedCategories = Object.fromEntries(
      Object.entries(issueCategoryRollup)
        .filter(([category, count]) => BLOCKING_CATEGORIES.has(category) && count > 0)
    );
    const terminalApprovedCount = Object.entries(reviewStatusRollup)
      .filter(([status]) => TERMINAL_APPROVED_STATUSES.has(status))
      .reduce((sum, [, count]) => sum + Number(count || 0), 0);
    const terminalBlockedCount = Object.entries(reviewStatusRollup)
      .filter(([status]) => TERMINAL_BLOCKED_STATUSES.has(status))
      .reduce((sum, [, count]) => sum + Number(count || 0), 0);
    return {
      totalReviewItems,
      totalEvents,
      createdEventsCount,
      statusChangedEventsCount,
      deferredEventsCount,
      rejectedEventsCount,
      supersededEventsCount,
      terminalApprovedCount,
      terminalBlockedCount,
      mostRecentImportTimestamp: latestCreatedEvent?.latest || null,
      latestStatusUpdateTimestamp: latestStatusEvent?.latest || null,
      reviewStatusRollup,
      issueCategoryRollup,
      severityRollup,
      priorityRollup,
      sourceEvidencePaths,
      blockedCategories,
      statusWorkflowAvailable: true,
      approvedForBackfillSupported: false,
      accessSwitchReady: false,
      backfillReady: false,
      tenantIsolationClaimed: false,
      productionReadiness: "blocked",
    };
  } catch (error) {
    wrapMissingSchema(error);
  }
}

export async function buildTenantAssetManualReviewEvidenceReport(env, input = {}) {
  const options = normalizeTenantAssetManualReviewEvidenceOptions(input);
  if (!env?.DB) {
    return {
      available: false,
      code: "tenant_asset_manual_review_db_unavailable",
      message: "D1 binding is unavailable.",
    };
  }
  try {
    const summary = await buildTenantAssetManualReviewQueueSummary(env);
    const itemPage = options.includeItems
      ? await listTenantAssetManualReviewItems(env, { limit: options.limit })
      : { items: [] };
    const reviewStatusesChanged = hasStatusChangeEvidence(summary);
    return {
      ok: true,
      available: true,
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_QUEUE_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      source: "local_d1_read_only",
      domain: "folders_images_manual_review",
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      tenantIsolationClaimed: false,
      backfillPerformed: false,
      sourceAssetRowsMutated: false,
      reviewStatusesChanged,
      r2LiveListed: false,
      productionReadiness: "blocked",
      filters: options,
      summary,
      items: itemPage.items,
      recommendations: [
        "Use this report as operator evidence for review queue visibility only.",
        "Do not backfill ownership or switch access checks from this report.",
        "Use the Phase 6.17 status workflow only for explicit review-status changes; assignment, notes, backfill planning, and Admin UI workflows remain separate future work.",
      ],
      limitations: [
        "This report reads manual-review state tables only.",
        "It does not inspect live R2 objects or source asset private keys.",
        "It does not approve tenant isolation, production readiness, ownership backfill, or access-check switching.",
      ],
    };
  } catch (error) {
    if (isMissingReviewTableError(error) || error instanceof TenantAssetManualReviewQueueError) {
      return {
        ok: false,
        available: false,
        reportVersion: TENANT_ASSET_MANUAL_REVIEW_QUEUE_REPORT_VERSION,
        generatedAt: new Date().toISOString(),
        source: "local_d1_read_only",
        domain: "folders_images_manual_review",
        runtimeBehaviorChanged: false,
        accessChecksChanged: false,
        tenantIsolationClaimed: false,
        backfillPerformed: false,
        sourceAssetRowsMutated: false,
        reviewStatusesChanged: false,
        r2LiveListed: false,
        productionReadiness: "blocked",
        code: error.code || "tenant_asset_manual_review_schema_unavailable",
        message: error.message || "Manual-review state tables are unavailable.",
        summary: {
          totalReviewItems: 0,
          totalEvents: 0,
        },
        recommendations: [
          "Apply the Phase 6.13 manual-review state schema before collecting review queue evidence.",
        ],
        limitations: [
          "No review queue repair, import execution, ownership backfill, or access-check migration was attempted.",
        ],
      };
    }
    throw error;
  }
}

export function exportTenantAssetManualReviewEvidenceReportJson(report) {
  return JSON.stringify(report, null, 2);
}

export function exportTenantAssetManualReviewEvidenceReportMarkdown(report) {
  const lines = [
    "# Tenant Asset Manual Review Queue Evidence",
    "",
    `Generated at: ${report.generatedAt || "unknown"}`,
    `Source: ${report.source || "local_d1_read_only"}`,
    `Domain: ${report.domain || "folders_images_manual_review"}`,
    `Production readiness: ${report.productionReadiness || "blocked"}`,
    `Runtime behavior changed: ${report.runtimeBehaviorChanged === true ? "yes" : "no"}`,
    `Access checks changed: ${report.accessChecksChanged === true ? "yes" : "no"}`,
    `Backfill performed: ${report.backfillPerformed === true ? "yes" : "no"}`,
    `Source asset rows mutated: ${report.sourceAssetRowsMutated === true ? "yes" : "no"}`,
    `Review statuses changed: ${report.reviewStatusesChanged === true ? "yes" : "no"}`,
    `R2 live listed: ${report.r2LiveListed === true ? "yes" : "no"}`,
    "",
    "## Summary",
  ];
  const summary = report.summary || {};
  for (const key of [
    "totalReviewItems",
    "totalEvents",
    "createdEventsCount",
    "statusChangedEventsCount",
    "deferredEventsCount",
    "rejectedEventsCount",
    "supersededEventsCount",
    "terminalApprovedCount",
    "terminalBlockedCount",
    "mostRecentImportTimestamp",
    "latestStatusUpdateTimestamp",
    "statusWorkflowAvailable",
    "accessSwitchReady",
    "backfillReady",
    "tenantIsolationClaimed",
  ]) {
    lines.push(`- ${key}: ${summary[key] ?? "not_recorded"}`);
  }
  lines.push("", "## Issue Categories");
  for (const [key, value] of Object.entries(summary.issueCategoryRollup || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("", "## Review Statuses");
  for (const [key, value] of Object.entries(summary.reviewStatusRollup || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("", "## Recent Items");
  const items = (report.items || []).slice(0, 25);
  if (!items.length) {
    lines.push("- None in bounded report.");
  } else {
    for (const item of items) {
      lines.push(`- ${item.id} ${item.issueCategory} ${item.reviewStatus} ${item.severity}/${item.priority}`);
    }
  }
  lines.push("", "## Limitations");
  for (const limitation of report.limitations || []) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");
  return lines.join("\n");
}
