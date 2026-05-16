import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const ADMIN_AI_ATTEMPT_TTL_MINUTES = 24 * 60;
const MAX_JSON_LENGTH = 16 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 160;
const DEFAULT_ADMIN_AI_ATTEMPT_LIST_LIMIT = 25;
const MAX_ADMIN_AI_ATTEMPT_LIST_LIMIT = 100;
const DEFAULT_ADMIN_AI_ATTEMPT_CLEANUP_LIMIT = 25;
const MAX_ADMIN_AI_ATTEMPT_CLEANUP_LIMIT = 50;
const ACTIVE_STATUSES = new Set(["pending", "provider_running"]);
const VISIBLE_STATUSES = new Set([
  "pending",
  "provider_running",
  "provider_failed",
  "succeeded",
  "terminal_failure",
  "expired",
]);
const VISIBLE_OPERATIONS = new Set([
  "admin.text.test",
  "admin.embeddings.test",
  "admin.music.test",
  "admin.compare",
]);
const DANGEROUS_METADATA_KEY_PATTERN =
  /(?:authorization|cookie|secret|token|password|api[_-]?key|idempotency[_-]?key|stripe|cloudflare|private[_-]?key|r2[_-]?key|provider[_-]?(?:request|body)|request[_-]?body|raw[_-]?(?:prompt|input|output)|prompt|generated[_-]?text|embedding[_-]?(?:input|vectors?)|vectors?|lyrics|messages?)/i;
const SAFE_LENGTH_KEY_PATTERN =
  /(?:^|[_-])(?:length|count|tokens|dimensions|shape|stored|status|kind|policy|scope|version|operation|route|model|family|class|domain|reason|fingerprint|id|target|state|metadata|summary|credits|cost|temperature|max[_-]?tokens)(?:$|[_-])/i;

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

function normalizeBoundedLimit(value, { defaultValue, maxValue }) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0) return defaultValue;
  return Math.max(1, Math.min(number, maxValue));
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

function isDangerousMetadataKey(key) {
  const text = String(key || "");
  if (!text) return false;
  if (/(?:^|[_-])request[_-]?fingerprint(?:$|[_-])/i.test(text)) return true;
  if (/idempotency/i.test(text)) return true;
  if (SAFE_LENGTH_KEY_PATTERN.test(text)) return false;
  return DANGEROUS_METADATA_KEY_PATTERN.test(text);
}

function sanitizeMetadataForAdmin(value, { key = "", depth = 0 } = {}) {
  if (value == null) return value;
  if (isDangerousMetadataKey(key)) return "[redacted]";
  if (typeof value === "string") {
    const normalized = safeShortText(value, "", 240);
    if (/sk_(?:live|test)_|whsec_|Bearer\s+|__Host-bitbi_session|bitbi_session=|-----BEGIN .*PRIVATE KEY-----/i.test(normalized)) {
      return "[redacted]";
    }
    return normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeMetadataForAdmin(entry, { key, depth: depth + 1 }));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 40)) {
      out[entryKey] = sanitizeMetadataForAdmin(entryValue, {
        key: entryKey,
        depth: depth + 1,
      });
    }
    return out;
  }
  return null;
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

export function serializeAdminAiUsageAttempt(row, { detail = false } = {}) {
  if (!row) return null;
  const resultMetadata = sanitizeMetadataForAdmin(parseJsonObject(row.result_metadata_json), {
    key: "result_metadata",
  });
  const out = {
    attemptId: row.id,
    operationKey: row.operation_key,
    route: row.route,
    adminUserId: row.admin_user_id,
    providerFamily: row.provider_family,
    modelKey: row.model_key || null,
    budgetScope: row.budget_scope,
    status: row.status,
    providerStatus: row.provider_status,
    resultStatus: row.result_status,
    error: row.error_code ? { code: row.error_code, message: safeShortText(row.error_message, null) } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at,
  };
  if (detail) {
    out.budgetPolicy = sanitizeMetadataForAdmin(parseJsonObject(row.budget_policy_json), {
      key: "budget_policy",
    });
    out.callerPolicy = sanitizeMetadataForAdmin(parseJsonObject(row.caller_policy_json), {
      key: "caller_policy",
    });
    out.resultMetadata = resultMetadata;
    out.metadata = sanitizeMetadataForAdmin(parseJsonObject(row.metadata_json), {
      key: "metadata",
    });
    out.privacy = {
      rawIdempotencyKeyReturned: false,
      idempotencyKeyHashReturned: false,
      rawPromptReturned: false,
      rawLyricsReturned: false,
      rawEmbeddingInputReturned: false,
      rawGeneratedTextReturned: false,
      embeddingVectorsReturned: false,
      audioReturned: false,
      providerRequestBodyReturned: false,
      providerResponseBodyReturned: false,
      compareResultsReturned: false,
    };
  } else {
    out.resultMetadata = {
      resultKind: resultMetadata?.result_kind || null,
      textLength: resultMetadata?.text_length == null ? null : Number(resultMetadata.text_length),
      count: resultMetadata?.count == null ? null : Number(resultMetadata.count),
      modelCount: resultMetadata?.model_count == null ? null : Number(resultMetadata.model_count),
      successfulCount: resultMetadata?.successful_count == null ? null : Number(resultMetadata.successful_count),
      failedCount: resultMetadata?.failed_count == null ? null : Number(resultMetadata.failed_count),
      totalTokens: resultMetadata?.usage?.total_tokens == null ? null : Number(resultMetadata.usage.total_tokens),
      dimensions: resultMetadata?.dimensions == null ? null : Number(resultMetadata.dimensions),
      vectorsStored: resultMetadata?.vectors_stored === true,
      durationMs: resultMetadata?.duration_ms == null ? null : Number(resultMetadata.duration_ms),
      sizeBytes: resultMetadata?.size_bytes == null ? null : Number(resultMetadata.size_bytes),
      audioStored: resultMetadata?.audio_stored === true,
      resultsStored: resultMetadata?.results_stored === true,
    };
  }
  return out;
}

function normalizeOptionalAdminAttemptStatus(value) {
  const text = safeShortText(value, null, 40);
  if (!text) return null;
  if (!/^[a-z_]+$/.test(text) || !VISIBLE_STATUSES.has(text)) {
    throw new AdminAiIdempotencyError("Invalid status filter.", {
      code: "validation_error",
      status: 400,
    });
  }
  return text;
}

function normalizeOptionalOperationKey(value) {
  const text = safeShortText(value, null, 80);
  if (!text) return null;
  if (!/^[a-z0-9_.-]+$/.test(text) || !VISIBLE_OPERATIONS.has(text)) {
    throw new AdminAiIdempotencyError("Invalid operation_key filter.", {
      code: "validation_error",
      status: 400,
    });
  }
  return text;
}

function normalizeOptionalRoute(value) {
  const text = safeShortText(value, null, 160);
  if (!text) return null;
  if (!/^(?:\/api\/admin\/ai\/test-(?:text|embeddings|music)|\/api\/admin\/ai\/compare)$/.test(text)) {
    throw new AdminAiIdempotencyError("Invalid route filter.", {
      code: "validation_error",
      status: 400,
    });
  }
  return text;
}

function normalizeOptionalAdminUserId(value) {
  const text = safeShortText(value, null, 120);
  if (!text) return null;
  if (!/^[A-Za-z0-9_.:@-]+$/.test(text)) {
    throw new AdminAiIdempotencyError("Invalid admin_user_id filter.", {
      code: "validation_error",
      status: 400,
    });
  }
  return text;
}

function normalizeAdminAttemptId(value) {
  const text = safeShortText(value, null, 80);
  if (!text || !/^aaia_[A-Za-z0-9_-]+$/.test(text)) return null;
  return text;
}

export function normalizeAdminAiUsageAttemptFilters(params = {}) {
  return {
    status: normalizeOptionalAdminAttemptStatus(params.status),
    operationKey: normalizeOptionalOperationKey(params.operationKey ?? params.operation_key),
    route: normalizeOptionalRoute(params.route),
    adminUserId: normalizeOptionalAdminUserId(params.adminUserId ?? params.admin_user_id),
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

export async function listAdminAiUsageAttempts(env, {
  limit = DEFAULT_ADMIN_AI_ATTEMPT_LIST_LIMIT,
  status = null,
  operationKey = null,
  route = null,
  adminUserId = null,
} = {}) {
  const filters = normalizeAdminAiUsageAttemptFilters({
    status,
    operationKey,
    route,
    adminUserId,
  });
  const appliedLimit = normalizeBoundedLimit(limit, {
    defaultValue: DEFAULT_ADMIN_AI_ATTEMPT_LIST_LIMIT,
    maxValue: MAX_ADMIN_AI_ATTEMPT_LIST_LIMIT,
  });
  try {
    const rows = await env.DB.prepare(
      `SELECT id, operation_key, route, admin_user_id, idempotency_key_hash,
              request_fingerprint, provider_family, model_key, budget_scope,
              budget_policy_json, caller_policy_json, status, provider_status,
              result_status, result_metadata_json, error_code, error_message,
              created_at, updated_at, completed_at, expires_at, metadata_json
       FROM admin_ai_usage_attempts
       WHERE (? IS NULL OR status = ?)
         AND (? IS NULL OR operation_key = ?)
         AND (? IS NULL OR route = ?)
         AND (? IS NULL OR admin_user_id = ?)
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    ).bind(
      filters.status,
      filters.status,
      filters.operationKey,
      filters.operationKey,
      filters.route,
      filters.route,
      filters.adminUserId,
      filters.adminUserId,
      appliedLimit
    ).all();
    return {
      attempts: (rows.results || []).map((row) => serializeAdminAiUsageAttempt(row)),
      appliedLimit,
      filters,
    };
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

export async function getAdminAiUsageAttemptDetail(env, attemptIdValue) {
  const attemptIdText = normalizeAdminAttemptId(attemptIdValue);
  if (!attemptIdText) return null;
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
    ).bind(attemptIdText).first();
    return serializeAdminAiUsageAttempt(row, { detail: true });
  } catch (error) {
    throw unavailableAttemptsError(error);
  }
}

async function listExpiredAdminAiAttemptCandidates(env, { now, limit }) {
  const rows = await env.DB.prepare(
    `SELECT id, operation_key, route, admin_user_id, idempotency_key_hash,
            request_fingerprint, provider_family, model_key, budget_scope,
            budget_policy_json, caller_policy_json, status, provider_status,
            result_status, result_metadata_json, error_code, error_message,
            created_at, updated_at, completed_at, expires_at, metadata_json
     FROM admin_ai_usage_attempts
     WHERE expires_at <= ?
       AND status IN ('pending', 'provider_running')
     ORDER BY expires_at ASC, updated_at ASC, id ASC
     LIMIT ?`
  ).bind(now, limit).all();
  return rows.results || [];
}

async function markAdminAiAttemptExpired(env, row, now) {
  const result = await env.DB.prepare(
    `UPDATE admin_ai_usage_attempts
     SET status = 'expired',
         provider_status = CASE WHEN provider_status = 'running' THEN 'failed' ELSE provider_status END,
         result_status = 'none',
         error_code = ?,
         error_message = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND status IN ('pending', 'provider_running')
       AND expires_at <= ?`
  ).bind(
    "admin_ai_usage_attempt_expired",
    "Admin AI usage attempt expired before provider completion.",
    now,
    now,
    row.id,
    now
  ).run();
  return Number(result?.meta?.changes || 0);
}

export async function cleanupExpiredAdminAiUsageAttempts({
  env,
  now = nowIso(),
  limit = DEFAULT_ADMIN_AI_ATTEMPT_CLEANUP_LIMIT,
  dryRun = true,
} = {}) {
  const appliedLimit = normalizeBoundedLimit(limit, {
    defaultValue: DEFAULT_ADMIN_AI_ATTEMPT_CLEANUP_LIMIT,
    maxValue: MAX_ADMIN_AI_ATTEMPT_CLEANUP_LIMIT,
  });
  const isDryRun = dryRun !== false;
  let candidates;
  try {
    candidates = await listExpiredAdminAiAttemptCandidates(env, {
      now,
      limit: appliedLimit,
    });
  } catch (error) {
    throw unavailableAttemptsError(error);
  }

  let expiredCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const results = [];

  for (const row of candidates) {
    const result = {
      attemptId: row.id,
      operationKey: row.operation_key,
      statusBefore: row.status,
      providerStatusBefore: row.provider_status,
      action: "mark_expired",
      changed: false,
      errorCode: null,
    };
    if (isDryRun) {
      expiredCount += 1;
      results.push(result);
      continue;
    }
    try {
      const changes = await markAdminAiAttemptExpired(env, row, now);
      if (changes > 0) {
        expiredCount += 1;
        result.changed = true;
      } else {
        skippedCount += 1;
        result.errorCode = "admin_ai_usage_attempt_cleanup_noop";
      }
    } catch {
      failedCount += 1;
      result.errorCode = "admin_ai_usage_attempt_cleanup_failed";
    }
    results.push(result);
  }

  return {
    dryRun: isDryRun,
    scannedCount: candidates.length,
    expiredCount,
    skippedCount,
    failedCount,
    appliedLimit,
    cutoff: now,
    now,
    results,
  };
}

export async function summarizeAdminAiUsageAttempts(env, { now = nowIso() } = {}) {
  const since = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  try {
    const row = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent_count,
         SUM(CASE WHEN status IN ('pending', 'provider_running') THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN status IN ('pending', 'provider_running') AND expires_at <= ? THEN 1 ELSE 0 END) AS stale_active_count,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count,
         SUM(CASE WHEN status IN ('provider_failed', 'terminal_failure') THEN 1 ELSE 0 END) AS failed_terminal_count,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_count,
         MAX(updated_at) AS latest_updated_at
       FROM admin_ai_usage_attempts`
    ).bind(since, now).first();
    return {
      available: true,
      totalCount: Number(row?.total_count || 0),
      recentCount: Number(row?.recent_count || 0),
      activeCount: Number(row?.active_count || 0),
      staleActiveCount: Number(row?.stale_active_count || 0),
      expiredCount: Number(row?.expired_count || 0),
      failedTerminalCount: Number(row?.failed_terminal_count || 0),
      succeededCount: Number(row?.succeeded_count || 0),
      latestUpdatedAt: row?.latest_updated_at || null,
      recentWindowHours: 24,
    };
  } catch (error) {
    if (String(error || "").includes("no such table: admin_ai_usage_attempts")) {
      return {
        available: false,
        code: "admin_ai_idempotency_unavailable",
      };
    }
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
