import {
  PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  PLATFORM_BUDGET_USAGE_EVENTS_TABLE,
  getPlatformBudgetWindows,
  normalizePlatformBudgetScope,
  normalizePlatformBudgetUnits,
  platformBudgetUnitsFromBudgetPolicy,
} from "./platform-budget-caps.js";
import { listPlatformBudgetRepairCandidates } from "./platform-budget-reconciliation.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE = "platform_budget_repair_actions";
export const PLATFORM_BUDGET_REPAIR_VERSION = "platform-budget-repair-v1";
export const PLATFORM_BUDGET_REPAIR_ENDPOINT = "/api/admin/ai/platform-budget-reconciliation/repair";
export const PLATFORM_BUDGET_REPAIR_ACTIONS_ENDPOINT = "/api/admin/ai/platform-budget-repair-actions";

const MAX_REASON_LENGTH = 500;
const MAX_LIST_LIMIT = 50;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,220}$/;
const ADMIN_ATTEMPT_OPERATION_ROUTE = Object.freeze({
  "admin.text.test": "/api/admin/ai/test-text",
  "admin.embeddings.test": "/api/admin/ai/test-embeddings",
  "admin.music.test": "/api/admin/ai/test-music",
  "admin.compare": "/api/admin/ai/compare",
  "admin.live_agent": "/api/admin/ai/live-agent",
});
const ADMIN_ATTEMPT_OPERATIONS = new Set(Object.keys(ADMIN_ATTEMPT_OPERATION_ROUTE));
const VIDEO_JOB_OPERATION = "admin.video.job.create";
const EXECUTABLE_ACTIONS = new Set(["create_missing_usage_event"]);
const REVIEW_ONLY_ACTIONS = new Set([
  "mark_duplicate_usage_event_review",
  "review_orphan_usage_event",
  "review_failed_source_usage",
  "fix_window_metadata",
  "add_missing_cost_metadata",
]);
const ALL_ACTIONS = new Set([...EXECUTABLE_ACTIONS, ...REVIEW_ONLY_ACTIONS]);

export class PlatformBudgetRepairError extends Error {
  constructor(message, { status = 400, code = "platform_budget_repair_error", fields = {} } = {}) {
    super(message);
    this.name = "PlatformBudgetRepairError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function safeText(value, maxLength = 180) {
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

function sanitizeReason(value) {
  return safeText(value, MAX_REASON_LENGTH) || "";
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
  for (const [key, raw] of Object.entries(value || {}).slice(0, 24)) {
    const safeKey = safeId(key, 80);
    if (!safeKey) continue;
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

function assertDb(env) {
  if (!env?.DB?.prepare) {
    throw new PlatformBudgetRepairError("Platform budget repair store is unavailable.", {
      status: 503,
      code: "platform_budget_repair_store_unavailable",
    });
  }
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return 25;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, numeric));
}

function missingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function repairError(message, code, fields = {}, status = 400) {
  return new PlatformBudgetRepairError(message, { status, code, fields });
}

export function normalizePlatformBudgetRepairRequest(input = {}) {
  const budgetScope = normalizePlatformBudgetScope(input.budgetScope || input.budget_scope || PLATFORM_ADMIN_LAB_BUDGET_SCOPE);
  const candidateId = safeId(input.candidateId || input.candidate_id, 220);
  const candidateType = safeId(input.candidateType || input.candidate_type, 120);
  const requestedAction = safeId(input.requestedAction || input.requested_action, 120);
  const dryRun = input.dryRun !== false && input.dry_run !== false;
  const confirm = input.confirm === true;
  const reason = sanitizeReason(input.reason);
  if (!candidateId) throw repairError("A valid repair candidate id is required.", "platform_budget_repair_candidate_required", { budgetScope });
  if (!candidateType) throw repairError("A valid repair candidate type is required.", "platform_budget_repair_candidate_type_required", { budgetScope, candidateId });
  if (!requestedAction || !ALL_ACTIONS.has(requestedAction)) {
    throw repairError("Unsupported platform budget repair action.", "platform_budget_repair_action_unsupported", {
      budgetScope,
      candidateId,
      requestedAction: requestedAction || null,
    });
  }
  if (!reason || reason.length < 6) {
    throw repairError("A bounded operator reason is required.", "platform_budget_repair_reason_required", { budgetScope, candidateId });
  }
  if (!dryRun && !confirm) {
    throw repairError("Repair execution requires explicit confirmation.", "platform_budget_repair_confirmation_required", {
      budgetScope,
      candidateId,
      requestedAction,
    });
  }
  return Object.freeze({
    budgetScope,
    candidateId,
    candidateType,
    requestedAction,
    dryRun,
    confirm,
    reason,
  });
}

export async function buildPlatformBudgetRepairRequestHash(request) {
  return sha256Hex(JSON.stringify({
    budgetScope: request.budgetScope,
    candidateId: request.candidateId,
    candidateType: request.candidateType,
    requestedAction: request.requestedAction,
    dryRun: request.dryRun,
    confirm: request.confirm,
    reason: request.reason,
  }));
}

function normalizeIdempotencyKey(value) {
  const key = safeId(value, 180);
  if (!key) {
    throw repairError("Idempotency-Key header is required.", "idempotency_key_required", {}, 428);
  }
  return key;
}

async function readExistingActionByIdempotency(env, idempotencyKey) {
  return env.DB.prepare(
    `SELECT id, budget_scope, candidate_id, candidate_type, requested_action, action_status, dry_run,
            idempotency_key, request_hash, requested_by_user_id, requested_by_email, reason,
            source_attempt_id, source_job_id, created_usage_event_id, evidence_json, result_json,
            error_code, error_message, created_at, updated_at
       FROM ${PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE}
      WHERE idempotency_key = ?
      LIMIT 1`
  ).bind(idempotencyKey).first();
}

async function readExistingActionById(env, id) {
  return env.DB.prepare(
    `SELECT id, budget_scope, candidate_id, candidate_type, requested_action, action_status, dry_run,
            idempotency_key, request_hash, requested_by_user_id, requested_by_email, reason,
            source_attempt_id, source_job_id, created_usage_event_id, evidence_json, result_json,
            error_code, error_message, created_at, updated_at
       FROM ${PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE}
      WHERE id = ?
      LIMIT 1`
  ).bind(id).first();
}

function serializeCandidate(candidate = null) {
  if (!candidate) return null;
  return Object.freeze({
    candidateId: candidate.candidateId || null,
    candidateType: candidate.issueType || null,
    severity: candidate.severity || null,
    budgetScope: candidate.budgetScope || null,
    operationKey: candidate.operationKey || null,
    sourceAttemptId: candidate.sourceAttemptId || null,
    sourceJobId: candidate.sourceJobId || null,
    usageEventIds: Array.isArray(candidate.usageEventIds) ? candidate.usageEventIds.slice(0, 20) : [],
    proposedAction: candidate.proposedAction || null,
    proposedUnits: candidate.proposedUnits ?? null,
    reason: candidate.reason || null,
  });
}

function serializeRepairAction(row = null, { replayed = false } = {}) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    budgetScope: row.budget_scope,
    candidateId: row.candidate_id,
    candidateType: row.candidate_type,
    requestedAction: row.requested_action,
    actionStatus: row.action_status,
    dryRun: Number(row.dry_run || 0) === 1,
    idempotencyKeyPresent: Boolean(row.idempotency_key),
    requestedByUserId: row.requested_by_user_id || null,
    requestedByEmail: row.requested_by_email || null,
    reason: row.reason || null,
    sourceAttemptId: row.source_attempt_id || null,
    sourceJobId: row.source_job_id || null,
    createdUsageEventId: row.created_usage_event_id || null,
    evidence: safeJson(parseJsonObject(row.evidence_json)),
    result: safeJson(parseJsonObject(row.result_json)),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replayed,
  });
}

export { serializeRepairAction as serializePlatformBudgetRepairAction };

async function findCandidate(env, request, { limit = 100 } = {}) {
  const candidates = await listPlatformBudgetRepairCandidates(env, {
    budgetScope: request.budgetScope,
    limit,
  });
  const candidate = candidates.find((item) =>
    item.candidateId === request.candidateId &&
    item.issueType === request.candidateType &&
    item.proposedAction === request.requestedAction
  );
  if (!candidate) {
    throw repairError("Repair candidate is stale or no longer valid.", "platform_budget_repair_candidate_stale", {
      budgetScope: request.budgetScope,
      candidateId: request.candidateId,
      candidateType: request.candidateType,
      requestedAction: request.requestedAction,
    }, 409);
  }
  return candidate;
}

async function readAttemptSource(env, sourceAttemptId) {
  return env.DB.prepare(
    `SELECT id, operation_key, route, admin_user_id, idempotency_key_hash, request_fingerprint,
            budget_scope, budget_policy_json, status, provider_status, result_status,
            created_at, updated_at, completed_at
       FROM admin_ai_usage_attempts
      WHERE id = ?
      LIMIT 1`
  ).bind(sourceAttemptId).first();
}

async function readVideoJobSource(env, sourceJobId) {
  return env.DB.prepare(
    `SELECT id, user_id, scope, status, provider, model, request_hash, idempotency_key,
            budget_policy_json, budget_policy_status, created_at, updated_at, completed_at
       FROM ai_video_jobs
      WHERE id = ?
      LIMIT 1`
  ).bind(sourceJobId).first();
}

async function readUsageByAttempt(env, sourceAttemptId) {
  return env.DB.prepare(
    `SELECT id, budget_scope, operation_key, units, source_attempt_id, source_job_id, status, created_at
       FROM ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE}
      WHERE source_attempt_id = ? AND status = 'recorded'
      LIMIT 1`
  ).bind(sourceAttemptId).first();
}

async function readUsageByJob(env, sourceJobId) {
  return env.DB.prepare(
    `SELECT id, budget_scope, operation_key, units, source_attempt_id, source_job_id, status, created_at
       FROM ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE}
      WHERE source_job_id = ? AND status = 'recorded'
      LIMIT 1`
  ).bind(sourceJobId).first();
}

function unitsFromSourcePolicy(row, candidate) {
  return normalizePlatformBudgetUnits(
    candidate?.proposedUnits ?? platformBudgetUnitsFromBudgetPolicy(parseJsonObject(row?.budget_policy_json)),
    { fallback: 1 }
  );
}

function sourceTimestamp(row) {
  return row?.completed_at || row?.updated_at || row?.created_at || nowIso();
}

function validateAttemptSource(row, candidate, request) {
  if (!row) {
    throw repairError("Source admin AI attempt is missing.", "platform_budget_repair_source_missing", {
      budgetScope: request.budgetScope,
      sourceAttemptId: candidate.sourceAttemptId || null,
    }, 409);
  }
  if (row.budget_scope !== request.budgetScope || !ADMIN_ATTEMPT_OPERATIONS.has(row.operation_key)) {
    throw repairError("Source admin AI attempt is outside the repair scope.", "platform_budget_repair_source_scope_invalid", {
      budgetScope: request.budgetScope,
      sourceAttemptId: row.id,
      operationKey: row.operation_key,
    }, 409);
  }
  if (row.status !== "succeeded" || row.provider_status !== "succeeded") {
    throw repairError("Source admin AI attempt is no longer successful.", "platform_budget_repair_source_not_successful", {
      budgetScope: request.budgetScope,
      sourceAttemptId: row.id,
      sourceStatus: row.status,
    }, 409);
  }
}

function validateVideoJobSource(row, request) {
  if (!row) {
    throw repairError("Source admin video job is missing.", "platform_budget_repair_source_missing", {
      budgetScope: request.budgetScope,
    }, 409);
  }
  if (row.scope !== "admin") {
    throw repairError("Source video job is outside the admin repair scope.", "platform_budget_repair_source_scope_invalid", {
      budgetScope: request.budgetScope,
      sourceJobId: row.id,
      scope: row.scope,
    }, 409);
  }
  if (row.status !== "succeeded") {
    throw repairError("Source admin video job is no longer successful.", "platform_budget_repair_source_not_successful", {
      budgetScope: request.budgetScope,
      sourceJobId: row.id,
      sourceStatus: row.status,
    }, 409);
  }
}

async function planCreateMissingUsageEvent(env, request, candidate) {
  if (!candidate || candidate.proposedAction !== "create_missing_usage_event") {
    throw repairError("Candidate is not executable in Phase 4.19.", "platform_budget_repair_action_unsupported", {
      budgetScope: request.budgetScope,
      candidateId: request.candidateId,
    }, 400);
  }

  if (candidate.sourceAttemptId) {
    const source = await readAttemptSource(env, candidate.sourceAttemptId);
    validateAttemptSource(source, candidate, request);
    const existingUsage = await readUsageByAttempt(env, source.id);
    if (existingUsage) {
      throw repairError("A platform budget usage event already exists for this attempt.", "platform_budget_repair_usage_already_exists", {
        budgetScope: request.budgetScope,
        candidateId: request.candidateId,
        sourceAttemptId: source.id,
        usageEventId: existingUsage.id,
      }, 409);
    }
    const timestamp = sourceTimestamp(source);
    const windows = getPlatformBudgetWindows(timestamp);
    return Object.freeze({
      sourceType: "admin_ai_usage_attempt",
      operationKey: source.operation_key,
      sourceRoute: source.route || ADMIN_ATTEMPT_OPERATION_ROUTE[source.operation_key] || null,
      actorUserId: source.admin_user_id || null,
      actorRole: "admin",
      units: unitsFromSourcePolicy(source, candidate),
      windowDay: windows.day,
      windowMonth: windows.month,
      idempotencyKeyHash: source.idempotency_key_hash || null,
      requestFingerprint: source.request_fingerprint || null,
      sourceAttemptId: source.id,
      sourceJobId: null,
      createdAt: timestamp,
      evidence: {
        sourceType: "admin_ai_usage_attempt",
        sourceAttemptId: source.id,
        operationKey: source.operation_key,
        sourceStatus: source.status,
        providerStatus: source.provider_status,
        resultStatus: source.result_status,
        completedAt: timestamp,
      },
    });
  }

  if (candidate.sourceJobId) {
    const source = await readVideoJobSource(env, candidate.sourceJobId);
    validateVideoJobSource(source, request);
    const existingUsage = await readUsageByJob(env, source.id);
    if (existingUsage) {
      throw repairError("A platform budget usage event already exists for this video job.", "platform_budget_repair_usage_already_exists", {
        budgetScope: request.budgetScope,
        candidateId: request.candidateId,
        sourceJobId: source.id,
        usageEventId: existingUsage.id,
      }, 409);
    }
    const timestamp = sourceTimestamp(source);
    const windows = getPlatformBudgetWindows(timestamp);
    return Object.freeze({
      sourceType: "ai_video_jobs",
      operationKey: VIDEO_JOB_OPERATION,
      sourceRoute: "/api/admin/ai/video-jobs",
      actorUserId: source.user_id || null,
      actorRole: "admin",
      units: unitsFromSourcePolicy(source, candidate),
      windowDay: windows.day,
      windowMonth: windows.month,
      idempotencyKeyHash: null,
      requestFingerprint: source.request_hash || null,
      sourceAttemptId: null,
      sourceJobId: source.id,
      createdAt: timestamp,
      evidence: {
        sourceType: "ai_video_jobs",
        sourceJobId: source.id,
        operationKey: VIDEO_JOB_OPERATION,
        jobStatus: source.status,
        provider: source.provider || null,
        model: source.model || null,
        completedAt: timestamp,
      },
    });
  }

  throw repairError("Missing usage event candidate does not identify a repairable source.", "platform_budget_repair_source_missing", {
    budgetScope: request.budgetScope,
    candidateId: request.candidateId,
  }, 409);
}

export async function planPlatformBudgetRepair(env, requestInput = {}) {
  assertDb(env);
  const request = normalizePlatformBudgetRepairRequest(requestInput);
  const candidate = await findCandidate(env, request);
  if (request.requestedAction === "create_missing_usage_event") {
    const proposed = await planCreateMissingUsageEvent(env, request, candidate);
    return Object.freeze({
      request,
      candidate: serializeCandidate(candidate),
      executable: true,
      reviewOnly: false,
      proposedUsageEvent: proposed,
      result: {
        actionStatus: "dry_run_planned",
        proposedAction: request.requestedAction,
        proposedUnits: proposed.units,
        sourceAttemptId: proposed.sourceAttemptId,
        sourceJobId: proposed.sourceJobId,
        windowDay: proposed.windowDay,
        windowMonth: proposed.windowMonth,
      },
    });
  }
  if (REVIEW_ONLY_ACTIONS.has(request.requestedAction)) {
    return Object.freeze({
      request,
      candidate: serializeCandidate(candidate),
      executable: false,
      reviewOnly: true,
      proposedUsageEvent: null,
      result: {
        actionStatus: "review_recorded",
        proposedAction: request.requestedAction,
        note: "Phase 4.19 records review evidence only for this candidate type.",
      },
    });
  }
  throw repairError("Unsupported platform budget repair action.", "platform_budget_repair_action_unsupported", {
    budgetScope: request.budgetScope,
    candidateId: request.candidateId,
    requestedAction: request.requestedAction,
  });
}

async function insertRepairAction(env, {
  id,
  request,
  idempotencyKey,
  requestHash,
  adminUser,
  status,
  evidence,
  result,
  createdUsageEventId = null,
  error = null,
  now,
}) {
  await env.DB.prepare(
    `INSERT INTO ${PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE} (
       id, budget_scope, candidate_id, candidate_type, requested_action, action_status, dry_run,
       idempotency_key, request_hash, requested_by_user_id, requested_by_email, reason,
       source_attempt_id, source_job_id, created_usage_event_id, evidence_json, result_json,
       error_code, error_message, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    request.budgetScope,
    request.candidateId,
    request.candidateType,
    request.requestedAction,
    status,
    idempotencyKey,
    requestHash,
    safeId(adminUser?.id, 180),
    safeText(adminUser?.email, 180),
    request.reason,
    safeId(evidence?.sourceAttemptId, 180),
    safeId(evidence?.sourceJobId, 180),
    createdUsageEventId,
    JSON.stringify(safeJson(evidence)),
    JSON.stringify(safeJson(result)),
    error?.code || null,
    error?.message ? safeText(error.message, 240) : null,
    now,
    now
  ).run();
}

async function updateRepairActionResult(env, { id, status, createdUsageEventId = null, result, error = null, now }) {
  await env.DB.prepare(
    `UPDATE ${PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE}
        SET action_status = ?, created_usage_event_id = COALESCE(?, created_usage_event_id),
            result_json = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE id = ?`
  ).bind(
    status,
    createdUsageEventId,
    JSON.stringify(safeJson(result)),
    error?.code || null,
    error?.message ? safeText(error.message, 240) : null,
    now,
    id
  ).run();
}

async function insertUsageEvent(env, request, proposed, actionId) {
  const usageEventId = `pbu_repair_${randomTokenHex(16)}`;
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE} (
       id, budget_scope, operation_key, source_route, actor_user_id, actor_role, units,
       window_day, window_month, idempotency_key_hash, request_fingerprint, source_attempt_id,
       source_job_id, status, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?)`
  ).bind(
    usageEventId,
    request.budgetScope,
    proposed.operationKey,
    proposed.sourceRoute,
    proposed.actorUserId,
    proposed.actorRole,
    proposed.units,
    proposed.windowDay,
    proposed.windowMonth,
    safeId(proposed.idempotencyKeyHash, 180),
    safeId(proposed.requestFingerprint, 180),
    safeId(proposed.sourceAttemptId, 180),
    safeId(proposed.sourceJobId, 180),
    JSON.stringify({
      phase: "4.19",
      source: "platform_budget_repair",
      repair_action_id: actionId,
      candidate_id: request.candidateId,
    }),
    proposed.createdAt
  ).run();
  const recorded = Number(result?.meta?.changes ?? 1) > 0;
  if (recorded) return { id: usageEventId, recorded };
  const existing = proposed.sourceAttemptId
    ? await readUsageByAttempt(env, proposed.sourceAttemptId)
    : await readUsageByJob(env, proposed.sourceJobId);
  return { id: existing?.id || null, recorded: false };
}

export async function executePlatformBudgetRepairDryRun(env, requestInput = {}) {
  const plan = await planPlatformBudgetRepair(env, requestInput);
  return Object.freeze({
    ok: true,
    dryRun: true,
    repairApplied: false,
    reviewRecorded: false,
    plan: {
      candidate: plan.candidate,
      executable: plan.executable,
      reviewOnly: plan.reviewOnly,
      proposedUsageEvent: plan.proposedUsageEvent ? {
        budgetScope: plan.request.budgetScope,
        operationKey: plan.proposedUsageEvent.operationKey,
        units: plan.proposedUsageEvent.units,
        windowDay: plan.proposedUsageEvent.windowDay,
        windowMonth: plan.proposedUsageEvent.windowMonth,
        sourceAttemptId: plan.proposedUsageEvent.sourceAttemptId,
        sourceJobId: plan.proposedUsageEvent.sourceJobId,
      } : null,
      result: plan.result,
    },
  });
}

export async function executePlatformBudgetRepair(env, {
  requestInput = {},
  idempotencyKey,
  adminUser = null,
  now = nowIso(),
} = {}) {
  assertDb(env);
  const request = normalizePlatformBudgetRepairRequest(requestInput);
  const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  if (request.dryRun) return executePlatformBudgetRepairDryRun(env, request);

  const requestHash = await buildPlatformBudgetRepairRequestHash(request);
  const existing = await readExistingActionByIdempotency(env, safeIdempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw repairError("Idempotency-Key was already used for a different platform budget repair request.", "idempotency_conflict", {
        budgetScope: request.budgetScope,
        candidateId: request.candidateId,
      }, 409);
    }
    return Object.freeze({
      ok: true,
      dryRun: false,
      repairApplied: existing.action_status === "applied",
      reviewRecorded: existing.action_status === "review_recorded",
      action: serializeRepairAction(existing, { replayed: true }),
    });
  }

  const plan = await planPlatformBudgetRepair(env, request);
  const actionId = `pbra_${randomTokenHex(16)}`;
  const baseEvidence = {
    version: PLATFORM_BUDGET_REPAIR_VERSION,
    candidateId: request.candidateId,
    candidateType: request.candidateType,
    requestedAction: request.requestedAction,
    operationKey: plan.candidate?.operationKey || null,
    sourceAttemptId: plan.proposedUsageEvent?.sourceAttemptId || plan.candidate?.sourceAttemptId || null,
    sourceJobId: plan.proposedUsageEvent?.sourceJobId || plan.candidate?.sourceJobId || null,
    proposedUnits: plan.proposedUsageEvent?.units ?? plan.candidate?.proposedUnits ?? null,
  };

  if (plan.reviewOnly) {
    await insertRepairAction(env, {
      id: actionId,
      request,
      idempotencyKey: safeIdempotencyKey,
      requestHash,
      adminUser,
      status: "review_recorded",
      evidence: baseEvidence,
      result: {
        actionStatus: "review_recorded",
        message: "Review-only platform budget repair evidence recorded. No usage/source rows were mutated.",
      },
      now,
    });
    const action = await readExistingActionById(env, actionId);
    return Object.freeze({
      ok: true,
      dryRun: false,
      repairApplied: false,
      reviewRecorded: true,
      action: serializeRepairAction(action),
    });
  }

  await insertRepairAction(env, {
    id: actionId,
    request,
    idempotencyKey: safeIdempotencyKey,
    requestHash,
    adminUser,
    status: "pending",
    evidence: baseEvidence,
    result: { actionStatus: "pending" },
    now,
  });

  try {
    const usage = await insertUsageEvent(env, request, plan.proposedUsageEvent, actionId);
    const status = usage.recorded ? "applied" : "no_op";
    const result = {
      actionStatus: status,
      createdUsageEventId: usage.id,
      usageEventRecorded: usage.recorded,
      units: plan.proposedUsageEvent.units,
      windowDay: plan.proposedUsageEvent.windowDay,
      windowMonth: plan.proposedUsageEvent.windowMonth,
      message: usage.recorded
        ? "Missing platform budget usage event was created from local D1 source evidence."
        : "A matching platform budget usage event already exists; no duplicate was created.",
    };
    await updateRepairActionResult(env, {
      id: actionId,
      status,
      createdUsageEventId: usage.id,
      result,
      now,
    });
    const action = await readExistingActionById(env, actionId);
    return Object.freeze({
      ok: true,
      dryRun: false,
      repairApplied: status === "applied",
      reviewRecorded: false,
      action: serializeRepairAction(action),
    });
  } catch (error) {
    await updateRepairActionResult(env, {
      id: actionId,
      status: "failed",
      result: {
        actionStatus: "failed",
        code: error?.code || "platform_budget_repair_failed",
      },
      error: {
        code: error?.code || "platform_budget_repair_failed",
        message: error?.message || "Platform budget repair failed.",
      },
      now,
    });
    if (error instanceof PlatformBudgetRepairError) throw error;
    if (missingTableError(error)) {
      throw repairError("Platform budget repair tables are unavailable.", "platform_budget_repair_store_unavailable", {
        budgetScope: request.budgetScope,
      }, 503);
    }
    throw error;
  }
}

export async function listPlatformBudgetRepairActions(env, {
  budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  limit = 25,
} = {}) {
  const scope = normalizePlatformBudgetScope(budgetScope);
  assertDb(env);
  const result = await env.DB.prepare(
    `SELECT id, budget_scope, candidate_id, candidate_type, requested_action, action_status, dry_run,
            idempotency_key, request_hash, requested_by_user_id, requested_by_email, reason,
            source_attempt_id, source_job_id, created_usage_event_id, evidence_json, result_json,
            error_code, error_message, created_at, updated_at
       FROM ${PLATFORM_BUDGET_REPAIR_ACTIONS_TABLE}
      WHERE budget_scope = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(scope, normalizeLimit(limit)).all();
  return (result?.results || []).map((row) => serializeRepairAction(row)).filter(Boolean);
}

export async function getPlatformBudgetRepairAction(env, id) {
  const safeActionId = safeId(id, 180);
  if (!safeActionId) {
    throw repairError("Invalid platform budget repair action id.", "platform_budget_repair_action_id_invalid", {}, 400);
  }
  assertDb(env);
  const row = await readExistingActionById(env, safeActionId);
  if (!row) {
    throw repairError("Platform budget repair action was not found.", "platform_budget_repair_action_not_found", {
      actionId: safeActionId,
    }, 404);
  }
  return serializeRepairAction(row);
}

export function platformBudgetRepairErrorResponse(error) {
  const fields = error?.fields || {};
  return {
    ok: false,
    error: error?.message || "Platform budget repair failed.",
    code: error?.code || "platform_budget_repair_error",
    budget_scope: fields.budgetScope || null,
    candidate_id: fields.candidateId || null,
    requested_action: fields.requestedAction || null,
  };
}
