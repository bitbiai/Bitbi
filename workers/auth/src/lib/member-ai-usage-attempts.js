import { BillingError } from "./billing.js";
import { nowIso, randomTokenHex } from "./tokens.js";

const ATTEMPT_TTL_MINUTES = 30;
const MAX_CREDIT_COST = 100_000;
const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "provider_running", "finalizing"]);

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function attemptId() {
  return `maua_${randomTokenHex(16)}`;
}

function normalizeShortText(value, fallback = null, max = 240) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

function normalizeUserId(value) {
  const userId = String(value || "").trim();
  if (!userId || userId.length > 128) {
    throw new BillingError("User not found.", {
      status: 404,
      code: "user_not_found",
    });
  }
  return userId;
}

function normalizePositiveInteger(value, { fieldName, max = MAX_CREDIT_COST } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > max) {
    throw new BillingError(`${fieldName || "value"} must be a positive integer.`, {
      status: 400,
      code: "invalid_credit_amount",
    });
  }
  return number;
}

function normalizeMetadataJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "{}";
  try {
    return JSON.stringify(value).slice(0, 4096);
  } catch {
    return "{}";
  }
}

function unavailableAttemptsError(error) {
  if (String(error || "").includes("no such table: member_ai_usage_attempts")) {
    return new BillingError("Member AI usage attempt tracking is unavailable.", {
      status: 503,
      code: "member_ai_usage_attempts_unavailable",
    });
  }
  return error;
}

function serializeAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    featureKey: row.feature_key,
    operationKey: row.operation_key,
    route: row.route,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    creditCost: Number(row.credit_cost || 0),
    quantity: Number(row.quantity || 1),
    status: row.status,
    providerStatus: row.provider_status,
    billingStatus: row.billing_status,
    resultStatus: row.result_status,
    resultTempKey: row.result_temp_key || null,
    resultSaveReference: row.result_save_reference || null,
    resultMimeType: row.result_mime_type || null,
    resultModel: row.result_model || null,
    resultPromptLength: row.result_prompt_length == null ? null : Number(row.result_prompt_length),
    resultSteps: row.result_steps == null ? null : Number(row.result_steps),
    resultSeed: row.result_seed == null ? null : Number(row.result_seed),
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at,
  };
}

async function fetchAttemptByIdempotency(env, { userId, idempotencyKey }) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, feature_key, operation_key, route,
              idempotency_key, request_fingerprint, credit_cost, quantity,
              status, provider_status, billing_status, result_status,
              result_temp_key, result_save_reference, result_mime_type,
              result_model, result_prompt_length, result_steps, result_seed,
              balance_after, error_code, error_message, created_at, updated_at,
              completed_at, expires_at
       FROM member_ai_usage_attempts
       WHERE user_id = ? AND idempotency_key = ?
       LIMIT 1`
    ).bind(userId, idempotencyKey).first();
    return serializeAttempt(row);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

async function fetchAttemptById(env, attemptIdValue) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, feature_key, operation_key, route,
              idempotency_key, request_fingerprint, credit_cost, quantity,
              status, provider_status, billing_status, result_status,
              result_temp_key, result_save_reference, result_mime_type,
              result_model, result_prompt_length, result_steps, result_seed,
              balance_after, error_code, error_message, created_at, updated_at,
              completed_at, expires_at
       FROM member_ai_usage_attempts
       WHERE id = ?
       LIMIT 1`
    ).bind(attemptIdValue).first();
    return serializeAttempt(row);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

function assertSameRequest(existing, requestFingerprint) {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new BillingError("Idempotency-Key conflicts with a different usage request.", {
      status: 409,
      code: "idempotency_conflict",
    });
  }
}

function classifyExistingAttempt(existing, now) {
  if (existing.status === "succeeded" && existing.billingStatus === "finalized") {
    return Date.parse(existing.expiresAt) <= Date.parse(now)
      ? "completed_expired"
      : "completed";
  }
  if (existing.status === "billing_failed" || existing.billingStatus === "failed") {
    return "billing_failed";
  }
  if (existing.status === "provider_failed" && existing.billingStatus === "released") {
    return "retryable";
  }
  if (existing.status === "expired" && existing.billingStatus === "released") {
    return "retryable";
  }
  if (ACTIVE_RESERVATION_STATUSES.has(existing.status) || existing.billingStatus === "reserved") {
    return Date.parse(existing.expiresAt) <= Date.parse(now)
      ? "retryable"
      : "in_progress";
  }
  return "in_progress";
}

async function reserveExistingAttempt(env, { attempt, now, expiresAt }) {
  try {
    const result = await env.DB.prepare(
      `UPDATE member_ai_usage_attempts
       SET status = 'reserved',
           provider_status = 'not_started',
           billing_status = 'reserved',
           result_status = 'none',
           result_temp_key = NULL,
           result_save_reference = NULL,
           result_mime_type = NULL,
           result_model = NULL,
           result_prompt_length = NULL,
           result_steps = NULL,
           result_seed = NULL,
           balance_after = NULL,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?,
           completed_at = NULL,
           expires_at = ?
       WHERE id = ?
         AND request_fingerprint = ?
         AND (
           COALESCE((
             SELECT balance_after FROM member_credit_ledger
             WHERE user_id = ?
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1
           ), 0)
           - COALESCE((
             SELECT SUM(credit_cost) FROM member_ai_usage_attempts
             WHERE user_id = ?
               AND billing_status = 'reserved'
               AND status IN ('reserved', 'provider_running', 'finalizing')
               AND expires_at > ?
               AND id <> ?
           ), 0)
         ) >= ?`
    ).bind(
      now,
      expiresAt,
      attempt.id,
      attempt.requestFingerprint,
      attempt.userId,
      attempt.userId,
      now,
      attempt.id,
      attempt.creditCost
    ).run();
    if (!result?.meta?.changes) {
      throw new BillingError("Insufficient member credits.", {
        status: 402,
        code: "insufficient_member_credits",
      });
    }
    return fetchAttemptByIdempotency(env, {
      userId: attempt.userId,
      idempotencyKey: attempt.idempotencyKey,
    });
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

async function insertReservedAttempt(env, attempt) {
  try {
    const result = await env.DB.prepare(
      `INSERT INTO member_ai_usage_attempts (
         id, user_id, feature_key, operation_key, route,
         idempotency_key, request_fingerprint, credit_cost, quantity,
         status, provider_status, billing_status, result_status,
         created_at, updated_at, expires_at, metadata_json
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'reserved', 'not_started', 'reserved', 'none',
              ?, ?, ?, ?
       WHERE (
         COALESCE((
           SELECT balance_after FROM member_credit_ledger
           WHERE user_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1
         ), 0)
         - COALESCE((
           SELECT SUM(credit_cost) FROM member_ai_usage_attempts
           WHERE user_id = ?
             AND billing_status = 'reserved'
             AND status IN ('reserved', 'provider_running', 'finalizing')
             AND expires_at > ?
         ), 0)
       ) >= ?`
    ).bind(
      attempt.id,
      attempt.userId,
      attempt.featureKey,
      attempt.operationKey,
      attempt.route,
      attempt.idempotencyKey,
      attempt.requestFingerprint,
      attempt.creditCost,
      attempt.quantity,
      attempt.createdAt,
      attempt.updatedAt,
      attempt.expiresAt,
      normalizeMetadataJson(attempt.metadata),
      attempt.userId,
      attempt.userId,
      attempt.createdAt,
      attempt.creditCost
    ).run();
    return result?.meta?.changes > 0;
  } catch (error) {
    if (String(error).includes("UNIQUE")) return false;
    throw unavailableAttemptsError(error);
  }
}

export async function beginMemberAiUsageAttempt({
  env,
  userId,
  featureKey,
  operationKey,
  route,
  idempotencyKey,
  requestFingerprint,
  creditCost,
  quantity = 1,
  metadata = {},
  beforeReserve = null,
}) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedCredits = normalizePositiveInteger(creditCost, { fieldName: "creditCost" });
  const normalizedQuantity = normalizePositiveInteger(quantity, { fieldName: "quantity" });
  const now = nowIso();
  const expiresAt = addMinutesIso(ATTEMPT_TTL_MINUTES);
  const existing = await fetchAttemptByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKey,
  });

  if (existing) {
    assertSameRequest(existing, requestFingerprint);
    const kind = classifyExistingAttempt(existing, now);
    if (kind === "retryable") {
      const preparation = typeof beforeReserve === "function" ? await beforeReserve() : null;
      const retryAttempt = await reserveExistingAttempt(env, { attempt: existing, now, expiresAt });
      return { kind: "reserved", attempt: retryAttempt, reused: true, preparation };
    }
    return { kind, attempt: existing, reused: true, preparation: null };
  }

  const preparation = typeof beforeReserve === "function" ? await beforeReserve() : null;
  const attempt = {
    id: attemptId(),
    userId: normalizedUserId,
    featureKey,
    operationKey,
    route,
    idempotencyKey,
    requestFingerprint,
    creditCost: normalizedCredits,
    quantity: normalizedQuantity,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    metadata,
  };
  const inserted = await insertReservedAttempt(env, attempt);
  if (!inserted) {
    const raced = await fetchAttemptByIdempotency(env, {
      userId: normalizedUserId,
      idempotencyKey,
    });
    if (raced) {
      assertSameRequest(raced, requestFingerprint);
      return { kind: classifyExistingAttempt(raced, now), attempt: raced, reused: true, preparation };
    }
    throw new BillingError("Insufficient member credits.", {
      status: 402,
      code: "insufficient_member_credits",
    });
  }
  const created = await fetchAttemptByIdempotency(env, {
    userId: normalizedUserId,
    idempotencyKey,
  });
  return { kind: "reserved", attempt: created, reused: false, preparation };
}

export async function markMemberAiUsageAttemptProviderRunning(env, attemptIdValue) {
  try {
    await env.DB.prepare(
      `UPDATE member_ai_usage_attempts
       SET status = 'provider_running',
           provider_status = 'running',
           updated_at = ?
       WHERE id = ?
         AND status = 'reserved'
         AND billing_status = 'reserved'`
    ).bind(nowIso(), attemptIdValue).run();
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function markMemberAiUsageAttemptProviderFailed(env, attemptIdValue, { code = "provider_failed", message = null } = {}) {
  const now = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE member_ai_usage_attempts
       SET status = 'provider_failed',
           provider_status = 'failed',
           billing_status = 'released',
           result_status = 'none',
           error_code = ?,
           error_message = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND billing_status = 'reserved'`
    ).bind(
      normalizeShortText(code, "provider_failed"),
      normalizeShortText(message),
      now,
      now,
      attemptIdValue
    ).run();
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function markMemberAiUsageAttemptFinalizing(env, attemptIdValue) {
  try {
    await env.DB.prepare(
      `UPDATE member_ai_usage_attempts
       SET status = 'finalizing',
           provider_status = 'succeeded',
           updated_at = ?
       WHERE id = ?
         AND billing_status = 'reserved'`
    ).bind(nowIso(), attemptIdValue).run();
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function markMemberAiUsageAttemptBillingFailed(env, attemptIdValue, { code = "billing_failed", message = null } = {}) {
  const now = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE member_ai_usage_attempts
       SET status = 'billing_failed',
           provider_status = 'succeeded',
           billing_status = 'failed',
           result_status = 'none',
           error_code = ?,
           error_message = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND billing_status = 'reserved'`
    ).bind(
      normalizeShortText(code, "billing_failed"),
      normalizeShortText(message),
      now,
      now,
      attemptIdValue
    ).run();
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function markMemberAiUsageAttemptSucceeded(env, attemptIdValue, {
  tempKey = null,
  saveReference = null,
  mimeType = null,
  model = null,
  promptLength = null,
  steps = null,
  seed = null,
  balanceAfter = null,
  metadata = null,
  resultStatus = null,
} = {}) {
  const now = nowIso();
  const resolvedResultStatus = resultStatus || (tempKey && saveReference ? "stored" : "unavailable");
  try {
    await env.DB.prepare(
      `UPDATE member_ai_usage_attempts
       SET status = 'succeeded',
           provider_status = 'succeeded',
           billing_status = 'finalized',
           result_status = ?,
           result_temp_key = ?,
           result_save_reference = ?,
           result_mime_type = ?,
           result_model = ?,
           result_prompt_length = ?,
           result_steps = ?,
           result_seed = ?,
           balance_after = ?,
           metadata_json = ?,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND status IN ('finalizing', 'succeeded')`
    ).bind(
      resolvedResultStatus,
      tempKey,
      saveReference,
      mimeType,
      model,
      promptLength == null ? null : Number(promptLength),
      steps == null ? null : Number(steps),
      seed == null ? null : Number(seed),
      balanceAfter == null ? null : Number(balanceAfter),
      normalizeMetadataJson(metadata),
      now,
      now,
      attemptIdValue
    ).run();
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export function billingMetadataFromMemberAttempt(attempt, { replay = false } = {}) {
  return {
    user_id: attempt.userId,
    feature: attempt.featureKey,
    credits_charged: attempt.creditCost,
    balance_after: attempt.balanceAfter,
    idempotent_replay: Boolean(replay),
  };
}

export async function refreshMemberAiUsageAttempt(env, attemptIdValue) {
  return fetchAttemptById(env, attemptIdValue);
}
