import { BillingError } from "./billing.js";
import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { normalizeOrgId } from "./orgs.js";
import { AI_GENERATED_TEMP_OBJECT_PREFIX } from "../routes/ai/generated-image-save-reference.js";

const ATTEMPT_TTL_MINUTES = 30;
const MAX_ERROR_MESSAGE_LENGTH = 160;
const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "provider_running", "finalizing"]);
const DEFAULT_ATTEMPT_CLEANUP_LIMIT = 25;
const MAX_ATTEMPT_CLEANUP_LIMIT = 50;
const DEFAULT_ADMIN_ATTEMPT_LIMIT = 25;
const MAX_ADMIN_ATTEMPT_LIMIT = 100;
const ADMIN_ATTEMPT_LIST_TTL_MS = 60 * 60 * 1000;
const MAX_REPLAY_OBJECT_KEY_LENGTH = 512;
const MAX_METADATA_JSON_LENGTH = 16 * 1024;
const DISALLOWED_REPLAY_OBJECT_PREFIXES = [
  "users/",
  "data-exports/",
  "admin-audit-logs/",
  "user-activity-logs/",
  "avatars/",
  "video-jobs/",
  "cleanup/",
];
const ADMIN_VISIBLE_STATUSES = new Set([
  "reserved",
  "provider_running",
  "provider_failed",
  "finalizing",
  "billing_failed",
  "succeeded",
  "expired",
]);
const ADMIN_VISIBLE_FEATURES = new Set([
  "ai.image.generate",
  "ai.text.generate",
  "ai.video.generate",
]);

function attemptId() {
  return `aua_${randomTokenHex(16)}`;
}

function normalizePositiveInteger(value, { fieldName }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 100_000) {
    throw new BillingError(`${fieldName} must be a positive integer.`, {
      status: 400,
      code: "invalid_amount",
    });
  }
  return number;
}

function normalizeBoundedLimit(value, { defaultValue, maxValue }) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0) return defaultValue;
  return Math.max(1, Math.min(number, maxValue));
}

function normalizeOptionalShortFilter(value, { fieldName, maxLength = 128, pattern = null } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength || (pattern && !pattern.test(text))) {
    throw new BillingError(`Invalid ${fieldName}.`, {
      status: 400,
      code: "validation_error",
    });
  }
  return text;
}

function normalizeOptionalAttemptStatus(value) {
  const status = normalizeOptionalShortFilter(value, {
    fieldName: "status",
    maxLength: 40,
    pattern: /^[a-z_]+$/,
  });
  if (status && !ADMIN_VISIBLE_STATUSES.has(status)) {
    throw new BillingError("Invalid status.", {
      status: 400,
      code: "validation_error",
    });
  }
  return status;
}

function normalizeOptionalFeatureKey(value) {
  const featureKey = normalizeOptionalShortFilter(value, {
    fieldName: "feature",
    maxLength: 80,
    pattern: /^[a-z0-9_.-]+$/,
  });
  if (featureKey && !ADMIN_VISIBLE_FEATURES.has(featureKey)) {
    throw new BillingError("Invalid feature.", {
      status: 400,
      code: "validation_error",
    });
  }
  return featureKey;
}

function normalizeOptionalOrganizationId(value) {
  return normalizeOptionalShortFilter(value, {
    fieldName: "organization_id",
    maxLength: 128,
    pattern: /^org_[a-f0-9]{32}$/,
  });
}

function normalizeOptionalUserId(value) {
  return normalizeOptionalShortFilter(value, {
    fieldName: "user_id",
    maxLength: 128,
    pattern: /^[A-Za-z0-9_.:@-]+$/,
  });
}

function normalizeShortText(value, fallback = null) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function normalizeMetadataJson(value = null) {
  let text = "{}";
  if (value && typeof value === "object") {
    text = JSON.stringify(value);
  } else if (typeof value === "string" && value.trim()) {
    text = value.trim();
  }
  if (text.length > MAX_METADATA_JSON_LENGTH) {
    throw new BillingError("AI usage replay metadata is too large.", {
      status: 413,
      code: "ai_usage_metadata_too_large",
    });
  }
  return text;
}

function hasUnsafeObjectKeyCharacters(key) {
  return (
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.includes("//") ||
    key.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(key)
  );
}

function validateReplayTempObjectKey(row) {
  const key = typeof row?.result_temp_key === "string" ? row.result_temp_key : "";
  if (!key || key.length > MAX_REPLAY_OBJECT_KEY_LENGTH) {
    return { ok: false, code: "missing_or_oversized_key" };
  }
  if (DISALLOWED_REPLAY_OBJECT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return { ok: false, code: "disallowed_prefix" };
  }
  if (!key.startsWith(AI_GENERATED_TEMP_OBJECT_PREFIX)) {
    return { ok: false, code: "unapproved_prefix" };
  }
  if (hasUnsafeObjectKeyCharacters(key)) {
    return { ok: false, code: "unsafe_key" };
  }

  const suffix = key.slice(AI_GENERATED_TEMP_OBJECT_PREFIX.length);
  const parts = suffix.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: "invalid_key_shape" };
  }
  if (parts[0] !== String(row?.user_id || "")) {
    return { ok: false, code: "user_mismatch" };
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(parts[1])) {
    return { ok: false, code: "invalid_temp_id" };
  }

  return { ok: true, key };
}

async function getReplayObjectMetadata(env, key) {
  const bucket = env?.USER_IMAGES;
  if (!bucket || typeof bucket.delete !== "function") {
    throw new Error("AI replay object storage is unavailable.");
  }
  if (typeof bucket.head === "function") {
    return bucket.head(key);
  }
  if (typeof bucket.get === "function") {
    return bucket.get(key);
  }
  throw new Error("AI replay object storage lookup is unavailable.");
}

function serializeAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id || null,
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

function publicReplayState(row, now = nowIso()) {
  const resultStatus = row.result_status || "none";
  return {
    status: resultStatus,
    available: resultStatus === "stored" && Date.parse(row.expires_at || "") > Date.parse(now),
    expiresAt: row.expires_at || null,
  };
}

function serializeAdminAttempt(row, { detail = false, now = nowIso() } = {}) {
  if (!row) return null;
  const out = {
    attemptId: row.id,
    organizationId: row.organization_id,
    userId: row.user_id || null,
    feature: row.feature_key,
    operation: row.operation_key,
    route: row.route,
    status: row.status,
    providerStatus: row.provider_status,
    billingStatus: row.billing_status,
    creditCost: Number(row.credit_cost || 0),
    quantity: Number(row.quantity || 1),
    replay: publicReplayState(row, now),
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    error: row.error_code ? { code: row.error_code } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at,
  };
  if (detail) {
    out.result = {
      status: row.result_status || "none",
      mimeType: row.result_mime_type || null,
      model: row.result_model || null,
      promptLength: row.result_prompt_length == null ? null : Number(row.result_prompt_length),
      steps: row.result_steps == null ? null : Number(row.result_steps),
      seed: row.result_seed == null ? null : Number(row.result_seed),
    };
  }
  return out;
}

function unavailableAttemptsError(error) {
  if (String(error || "").includes("no such table: ai_usage_attempts")) {
    return new BillingError("AI usage attempt tracking is unavailable.", {
      status: 503,
      code: "ai_usage_attempts_unavailable",
    });
  }
  return error;
}

async function fetchAttemptByIdempotency(env, { organizationId, idempotencyKey }) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, organization_id, user_id, feature_key, operation_key, route,
              idempotency_key, request_fingerprint, credit_cost, quantity,
              status, provider_status, billing_status, result_status,
              result_temp_key, result_save_reference, result_mime_type,
              result_model, result_prompt_length, result_steps, result_seed,
              balance_after, error_code, error_message, created_at, updated_at,
              completed_at, expires_at
       FROM ai_usage_attempts
       WHERE organization_id = ? AND idempotency_key = ?
       LIMIT 1`
    ).bind(organizationId, idempotencyKey).first();
    return serializeAttempt(row);
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

async function fetchAttemptById(env, attemptIdValue) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, organization_id, user_id, feature_key, operation_key, route,
              idempotency_key, request_fingerprint, credit_cost, quantity,
              status, provider_status, billing_status, result_status,
              result_temp_key, result_save_reference, result_mime_type,
              result_model, result_prompt_length, result_steps, result_seed,
              balance_after, error_code, error_message, created_at, updated_at,
              completed_at, expires_at
       FROM ai_usage_attempts
       WHERE id = ?
       LIMIT 1`
    ).bind(attemptIdValue).first();
    return row || null;
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function getAiUsageAttemptReplayMetadata(env, attemptIdValue) {
  try {
    const row = await env.DB.prepare(
      `SELECT metadata_json
       FROM ai_usage_attempts
       WHERE id = ?
         AND status = 'succeeded'
         AND billing_status = 'finalized'
       LIMIT 1`
    ).bind(attemptIdValue).first();
    if (!row?.metadata_json) return {};
    try {
      const parsed = JSON.parse(row.metadata_json);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
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
      `UPDATE ai_usage_attempts
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
             SELECT balance_after FROM credit_ledger
             WHERE organization_id = ?
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1
           ), 0)
           - COALESCE((
             SELECT SUM(credit_cost) FROM ai_usage_attempts
             WHERE organization_id = ?
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
      attempt.organizationId,
      attempt.organizationId,
      now,
      attempt.id,
      attempt.creditCost
    ).run();
    if (!result?.meta?.changes) {
      throw new BillingError("Insufficient organization credits.", {
        status: 402,
        code: "insufficient_credits",
      });
    }
    return fetchAttemptByIdempotency(env, {
      organizationId: attempt.organizationId,
      idempotencyKey: attempt.idempotencyKey,
    });
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

async function insertReservedAttempt(env, attempt) {
  try {
    const result = await env.DB.prepare(
      `INSERT INTO ai_usage_attempts (
         id, organization_id, user_id, feature_key, operation_key, route,
         idempotency_key, request_fingerprint, credit_cost, quantity,
         status, provider_status, billing_status, result_status,
         created_at, updated_at, expires_at, metadata_json
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'reserved', 'not_started', 'reserved', 'none',
              ?, ?, ?, ?
       WHERE (
         COALESCE((
           SELECT balance_after FROM credit_ledger
           WHERE organization_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1
         ), 0)
         - COALESCE((
           SELECT SUM(credit_cost) FROM ai_usage_attempts
           WHERE organization_id = ?
             AND billing_status = 'reserved'
             AND status IN ('reserved', 'provider_running', 'finalizing')
             AND expires_at > ?
         ), 0)
       ) >= ?`
    ).bind(
      attempt.id,
      attempt.organizationId,
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
      "{}",
      attempt.organizationId,
      attempt.organizationId,
      attempt.createdAt,
      attempt.creditCost
    ).run();
    return result?.meta?.changes > 0;
  } catch (error) {
    if (String(error).includes("UNIQUE")) return false;
    throw unavailableAttemptsError(error);
  }
}

export async function beginAiUsageAttempt({
  env,
  organizationId,
  userId = null,
  featureKey,
  operationKey,
  route,
  idempotencyKey,
  requestFingerprint,
  creditCost,
  quantity = 1,
}) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedCredits = normalizePositiveInteger(creditCost, { fieldName: "creditCost" });
  const normalizedQuantity = normalizePositiveInteger(quantity, { fieldName: "quantity" });
  const now = nowIso();
  const expiresAt = addMinutesIso(ATTEMPT_TTL_MINUTES);
  const existing = await fetchAttemptByIdempotency(env, { organizationId: orgId, idempotencyKey });

  if (existing) {
    assertSameRequest(existing, requestFingerprint);
    const kind = classifyExistingAttempt(existing, now);
    if (kind === "retryable") {
      const retryAttempt = await reserveExistingAttempt(env, { attempt: existing, now, expiresAt });
      return { kind: "reserved", attempt: retryAttempt, reused: true };
    }
    return { kind, attempt: existing, reused: true };
  }

  const attempt = {
    id: attemptId(),
    organizationId: orgId,
    userId: userId || null,
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
  };
  const inserted = await insertReservedAttempt(env, attempt);
  if (!inserted) {
    const raced = await fetchAttemptByIdempotency(env, { organizationId: orgId, idempotencyKey });
    if (raced) {
      assertSameRequest(raced, requestFingerprint);
      return { kind: classifyExistingAttempt(raced, now), attempt: raced, reused: true };
    }
    throw new BillingError("Insufficient organization credits.", {
      status: 402,
      code: "insufficient_credits",
    });
  }
  const created = await fetchAttemptByIdempotency(env, { organizationId: orgId, idempotencyKey });
  return { kind: "reserved", attempt: created, reused: false };
}

export async function markAiUsageAttemptProviderRunning(env, attemptIdValue) {
  try {
    await env.DB.prepare(
      `UPDATE ai_usage_attempts
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

export async function markAiUsageAttemptProviderFailed(env, attemptIdValue, { code = "provider_failed", message = null } = {}) {
  const now = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE ai_usage_attempts
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

export async function markAiUsageAttemptFinalizing(env, attemptIdValue) {
  try {
    await env.DB.prepare(
      `UPDATE ai_usage_attempts
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

export async function markAiUsageAttemptBillingFailed(env, attemptIdValue, { code = "billing_failed", message = null } = {}) {
  const now = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE ai_usage_attempts
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

export async function markAiUsageAttemptSucceeded(env, attemptIdValue, {
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
  const metadataJson = normalizeMetadataJson(metadata);
  try {
    await env.DB.prepare(
      `UPDATE ai_usage_attempts
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
      metadataJson,
      now,
      now,
      attemptIdValue
    ).run();
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export function billingMetadataFromAttempt(attempt, { replay = false } = {}) {
  return {
    organization_id: attempt.organizationId,
    feature: attempt.featureKey,
    credits_charged: attempt.creditCost,
    balance_after: attempt.balanceAfter,
    idempotent_replay: Boolean(replay),
  };
}

export async function buildAdminAiUsageAttemptFilterHash(filters = {}) {
  return sha256Hex(JSON.stringify({
    status: filters.status || null,
    organizationId: filters.organizationId || null,
    userId: filters.userId || null,
    featureKey: filters.featureKey || null,
  }));
}

export function adminAiUsageAttemptCursorExpiry() {
  return Date.now() + ADMIN_ATTEMPT_LIST_TTL_MS;
}

export function normalizeAdminAiUsageAttemptFilters(params = {}) {
  return {
    status: normalizeOptionalAttemptStatus(params.status),
    organizationId: normalizeOptionalOrganizationId(params.organizationId ?? params.organization_id),
    userId: normalizeOptionalUserId(params.userId ?? params.user_id),
    featureKey: normalizeOptionalFeatureKey(params.featureKey ?? params.feature),
  };
}

export async function listAdminAiUsageAttempts(env, {
  limit = DEFAULT_ADMIN_ATTEMPT_LIMIT,
  cursor = null,
  status = null,
  organizationId = null,
  userId = null,
  featureKey = null,
} = {}) {
  const appliedLimit = normalizeBoundedLimit(limit, {
    defaultValue: DEFAULT_ADMIN_ATTEMPT_LIMIT,
    maxValue: MAX_ADMIN_ATTEMPT_LIMIT,
  });
  const now = nowIso();
  try {
    const rows = await env.DB.prepare(
      `SELECT id, organization_id, user_id, feature_key, operation_key, route,
              idempotency_key, request_fingerprint, credit_cost, quantity,
              status, provider_status, billing_status, result_status,
              result_temp_key, result_save_reference, result_mime_type,
              result_model, result_prompt_length, result_steps, result_seed,
              balance_after, error_code, error_message, created_at, updated_at,
              completed_at, expires_at
       FROM ai_usage_attempts
       WHERE (? IS NULL OR status = ?)
         AND (? IS NULL OR organization_id = ?)
         AND (? IS NULL OR user_id = ?)
         AND (? IS NULL OR feature_key = ?)
         AND (? IS NULL OR (updated_at < ? OR (updated_at = ? AND id < ?)))
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    ).bind(
      status,
      status,
      organizationId,
      organizationId,
      userId,
      userId,
      featureKey,
      featureKey,
      cursor?.updatedAt || null,
      cursor?.updatedAt || null,
      cursor?.updatedAt || null,
      cursor?.id || null,
      appliedLimit + 1
    ).all();
    const pageRows = rows.results || [];
    const hasMore = pageRows.length > appliedLimit;
    const visibleRows = pageRows.slice(0, appliedLimit);
    return {
      attempts: visibleRows.map((row) => serializeAdminAttempt(row, { now })),
      hasMore,
      last: visibleRows.at(-1) || null,
      appliedLimit,
    };
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function getAdminAiUsageAttempt(env, attemptIdValue) {
  const attemptIdText = normalizeOptionalShortFilter(attemptIdValue, {
    fieldName: "attempt_id",
    maxLength: 80,
    pattern: /^aua_[A-Za-z0-9_-]+$/,
  });
  if (!attemptIdText) return null;
  return serializeAdminAttempt(await fetchAttemptById(env, attemptIdText), {
    detail: true,
  });
}

async function listCleanupCandidates(env, { now, limit }) {
  const rows = await env.DB.prepare(
    `SELECT id, organization_id, user_id, feature_key, operation_key, route,
            idempotency_key, request_fingerprint, credit_cost, quantity,
            status, provider_status, billing_status, result_status,
            result_temp_key, result_save_reference, result_mime_type,
            result_model, result_prompt_length, result_steps, result_seed,
            balance_after, error_code, error_message, created_at, updated_at,
            completed_at, expires_at
     FROM ai_usage_attempts
     WHERE expires_at <= ?
       AND (
         (billing_status = 'reserved' AND status IN ('reserved', 'provider_running', 'provider_failed', 'finalizing'))
         OR (status = 'succeeded' AND billing_status = 'finalized' AND result_status = 'stored')
       )
     ORDER BY expires_at ASC, updated_at ASC, id ASC
     LIMIT ?`
  ).bind(now, limit).all();
  return rows.results || [];
}

function cleanupActionForAttempt(row) {
  if (row.status === "succeeded" && row.billing_status === "finalized" && row.result_status === "stored") {
    return row.result_temp_key ? "cleanup_replay_object" : "expire_replay_metadata";
  }
  if (row.status === "finalizing" && row.billing_status === "reserved") {
    return "mark_billing_failed";
  }
  if (row.billing_status === "reserved" && ["reserved", "provider_running", "provider_failed"].includes(row.status)) {
    return "release_reservation";
  }
  return "skip";
}

async function releaseExpiredReservation(env, row, now) {
  const result = await env.DB.prepare(
    `UPDATE ai_usage_attempts
     SET status = 'expired',
         provider_status = CASE WHEN provider_status = 'failed' THEN 'failed' ELSE 'expired' END,
         billing_status = 'released',
         result_status = 'none',
         error_code = ?,
         error_message = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND billing_status = 'reserved'
       AND status IN ('reserved', 'provider_running', 'provider_failed')
       AND expires_at <= ?`
  ).bind(
    "ai_usage_attempt_expired",
    "AI usage attempt expired before provider/billing completion.",
    now,
    now,
    row.id,
    now
  ).run();
  return Number(result?.meta?.changes || 0);
}

async function markExpiredFinalizationFailed(env, row, now) {
  const result = await env.DB.prepare(
    `UPDATE ai_usage_attempts
     SET status = 'billing_failed',
         provider_status = 'succeeded',
         billing_status = 'failed',
         result_status = 'none',
         result_temp_key = NULL,
         result_save_reference = NULL,
         error_code = ?,
         error_message = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND status = 'finalizing'
       AND billing_status = 'reserved'
       AND expires_at <= ?`
  ).bind(
    "ai_usage_billing_expired",
    "AI usage billing finalization expired before completion.",
    now,
    now,
    row.id,
    now
  ).run();
  return Number(result?.meta?.changes || 0);
}

async function expireReplayMetadata(env, row, now) {
  const result = await env.DB.prepare(
    `UPDATE ai_usage_attempts
     SET result_status = 'expired',
         result_temp_key = NULL,
         result_save_reference = NULL,
         metadata_json = '{}',
         updated_at = ?
     WHERE id = ?
       AND status = 'succeeded'
       AND billing_status = 'finalized'
       AND result_status = 'stored'
       AND (? IS NULL OR result_temp_key = ?)
       AND expires_at <= ?`
  ).bind(now, row.id, row.result_temp_key || null, row.result_temp_key || null, now).run();
  return Number(result?.meta?.changes || 0);
}

async function cleanupReplayObjectForAttempt(env, row, now, { dryRun = true } = {}) {
  if (
    row.status !== "succeeded" ||
    row.billing_status !== "finalized" ||
    row.result_status !== "stored" ||
    String(row.expires_at || "") > String(now || "")
  ) {
    return {
      eligible: false,
      skippedActive: true,
      errorCode: "ai_usage_replay_cleanup_ineligible",
    };
  }

  const validation = validateReplayTempObjectKey(row);
  if (!validation.ok) {
    return {
      eligible: false,
      skippedUnsafeKey: true,
      errorCode: `ai_usage_replay_${validation.code}`,
    };
  }

  let objectMetadata;
  try {
    objectMetadata = await getReplayObjectMetadata(env, validation.key);
  } catch {
    return {
      eligible: true,
      failed: true,
      errorCode: "ai_usage_replay_object_lookup_failed",
    };
  }

  if (dryRun) {
    return {
      eligible: true,
      missingObject: !objectMetadata,
      errorCode: objectMetadata ? null : "ai_usage_replay_object_missing",
    };
  }

  if (!objectMetadata) {
    const changes = await expireReplayMetadata(env, row, now);
    return {
      eligible: true,
      missingObject: true,
      metadataCleared: changes > 0,
      changed: changes > 0,
      errorCode: changes > 0 ? "ai_usage_replay_object_missing" : "ai_usage_replay_cleanup_noop",
    };
  }

  try {
    await env.USER_IMAGES.delete(validation.key);
  } catch {
    return {
      eligible: true,
      failed: true,
      errorCode: "ai_usage_replay_object_delete_failed",
    };
  }

  const changes = await expireReplayMetadata(env, row, now);
  return {
    eligible: true,
    deleted: true,
    metadataCleared: changes > 0,
    changed: changes > 0,
    errorCode: changes > 0 ? null : "ai_usage_replay_cleanup_noop",
  };
}

export async function cleanupExpiredAiUsageAttempts({
  env,
  now = nowIso(),
  limit = DEFAULT_ATTEMPT_CLEANUP_LIMIT,
  dryRun = true,
} = {}) {
  const appliedLimit = normalizeBoundedLimit(limit, {
    defaultValue: DEFAULT_ATTEMPT_CLEANUP_LIMIT,
    maxValue: MAX_ATTEMPT_CLEANUP_LIMIT,
  });
  const isDryRun = dryRun !== false;
  let candidates;
  try {
    candidates = await listCleanupCandidates(env, { now, limit: appliedLimit });
  } catch (error) {
    throw unavailableAttemptsError(error);
  }

  let expiredCount = 0;
  let reservationsReleasedCount = 0;
  let replayMetadataExpiredCount = 0;
  let replayObjectsEligibleCount = 0;
  let replayObjectsDeletedCount = 0;
  let replayObjectMetadataClearedCount = 0;
  let replayObjectsSkippedActiveCount = 0;
  let replayObjectsSkippedUnsafeKeyCount = 0;
  let replayObjectsSkippedMissingObjectCount = 0;
  let replayObjectFailedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const results = [];

  for (const row of candidates) {
    const action = cleanupActionForAttempt(row);
    const result = {
      attemptId: row.id,
      organizationId: row.organization_id,
      statusBefore: row.status,
      billingStatusBefore: row.billing_status,
      action,
      changed: false,
      errorCode: null,
    };

    if (action === "skip") {
      skippedCount += 1;
      result.errorCode = "ai_usage_cleanup_skipped";
      results.push(result);
      continue;
    }

    if (isDryRun) {
      if (action === "cleanup_replay_object") {
        const replayCleanup = await cleanupReplayObjectForAttempt(env, row, now, { dryRun: true });
        if (replayCleanup.eligible) {
          replayObjectsEligibleCount += 1;
          replayMetadataExpiredCount += 1;
        }
        if (replayCleanup.skippedActive) {
          replayObjectsSkippedActiveCount += 1;
          skippedCount += 1;
        }
        if (replayCleanup.skippedUnsafeKey) {
          replayObjectsSkippedUnsafeKeyCount += 1;
          skippedCount += 1;
        }
        if (replayCleanup.missingObject) {
          replayObjectsSkippedMissingObjectCount += 1;
        }
        if (replayCleanup.failed) {
          failedCount += 1;
          replayObjectFailedCount += 1;
        }
        result.errorCode = replayCleanup.errorCode || null;
      } else {
        expiredCount += 1;
        if (action === "release_reservation") reservationsReleasedCount += 1;
        if (action === "expire_replay_metadata") replayMetadataExpiredCount += 1;
      }
      results.push(result);
      continue;
    }

    try {
      let changes = 0;
      if (action === "release_reservation") {
        changes = await releaseExpiredReservation(env, row, now);
        if (changes > 0) {
          expiredCount += 1;
          reservationsReleasedCount += 1;
        }
      } else if (action === "mark_billing_failed") {
        changes = await markExpiredFinalizationFailed(env, row, now);
        if (changes > 0) expiredCount += 1;
      } else if (action === "cleanup_replay_object") {
        const replayCleanup = await cleanupReplayObjectForAttempt(env, row, now, { dryRun: false });
        if (replayCleanup.eligible) replayObjectsEligibleCount += 1;
        if (replayCleanup.deleted) replayObjectsDeletedCount += 1;
        if (replayCleanup.metadataCleared) {
          replayObjectMetadataClearedCount += 1;
          replayMetadataExpiredCount += 1;
        }
        if (replayCleanup.skippedActive) {
          replayObjectsSkippedActiveCount += 1;
          skippedCount += 1;
        }
        if (replayCleanup.skippedUnsafeKey) {
          replayObjectsSkippedUnsafeKeyCount += 1;
          skippedCount += 1;
        }
        if (replayCleanup.missingObject) {
          replayObjectsSkippedMissingObjectCount += 1;
        }
        if (replayCleanup.failed) {
          failedCount += 1;
          replayObjectFailedCount += 1;
        }
        result.errorCode = replayCleanup.errorCode || null;
        changes = replayCleanup.changed ? 1 : 0;
      } else if (action === "expire_replay_metadata") {
        changes = await expireReplayMetadata(env, row, now);
        if (changes > 0) replayMetadataExpiredCount += 1;
      }
      if (changes > 0) {
        result.changed = true;
      } else if (!result.errorCode) {
        skippedCount += 1;
        result.errorCode = "ai_usage_cleanup_noop";
      }
    } catch {
      failedCount += 1;
      result.errorCode = "ai_usage_cleanup_failed";
    }
    results.push(result);
  }

  return {
    dryRun: isDryRun,
    scannedCount: candidates.length,
    expiredCount,
    reservationsReleasedCount,
    replayMetadataExpiredCount,
    replayObjectsEligibleCount,
    replayObjectsDeletedCount,
    replayObjectMetadataClearedCount,
    replayObjectsSkippedActiveCount,
    replayObjectsSkippedUnsafeKeyCount,
    replayObjectsSkippedMissingObjectCount,
    replayObjectFailedCount,
    skippedCount,
    failedCount,
    appliedLimit,
    results,
  };
}
