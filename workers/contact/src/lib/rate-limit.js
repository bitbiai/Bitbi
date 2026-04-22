import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

const rateLimitBuckets = new Map();
const RATE_LIMIT_COUNTERS_TABLE = 'rate_limit_counters';
const limiterInfraCache = new WeakMap();

export class SharedRateLimitUnavailableError extends Error {
  constructor(message = 'Shared contact rate limiter unavailable.', { reason = 'unknown', cause = null } = {}) {
    super(message);
    this.name = 'SharedRateLimitUnavailableError';
    this.code = 'rate_limit_unavailable';
    this.status = 503;
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}

export function isProductionEnvironment(env) {
  return String(env?.BITBI_ENV || '').trim().toLowerCase() === 'production';
}

export function isSharedRateLimitUnavailableError(error) {
  return error instanceof SharedRateLimitUnavailableError;
}

function isRateLimitedInMemory(key, maxRequests, windowMs) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > maxRequests;
}

function getFixedWindowStartMs(nowMs, windowMs) {
  return nowMs - (nowMs % windowMs);
}

function buildLimiterUnavailableError(reason, cause = null) {
  if (reason === 'db_binding_missing') {
    return new SharedRateLimitUnavailableError('Shared contact rate limiter DB binding is unavailable.', { reason, cause });
  }
  if (reason === 'rate_limit_table_missing') {
    return new SharedRateLimitUnavailableError('Shared contact rate limiter table is unavailable.', { reason, cause });
  }
  return new SharedRateLimitUnavailableError('Shared contact rate limiter is unavailable.', { reason, cause });
}

function logLimiterDegradedEvent({
  env,
  scope,
  component,
  correlationId = null,
  failClosed = false,
  reason,
  error,
  requestInfo = null,
}) {
  logDiagnostic({
    service: 'bitbi-contact',
    component: component || 'shared-rate-limit',
    event: failClosed ? 'shared_rate_limiter_fail_closed' : 'shared_rate_limiter_degraded',
    level: failClosed ? 'error' : 'warn',
    correlationId,
    limiter_scope: scope,
    limiter_reason: reason,
    production: isProductionEnvironment(env),
    status: failClosed ? 503 : null,
    ...getRequestLogFields(requestInfo),
    ...getErrorFields(error),
  });
}

function readLimiterInfraCache(env) {
  if (!env || typeof env !== 'object') return null;
  return limiterInfraCache.get(env) || null;
}

function writeLimiterInfraCache(env, state) {
  if (!env || typeof env !== 'object') return;
  limiterInfraCache.set(env, state);
}

export async function assertSharedRateLimitInfraReady(
  env,
  { component = 'shared-rate-limit', correlationId = null, scope = null, requestInfo = null } = {}
) {
  if (!env?.DB) {
    const error = buildLimiterUnavailableError('db_binding_missing');
    logLimiterDegradedEvent({
      env,
      scope,
      component,
      correlationId,
      failClosed: true,
      reason: error.reason,
      error,
      requestInfo,
    });
    throw error;
  }

  const cached = readLimiterInfraCache(env);
  if (cached?.ready === true && cached.db === env.DB) {
    return true;
  }
  if (cached?.promise && cached.db === env.DB) {
    return cached.promise;
  }

  const probePromise = (async () => {
    try {
      await env.DB.prepare(`SELECT 1 FROM ${RATE_LIMIT_COUNTERS_TABLE} LIMIT 1`).first();
      writeLimiterInfraCache(env, { ready: true, db: env.DB });
      return true;
    } catch (error) {
      const reason = String(error).includes('no such table')
        ? 'rate_limit_table_missing'
        : 'rate_limit_probe_failed';
      const unavailable = buildLimiterUnavailableError(reason, error);
      logLimiterDegradedEvent({
        env,
        scope,
        component,
        correlationId,
        failClosed: true,
        reason: unavailable.reason,
        error,
        requestInfo,
      });
      writeLimiterInfraCache(env, { ready: false, db: env.DB });
      throw unavailable;
    }
  })();

  writeLimiterInfraCache(env, { ready: false, db: env.DB, promise: probePromise });
  return probePromise;
}

function shouldFailClosed(env, options) {
  return options?.failClosedInProduction === true && isProductionEnvironment(env);
}

function unwrapLimiterFailure(error) {
  if (isSharedRateLimitUnavailableError(error)) return error;
  if (String(error).includes('no such table')) {
    return buildLimiterUnavailableError('rate_limit_table_missing', error);
  }
  return buildLimiterUnavailableError('rate_limit_query_failed', error);
}

export async function isSharedRateLimited(env, scope, key, maxRequests, windowMs, options = {}) {
  const failClosed = shouldFailClosed(env, options);
  if (failClosed) {
    await assertSharedRateLimitInfraReady(env, { ...options, scope });
  }

  if (!env?.DB) {
    if (failClosed) {
      throw buildLimiterUnavailableError('db_binding_missing');
    }
    return isRateLimitedInMemory(`${scope}:${key}`, maxRequests, windowMs);
  }

  const nowMs = Date.now();
  const windowStartMs = getFixedWindowStartMs(nowMs, windowMs);
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = new Date(windowStartMs + windowMs).toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO rate_limit_counters (scope, limiter_key, window_start_ms, count, expires_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(scope, limiter_key, window_start_ms)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
    ).bind(scope, key, windowStartMs, expiresAt, nowIso).run();

    const row = await env.DB.prepare(
      "SELECT count FROM rate_limit_counters WHERE scope = ? AND limiter_key = ? AND window_start_ms = ? LIMIT 1"
    ).bind(scope, key, windowStartMs).first();

    return !!row && row.count > maxRequests;
  } catch (e) {
    if (failClosed) {
      const unavailable = unwrapLimiterFailure(e);
      logLimiterDegradedEvent({
        env,
        scope,
        component: options?.component,
        correlationId: options?.correlationId || null,
        failClosed: true,
        reason: unavailable.reason,
        error: e,
        requestInfo: options?.requestInfo || null,
      });
      throw unavailable;
    }
    logLimiterDegradedEvent({
      env,
      scope,
      component: options?.component,
      correlationId: options?.correlationId || null,
      failClosed: false,
      reason: String(e).includes('no such table') ? 'rate_limit_table_missing' : 'rate_limit_query_failed',
      error: e,
      requestInfo: options?.requestInfo || null,
    });
    return isRateLimitedInMemory(`${scope}:${key}`, maxRequests, windowMs);
  }
}

export async function evaluateSharedRateLimit(env, scope, key, maxRequests, windowMs, options = {}) {
  try {
    return {
      limited: await isSharedRateLimited(env, scope, key, maxRequests, windowMs, options),
      unavailable: false,
    };
  } catch (error) {
    if (isSharedRateLimitUnavailableError(error)) {
      return {
        limited: false,
        unavailable: true,
      };
    }
    throw error;
  }
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'unknown';
}
