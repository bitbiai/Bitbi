const rateLimitBuckets = new Map();

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

export async function isSharedRateLimited(env, scope, key, maxRequests, windowMs) {
  if (!env?.DB) {
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
    console.error("Shared contact rate limiter unavailable, falling back to in-memory limiter", e);
    return isRateLimitedInMemory(`${scope}:${key}`, maxRequests, windowMs);
  }
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'unknown';
}
