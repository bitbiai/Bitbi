import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const ADMIN_AI_ATTEMPT_TTL_MINUTES = 24 * 60;
const MAX_JSON_LENGTH = 16 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 160;
const ACTIVE_STATUSES = new Set(["pending", "provider_running"]);

export class AdminAiIdempotencyError extends Error {
  constructor(message, { code = "admin_ai_idempotency_error", status = 400 } = {}) {
    super(message);
    this.name = "AdminAiIdempotencyError";
    this.code = code;
    this.status = status;
  }
}

function attemptId() {
  return `aaia_${randomTokenHex(16)}`;
}

function safeShortText(value, fallback = null, maxLength = MAX_ERROR_MESSAGE_LENGTH) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .replace(/(?:authorization|cookie|secret|token|password|api[_-]?key|stripe|private[_-]?key)[^,\s]*/ig, "[redacted]")
    .slice(0, maxLength);
}

function safeJson(value, { fallback = "{}" } = {}) {
  const text = JSON.stringify(value && typeof value === "object" ? value : {});
  if (text.length > MAX_JSON_LENGTH) {
    throw new AdminAiIdempotencyError("Admin AI idempotency metadata is too large.", {
      code: "admin_ai_idempotency_metadata_too_large",
      status: 413,
    });
  }
  return text || fallback;
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

function unavailableAttemptsError(error) {
  if (String(error || "").includes("no such table: admin_ai_usage_attempts")) {
    return new AdminAiIdempotencyError("Admin AI idempotency tracking is unavailable.", {
      code: "admin_ai_idempotency_unavailable",
      status: 503,
    });
  }
  return error;
}

function serializeAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    operationKey: row.operation_key,
    route: row.route,
    adminUserId: row.admin_user_id,
    idempotencyKeyHash: row.idempotency_key_hash,
    requestFingerprint: row.request_fingerprint,
    providerFamily: row.provider_family,
    modelKey: row.model_key || null,
    budgetScope: row.budget_scope,
    budgetPolicy: parseJsonObject(row.budget_policy_json),
    callerPolicy: parseJsonObject(row.caller_policy_json),
    status: row.status,
    providerStatus: row.provider_status,
    resultStatus: row.result_status,
    resultMetadata: parseJsonObject(row.result_metadata_json),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at,
    metadata: parseJsonObject(row.metadata_json),
  };
}

async function fetchAttemptByIdempotency(env, {
  adminUserId,
  operationKey,
  idempotencyKeyHash,
}) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, operation_key, route, admin_user_id, idempotency_key_hash,
              request_fingerprint, provider_family, model_key, budget_scope,
              budget_policy_json, caller_policy_json, status, provider_status,
              result_status, result_metadata_json, error_code, error_message,
              created_at, updated_at, completed_at, expires_at, metadata_json
       FROM admin_ai_usage_attempts
       WHERE admin_user_id = ?
         AND operation_key = ?
         AND idempotency_key_hash = ?
       LIMIT 1`
    ).bind(adminUserId, operationKey, idempotencyKeyHash).first();
    return serializeAttempt(row);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

async function fetchAttemptById(env, id) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, operation_key, route, admin_user_id, idempotency_key_hash,
              request_fingerprint, provider_family, model_key, budget_scope,
              budget_policy_json, caller_policy_json, status, provider_status,
              result_status, result_metadata_json, error_code, error_message,
              created_at, updated_at, completed_at, expires_at, metadata_json
       FROM admin_ai_usage_attempts
       WHERE id = ?
       LIMIT 1`
    ).bind(id).first();
    return serializeAttempt(row);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

function assertSameRequest(existing, requestFingerprint) {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new AdminAiIdempotencyError("Idempotency-Key conflicts with a different admin AI request.", {
      code: "idempotency_conflict",
      status: 409,
    });
  }
}

function classifyExistingAttempt(existing, now) {
  if (existing.status === "succeeded") return "completed";
  if (existing.status === "provider_failed" || existing.status === "terminal_failure") {
    return "terminal_failure";
  }
  if (ACTIVE_STATUSES.has(existing.status)) {
    return Date.parse(existing.expiresAt || "") <= Date.parse(now || "") ? "expired" : "in_progress";
  }
  if (existing.status === "expired") return "expired";
  return "in_progress";
}

async function insertAttempt(env, attempt) {
  try {
    await env.DB.prepare(
      `INSERT INTO admin_ai_usage_attempts (
         id, operation_key, route, admin_user_id, idempotency_key_hash,
         request_fingerprint, provider_family, model_key, budget_scope,
         budget_policy_json, caller_policy_json, status, provider_status,
         result_status, result_metadata_json, error_code, error_message,
         created_at, updated_at, completed_at, expires_at, metadata_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'not_started',
               'none', '{}', NULL, NULL, ?, ?, NULL, ?, ?)`
    ).bind(
      attempt.id,
      attempt.operationKey,
      attempt.route,
      attempt.adminUserId,
      attempt.idempotencyKeyHash,
      attempt.requestFingerprint,
      attempt.providerFamily,
      attempt.modelKey,
      attempt.budgetScope,
      safeJson(attempt.budgetPolicy),
      safeJson(attempt.callerPolicy),
      attempt.createdAt,
      attempt.updatedAt,
      attempt.expiresAt,
      safeJson(attempt.metadata)
    ).run();
    return true;
  } catch (error) {
    if (String(error || "").includes("UNIQUE")) return false;
    throw unavailableAttemptsError(error);
  }
}

export async function beginAdminAiIdempotencyAttempt({
  env,
  operationKey,
  route,
  adminUserId,
  idempotencyKey,
  requestFingerprint,
  providerFamily = "ai_worker",
  modelKey = null,
  budgetScope,
  budgetPolicy = {},
  callerPolicy = {},
  metadata = {},
}) {
  const normalizedOperation = safeShortText(operationKey, null, 120);
  const normalizedAdminUserId = safeShortText(adminUserId, null, 120);
  const normalizedRoute = safeShortText(route, null, 256);
  if (!normalizedOperation || !normalizedAdminUserId || !normalizedRoute || !requestFingerprint) {
    throw new AdminAiIdempotencyError("Admin AI idempotency attempt is invalid.", {
      code: "admin_ai_idempotency_invalid",
      status: 503,
    });
  }

  const idempotencyKeyHash = await sha256Hex(idempotencyKey);
  const now = nowIso();
  const existing = await fetchAttemptByIdempotency(env, {
    adminUserId: normalizedAdminUserId,
    operationKey: normalizedOperation,
    idempotencyKeyHash,
  });
  if (existing) {
    assertSameRequest(existing, requestFingerprint);
    return {
      kind: classifyExistingAttempt(existing, now),
      attempt: existing,
      reused: true,
    };
  }

  const attempt = {
    id: attemptId(),
    operationKey: normalizedOperation,
    route: normalizedRoute,
    adminUserId: normalizedAdminUserId,
    idempotencyKeyHash,
    requestFingerprint,
    providerFamily: safeShortText(providerFamily, "ai_worker", 80),
    modelKey: safeShortText(modelKey, null, 160),
    budgetScope: safeShortText(budgetScope, null, 80),
    budgetPolicy,
    callerPolicy,
    metadata,
    createdAt: now,
    updatedAt: now,
    expiresAt: addMinutesIso(ADMIN_AI_ATTEMPT_TTL_MINUTES),
  };

  const inserted = await insertAttempt(env, attempt);
  const created = await fetchAttemptByIdempotency(env, {
    adminUserId: attempt.adminUserId,
    operationKey: attempt.operationKey,
    idempotencyKeyHash,
  });
  if (!inserted && created) {
    assertSameRequest(created, requestFingerprint);
    return {
      kind: classifyExistingAttempt(created, now),
      attempt: created,
      reused: true,
    };
  }
  if (!created) {
    throw new AdminAiIdempotencyError("Admin AI idempotency attempt could not be created.", {
      code: "admin_ai_idempotency_create_failed",
      status: 503,
    });
  }
  return { kind: "created", attempt: created, reused: false };
}

export async function markAdminAiIdempotencyProviderRunning(env, attemptIdValue) {
  try {
    const result = await env.DB.prepare(
      `UPDATE admin_ai_usage_attempts
       SET status = 'provider_running',
           provider_status = 'running',
           updated_at = ?
       WHERE id = ?
         AND status = 'pending'
         AND provider_status = 'not_started'`
    ).bind(nowIso(), attemptIdValue).run();
    if (!result?.meta?.changes) {
      throw new AdminAiIdempotencyError("Admin AI idempotency attempt is already active.", {
        code: "admin_ai_idempotency_attempt_active",
        status: 409,
      });
    }
    return fetchAttemptById(env, attemptIdValue);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function markAdminAiIdempotencyProviderFailed(env, attemptIdValue, {
  code = "provider_failed",
  message = null,
} = {}) {
  const now = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE admin_ai_usage_attempts
       SET status = 'provider_failed',
           provider_status = 'failed',
           result_status = 'none',
           error_code = ?,
           error_message = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`
    ).bind(
      safeShortText(code, "provider_failed", 80),
      safeShortText(message, "Admin AI provider call failed."),
      now,
      now,
      attemptIdValue
    ).run();
    return fetchAttemptById(env, attemptIdValue);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function markAdminAiIdempotencySucceeded(env, attemptIdValue, {
  resultMetadata = {},
  metadata = {},
} = {}) {
  const now = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE admin_ai_usage_attempts
       SET status = 'succeeded',
           provider_status = 'succeeded',
           result_status = 'metadata_only',
           result_metadata_json = ?,
           metadata_json = ?,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`
    ).bind(
      safeJson(resultMetadata),
      safeJson(metadata),
      now,
      now,
      attemptIdValue
    ).run();
    return fetchAttemptById(env, attemptIdValue);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}
