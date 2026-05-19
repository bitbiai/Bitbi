import { getActivityRetentionMetadata } from "./activity-archive.js";
import { getBillingReconciliationReport, listBillingReviewEvents } from "./billing-events.js";
import { redactStorageObjectKey } from "./storage-key-redaction.js";
import { nowIso } from "./tokens.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 500;
const SOURCE_SET = new Set([
  "admin_audit",
  "user_activity",
  "billing",
  "billing_review",
  "billing_reconciliation",
  "data_lifecycle",
  "evidence_archive",
  "tenant_review",
  "legacy_reset",
  "ai_budget",
  "activity_archive",
  "readiness",
]);
const SEVERITY_SET = new Set(["critical", "high", "medium", "low", "informational"]);
const SENSITIVE_KEY_PATTERN = /(?:secret|token|cookie|authorization|signature|payload|raw|idempotency|request_?hash|fingerprint|r2_?key|storage_?key|object_?key|prompt|payment_?method|card|password|credential)/i;
const SENSITIVE_VALUE_PATTERN = /\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec|Stripe-Signature|Bearer\s+|pm_[A-Za-z0-9]|card=|token=|secret=|password=|cookie=)[A-Za-z0-9_:=+./-]*/gi;
const BLOCKED_CLAIMS = Object.freeze([
  { id: "production_readiness", label: "Production readiness", status: "blocked" },
  { id: "live_billing_readiness", label: "Live billing readiness", status: "blocked" },
  { id: "tenant_isolation", label: "Tenant isolation", status: "not_claimed" },
  { id: "ownership_backfill_readiness", label: "Ownership backfill readiness", status: "blocked" },
  { id: "access_switch_readiness", label: "Access-switch readiness", status: "blocked" },
  { id: "confirmed_legacy_media_reset_readiness", label: "Confirmed legacy media reset readiness", status: "blocked" },
]);
const DANGEROUS_ACTION_WARNING = "No reset execution, ownership backfill, access switch, deploy, remote migration, Stripe action, provider call, refund, subscription mutation, or credit mutation is available from this timeline.";

function safeString(value, maxLength = 240) {
  if (value == null) return "";
  return String(value).replace(SENSITIVE_VALUE_PATTERN, "[redacted]").trim().slice(0, maxLength);
}

function safeToken(value, fallback = "unknown", maxLength = 80) {
  const text = safeString(value, maxLength).toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  return text || fallback;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return null;
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 8).map((entry) => sanitizeValue(entry, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value).slice(0, 20)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[`${safeToken(key, "field")}_redacted`] = true;
        continue;
      }
      const sanitized = sanitizeValue(entry, depth + 1);
      if (sanitized != null && sanitized !== "") out[key] = sanitized;
    }
    return out;
  }
  return safeString(value, 180);
}

function isMissingTable(error) {
  return /no such table/i.test(String(error?.message || error || ""));
}

function bindStatement(statement, bindings) {
  return bindings.length > 0 ? statement.bind(...bindings) : statement;
}

async function safeAll(env, source, sql, bindings = [], unavailable) {
  try {
    const result = await bindStatement(env.DB.prepare(sql), bindings).all();
    return { rows: Array.isArray(result?.results) ? result.results : [], unavailable };
  } catch (error) {
    if (isMissingTable(error)) {
      unavailable.push({ source, reason: "table_unavailable" });
      return { rows: [], unavailable };
    }
    throw error;
  }
}

async function safeFirst(env, source, sql, bindings = [], unavailable) {
  try {
    const row = await bindStatement(env.DB.prepare(sql), bindings).first();
    return { row: row || null, unavailable };
  } catch (error) {
    if (isMissingTable(error)) {
      unavailable.push({ source, reason: "table_unavailable" });
      return { row: null, unavailable };
    }
    throw error;
  }
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_OFFSET);
}

function normalizeBooleanFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return null;
}

export function normalizeOperatorTimelineFilters(params = {}) {
  const get = (name) => typeof params.get === "function" ? params.get(name) : params[name];
  const source = safeToken(get("source"), "");
  const severity = safeToken(get("severity"), "");
  const status = safeToken(get("status"), "");
  return {
    source: SOURCE_SET.has(source) ? source : null,
    severity: SEVERITY_SET.has(severity) ? severity : null,
    status: status && status.length <= 64 ? status : null,
    attentionRequired: normalizeBooleanFilter(get("attentionRequired") ?? get("attention_required")),
    limit: normalizeLimit(get("limit")),
    offset: normalizeOffset(get("offset")),
  };
}

function severityForStatus(status) {
  const text = safeToken(status);
  if (/critical|blocked|failed|error|dispute|delete|revoke/.test(text)) return "critical";
  if (/needs_review|warning|cleanup_failed|expired|payment_failed|refund/.test(text)) return "high";
  if (/pending|planned|deferred|review|ignored/.test(text)) return "medium";
  if (/completed|resolved|dismissed|ready|created|recorded|active/.test(text)) return "low";
  return "informational";
}

function severityRank(severity) {
  return { critical: 5, high: 4, medium: 3, low: 2, informational: 1 }[severity] || 0;
}

function maxSeverity(...values) {
  return values.map((value) => safeToken(value, "informational")).reduce((best, value) =>
    severityRank(value) > severityRank(best) ? value : best, "informational");
}

function eventTimestamp(...values) {
  for (const value of values) {
    const text = safeString(value, 64);
    if (text && Number.isFinite(Date.parse(text))) return text;
  }
  return nowIso();
}

function panelTarget(label, href) {
  return { label, href, kind: "admin_panel" };
}

function eventRecord(input) {
  const source = safeToken(input.source);
  const type = safeToken(input.type);
  const timestamp = eventTimestamp(input.timestamp);
  const severity = SEVERITY_SET.has(input.severity) ? input.severity : severityForStatus(input.status);
  const status = safeToken(input.status);
  const inferredAttentionRequired = severityRank(severity) >= 4 || /blocked|failed|needs_review|pending/.test(status);
  const attentionRequired = input.attentionRequired ?? inferredAttentionRequired;
  return {
    id: `${source}:${safeToken(input.id, "event", 128)}`,
    timestamp,
    source,
    domain: safeToken(input.domain || source),
    type,
    category: safeToken(input.category || type),
    severity,
    attentionRequired: Boolean(attentionRequired),
    status,
    title: safeString(input.title || `${source} ${type}`, 120),
    summary: safeString(input.summary || "", 360),
    actor: input.actor ? sanitizeValue(input.actor) : null,
    related: input.related ? sanitizeValue(input.related) : {},
    evidenceTarget: input.evidenceTarget || null,
    recommendedAction: input.recommendedAction || panelTarget("Open related admin panel", "#readiness"),
    dangerousActionWarning: input.dangerousActionWarning || DANGEROUS_ACTION_WARNING,
  };
}

function adminAuditEvent(row) {
  const action = safeToken(row.action);
  const highRisk = /delete|revoke|role|status|mfa|reset|credit|grant|repair|archive|cleanup|visibility/.test(action);
  return eventRecord({
    source: "admin_audit",
    domain: highRisk ? "security" : "admin",
    id: row.id,
    timestamp: row.created_at,
    type: action,
    category: highRisk ? "security_admin" : "admin_audit",
    status: "recorded",
    severity: highRisk ? "high" : "low",
    title: `Admin audit: ${action.replace(/_/g, " ")}`,
    summary: row.target_email ? `Recorded admin action for ${safeString(row.target_email, 120)}.` : "Recorded admin action.",
    actor: { userId: row.admin_user_id || null, email: row.admin_email || null },
    related: { targetUserId: row.target_user_id || null },
    evidenceTarget: panelTarget("Open Activity Log", "#activity"),
    recommendedAction: panelTarget("Open Activity Log", "#activity"),
  });
}

function userActivityEvent(row) {
  const action = safeToken(row.action);
  const security = /login|logout|register|password|wallet|mfa|failed|delete/.test(action);
  return eventRecord({
    source: "user_activity",
    domain: security ? "security" : "user",
    id: row.id,
    timestamp: row.created_at,
    type: action,
    category: security ? "security_user_activity" : "user_activity",
    status: "recorded",
    severity: security ? "medium" : "informational",
    title: `User activity: ${action.replace(/_/g, " ")}`,
    summary: row.user_email ? `Sanitized user activity for ${safeString(row.user_email, 120)}.` : "Sanitized user activity.",
    actor: { userId: row.user_id || null, email: row.user_email || null },
    related: { userId: row.user_id || null },
    evidenceTarget: panelTarget("Open Activity Log", "#activity"),
    recommendedAction: panelTarget("Open Activity Log", "#activity"),
  });
}

function billingProviderEvent(row) {
  const status = safeToken(row.processing_status);
  const type = safeToken(row.event_type, "billing_event", 120);
  const isFinancialReview = /refund|dispute|payment_failed|invoice\.payment_failed|expired/.test(type) || status === "failed";
  return eventRecord({
    source: "billing",
    domain: "billing",
    id: row.id,
    timestamp: row.received_at || row.event_created_at || row.created_at,
    type,
    category: "billing_provider_event",
    status,
    severity: isFinancialReview ? "high" : severityForStatus(status),
    attentionRequired: isFinancialReview || status === "failed",
    title: `Billing event: ${type}`,
    summary: `${safeString(row.provider, 32)} ${safeString(row.provider_mode, 32)} event processed as ${status}. Raw payload and signatures are not exposed.`,
    related: {
      billingEventId: row.id,
      providerMode: row.provider_mode || null,
      organizationId: row.organization_id || null,
      userId: row.user_id || null,
    },
    evidenceTarget: panelTarget("Open Billing Events", "#billing-events"),
    recommendedAction: isFinancialReview ? panelTarget("Open Billing Reviews", "#billing-events") : panelTarget("Open Billing Events", "#billing-events"),
  });
}

function billingReviewEvent(review) {
  return eventRecord({
    source: "billing_review",
    domain: "billing",
    id: review.id || review.billingEventId,
    timestamp: review.receivedAt || review.createdAt,
    type: review.eventType || "billing_review",
    category: "billing_financial_review",
    status: review.reviewState || review.actionStatus || "needs_review",
    severity: review.reviewState === "blocked" ? "critical" : "high",
    attentionRequired: !["resolved", "dismissed", "informational"].includes(review.reviewState),
    title: `Billing review: ${safeString(review.eventType || "provider event", 120)}`,
    summary: safeString(review.reviewReason || review.recommendedAction || "Financial lifecycle event requires operator review.", 280),
    related: {
      billingEventId: review.billingEventId || review.id || null,
      actionId: review.actionId || null,
      providerMode: review.providerMode || null,
    },
    evidenceTarget: panelTarget("Open Billing Reviews", "#billing-events"),
    recommendedAction: panelTarget("Open Billing Reviews", "#billing-events"),
  });
}

function reconciliationEvent(item, section, generatedAt) {
  return eventRecord({
    source: "billing_reconciliation",
    domain: "billing",
    id: `${section.id || "section"}:${item.id || item.title || "finding"}`,
    timestamp: generatedAt,
    type: item.id || section.id || "reconciliation_finding",
    category: "billing_reconciliation",
    status: item.severity || section.severity || "needs_review",
    severity: maxSeverity(item.severity, section.severity),
    attentionRequired: severityRank(maxSeverity(item.severity, section.severity)) >= 3,
    title: item.title || section.title || "Billing reconciliation finding",
    summary: item.detail || "Read-only local D1 reconciliation finding.",
    related: { sectionId: section.id || null, count: item.count || null },
    evidenceTarget: panelTarget("Open Billing Reconciliation", "#billing-events"),
    recommendedAction: panelTarget("Open Billing Reconciliation", "#billing-events"),
  });
}

function dataLifecycleEvent(row) {
  const status = safeToken(row.status);
  const failed = /failed|blocked|error/.test(status);
  const pending = /pending|planned|approved|requested/.test(status);
  return eventRecord({
    source: "data_lifecycle",
    domain: "privacy",
    id: row.id,
    timestamp: row.updated_at || row.created_at,
    type: row.type,
    category: "data_lifecycle_request",
    status,
    severity: failed ? "high" : pending ? "medium" : "low",
    attentionRequired: failed || pending,
    title: `Data lifecycle ${safeString(row.type, 80)} request`,
    summary: `Request status is ${status}. Private archive bodies and raw request hashes are not exposed.`,
    actor: { userId: row.requested_by_admin_id || row.requested_by_user_id || null },
    related: { requestId: row.id, subjectUserId: row.subject_user_id || null },
    evidenceTarget: panelTarget("Open Data Lifecycle", "#lifecycle"),
    recommendedAction: panelTarget("Open Data Lifecycle", "#lifecycle"),
  });
}

async function dataExportArchiveEvent(row) {
  const storage = await redactStorageObjectKey(row.r2_key, { bucket: row.r2_bucket || "AUDIT_ARCHIVE" });
  return eventRecord({
    source: "evidence_archive",
    domain: "privacy",
    id: row.id,
    timestamp: row.updated_at || row.created_at,
    type: "data_export_archive",
    category: "data_lifecycle_archive",
    status: row.status || "archive_metadata",
    severity: /failed|cleanup_failed/.test(safeToken(row.status)) ? "high" : "low",
    attentionRequired: /failed|cleanup_failed|expired/.test(safeToken(row.status)),
    title: "Data lifecycle export archive metadata",
    summary: "Private AUDIT_ARCHIVE metadata only. Live R2 objects are not listed and raw archive keys are not exposed.",
    related: { archiveId: row.id, requestId: row.request_id || null, subjectUserId: row.subject_user_id || null, storage },
    evidenceTarget: panelTarget("Open Data Lifecycle Archives", "#lifecycle"),
    recommendedAction: panelTarget("Open Data Lifecycle", "#lifecycle"),
  });
}

function tenantReviewEvent(row) {
  const severity = row.severity === "critical" ? "critical" : row.severity === "warning" ? "medium" : "informational";
  const status = safeToken(row.review_status);
  return eventRecord({
    source: "tenant_review",
    domain: "tenant_assets",
    id: row.id,
    timestamp: row.updated_at || row.created_at,
    type: row.issue_category,
    category: "tenant_asset_manual_review",
    status,
    severity,
    attentionRequired: !/^approved_|rejected|superseded/.test(status),
    title: `Tenant review: ${safeString(row.issue_category, 100)}`,
    summary: safeString(row.safe_notes || "Tenant asset review item requires safe operator classification before any future backfill/access switch.", 280),
    related: { reviewItemId: row.id, assetDomain: row.asset_domain || null, assetId: row.asset_id || null, evidenceSourcePath: row.evidence_source_path || null },
    evidenceTarget: panelTarget("Open Manual Review Queue", "#operations"),
    recommendedAction: panelTarget("Open Manual Review Queue", "#operations"),
  });
}

function tenantReviewStatusEvent(row) {
  return eventRecord({
    source: "tenant_review",
    domain: "tenant_assets",
    id: row.id,
    timestamp: row.created_at,
    type: row.event_type,
    category: "tenant_asset_review_event",
    status: row.new_status || row.event_type,
    severity: /blocked|rejected/.test(safeToken(row.new_status || row.event_type)) ? "high" : "medium",
    attentionRequired: /blocked|pending|review|deferred/.test(safeToken(row.new_status || row.event_type)),
    title: `Tenant review event: ${safeString(row.event_type, 100)}`,
    summary: "Manual-review status event. Idempotency keys and request hashes are not exposed.",
    actor: { userId: row.actor_user_id || null, email: row.actor_email || null },
    related: { reviewItemId: row.review_item_id || null },
    evidenceTarget: panelTarget("Open Manual Review Queue", "#operations"),
    recommendedAction: panelTarget("Open Manual Review Queue", "#operations"),
  });
}

function legacyResetEvent(row) {
  return eventRecord({
    source: "legacy_reset",
    domain: "tenant_assets",
    id: row.id,
    timestamp: row.updated_at || row.created_at,
    type: "legacy_media_reset_action",
    category: "legacy_media_reset",
    status: row.status,
    severity: row.dry_run ? "medium" : "critical",
    attentionRequired: true,
    title: "Legacy media reset action evidence",
    summary: "Legacy media reset remains blocked/default-off. Action metadata is redacted; no R2 listing or reset execution is exposed here.",
    actor: { userId: row.operator_user_id || null, email: row.operator_email || null },
    related: { actionId: row.id, dryRun: Number(row.dry_run) === 1, evidenceReportGeneratedAt: row.evidence_report_generated_at || null },
    evidenceTarget: panelTarget("Open Tenant Asset Center", "#tenant-assets"),
    recommendedAction: panelTarget("Open Readiness/Evidence Dashboard", "#readiness"),
  });
}

function platformBudgetRepairEvent(row) {
  const status = safeToken(row.action_status);
  return eventRecord({
    source: "ai_budget",
    domain: "admin_ai",
    id: row.id,
    timestamp: row.updated_at || row.created_at,
    type: row.requested_action,
    category: "platform_budget_repair",
    status,
    severity: /failed|rejected/.test(status) ? "high" : /review|pending/.test(status) ? "medium" : "low",
    attentionRequired: /failed|pending|review/.test(status),
    title: `Platform budget repair: ${safeString(row.requested_action, 120)}`,
    summary: "Repair action metadata only. No provider, Stripe, credit, customer billing, or source-row mutation is exposed from timeline.",
    actor: { userId: row.requested_by_user_id || null, email: row.requested_by_email || null },
    related: { repairActionId: row.id, candidateId: row.candidate_id || null, candidateType: row.candidate_type || null },
    evidenceTarget: panelTarget("Open AI Budget Evidence", "#ai-budget-switches"),
    recommendedAction: panelTarget("Open AI Budget Evidence", "#ai-budget-switches"),
  });
}

async function platformBudgetArchiveEvent(row) {
  const storage = await redactStorageObjectKey(row.storage_key, { bucket: row.storage_bucket || "AUDIT_ARCHIVE" });
  const status = safeToken(row.archive_status);
  return eventRecord({
    source: "evidence_archive",
    domain: "admin_ai",
    id: row.id,
    timestamp: row.updated_at || row.created_at,
    type: row.archive_type,
    category: "platform_budget_evidence_archive",
    status,
    severity: /failed|cleanup_failed/.test(status) ? "high" : "low",
    attentionRequired: /failed|cleanup_failed|expired/.test(status),
    title: `AI budget evidence archive: ${safeString(row.archive_type, 100)}`,
    summary: "AUDIT_ARCHIVE metadata only. Raw storage keys and archive bodies are not exposed.",
    actor: { userId: row.created_by_user_id || null, email: row.created_by_email || null },
    related: { archiveId: row.id, budgetScope: row.budget_scope || null, format: row.format || null, storage },
    evidenceTarget: panelTarget("Open AI Budget Evidence Archives", "#ai-budget-switches"),
    recommendedAction: panelTarget("Open AI Budget Evidence Archives", "#ai-budget-switches"),
  });
}

function platformBudgetUsageEvent(row) {
  return eventRecord({
    source: "ai_budget",
    domain: "admin_ai",
    id: row.id,
    timestamp: row.created_at,
    type: row.operation_key,
    category: "platform_budget_usage",
    status: row.status || "recorded",
    severity: "informational",
    attentionRequired: false,
    title: `Platform budget usage: ${safeString(row.operation_key, 120)}`,
    summary: `Recorded ${Number(row.units || 0)} platform budget unit(s). Idempotency hashes and provider payloads are not exposed.`,
    actor: { userId: row.actor_user_id || null, role: row.actor_role || null },
    related: { budgetScope: row.budget_scope || null, sourceRoute: row.source_route || null },
    evidenceTarget: panelTarget("Open AI Budget Usage", "#ai-budget-switches"),
    recommendedAction: panelTarget("Open AI Budget Evidence", "#ai-budget-switches"),
  });
}

function readinessEvents(generatedAt) {
  return [
    eventRecord({
      source: "readiness",
      domain: "readiness",
      id: "production_readiness_blocked",
      timestamp: generatedAt,
      type: "blocked_claim",
      category: "readiness_claim",
      status: "blocked",
      severity: "high",
      attentionRequired: true,
      title: "Production readiness remains blocked",
      summary: "Repository support exists for evidence collection, but live deploy/operator evidence is still required.",
      evidenceTarget: panelTarget("Open Readiness/Evidence Dashboard", "#readiness"),
      recommendedAction: panelTarget("Open Readiness/Evidence Dashboard", "#readiness"),
    }),
    eventRecord({
      source: "readiness",
      domain: "billing",
      id: "live_billing_readiness_blocked",
      timestamp: generatedAt,
      type: "blocked_claim",
      category: "billing_readiness_claim",
      status: "blocked",
      severity: "high",
      attentionRequired: true,
      title: "Live billing readiness remains blocked",
      summary: "Stripe credit packs and BITBI Pro require operator canary evidence before any live readiness claim.",
      evidenceTarget: panelTarget("Open Billing Evidence Center", "#billing-events"),
      recommendedAction: panelTarget("Open Billing Evidence Center", "#billing-events"),
    }),
  ];
}

async function queryActivityArchiveVisibility(env, unavailable, generatedAt) {
  const retention = getActivityRetentionMetadata(generatedAt);
  const countQueries = [
    ["adminAuditHot", "admin_audit", "SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE created_at >= ?", [retention.retentionCutoff]],
    ["adminAuditColdCandidates", "admin_audit", "SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE created_at < ?", [retention.retentionCutoff]],
    ["userActivityHot", "user_activity", "SELECT COUNT(*) AS cnt FROM user_activity_log WHERE created_at >= ?", [retention.retentionCutoff]],
    ["userActivityColdCandidates", "user_activity", "SELECT COUNT(*) AS cnt FROM user_activity_log WHERE created_at < ?", [retention.retentionCutoff]],
    ["dataExportArchives", "evidence_archive", "SELECT COUNT(*) AS cnt FROM data_export_archives", []],
    ["platformBudgetEvidenceArchives", "evidence_archive", "SELECT COUNT(*) AS cnt FROM platform_budget_evidence_archives", []],
  ];
  const counts = {};
  for (const [key, source, sql, bindings] of countQueries) {
    const result = await safeFirst(env, source, sql, bindings, unavailable);
    counts[key] = Number(result.row?.cnt ?? 0);
  }
  return {
    status: "metadata_only_no_r2_listing",
    policy: {
      retentionDays: retention.retentionDays,
      retentionCutoff: retention.retentionCutoff,
      cleanupPolicy: "scheduled archive writes sanitized NDJSON to AUDIT_ARCHIVE then prunes hot D1 rows",
      liveR2Listed: false,
      archivesDeleted: false,
    },
    counts,
  };
}

function sourceAllowed(filters, source) {
  return !filters.source || filters.source === source;
}

export async function buildOperatorTimeline(env, params = {}) {
  const filters = normalizeOperatorTimelineFilters(params);
  const generatedAt = nowIso();
  const unavailableSources = [];
  const candidateLimit = Math.min(Math.max(filters.limit + filters.offset + 10, 50), MAX_LIMIT);
  const events = [];

  if (sourceAllowed(filters, "admin_audit")) {
    const { rows } = await safeAll(env, "admin_audit",
      `SELECT a.id, a.action, a.meta_json, a.created_at,
              a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email,
              a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email
       FROM admin_audit_log a
       LEFT JOIN activity_search_index idx
         ON idx.source_table = 'admin_audit_log'
        AND idx.source_event_id = a.id
       LEFT JOIN users au ON au.id = a.admin_user_id
       LEFT JOIN users tu ON tu.id = a.target_user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
      [candidateLimit], unavailableSources);
    events.push(...rows.map(adminAuditEvent));
  }

  if (sourceAllowed(filters, "user_activity")) {
    const { rows } = await safeAll(env, "user_activity",
      `SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at,
              COALESCE(u.email, idx.actor_email_norm) AS user_email
       FROM user_activity_log a
       LEFT JOIN activity_search_index idx
         ON idx.source_table = 'user_activity_log'
        AND idx.source_event_id = a.id
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
      [candidateLimit], unavailableSources);
    events.push(...rows.map(userActivityEvent));
  }

  if (sourceAllowed(filters, "billing")) {
    const { rows } = await safeAll(env, "billing",
      `SELECT id, provider, provider_event_id, provider_account, provider_mode, event_type, event_created_at, received_at,
              processing_status, verification_status, payload_hash, payload_summary_json, organization_id, user_id,
              billing_customer_id, error_code, error_message, attempt_count, last_processed_at, created_at, updated_at
       FROM billing_provider_events
       WHERE (? IS NULL OR provider = ?)
         AND (? IS NULL OR provider_mode = ?)
         AND (? IS NULL OR processing_status = ?)
         AND (? IS NULL OR event_type = ?)
         AND (? IS NULL OR organization_id = ?)
       ORDER BY received_at DESC, id DESC
       LIMIT ?`,
      [null, null, null, null, null, null, null, null, null, null, candidateLimit], unavailableSources);
    events.push(...rows.map(billingProviderEvent));
  }

  if (sourceAllowed(filters, "billing_review")) {
    try {
      const reviewResult = await listBillingReviewEvents(env, { providerMode: "live", limit: Math.min(candidateLimit, 50) });
      events.push(...(reviewResult.reviews || []).map(billingReviewEvent));
    } catch (error) {
      if (isMissingTable(error)) unavailableSources.push({ source: "billing_review", reason: "table_unavailable" });
      else throw error;
    }
  }

  if (sourceAllowed(filters, "billing_reconciliation")) {
    try {
      const report = await getBillingReconciliationReport(env);
      for (const section of report.sections || []) {
        for (const item of (section.items || []).slice(0, 3)) {
          events.push(reconciliationEvent(item, section, report.generatedAt || generatedAt));
        }
      }
    } catch (error) {
      if (isMissingTable(error)) unavailableSources.push({ source: "billing_reconciliation", reason: "table_unavailable" });
      else throw error;
    }
  }

  if (sourceAllowed(filters, "data_lifecycle")) {
    const { rows } = await safeAll(env, "data_lifecycle",
      `SELECT id, type, subject_user_id, requested_by_user_id, requested_by_admin_id, status, reason,
              approval_required, approved_by_admin_id, approved_at, idempotency_key, request_hash, dry_run,
              created_at, updated_at, completed_at, expires_at, error_code, error_message
       FROM data_lifecycle_requests
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [candidateLimit], unavailableSources);
    events.push(...rows.map(dataLifecycleEvent));
  }

  if (sourceAllowed(filters, "evidence_archive")) {
    const dataArchives = await safeAll(env, "evidence_archive",
      `SELECT id, request_id, subject_user_id, r2_bucket, r2_key, sha256, size_bytes, expires_at,
              created_at, status, updated_at, downloaded_at, deleted_at, error_code, error_message
       FROM data_export_archives
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [Math.min(candidateLimit, 50)], unavailableSources);
    for (const row of dataArchives.rows) events.push(await dataExportArchiveEvent(row));

    const platformArchives = await safeAll(env, "evidence_archive",
      `SELECT id, budget_scope, archive_type, archive_status, storage_bucket, storage_key, content_type, format,
              sha256, size_bytes, filters_json, summary_json, idempotency_key_hash, request_hash, reason,
              created_by_user_id, created_by_email, created_at, updated_at, expires_at, deleted_at, error_code, error_message
       FROM platform_budget_evidence_archives
       WHERE budget_scope = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ["platform_admin_lab_budget", Math.min(candidateLimit, 50)], unavailableSources);
    for (const row of platformArchives.rows) events.push(await platformBudgetArchiveEvent(row));
  }

  if (sourceAllowed(filters, "tenant_review")) {
    const items = await safeAll(env, "tenant_review",
      `SELECT id, asset_domain, asset_id, related_asset_id, source_table, source_row_id, issue_category, review_status,
              severity, priority, legacy_owner_user_id, proposed_asset_owner_type, proposed_owning_user_id,
              proposed_owning_organization_id, proposed_ownership_status, proposed_ownership_source,
              proposed_ownership_confidence, evidence_source_path, evidence_report_generated_at, evidence_summary_json,
              safe_notes, assigned_to_user_id, reviewed_by_user_id, reviewed_at, created_by_user_id, created_at,
              updated_at, superseded_by_id, metadata_json
       FROM ai_asset_manual_review_items
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [Math.min(candidateLimit, 50), 0], unavailableSources);
    events.push(...items.rows.map(tenantReviewEvent));

    const reviewEvents = await safeAll(env, "tenant_review",
      `SELECT id, review_item_id, event_type, old_status, new_status, actor_user_id, actor_email, reason,
              idempotency_key, request_hash, event_metadata_json, created_at
       FROM ai_asset_manual_review_events
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [Math.min(candidateLimit, 50)], unavailableSources);
    events.push(...reviewEvents.rows.map(tenantReviewStatusEvent));
  }

  if (sourceAllowed(filters, "legacy_reset")) {
    const { rows } = await safeAll(env, "legacy_reset",
      `SELECT id, dry_run, status, requested_domains_json, normalized_request_hash, idempotency_key_hash,
              operator_user_id, operator_email, reason, acknowledgements_json, evidence_report_generated_at,
              evidence_snapshot_hash, before_summary_json, result_summary_json, error_summary_json,
              created_at, updated_at, completed_at
       FROM tenant_asset_media_reset_actions
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [Math.min(candidateLimit, 50), 0], unavailableSources);
    events.push(...rows.map(legacyResetEvent));
  }

  if (sourceAllowed(filters, "ai_budget")) {
    const repairs = await safeAll(env, "ai_budget",
      `SELECT id, budget_scope, candidate_id, candidate_type, requested_action, action_status, dry_run,
              idempotency_key, request_hash, requested_by_user_id, requested_by_email, reason,
              source_attempt_id, source_job_id, created_usage_event_id, evidence_json, result_json,
              error_code, error_message, created_at, updated_at
       FROM platform_budget_repair_actions
       WHERE budget_scope = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ["platform_admin_lab_budget", Math.min(candidateLimit, 50)], unavailableSources);
    events.push(...repairs.rows.map(platformBudgetRepairEvent));

    const usage = await safeAll(env, "ai_budget",
      `SELECT id, budget_scope, operation_key, source_route, actor_user_id, actor_role, units, window_day,
              window_month, source_attempt_id, source_job_id, status, metadata_json, created_at
       FROM platform_budget_usage_events
       WHERE budget_scope = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ["platform_admin_lab_budget", Math.min(candidateLimit, 50)], unavailableSources);
    events.push(...usage.rows.map(platformBudgetUsageEvent));
  }

  if (sourceAllowed(filters, "readiness")) {
    events.push(...readinessEvents(generatedAt));
  }

  const archiveVisibility = await queryActivityArchiveVisibility(env, unavailableSources, generatedAt);
  if (sourceAllowed(filters, "activity_archive")) {
    events.push(eventRecord({
      source: "activity_archive",
      domain: "admin",
      id: "activity_retention_status",
      timestamp: generatedAt,
      type: "retention_status",
      category: "activity_archive_visibility",
      status: "metadata_only",
      severity: archiveVisibility.counts.adminAuditColdCandidates || archiveVisibility.counts.userActivityColdCandidates ? "medium" : "informational",
      attentionRequired: Boolean(archiveVisibility.counts.adminAuditColdCandidates || archiveVisibility.counts.userActivityColdCandidates),
      title: "Audit/activity archive visibility",
      summary: `Hot retention is ${archiveVisibility.policy.retentionDays} days. Archive posture is metadata-only; no live R2 listing or deletion was performed.`,
      related: archiveVisibility.counts,
      evidenceTarget: panelTarget("Open Activity Log", "#activity"),
      recommendedAction: panelTarget("Open Activity Log", "#activity"),
    }));
  }

  const filtered = events
    .filter((event) => !filters.severity || event.severity === filters.severity)
    .filter((event) => !filters.status || event.status === filters.status)
    .filter((event) => filters.attentionRequired == null || event.attentionRequired === filters.attentionRequired)
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp.localeCompare(a.timestamp);
      return b.id.localeCompare(a.id);
    });

  const page = filtered.slice(filters.offset, filters.offset + filters.limit);
  const hasMore = filtered.length > filters.offset + filters.limit;
  return {
    ok: true,
    version: "omega-p1-wave8-operator-timeline-v1",
    generatedAt,
    source: "local_d1_read_only_aggregate",
    readOnly: true,
    boundedResponse: true,
    redactedResponse: true,
    externalCallsMade: false,
    stripeCallsMade: false,
    providerCallsMade: false,
    d1MutationPerformed: false,
    r2ListingPerformed: false,
    r2MutationPerformed: false,
    creditMutationPerformed: false,
    filters,
    appliedFilters: filters,
    events: page,
    totalAvailable: filtered.length,
    hasMore,
    nextOffset: hasMore ? filters.offset + filters.limit : null,
    unavailableSources,
    blockedClaims: BLOCKED_CLAIMS,
    archiveVisibility,
    safeNextActions: [
      "Open the related Admin panel.",
      "Export already sanitized evidence where an existing Admin API supports it.",
      "Run local evidence index or readiness commands outside the browser.",
      "Keep blocked claims blocked until reviewed evidence proves otherwise.",
    ],
    dangerousActionsOffered: [],
  };
}
