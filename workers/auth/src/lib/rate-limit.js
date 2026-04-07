import { json } from "./response.js";

// ── Per-isolate sliding window rate limiter ──
const rateLimitBuckets = new Map();
const RATE_LIMIT_CLEANUP_INTERVAL = 60_000;
let lastRateLimitCleanup = Date.now();

export function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  if (now - lastRateLimitCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
    lastRateLimitCleanup = now;
    for (const [k, entries] of rateLimitBuckets) {
      if (entries.length === 0 || entries[entries.length - 1] <= now - windowMs) {
        rateLimitBuckets.delete(k);
      }
    }
  }
  let entries = rateLimitBuckets.get(key);
  if (!entries) {
    entries = [];
    rateLimitBuckets.set(key, entries);
  }
  const windowStart = now - windowMs;
  while (entries.length > 0 && entries[0] <= windowStart) entries.shift();
  if (entries.length >= maxRequests) return true;
  entries.push(now);
  return false;
}

function getFixedWindowStartMs(nowMs, windowMs) {
  return nowMs - (nowMs % windowMs);
}

export async function isSharedRateLimited(env, scope, key, maxRequests, windowMs) {
  if (!env?.DB) {
    return isRateLimited(`${scope}:${key}`, maxRequests, windowMs);
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
    console.error("Shared rate limiter unavailable, falling back to in-memory limiter", e);
    return isRateLimited(`${scope}:${key}`, maxRequests, windowMs);
  }
}

export function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export function rateLimitResponse() {
  return json(
    { ok: false, error: "Too many requests. Please try again later." },
    { status: 429 }
  );
}
