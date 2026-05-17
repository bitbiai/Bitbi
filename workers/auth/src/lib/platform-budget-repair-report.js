import {
  PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  PLATFORM_BUDGET_USAGE_EVENTS_TABLE,
  getPlatformBudgetUsageSummary,
  normalizePlatformBudgetScope,
} from "./platform-budget-caps.js";
import {
  PLATFORM_BUDGET_REPAIR_ACTIONS_ENDPOINT,
  PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE,
  listPlatformBudgetRepairActions,
} from "./platform-budget-repair.js";
import { buildPlatformBudgetReconciliationReport } from "./platform-budget-reconciliation.js";
import { nowIso } from "./tokens.js";

export const PLATFORM_BUDGET_REPAIR_REPORT_VERSION = "platform-budget-repair-report-v1";
export const PLATFORM_BUDGET_REPAIR_REPORT_ENDPOINT = "/api/admin/ai/platform-budget-repair-report";
export const PLATFORM_BUDGET_REPAIR_REPORT_EXPORT_ENDPOINT = "/api/admin/ai/platform-budget-repair-report/export";
export const PLATFORM_BUDGET_REPAIR_REPORT_SOURCE = "local_d1_read_only";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const REPORT_ACTION_FETCH_LIMIT = 100;
const MAX_EVIDENCE_ROWS = 25;

const ALLOWED_ACTION_STATUSES = new Set(["pending", "applied", "review_recorded", "no_op", "rejected", "failed"]);
const ALLOWED_CANDIDATE_TYPES = new Set([
  "missing_admin_usage_event",
  "missing_video_usage_event",
  "duplicate_attempt_usage_event",
  "duplicate_job_usage_event",
  "duplicate_idempotent_usage_event",
  "orphan_attempt_usage_event",
  "orphan_job_usage_event",
  "usage_event_without_source",
  "failed_attempt_counted",
  "failed_job_counted",
  "window_mismatch",
  "invalid_usage_units",
  "cap_total_exceeds_limit",
  "not_checkable",
]);
const ALLOWED_REQUESTED_ACTIONS = new Set([
  "create_missing_usage_event",
  "mark_duplicate_usage_event_review",
  "review_orphan_usage_event",
  "review_failed_source_usage",
  "fix_window_metadata",
  "add_missing_cost_metadata",
]);
const ALLOWED_FORMATS = new Set(["json", "markdown"]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,220}$/;
const UNSAFE_KEY_PATTERN = /(secret|token|cookie|authorization|auth_header|private[_-]?key|stripe|cloudflare|api[_-]?key|prompt|lyrics|message|provider[_-]?body|raw|idempotency)/i;

export class PlatformBudgetRepairReportError extends Error {
  constructor(message, { status = 400, code = "platform_budget_repair_report_error", fields = {} } = {}) {
    super(message);
    this.name = "PlatformBudgetRepairReportError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function safeText(value, maxLength = 240) {
  if (value == null || value === "") return null;
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function safeId(value, maxLength = 220) {
  const text = safeText(value, maxLength);
  if (!text || !SAFE_ID_PATTERN.test(text)) return null;
  return text;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJson(value) {
  const out = {};
  for (const [key, raw] of Object.entries(value || {}).slice(0, 20)) {
    const safeKey = safeId(key, 80);
    if (!safeKey || UNSAFE_KEY_PATTERN.test(safeKey)) continue;
    if (raw == null || typeof raw === "boolean" || typeof raw === "number") {
      out[safeKey] = raw;
    } else if (typeof raw === "string") {
      out[safeKey] = safeText(raw, 240);
    } else if (Array.isArray(raw)) {
      out[safeKey] = raw.slice(0, 12).map((item) => safeText(item, 180)).filter(Boolean);
    }
  }
  return out;
}

function safeRepairAction(action = {}) {
  return {
    id: safeId(action.id, 180),
    budgetScope: safeId(action.budgetScope, 120),
    candidateId: safeId(action.candidateId, 220),
    candidateType: safeId(action.candidateType, 120),
    requestedAction: safeId(action.requestedAction, 120),
    actionStatus: safeId(action.actionStatus, 80),
    dryRun: action.dryRun === true,
    idempotencyKeyPresent: action.idempotencyKeyPresent === true,
    requestedByUserId: safeId(action.requestedByUserId, 180),
    requestedByEmail: safeText(action.requestedByEmail, 180),
    reason: safeText(action.reason, 280),
    sourceAttemptId: safeId(action.sourceAttemptId, 180),
    sourceJobId: safeId(action.sourceJobId, 180),
    createdUsageEventId: safeId(action.createdUsageEventId, 180),
    evidence: safeJson(action.evidence),
    result: safeJson(action.result),
    errorCode: safeId(action.errorCode, 120),
    errorMessage: safeText(action.errorMessage, 240),
    createdAt: safeText(action.createdAt, 40),
    updatedAt: safeText(action.updatedAt, 40),
    replayed: action.replayed === true,
  };
}

function parseBooleanFilter(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new PlatformBudgetRepairReportError("Invalid boolean repair report filter.", {
    status: 400,
    code: "platform_budget_repair_report_filter_invalid",
    fields: { filter: "dryRun" },
  });
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, numeric));
}

function normalizeDateFilter(value, { endOfDay = false } = {}) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new PlatformBudgetRepairReportError("Invalid repair report date filter.", {
      status: 400,
      code: "platform_budget_repair_report_filter_invalid",
      fields: { filter: endOfDay ? "dateTo" : "dateFrom" },
    });
  }
  return date.toISOString();
}

function normalizeEnumFilter(value, allowed, name) {
  const normalized = safeId(value, 120);
  if (!normalized) return null;
  if (!allowed.has(normalized)) {
    throw new PlatformBudgetRepairReportError("Unsupported repair report filter value.", {
      status: 400,
      code: "platform_budget_repair_report_filter_invalid",
      fields: { filter: name, value: normalized },
    });
  }
  return normalized;
}

function normalizeFormat(value) {
  const normalized = String(value || "json").trim().toLowerCase();
  if (!ALLOWED_FORMATS.has(normalized)) {
    throw new PlatformBudgetRepairReportError("Unsupported repair report export format.", {
      status: 400,
      code: "platform_budget_repair_report_format_unsupported",
      fields: { format: normalized || null },
    });
  }
  return normalized;
}

function missingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function assertDb(env) {
  if (!env?.DB?.prepare) {
    throw new PlatformBudgetRepairReportError("Platform budget repair report store is unavailable.", {
      status: 503,
      code: "platform_budget_repair_report_store_unavailable",
    });
  }
}

export function normalizePlatformBudgetRepairReportFilters(input = {}) {
  const budgetScope = normalizePlatformBudgetScope(input.budgetScope || input.budget_scope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE);
  const status = normalizeEnumFilter(input.status, ALLOWED_ACTION_STATUSES, "status");
  const candidateType = normalizeEnumFilter(input.candidateType || input.candidate_type, ALLOWED_CANDIDATE_TYPES, "candidateType");
  const requestedAction = normalizeEnumFilter(input.requestedAction || input.requested_action, ALLOWED_REQUESTED_ACTIONS, "requestedAction");
  const dryRun = parseBooleanFilter(input.dryRun ?? input.dry_run);
  const dateFrom = normalizeDateFilter(input.dateFrom || input.date_from);
  const dateTo = normalizeDateFilter(input.dateTo || input.date_to, { endOfDay: true });
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new PlatformBudgetRepairReportError("Repair report date range is invalid.", {
      status: 400,
      code: "platform_budget_repair_report_filter_invalid",
      fields: { filter: "dateRange" },
    });
  }
  return Object.freeze({
    budgetScope,
    status,
    candidateType,
    requestedAction,
    dryRun,
    dateFrom,
    dateTo,
    limit: normalizeLimit(input.limit),
    includeDetails: input.includeDetails === true || input.include_details === true || String(input.includeDetails || input.include_details || "").toLowerCase() === "true",
    includeCandidates: input.includeCandidates === true || input.include_candidates === true || String(input.includeCandidates || input.include_candidates || "").toLowerCase() === "true",
    format: normalizeFormat(input.format || "json"),
  });
}

function actionMatchesFilters(action, filters) {
  if (filters.status && action.actionStatus !== filters.status) return false;
  if (filters.candidateType && action.candidateType !== filters.candidateType) return false;
  if (filters.requestedAction && action.requestedAction !== filters.requestedAction) return false;
  if (filters.dryRun != null && action.dryRun !== filters.dryRun) return false;
  const createdAt = action.createdAt || action.updatedAt || "";
  if (filters.dateFrom && createdAt < filters.dateFrom) return false;
  if (filters.dateTo && createdAt > filters.dateTo) return false;
  return true;
}

function rollupBy(actions, keyFn) {
  const rows = new Map();
  for (const action of actions) {
    const key = keyFn(action) || "unknown";
    const current = rows.get(key) || {
      key,
      count: 0,
      createdUsageEventCount: 0,
      lastActionAt: null,
    };
    current.count += 1;
    if (action.createdUsageEventId) current.createdUsageEventCount += 1;
    const timestamp = action.updatedAt || action.createdAt || null;
    if (timestamp && (!current.lastActionAt || String(timestamp) > String(current.lastActionAt))) {
      current.lastActionAt = timestamp;
    }
    rows.set(key, current);
  }
  return Array.from(rows.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return String(left.key).localeCompare(String(right.key));
  });
}

async function readUsageEvent(env, usageEventId) {
  const id = safeId(usageEventId, 180);
  if (!id) return null;
  const row = await env.DB.prepare(
    `SELECT id, budget_scope, operation_key, source_route, actor_user_id, actor_role, units,
            window_day, window_month, source_attempt_id, source_job_id, status, metadata_json, created_at
       FROM ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE}
      WHERE id = ?
      LIMIT 1`
  ).bind(id).first();
  if (!row) return null;
  return {
    id: row.id,
    budgetScope: row.budget_scope,
    operationKey: row.operation_key,
    sourceRoute: row.source_route || null,
    actorUserId: row.actor_user_id || null,
    actorRole: row.actor_role || null,
    units: Number(row.units || 0),
    windowDay: row.window_day || null,
    windowMonth: row.window_month || null,
    sourceAttemptId: row.source_attempt_id || null,
    sourceJobId: row.source_job_id || null,
    status: row.status || "recorded",
    metadata: safeJson(parseJsonObject(row.metadata_json)),
    createdAt: row.created_at || null,
  };
}

export async function listPlatformBudgetRepairEvidenceItems(env, filtersInput = {}) {
  assertDb(env);
  const filters = normalizePlatformBudgetRepairReportFilters(filtersInput);
  const actions = await listPlatformBudgetRepairActions(env, {
    budgetScope: filters.budgetScope,
    limit: REPORT_ACTION_FETCH_LIMIT,
  });
  return actions
    .filter((action) => actionMatchesFilters(action, filters))
    .slice(0, filters.limit);
}

export function summarizePlatformBudgetRepairActions(actions = []) {
  const summary = {
    totalRepairActions: actions.length,
    executableRepairsApplied: 0,
    dryRunsPerformed: 0,
    reviewOnlyActionsRecorded: 0,
    failedRepairAttempts: 0,
    idempotencyConflictCount: 0,
    recentRepairCount: actions.length,
    createdUsageEventCount: 0,
    lastRepairTimestamp: null,
    lastDryRunTimestamp: null,
  };
  for (const action of actions) {
    if (action.actionStatus === "applied" && action.requestedAction === "create_missing_usage_event") summary.executableRepairsApplied += 1;
    if (action.dryRun) summary.dryRunsPerformed += 1;
    if (action.actionStatus === "review_recorded") summary.reviewOnlyActionsRecorded += 1;
    if (action.actionStatus === "failed") summary.failedRepairAttempts += 1;
    if (action.errorCode === "idempotency_conflict") summary.idempotencyConflictCount += 1;
    if (action.createdUsageEventId) summary.createdUsageEventCount += 1;
    const timestamp = action.updatedAt || action.createdAt || null;
    if (timestamp && (!summary.lastRepairTimestamp || String(timestamp) > String(summary.lastRepairTimestamp))) {
      summary.lastRepairTimestamp = timestamp;
    }
    if (action.dryRun && timestamp && (!summary.lastDryRunTimestamp || String(timestamp) > String(summary.lastDryRunTimestamp))) {
      summary.lastDryRunTimestamp = timestamp;
    }
  }
  return summary;
}

export async function buildPlatformBudgetRepairOperatorReport(env, options = {}) {
  const generatedAt = options.generatedAt || nowIso();
  let filters;
  try {
    filters = normalizePlatformBudgetRepairReportFilters(options);
  } catch (error) {
    if (error instanceof PlatformBudgetRepairReportError) throw error;
    throw error;
  }
  try {
    assertDb(env);
    const actions = (await listPlatformBudgetRepairEvidenceItems(env, filters)).map((action) => safeRepairAction(action));
    const summary = summarizePlatformBudgetRepairActions(actions);
    let reconciliationSnapshot = null;
    try {
      reconciliationSnapshot = await buildPlatformBudgetReconciliationReport(env, {
        budgetScope: filters.budgetScope,
        includeCandidates: filters.includeCandidates,
        limit: Math.min(filters.limit, 50),
        generatedAt,
      });
      summary.unresolvedRepairCandidatesCount = Number(reconciliationSnapshot?.summary?.repairCandidateCount || 0);
      summary.criticalReconciliationIssueCount = Number(reconciliationSnapshot?.summary?.criticalIssueCount || 0);
    } catch (error) {
      reconciliationSnapshot = {
        available: false,
        code: error?.code || "platform_budget_reconciliation_unavailable",
      };
      summary.unresolvedRepairCandidatesCount = null;
      summary.criticalReconciliationIssueCount = null;
    }
    let capStatusSnapshot = null;
    try {
      capStatusSnapshot = await getPlatformBudgetUsageSummary(env, {
        budgetScope: filters.budgetScope,
        recentLimit: Math.min(filters.limit, 10),
        now: generatedAt,
      });
    } catch (error) {
      capStatusSnapshot = {
        available: false,
        code: error?.code || "platform_budget_cap_summary_unavailable",
      };
    }
    const createdUsageEvents = [];
    if (filters.includeDetails) {
      for (const action of actions.filter((item) => item.createdUsageEventId).slice(0, MAX_EVIDENCE_ROWS)) {
        const usage = await readUsageEvent(env, action.createdUsageEventId);
        if (usage) createdUsageEvents.push(usage);
      }
    }
    const report = {
      ok: true,
      available: true,
      version: PLATFORM_BUDGET_REPAIR_REPORT_VERSION,
      reportId: `pbr_report_${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
      generatedAt,
      source: PLATFORM_BUDGET_REPAIR_REPORT_SOURCE,
      budgetScope: filters.budgetScope,
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      repairExecution: "manual_admin_approved_only",
      automaticRepair: false,
      scheduledRepair: false,
      runtimeMutation: false,
      providerCalls: false,
      stripeCalls: false,
      creditMutation: false,
      filtersApplied: {
        status: filters.status,
        candidateType: filters.candidateType,
        requestedAction: filters.requestedAction,
        dryRun: filters.dryRun,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit,
        includeDetails: filters.includeDetails,
        includeCandidates: filters.includeCandidates,
      },
      summary,
      sections: {
        repairActionStatusRollup: rollupBy(actions, (action) => action.actionStatus),
        repairActionTypeRollup: rollupBy(actions, (action) => `${action.candidateType}:${action.requestedAction}`),
        recentRepairActions: filters.includeDetails ? actions.slice(0, MAX_EVIDENCE_ROWS) : [],
        createdUsageEventEvidence: createdUsageEvents,
        reviewOnlyActionEvidence: filters.includeDetails
          ? actions.filter((action) => action.actionStatus === "review_recorded").slice(0, MAX_EVIDENCE_ROWS)
          : [],
        reconciliationSnapshot: filters.includeCandidates ? reconciliationSnapshot : {
          available: reconciliationSnapshot?.available !== false,
          verdict: reconciliationSnapshot?.verdict || null,
          summary: reconciliationSnapshot?.summary || null,
          repairCandidatesOmitted: true,
        },
        capStatusSnapshot,
      },
      endpoints: {
        repairActions: PLATFORM_BUDGET_REPAIR_ACTIONS_ENDPOINT,
        report: PLATFORM_BUDGET_REPAIR_REPORT_ENDPOINT,
        export: PLATFORM_BUDGET_REPAIR_REPORT_EXPORT_ENDPOINT,
      },
      limitations: [
        "Report reads are bounded and may not include older repair actions beyond the applied limit.",
        "Dry-runs are not persisted by Phase 4.19, so dry-run counts include only rows explicitly recorded with dry_run=1.",
        "This report exports evidence only and cannot apply, delete, purge, or rewrite repairs.",
      ],
      notes: [
        "Phase 4.20 adds read-only platform budget repair evidence reporting/export.",
        "No repairs are applied by this report/export endpoint.",
        "No provider calls, Stripe calls, credit mutations, source row mutations, customer billing mutations, or Cloudflare mutations are performed.",
        "Production readiness and live billing readiness remain blocked.",
      ],
    };
    return Object.freeze(report);
  } catch (error) {
    if (error instanceof PlatformBudgetRepairReportError) throw error;
    if (!missingTableError(error)) throw error;
    return Object.freeze({
      ok: true,
      available: false,
      version: PLATFORM_BUDGET_REPAIR_REPORT_VERSION,
      reportId: `pbr_report_unavailable_${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
      generatedAt,
      source: PLATFORM_BUDGET_REPAIR_REPORT_SOURCE,
      budgetScope: filters.budgetScope,
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      repairExecution: "manual_admin_approved_only",
      automaticRepair: false,
      scheduledRepair: false,
      runtimeMutation: false,
      providerCalls: false,
      stripeCalls: false,
      creditMutation: false,
      code: "platform_budget_repair_report_unavailable",
      summary: {
        totalRepairActions: 0,
        executableRepairsApplied: 0,
        dryRunsPerformed: 0,
        reviewOnlyActionsRecorded: 0,
        failedRepairAttempts: 0,
        idempotencyConflictCount: 0,
        recentRepairCount: 0,
        createdUsageEventCount: 0,
        unresolvedRepairCandidatesCount: null,
        criticalReconciliationIssueCount: null,
        lastRepairTimestamp: null,
        lastDryRunTimestamp: null,
      },
      sections: {
        repairActionStatusRollup: [],
        repairActionTypeRollup: [],
        recentRepairActions: [],
        createdUsageEventEvidence: [],
        reviewOnlyActionEvidence: [],
      },
      limitations: ["The repair action table is unavailable; apply migration 0054 before relying on this report."],
      notes: ["Report generation failed closed as unavailable and performed no writes."],
    });
  }
}

export function serializePlatformBudgetRepairReport(report = {}) {
  return report;
}

export function exportPlatformBudgetRepairReportJson(report = {}) {
  return `${JSON.stringify(serializePlatformBudgetRepairReport(report), null, 2)}\n`;
}

export function exportPlatformBudgetRepairReportMarkdown(report = {}) {
  const summary = report.summary || {};
  const statusLines = (report.sections?.repairActionStatusRollup || []).map((row) =>
    `- ${row.key}: ${row.count} action(s), created usage events ${row.createdUsageEventCount}`
  );
  const typeLines = (report.sections?.repairActionTypeRollup || []).map((row) =>
    `- ${row.key}: ${row.count} action(s)`
  );
  return [
    "# Platform Budget Repair Evidence Report",
    "",
    `Generated: ${report.generatedAt || "-"}`,
    `Source: ${report.source || PLATFORM_BUDGET_REPAIR_REPORT_SOURCE}`,
    `Budget scope: ${report.budgetScope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE}`,
    `Production readiness: ${report.productionReadiness || "blocked"}`,
    `Live billing readiness: ${report.liveBillingReadiness || "blocked"}`,
    `Automatic repair: ${report.automaticRepair === true ? "yes" : "no"}`,
    "",
    "## Summary",
    `- Total repair actions: ${summary.totalRepairActions ?? 0}`,
    `- Executable repairs applied: ${summary.executableRepairsApplied ?? 0}`,
    `- Review-only actions recorded: ${summary.reviewOnlyActionsRecorded ?? 0}`,
    `- Failed repair attempts: ${summary.failedRepairAttempts ?? 0}`,
    `- Created usage events: ${summary.createdUsageEventCount ?? 0}`,
    `- Last repair timestamp: ${summary.lastRepairTimestamp || "n/a"}`,
    "",
    "## Status Rollup",
    statusLines.length ? statusLines.join("\n") : "- None",
    "",
    "## Type Rollup",
    typeLines.length ? typeLines.join("\n") : "- None",
    "",
    "## Notes",
    ...(report.notes || []).map((note) => `- ${safeText(note, 300) || "-"}`),
    "",
  ].join("\n");
}

export function platformBudgetRepairReportErrorResponse(error) {
  const fields = error?.fields || {};
  return {
    ok: false,
    error: error?.message || "Platform budget repair report failed.",
    code: error?.code || "platform_budget_repair_report_error",
    budget_scope: fields.budgetScope || null,
    filter: fields.filter || null,
    format: fields.format || null,
  };
}
