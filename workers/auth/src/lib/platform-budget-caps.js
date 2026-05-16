import { json } from "./response.js";
import { ADMIN_PLATFORM_BUDGET_SCOPES } from "./admin-platform-budget-policy.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const PLATFORM_BUDGET_LIMITS_TABLE = "platform_budget_limits";
export const PLATFORM_BUDGET_LIMIT_EVENTS_TABLE = "platform_budget_limit_events";
export const PLATFORM_BUDGET_USAGE_EVENTS_TABLE = "platform_budget_usage_events";
export const PLATFORM_ADMIN_LAB_BUDGET_SCOPE = ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET;

const WINDOW_TYPES = new Set(["daily", "monthly"]);
const MAX_LIMIT_UNITS = 1_000_000_000;
const MAX_REASON_LENGTH = 500;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,180}$/;
const UNSAFE_METADATA_KEY_PATTERN = /(secret|token|cookie|authorization|auth_header|private[_-]?key|stripe|cloudflare|api[_-]?key|prompt|lyrics|message|provider[_-]?body|raw)/i;

export class PlatformBudgetCapError extends Error {
  constructor(message, { status = 503, code = "platform_budget_cap_unavailable", fields = {} } = {}) {
    super(message);
    this.name = "PlatformBudgetCapError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function safeString(value, maxLength = 180) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text || !SAFE_ID_PATTERN.test(text)) return null;
  return text.slice(0, maxLength);
}

function sanitizeReason(value) {
  if (value == null) return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REASON_LENGTH);
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 16)) {
    const safeKey = safeString(key, 80);
    if (!safeKey || UNSAFE_METADATA_KEY_PATTERN.test(safeKey)) continue;
    if (raw == null || typeof raw === "boolean" || typeof raw === "number") {
      out[safeKey] = raw;
      continue;
    }
    if (typeof raw === "string") {
      out[safeKey] = raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 180);
    }
  }
  return out;
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

export function normalizePlatformBudgetScope(value) {
  const normalized = String(value || "").trim();
  if (normalized !== PLATFORM_ADMIN_LAB_BUDGET_SCOPE) {
    throw new PlatformBudgetCapError("Unsupported platform budget scope.", {
      status: 400,
      code: "platform_budget_scope_unsupported",
      fields: { budgetScope: normalized || null },
    });
  }
  return normalized;
}

export function normalizePlatformBudgetWindowType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!WINDOW_TYPES.has(normalized)) {
    throw new PlatformBudgetCapError("Unsupported platform budget cap window.", {
      status: 400,
      code: "platform_budget_window_unsupported",
      fields: { windowType: normalized || null },
    });
  }
  return normalized;
}

export function normalizePlatformBudgetUnits(value, { fallback = null } = {}) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.min(MAX_LIMIT_UNITS, Math.ceil(numeric)));
  }
  if (fallback != null) return normalizePlatformBudgetUnits(fallback);
  throw new PlatformBudgetCapError("Platform budget units must be a positive integer.", {
    status: 400,
    code: "platform_budget_units_invalid",
    fields: {},
  });
}

export function platformBudgetUnitsFromBudgetPolicy(budgetPolicy = {}) {
  return normalizePlatformBudgetUnits(
    budgetPolicy.estimated_cost_units ?? budgetPolicy.estimatedCostUnits ?? budgetPolicy.estimated_credits ?? budgetPolicy.estimatedCredits,
    { fallback: 1 }
  );
}

export function getPlatformBudgetWindows(now = nowIso()) {
  const iso = String(now || nowIso());
  return Object.freeze({
    now: iso,
    day: iso.slice(0, 10),
    month: iso.slice(0, 7),
  });
}

function assertDb(env, fields = {}) {
  if (!env?.DB?.prepare) {
    throw new PlatformBudgetCapError("Platform budget cap store is unavailable.", {
      status: 503,
      code: "platform_budget_cap_store_unavailable",
      fields,
    });
  }
}

function serializeLimit(row = null, usage = null) {
  if (!row) return null;
  const limitUnits = Number(row.limit_units || 0);
  const usedUnits = usage ? Number(usage.usedUnits || 0) : null;
  const remainingUnits = usage ? Math.max(0, limitUnits - usedUnits) : null;
  return Object.freeze({
    id: row.id,
    budgetScope: row.budget_scope,
    windowType: row.window_type,
    limitUnits,
    mode: row.mode || "enforce",
    status: row.status || "active",
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    reason: row.reason || null,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id || null,
    updatedByUserId: row.updated_by_user_id || null,
    usedUnits,
    remainingUnits,
    capStatus: usage ? (remainingUnits > 0 ? "available" : "exhausted") : "configured",
  });
}

function serializeUsageEvent(row = null) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    budgetScope: row.budget_scope,
    operationKey: row.operation_key,
    sourceRoute: row.source_route || null,
    actorUserId: row.actor_user_id || null,
    actorRole: row.actor_role || null,
    units: Number(row.units || 0),
    windowDay: row.window_day,
    windowMonth: row.window_month,
    sourceAttemptId: row.source_attempt_id || null,
    sourceJobId: row.source_job_id || null,
    status: row.status || "recorded",
    metadata: sanitizeMetadata(parseJsonObject(row.metadata_json)),
    createdAt: row.created_at || null,
  });
}

async function readActiveLimit(env, budgetScope, windowType) {
  return env.DB.prepare(
    `SELECT id, budget_scope, window_type, limit_units, mode, status, starts_at, ends_at, reason, metadata_json, created_at, updated_at, created_by_user_id, updated_by_user_id
       FROM ${PLATFORM_BUDGET_LIMITS_TABLE}
      WHERE budget_scope = ? AND window_type = ? AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`
  ).bind(budgetScope, windowType).first();
}

async function readUsageUnits(env, { budgetScope, windowType, windowValue }) {
  const column = windowType === "daily" ? "window_day" : "window_month";
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(units), 0) AS used_units
       FROM ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE}
      WHERE budget_scope = ? AND ${column} = ? AND status = 'recorded'`
  ).bind(budgetScope, windowValue).first();
  return Number(row?.used_units || 0);
}

async function getWindowLimitUsage(env, { budgetScope, windowType, windows }) {
  const limit = await readActiveLimit(env, budgetScope, windowType);
  if (!limit) return { windowType, limit: null, usedUnits: null, windowValue: windowType === "daily" ? windows.day : windows.month };
  const windowValue = windowType === "daily" ? windows.day : windows.month;
  const usedUnits = await readUsageUnits(env, { budgetScope, windowType, windowValue });
  return { windowType, limit, usedUnits, windowValue };
}

export async function listPlatformBudgetLimits(env, { budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE } = {}) {
  const scope = normalizePlatformBudgetScope(budgetScope);
  assertDb(env, { budgetScope: scope });
  const result = await env.DB.prepare(
    `SELECT id, budget_scope, window_type, limit_units, mode, status, starts_at, ends_at, reason, metadata_json, created_at, updated_at, created_by_user_id, updated_by_user_id
       FROM ${PLATFORM_BUDGET_LIMITS_TABLE}
      WHERE budget_scope = ?
      ORDER BY status ASC, window_type ASC, updated_at DESC, id DESC
      LIMIT 10`
  ).bind(scope).all();
  return (result?.results || []).map((row) => serializeLimit(row));
}

async function readLimitEvent(env, budgetScope, windowType, idempotencyKey) {
  return env.DB.prepare(
    `SELECT id, budget_scope, window_type, old_limit_units, new_limit_units, reason, changed_by_user_id, idempotency_key, request_hash, created_at
       FROM ${PLATFORM_BUDGET_LIMIT_EVENTS_TABLE}
      WHERE budget_scope = ? AND window_type = ? AND idempotency_key = ?
      LIMIT 1`
  ).bind(budgetScope, windowType, idempotencyKey).first();
}

export async function upsertPlatformBudgetLimit(env, {
  budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  windowType,
  limitUnits,
  reason,
  metadata = null,
  adminUser = null,
  idempotencyKey,
  now = nowIso(),
} = {}) {
  const scope = normalizePlatformBudgetScope(budgetScope);
  const window = normalizePlatformBudgetWindowType(windowType);
  const units = normalizePlatformBudgetUnits(limitUnits);
  const normalizedReason = sanitizeReason(reason);
  if (!normalizedReason || normalizedReason.length < 6) {
    throw new PlatformBudgetCapError("A bounded reason is required.", {
      status: 400,
      code: "platform_budget_cap_reason_required",
      fields: { budgetScope: scope, windowType: window },
    });
  }
  const safeIdempotencyKey = safeString(idempotencyKey, 180);
  if (!safeIdempotencyKey) {
    throw new PlatformBudgetCapError("Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
      fields: { budgetScope: scope, windowType: window },
    });
  }
  assertDb(env, { budgetScope: scope, windowType: window });

  const metadataJson = JSON.stringify({
    phase: "4.17",
    source: "admin_control_plane",
    scope,
    ...sanitizeMetadata(metadata),
  });
  const requestHash = await sha256Hex(JSON.stringify({
    budgetScope: scope,
    windowType: window,
    limitUnits: units,
    reason: normalizedReason,
    metadata: metadataJson,
  }));
  const existingEvent = await readLimitEvent(env, scope, window, safeIdempotencyKey);
  if (existingEvent) {
    if (existingEvent.request_hash !== requestHash) {
      throw new PlatformBudgetCapError("Idempotency-Key was already used for a different budget cap update.", {
        status: 409,
        code: "idempotency_conflict",
        fields: { budgetScope: scope, windowType: window },
      });
    }
    return {
      limit: serializeLimit(await readActiveLimit(env, scope, window)),
      event: {
        id: existingEvent.id,
        replayed: true,
        createdAt: existingEvent.created_at,
      },
    };
  }

  const existingLimit = await readActiveLimit(env, scope, window);
  const adminUserId = safeString(adminUser?.id, 180);
  if (existingLimit) {
    await env.DB.prepare(
      `UPDATE ${PLATFORM_BUDGET_LIMITS_TABLE}
          SET limit_units = ?, mode = 'enforce', status = 'active', reason = ?, metadata_json = ?, updated_at = ?, updated_by_user_id = ?
        WHERE id = ?`
    ).bind(units, normalizedReason, metadataJson, now, adminUserId, existingLimit.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO ${PLATFORM_BUDGET_LIMITS_TABLE} (
         id, budget_scope, window_type, limit_units, mode, status, starts_at, ends_at, reason, metadata_json,
         created_at, updated_at, created_by_user_id, updated_by_user_id
       ) VALUES (?, ?, ?, ?, 'enforce', 'active', NULL, NULL, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `pbl_${randomTokenHex(16)}`,
      scope,
      window,
      units,
      normalizedReason,
      metadataJson,
      now,
      now,
      adminUserId,
      adminUserId
    ).run();
  }

  const eventId = `pble_${randomTokenHex(16)}`;
  await env.DB.prepare(
    `INSERT INTO ${PLATFORM_BUDGET_LIMIT_EVENTS_TABLE} (
       id, budget_scope, window_type, old_limit_units, new_limit_units, reason,
       changed_by_user_id, idempotency_key, request_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    eventId,
    scope,
    window,
    existingLimit ? Number(existingLimit.limit_units || 0) : null,
    units,
    normalizedReason,
    adminUserId,
    safeIdempotencyKey,
    requestHash,
    now
  ).run();

  return {
    limit: serializeLimit(await readActiveLimit(env, scope, window)),
    event: {
      id: eventId,
      replayed: false,
      createdAt: now,
    },
  };
}

export async function getPlatformBudgetUsageSummary(env, {
  budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  now = nowIso(),
  recentLimit = 20,
} = {}) {
  const scope = normalizePlatformBudgetScope(budgetScope);
  assertDb(env, { budgetScope: scope });
  const windows = getPlatformBudgetWindows(now);
  const daily = await getWindowLimitUsage(env, { budgetScope: scope, windowType: "daily", windows });
  const monthly = await getWindowLimitUsage(env, { budgetScope: scope, windowType: "monthly", windows });
  const operationResult = await env.DB.prepare(
    `SELECT operation_key, COALESCE(SUM(units), 0) AS used_units, COUNT(*) AS event_count
       FROM ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE}
      WHERE budget_scope = ? AND window_month = ? AND status = 'recorded'
      GROUP BY operation_key
      ORDER BY used_units DESC, operation_key ASC
      LIMIT 20`
  ).bind(scope, windows.month).all();
  const recentResult = await env.DB.prepare(
    `SELECT id, budget_scope, operation_key, source_route, actor_user_id, actor_role, units, window_day, window_month, source_attempt_id, source_job_id, status, metadata_json, created_at
       FROM ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE}
      WHERE budget_scope = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  ).bind(scope, Math.max(1, Math.min(50, Number(recentLimit || 20)))).all();

  const windowsSummary = [daily, monthly].map((entry) => {
    const limit = serializeLimit(entry.limit, { usedUnits: entry.usedUnits });
    return {
      windowType: entry.windowType,
      windowValue: entry.windowValue,
      limit,
      configured: Boolean(entry.limit),
      usedUnits: entry.usedUnits,
      remainingUnits: entry.limit ? Math.max(0, Number(entry.limit.limit_units || 0) - Number(entry.usedUnits || 0)) : null,
      capStatus: !entry.limit
        ? "missing"
        : (Number(entry.usedUnits || 0) >= Number(entry.limit.limit_units || 0) ? "exhausted" : "available"),
    };
  });

  return Object.freeze({
    budgetScope: scope,
    liveBudgetCapsStatus: "platform_admin_lab_budget_foundation",
    capEnforced: true,
    windows: windowsSummary,
    operationUsage: (operationResult?.results || []).map((row) => ({
      operationKey: row.operation_key,
      usedUnits: Number(row.used_units || 0),
      eventCount: Number(row.event_count || 0),
    })),
    recentEvents: (recentResult?.results || []).map(serializeUsageEvent).filter(Boolean),
    generatedAt: now,
  });
}

export async function checkPlatformBudgetCap(env, {
  budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  operationKey,
  units,
  sourceRoute = null,
  actorUserId = null,
  actorRole = "admin",
  now = nowIso(),
} = {}) {
  const scope = normalizePlatformBudgetScope(budgetScope);
  const requestedUnits = normalizePlatformBudgetUnits(units, { fallback: 1 });
  const safeOperationKey = safeString(operationKey, 160);
  assertDb(env, { budgetScope: scope, operationKey: safeOperationKey });
  const windows = getPlatformBudgetWindows(now);
  const checks = [
    await getWindowLimitUsage(env, { budgetScope: scope, windowType: "daily", windows }),
    await getWindowLimitUsage(env, { budgetScope: scope, windowType: "monthly", windows }),
  ];

  for (const check of checks) {
    if (!check.limit) {
      throw new PlatformBudgetCapError("Platform budget cap is not configured.", {
        status: 503,
        code: "platform_budget_cap_missing",
        fields: {
          budgetScope: scope,
          windowType: check.windowType,
          operationKey: safeOperationKey,
          requestedUnits,
        },
      });
    }
    const limitUnits = Number(check.limit.limit_units || 0);
    const usedUnits = Number(check.usedUnits || 0);
    if (usedUnits + requestedUnits > limitUnits) {
      throw new PlatformBudgetCapError("Platform budget cap would be exceeded.", {
        status: 429,
        code: "platform_budget_cap_exceeded",
        fields: {
          budgetScope: scope,
          windowType: check.windowType,
          windowValue: check.windowValue,
          operationKey: safeOperationKey,
          limitUnits,
          usedUnits,
          requestedUnits,
          remainingUnits: Math.max(0, limitUnits - usedUnits),
          sourceRoute: safeString(sourceRoute, 180),
          actorUserId: safeString(actorUserId, 180),
          actorRole: safeString(actorRole, 80),
        },
      });
    }
  }

  return Object.freeze({
    ok: true,
    allowed: true,
    budgetScope: scope,
    operationKey: safeOperationKey,
    requestedUnits,
    sourceRoute: safeString(sourceRoute, 180),
    actorUserId: safeString(actorUserId, 180),
    actorRole: safeString(actorRole, 80),
    checkedAt: now,
    windows: checks.map((check) => ({
      windowType: check.windowType,
      windowValue: check.windowValue,
      limitUnits: Number(check.limit.limit_units || 0),
      usedUnits: Number(check.usedUnits || 0),
      requestedUnits,
      remainingUnits: Math.max(0, Number(check.limit.limit_units || 0) - Number(check.usedUnits || 0) - requestedUnits),
    })),
  });
}

export function buildPlatformBudgetCapMetadata(capCheck = null) {
  if (!capCheck) return null;
  return {
    status: capCheck.allowed ? "allowed" : "unknown",
    budget_scope: capCheck.budgetScope || null,
    operation_key: capCheck.operationKey || null,
    requested_units: capCheck.requestedUnits || null,
    checked_at: capCheck.checkedAt || null,
    windows: Array.isArray(capCheck.windows) ? capCheck.windows.map((entry) => ({
      window_type: entry.windowType,
      window_value: entry.windowValue,
      limit_units: entry.limitUnits,
      used_units: entry.usedUnits,
      requested_units: entry.requestedUnits,
      remaining_units_after_request: entry.remainingUnits,
    })) : [],
  };
}

export function withPlatformBudgetCapMetadata(budgetPolicy, capCheck) {
  return {
    ...(budgetPolicy || {}),
    runtime_budget_limit_enforced: true,
    runtime_budget_cap_enforced: true,
    live_platform_budget_cap: buildPlatformBudgetCapMetadata(capCheck),
  };
}

export async function recordPlatformBudgetUsageEvent(env, {
  budgetScope = PLATFORM_ADMIN_LAB_BUDGET_SCOPE,
  operationKey,
  sourceRoute = null,
  actorUserId = null,
  actorRole = "admin",
  units,
  idempotencyKeyHash = null,
  requestFingerprint = null,
  sourceAttemptId = null,
  sourceJobId = null,
  metadata = null,
  now = nowIso(),
} = {}) {
  const scope = normalizePlatformBudgetScope(budgetScope);
  const recordedUnits = normalizePlatformBudgetUnits(units, { fallback: 1 });
  const safeOperationKey = safeString(operationKey, 160);
  assertDb(env, { budgetScope: scope, operationKey: safeOperationKey });
  const windows = getPlatformBudgetWindows(now);
  const eventId = `pbu_${randomTokenHex(16)}`;
  const safeMetadata = JSON.stringify({
    phase: "4.17",
    source: "platform_budget_cap_usage",
    ...sanitizeMetadata(metadata),
  });
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO ${PLATFORM_BUDGET_USAGE_EVENTS_TABLE} (
       id, budget_scope, operation_key, source_route, actor_user_id, actor_role, units,
       window_day, window_month, idempotency_key_hash, request_fingerprint, source_attempt_id,
       source_job_id, status, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?)`
  ).bind(
    eventId,
    scope,
    safeOperationKey,
    safeString(sourceRoute, 180),
    safeString(actorUserId, 180),
    safeString(actorRole, 80),
    recordedUnits,
    windows.day,
    windows.month,
    safeString(idempotencyKeyHash, 180),
    safeString(requestFingerprint, 180),
    safeString(sourceAttemptId, 180),
    safeString(sourceJobId, 180),
    safeMetadata,
    now
  ).run();

  return Object.freeze({
    id: eventId,
    recorded: Number(result?.meta?.changes ?? 1) > 0,
    budgetScope: scope,
    operationKey: safeOperationKey,
    units: recordedUnits,
    windowDay: windows.day,
    windowMonth: windows.month,
    sourceAttemptId: safeString(sourceAttemptId, 180),
    sourceJobId: safeString(sourceJobId, 180),
    createdAt: now,
  });
}

export function platformBudgetCapErrorResponse(errorOrFields, options = {}) {
  const fields = errorOrFields instanceof PlatformBudgetCapError
    ? errorOrFields.fields
    : (errorOrFields || {});
  return json({
    ok: false,
    error: options.message || errorOrFields?.message || "Platform budget cap blocked this request.",
    code: errorOrFields?.code || options.code || "platform_budget_cap_error",
    budget_scope: fields.budgetScope || null,
    window_type: fields.windowType || null,
    operation_key: fields.operationKey || null,
    limit_units: fields.limitUnits ?? null,
    used_units: fields.usedUnits ?? null,
    requested_units: fields.requestedUnits ?? null,
    remaining_units: fields.remainingUnits ?? null,
  }, { status: options.status || errorOrFields?.status || 503 });
}
