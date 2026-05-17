import {
  PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  getPlatformBudgetUsageSummary,
  normalizePlatformBudgetScope,
  platformBudgetUnitsFromBudgetPolicy,
} from "./platform-budget-caps.js";
import { nowIso } from "./tokens.js";

export const PLATFORM_BUDGET_RECONCILIATION_VERSION = "platform-budget-reconciliation-v1";
export const PLATFORM_BUDGET_RECONCILIATION_ENDPOINT = "/api/admin/ai/platform-budget-reconciliation";
export const PLATFORM_BUDGET_RECONCILIATION_SOURCE = "local_d1_read_only";

const ADMIN_LAB_ATTEMPT_OPERATION_KEYS = Object.freeze([
  "admin.text.test",
  "admin.embeddings.test",
  "admin.music.test",
  "admin.compare",
  "admin.live_agent",
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const ISSUE_SEVERITY = Object.freeze({
  missing_admin_usage_event: "warning",
  missing_video_usage_event: "critical",
  orphan_attempt_usage_event: "warning",
  orphan_job_usage_event: "warning",
  usage_event_without_source: "warning",
  duplicate_attempt_usage_event: "critical",
  duplicate_job_usage_event: "critical",
  duplicate_idempotent_usage_event: "critical",
  failed_attempt_counted: "critical",
  failed_job_counted: "critical",
  window_mismatch: "warning",
  invalid_usage_units: "warning",
  cap_total_exceeds_limit: "critical",
  not_checkable: "warning",
});

const ACTION_BY_ISSUE = Object.freeze({
  missing_admin_usage_event: "create_missing_usage_event",
  missing_video_usage_event: "create_missing_usage_event",
  orphan_attempt_usage_event: "review_orphan_usage_event",
  orphan_job_usage_event: "review_orphan_usage_event",
  usage_event_without_source: "review_orphan_usage_event",
  duplicate_attempt_usage_event: "mark_duplicate_usage_event_review",
  duplicate_job_usage_event: "mark_duplicate_usage_event_review",
  duplicate_idempotent_usage_event: "mark_duplicate_usage_event_review",
  failed_attempt_counted: "review_failed_source_usage",
  failed_job_counted: "review_failed_source_usage",
  window_mismatch: "fix_window_metadata",
  invalid_usage_units: "add_missing_cost_metadata",
  cap_total_exceeds_limit: "review_orphan_usage_event",
  not_checkable: "requires_operator_review",
});

export class PlatformBudgetReconciliationError extends Error {
  constructor(message, { status = 400, code = "platform_budget_reconciliation_error", fields = {} } = {}) {
    super(message);
    this.name = "PlatformBudgetReconciliationError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function boundedLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, numeric));
}

function safeText(value, maxLength = 180) {
  if (value == null || value === "") return null;
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || null;
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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

function operationUnitsFromBudgetPolicyJson(value) {
  return platformBudgetUnitsFromBudgetPolicy(parseJsonObject(value));
}

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function assertDb(env) {
  if (!env?.DB?.prepare) {
    throw new PlatformBudgetReconciliationError("Platform budget reconciliation store is unavailable.", {
      status: 503,
      code: "platform_budget_reconciliation_store_unavailable",
    });
  }
}

function candidateId(issueType, sourceId, suffix = "") {
  return safeText(`pbr_${issueType}_${sourceId || "unknown"}${suffix ? `_${suffix}` : ""}`, 220);
}

export function classifyPlatformBudgetReconciliationSeverity(issueType) {
  return ISSUE_SEVERITY[issueType] || "warning";
}

function makeCandidate({
  issueType,
  budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  operationKey = null,
  sourceAttemptId = null,
  sourceJobId = null,
  usageEventIds = [],
  proposedUnits = null,
  reason,
  evidence = {},
}) {
  const severity = classifyPlatformBudgetReconciliationSeverity(issueType);
  const sourceId = sourceAttemptId || sourceJobId || usageEventIds[0] || operationKey || issueType;
  const proposedAction = ACTION_BY_ISSUE[issueType] || "requires_operator_review";
  const executableInPhase419 = proposedAction === "create_missing_usage_event";
  const reviewOnlyInPhase419 = [
    "mark_duplicate_usage_event_review",
    "review_orphan_usage_event",
    "review_failed_source_usage",
    "fix_window_metadata",
    "add_missing_cost_metadata",
  ].includes(proposedAction);
  return Object.freeze({
    candidateId: candidateId(issueType, sourceId, usageEventIds.length > 1 ? String(usageEventIds.length) : ""),
    issueType,
    severity,
    budgetScope,
    operationKey: safeText(operationKey, 160),
    sourceAttemptId: safeText(sourceAttemptId, 180),
    sourceJobId: safeText(sourceJobId, 180),
    usageEventIds: (usageEventIds || []).map((id) => safeText(id, 180)).filter(Boolean).slice(0, 20),
    proposedAction,
    actionSafety: executableInPhase419 ? "admin_approved_idempotent_executor" : "dry_run_or_review_only",
    requiresOperatorReview: true,
    futureRepairExecutorRequired: !executableInPhase419,
    phase419Executable: executableInPhase419,
    reviewOnly: reviewOnlyInPhase419,
    repairEndpoint: executableInPhase419 || reviewOnlyInPhase419 ? "/api/admin/ai/platform-budget-reconciliation/repair" : null,
    proposedUnits: proposedUnits == null ? null : safeNumber(proposedUnits, null),
    reason: safeText(reason, 500),
    evidenceSummary: Object.freeze(Object.fromEntries(
      Object.entries(evidence || {}).map(([key, value]) => [
        safeText(key, 80) || "field",
        typeof value === "number" || typeof value === "boolean"
          ? value
          : safeText(value, 220),
      ])
    )),
  });
}

export function serializePlatformBudgetReconciliationItem(item) {
  return makeCandidate(item || {});
}

function summarizeCandidates(candidates) {
  const bySeverity = { critical: 0, warning: 0 };
  const byIssueType = {};
  for (const candidate of candidates) {
    bySeverity[candidate.severity] = (bySeverity[candidate.severity] || 0) + 1;
    byIssueType[candidate.issueType] = (byIssueType[candidate.issueType] || 0) + 1;
  }
  return { bySeverity, byIssueType };
}

async function querySuccessfulAttemptsMissingUsage(env, { budgetScope, limit }) {
  const result = await env.DB.prepare(
    `SELECT a.id, a.operation_key, a.route, a.admin_user_id, a.status, a.provider_status, a.result_status,
            a.budget_policy_json, a.completed_at, a.updated_at, p.id AS usage_event_id
       FROM admin_ai_usage_attempts a
       LEFT JOIN platform_budget_usage_events p
         ON p.source_attempt_id = a.id
        AND p.budget_scope = a.budget_scope
        AND p.status = 'recorded'
      WHERE a.budget_scope = ?
        AND a.operation_key IN ('admin.text.test', 'admin.embeddings.test', 'admin.music.test', 'admin.compare', 'admin.live_agent')
        AND a.status = 'succeeded'
        AND a.provider_status = 'succeeded'
      ORDER BY COALESCE(a.completed_at, a.updated_at, a.created_at) DESC, a.id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  return (result?.results || [])
    .filter((row) => !row.usage_event_id)
    .map((row) => makeCandidate({
      issueType: "missing_admin_usage_event",
      budgetScope,
      operationKey: row.operation_key,
      sourceAttemptId: row.id,
      proposedUnits: operationUnitsFromBudgetPolicyJson(row.budget_policy_json),
      reason: "Successful admin AI attempt has no matching platform budget usage event.",
      evidence: {
        route: row.route,
        attemptStatus: row.status,
        providerStatus: row.provider_status,
        resultStatus: row.result_status,
        completedAt: row.completed_at || row.updated_at,
      },
    }));
}

async function querySuccessfulVideoJobsMissingUsage(env, { budgetScope, limit }) {
  const result = await env.DB.prepare(
    `SELECT j.id, j.user_id, j.status, j.provider, j.model, j.budget_policy_json,
            j.budget_policy_status, j.completed_at, j.updated_at, u.id AS usage_event_id
       FROM ai_video_jobs j
       LEFT JOIN platform_budget_usage_events u
         ON u.source_job_id = j.id
        AND u.budget_scope = ?
        AND u.status = 'recorded'
      WHERE j.scope = 'admin'
        AND j.status = 'succeeded'
      ORDER BY COALESCE(j.completed_at, j.updated_at, j.created_at) DESC, j.id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  return (result?.results || [])
    .filter((row) => !row.usage_event_id)
    .map((row) => makeCandidate({
      issueType: "missing_video_usage_event",
      budgetScope,
      operationKey: "admin.video.job.create",
      sourceJobId: row.id,
      proposedUnits: operationUnitsFromBudgetPolicyJson(row.budget_policy_json),
      reason: "Successful admin async video job has no matching platform budget usage event.",
      evidence: {
        provider: row.provider,
        model: row.model,
        jobStatus: row.status,
        budgetPolicyStatus: row.budget_policy_status,
        completedAt: row.completed_at || row.updated_at,
      },
    }));
}

async function queryDuplicateUsageEvents(env, { budgetScope, limit }) {
  const queries = [
    {
      issueType: "duplicate_attempt_usage_event",
      sourceField: "source_attempt_id",
      sql:
        `SELECT source_attempt_id AS source_id, operation_key, COUNT(*) AS event_count, COALESCE(SUM(units), 0) AS total_units, GROUP_CONCAT(id) AS usage_event_ids
           FROM platform_budget_usage_events
          WHERE budget_scope = ? AND status = 'recorded' AND source_attempt_id IS NOT NULL
          GROUP BY source_attempt_id, operation_key
         HAVING COUNT(*) > 1
          LIMIT ?`,
    },
    {
      issueType: "duplicate_job_usage_event",
      sourceField: "source_job_id",
      sql:
        `SELECT source_job_id AS source_id, operation_key, COUNT(*) AS event_count, COALESCE(SUM(units), 0) AS total_units, GROUP_CONCAT(id) AS usage_event_ids
           FROM platform_budget_usage_events
          WHERE budget_scope = ? AND status = 'recorded' AND source_job_id IS NOT NULL
          GROUP BY source_job_id, operation_key
         HAVING COUNT(*) > 1
          LIMIT ?`,
    },
    {
      issueType: "duplicate_idempotent_usage_event",
      sourceField: "idempotency_group",
      sql:
        `SELECT 'idempotency_group' AS source_id, operation_key, COUNT(*) AS event_count, COALESCE(SUM(units), 0) AS total_units, GROUP_CONCAT(id) AS usage_event_ids
           FROM platform_budget_usage_events
          WHERE budget_scope = ? AND status = 'recorded' AND idempotency_key_hash IS NOT NULL AND request_fingerprint IS NOT NULL
          GROUP BY operation_key, idempotency_key_hash, request_fingerprint
         HAVING COUNT(*) > 1
          LIMIT ?`,
    },
  ];
  const candidates = [];
  for (const query of queries) {
    const result = await env.DB.prepare(query.sql).bind(budgetScope, limit).all();
    for (const row of result?.results || []) {
      const ids = String(row.usage_event_ids || "").split(",").map((id) => id.trim()).filter(Boolean);
      candidates.push(makeCandidate({
        issueType: query.issueType,
        budgetScope,
        operationKey: row.operation_key,
        sourceAttemptId: query.sourceField === "source_attempt_id" ? row.source_id : null,
        sourceJobId: query.sourceField === "source_job_id" ? row.source_id : null,
        usageEventIds: ids,
        proposedUnits: row.total_units,
        reason: "Multiple recorded platform budget usage events point at the same source/de-dupe identity.",
        evidence: {
          eventCount: Number(row.event_count || 0),
          totalUnits: Number(row.total_units || 0),
          duplicateKey: query.sourceField,
        },
      }));
    }
  }
  return candidates;
}

async function queryInvalidSourceUsage(env, { budgetScope, limit }) {
  const candidates = [];
  const failedAttempts = await env.DB.prepare(
    `SELECT u.id AS usage_event_id, u.operation_key, u.units, u.source_attempt_id,
            a.status AS source_status, a.provider_status AS source_provider_status
       FROM platform_budget_usage_events u
       INNER JOIN admin_ai_usage_attempts a ON a.id = u.source_attempt_id
      WHERE u.budget_scope = ?
        AND u.status = 'recorded'
        AND (a.status <> 'succeeded' OR a.provider_status <> 'succeeded')
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of failedAttempts?.results || []) {
    candidates.push(makeCandidate({
      issueType: "failed_attempt_counted",
      budgetScope,
      operationKey: row.operation_key,
      sourceAttemptId: row.source_attempt_id,
      usageEventIds: [row.usage_event_id],
      proposedUnits: row.units,
      reason: "Platform budget usage event is linked to an admin AI attempt that is not succeeded.",
      evidence: {
        attemptStatus: row.source_status,
        providerStatus: row.source_provider_status,
        units: row.units,
      },
    }));
  }

  const failedJobs = await env.DB.prepare(
    `SELECT u.id AS usage_event_id, u.operation_key, u.units, u.source_job_id,
            j.status AS source_status, j.error_code AS source_error_code
       FROM platform_budget_usage_events u
       INNER JOIN ai_video_jobs j ON j.id = u.source_job_id
      WHERE u.budget_scope = ?
        AND u.status = 'recorded'
        AND j.status <> 'succeeded'
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of failedJobs?.results || []) {
    candidates.push(makeCandidate({
      issueType: "failed_job_counted",
      budgetScope,
      operationKey: row.operation_key || "admin.video.job.create",
      sourceJobId: row.source_job_id,
      usageEventIds: [row.usage_event_id],
      proposedUnits: row.units,
      reason: "Platform budget usage event is linked to an admin video job that is not succeeded.",
      evidence: {
        jobStatus: row.source_status,
        errorCode: row.source_error_code,
        units: row.units,
      },
    }));
  }
  return candidates;
}

async function queryOrphanUsageEvents(env, { budgetScope, limit }) {
  const candidates = [];
  const orphanAttempts = await env.DB.prepare(
    `SELECT u.id, u.operation_key, u.units, u.source_attempt_id, u.created_at
       FROM platform_budget_usage_events u
       LEFT JOIN admin_ai_usage_attempts a ON a.id = u.source_attempt_id
      WHERE u.budget_scope = ?
        AND u.status = 'recorded'
        AND u.source_attempt_id IS NOT NULL
        AND a.id IS NULL
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of orphanAttempts?.results || []) {
    candidates.push(makeCandidate({
      issueType: "orphan_attempt_usage_event",
      budgetScope,
      operationKey: row.operation_key,
      sourceAttemptId: row.source_attempt_id,
      usageEventIds: [row.id],
      proposedUnits: row.units,
      reason: "Platform budget usage event references a missing admin AI attempt.",
      evidence: { createdAt: row.created_at, units: row.units },
    }));
  }

  const orphanJobs = await env.DB.prepare(
    `SELECT u.id, u.operation_key, u.units, u.source_job_id, u.created_at
       FROM platform_budget_usage_events u
       LEFT JOIN ai_video_jobs j ON j.id = u.source_job_id
      WHERE u.budget_scope = ?
        AND u.status = 'recorded'
        AND u.source_job_id IS NOT NULL
        AND j.id IS NULL
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of orphanJobs?.results || []) {
    candidates.push(makeCandidate({
      issueType: "orphan_job_usage_event",
      budgetScope,
      operationKey: row.operation_key || "admin.video.job.create",
      sourceJobId: row.source_job_id,
      usageEventIds: [row.id],
      proposedUnits: row.units,
      reason: "Platform budget usage event references a missing admin video job.",
      evidence: { createdAt: row.created_at, units: row.units },
    }));
  }

  const noSource = await env.DB.prepare(
    `SELECT id, operation_key, units, created_at
       FROM platform_budget_usage_events
      WHERE budget_scope = ?
        AND status = 'recorded'
        AND source_attempt_id IS NULL
        AND source_job_id IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of noSource?.results || []) {
    candidates.push(makeCandidate({
      issueType: "usage_event_without_source",
      budgetScope,
      operationKey: row.operation_key,
      usageEventIds: [row.id],
      proposedUnits: row.units,
      reason: "Platform budget usage event has no source attempt or source job id.",
      evidence: { createdAt: row.created_at, units: row.units },
    }));
  }
  return candidates;
}

async function queryWindowAndUnitIssues(env, { budgetScope, limit }) {
  const candidates = [];
  const windowMismatches = await env.DB.prepare(
    `SELECT id, operation_key, units, window_day, window_month, created_at
       FROM platform_budget_usage_events
      WHERE budget_scope = ?
        AND status = 'recorded'
        AND (substr(created_at, 1, 10) <> window_day OR substr(created_at, 1, 7) <> window_month)
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of windowMismatches?.results || []) {
    candidates.push(makeCandidate({
      issueType: "window_mismatch",
      budgetScope,
      operationKey: row.operation_key,
      usageEventIds: [row.id],
      proposedUnits: row.units,
      reason: "Platform budget usage event window fields do not match created_at.",
      evidence: {
        createdAt: row.created_at,
        windowDay: row.window_day,
        windowMonth: row.window_month,
      },
    }));
  }

  const invalidUnits = await env.DB.prepare(
    `SELECT id, operation_key, units, window_day, window_month, created_at
       FROM platform_budget_usage_events
      WHERE budget_scope = ?
        AND status = 'recorded'
        AND (units IS NULL OR units <= 0)
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(budgetScope, limit).all();
  for (const row of invalidUnits?.results || []) {
    candidates.push(makeCandidate({
      issueType: "invalid_usage_units",
      budgetScope,
      operationKey: row.operation_key,
      usageEventIds: [row.id],
      reason: "Platform budget usage event has missing or invalid units.",
      evidence: {
        units: row.units,
        createdAt: row.created_at,
        windowDay: row.window_day,
        windowMonth: row.window_month,
      },
    }));
  }
  return candidates;
}

function capTotalIssuesFromUsageSummary(usageSummary, { budgetScope }) {
  const candidates = [];
  for (const window of usageSummary?.windows || []) {
    const limit = window.limit || null;
    if (!limit || Number(window.usedUnits || 0) <= Number(limit.limitUnits || 0)) continue;
    candidates.push(makeCandidate({
      issueType: "cap_total_exceeds_limit",
      budgetScope,
      operationKey: null,
      proposedUnits: Number(window.usedUnits || 0),
      reason: "Recorded platform budget usage exceeds the configured cap window.",
      evidence: {
        windowType: window.windowType,
        windowValue: window.windowValue,
        limitUnits: limit.limitUnits,
        usedUnits: window.usedUnits,
      },
    }));
  }
  return candidates;
}

async function runCheck(label, notCheckable, fn) {
  try {
    return await fn();
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    notCheckable.push(makeCandidate({
      issueType: "not_checkable",
      reason: `${label} not checkable because a required D1 table is unavailable.`,
      evidence: {
        check: label,
        unavailableCode: "missing_table",
      },
    }));
    return [];
  }
}

export async function reconcilePlatformAdminLabBudget(env, options = {}) {
  const budgetScope = normalizePlatformBudgetScope(options.budgetScope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE);
  const limit = boundedLimit(options.limit);
  assertDb(env);
  const notCheckable = [];
  const sections = {
    missingUsageEvents: [],
    duplicateUsageEvents: [],
    orphanUsageEvents: [],
    failedSourcesCounted: [],
    windowMismatches: [],
    invalidUsageUnits: [],
    capStatus: [],
    notCheckable,
  };

  sections.missingUsageEvents.push(
    ...await runCheck("successful_admin_ai_attempts_missing_usage", notCheckable, () =>
      querySuccessfulAttemptsMissingUsage(env, { budgetScope, limit })),
    ...await runCheck("successful_admin_video_jobs_missing_usage", notCheckable, () =>
      querySuccessfulVideoJobsMissingUsage(env, { budgetScope, limit }))
  );
  sections.duplicateUsageEvents.push(
    ...await runCheck("duplicate_platform_budget_usage_events", notCheckable, () =>
      queryDuplicateUsageEvents(env, { budgetScope, limit }))
  );
  sections.failedSourcesCounted.push(
    ...await runCheck("failed_sources_counted_as_usage", notCheckable, () =>
      queryInvalidSourceUsage(env, { budgetScope, limit }))
  );
  sections.orphanUsageEvents.push(
    ...await runCheck("orphan_platform_budget_usage_events", notCheckable, () =>
      queryOrphanUsageEvents(env, { budgetScope, limit }))
  );
  const windowAndUnitIssues = await runCheck("platform_budget_usage_window_and_units", notCheckable, () =>
    queryWindowAndUnitIssues(env, { budgetScope, limit }));
  sections.windowMismatches.push(...windowAndUnitIssues.filter((item) => item.issueType === "window_mismatch"));
  sections.invalidUsageUnits.push(...windowAndUnitIssues.filter((item) => item.issueType === "invalid_usage_units"));

  let usageSummary = null;
  try {
    usageSummary = await getPlatformBudgetUsageSummary(env, { budgetScope, recentLimit: Math.min(limit, 20), now: options.now || nowIso() });
    sections.capStatus.push(...capTotalIssuesFromUsageSummary(usageSummary, { budgetScope }));
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    notCheckable.push(makeCandidate({
      issueType: "not_checkable",
      budgetScope,
      reason: "Cap status not checkable because platform budget cap tables are unavailable.",
      evidence: { check: "cap_status", unavailableCode: "missing_table" },
    }));
  }

  const repairCandidates = [
    ...sections.missingUsageEvents,
    ...sections.duplicateUsageEvents,
    ...sections.orphanUsageEvents,
    ...sections.failedSourcesCounted,
    ...sections.windowMismatches,
    ...sections.invalidUsageUnits,
    ...sections.capStatus,
    ...sections.notCheckable,
  ];
  const summary = summarizeCandidates(repairCandidates);
  return Object.freeze({
    budgetScope,
    appliedLimit: limit,
    usageSummary,
    sections,
    repairCandidates,
    summary,
  });
}

export async function buildPlatformBudgetReconciliationReport(env, options = {}) {
  const generatedAt = options.generatedAt || nowIso();
  const budgetScope = normalizePlatformBudgetScope(options.budgetScope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE);
  const includeCandidates = options.includeCandidates !== false;
  try {
    const reconciliation = await reconcilePlatformAdminLabBudget(env, {
      ...options,
      budgetScope,
      now: generatedAt,
    });
    const criticalIssueCount = reconciliation.summary.bySeverity.critical || 0;
    const warningIssueCount = reconciliation.summary.bySeverity.warning || 0;
    const repairCandidateCount = reconciliation.repairCandidates.length;
    return Object.freeze({
      ok: true,
      version: PLATFORM_BUDGET_RECONCILIATION_VERSION,
      generatedAt,
      source: PLATFORM_BUDGET_RECONCILIATION_SOURCE,
      budgetScope,
      verdict: criticalIssueCount > 0
        ? "blocked"
        : warningIssueCount > 0
          ? "needs_operator_review"
          : "no_mismatches_detected",
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      runtimeMutation: false,
      repairApplied: false,
      providerCalls: false,
      stripeCalls: false,
      summary: {
        issueCount: repairCandidateCount,
        criticalIssueCount,
        warningIssueCount,
        repairCandidateCount,
        notCheckableCount: reconciliation.sections.notCheckable.length,
        missingUsageEventCount: reconciliation.sections.missingUsageEvents.length,
        duplicateUsageEventCount: reconciliation.sections.duplicateUsageEvents.length,
        orphanUsageEventCount: reconciliation.sections.orphanUsageEvents.length,
        failedSourceUsageCount: reconciliation.sections.failedSourcesCounted.length,
        windowMismatchCount: reconciliation.sections.windowMismatches.length,
        invalidUsageUnitCount: reconciliation.sections.invalidUsageUnits.length,
        capStatusIssueCount: reconciliation.sections.capStatus.length,
      },
      sections: reconciliation.sections,
      repairCandidates: includeCandidates ? reconciliation.repairCandidates : [],
      repairCandidatesOmitted: !includeCandidates,
      notes: [
        "Phase 4.18 reconciliation remains read-only and local-D1-only.",
        "Phase 4.19 adds an explicit admin-approved executor for create_missing_usage_event candidates only; review-only candidates do not mutate usage/source rows.",
        "This report itself applies no repair and mutates no platform_budget_usage_events, admin_ai_usage_attempts, ai_video_jobs, credits, queues, or billing rows.",
        "Production readiness and live billing readiness remain blocked until operator evidence is reviewed.",
      ],
      limitations: [
        "Checks are bounded and may not enumerate every historical row when more rows exist than the applied limit.",
        "Provider-cost failure semantics remain source-specific; failed sources counted as usage require operator review before any future repair.",
      ],
    });
  } catch (error) {
    if (error instanceof PlatformBudgetReconciliationError) throw error;
    if (!isMissingTableError(error)) throw error;
    return Object.freeze({
      ok: true,
      version: PLATFORM_BUDGET_RECONCILIATION_VERSION,
      generatedAt,
      source: PLATFORM_BUDGET_RECONCILIATION_SOURCE,
      budgetScope,
      verdict: "blocked",
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      runtimeMutation: false,
      repairApplied: false,
      providerCalls: false,
      stripeCalls: false,
      summary: {
        issueCount: 1,
        criticalIssueCount: 0,
        warningIssueCount: 1,
        repairCandidateCount: 1,
        notCheckableCount: 1,
        missingUsageEventCount: 0,
        duplicateUsageEventCount: 0,
        orphanUsageEventCount: 0,
        failedSourceUsageCount: 0,
        windowMismatchCount: 0,
        invalidUsageUnitCount: 0,
        capStatusIssueCount: 0,
      },
      sections: {
        missingUsageEvents: [],
        duplicateUsageEvents: [],
        orphanUsageEvents: [],
        failedSourcesCounted: [],
        windowMismatches: [],
        invalidUsageUnits: [],
        capStatus: [],
        notCheckable: [makeCandidate({
          issueType: "not_checkable",
          budgetScope,
          reason: "Reconciliation is unavailable because one or more D1 tables are missing.",
          evidence: { unavailableCode: "missing_table" },
        })],
      },
      repairCandidates: includeCandidates ? [makeCandidate({
        issueType: "not_checkable",
        budgetScope,
        reason: "Reconciliation is unavailable because one or more D1 tables are missing.",
        evidence: { unavailableCode: "missing_table" },
      })] : [],
      repairCandidatesOmitted: !includeCandidates,
      notes: [
        "Phase 4.18/4.19 reconciliation and repair planning failed safely as unavailable.",
      ],
      limitations: ["Required Phase 4.17 budget cap tables must exist before reconciliation can be complete."],
    });
  }
}

export async function listPlatformBudgetRepairCandidates(env, options = {}) {
  const report = await buildPlatformBudgetReconciliationReport(env, {
    ...options,
    includeCandidates: true,
  });
  return report.repairCandidates || [];
}
