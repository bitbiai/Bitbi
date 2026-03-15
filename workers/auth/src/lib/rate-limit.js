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

export function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export function rateLimitResponse() {
  return json(
    { ok: false, error: "Too many requests. Please try again later." },
    { status: 429 }
  );
}
