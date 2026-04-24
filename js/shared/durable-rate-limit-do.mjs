const WINDOW_START_MS_KEY = "window_start_ms";
const COUNT_KEY = "count";
const EXPIRES_AT_MS_KEY = "expires_at_ms";
const NONCE_USED_KEY = "nonce_used";
const JSON_HEADERS = {
  "content-type": "application/json",
};

export function getDurableObjectBaseClass() {
  return globalThis.DurableObject || class DurableObjectFallback {
    constructor(state, env) {
      this.ctx = state;
      this.env = env;
    }
  };
}

function buildJsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function getRequestPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

function getFixedWindowStartMs(nowMs, windowMs) {
  return nowMs - (nowMs % windowMs);
}

async function readStoredCounter(storage) {
  const [windowStartMs, count, expiresAtMs] = await Promise.all([
    storage.get(WINDOW_START_MS_KEY),
    storage.get(COUNT_KEY),
    storage.get(EXPIRES_AT_MS_KEY),
  ]);
  return {
    windowStartMs: Number.isInteger(windowStartMs) ? windowStartMs : null,
    count: Number.isInteger(count) ? count : 0,
    expiresAtMs: Number.isInteger(expiresAtMs) ? expiresAtMs : null,
  };
}

async function writeStoredCounter(storage, { windowStartMs, count, expiresAtMs }) {
  await Promise.all([
    storage.put(WINDOW_START_MS_KEY, windowStartMs),
    storage.put(COUNT_KEY, count),
    storage.put(EXPIRES_AT_MS_KEY, expiresAtMs),
  ]);
  if (typeof storage.setAlarm === "function") {
    await storage.setAlarm(expiresAtMs);
  }
}

export async function clearDurableRateLimitState(state) {
  const storage = state?.storage;
  if (!storage) return;
  if (typeof storage.deleteAll === "function") {
    await storage.deleteAll();
    return;
  }
  await Promise.all([
    storage.delete?.(WINDOW_START_MS_KEY),
    storage.delete?.(COUNT_KEY),
    storage.delete?.(EXPIRES_AT_MS_KEY),
    storage.delete?.(NONCE_USED_KEY),
  ]);
}

async function handleDurableFixedWindowLimitRequest(state, request) {
  if (request.method !== "POST") {
    return buildJsonResponse(
      { ok: false, error: "Method not allowed." },
      405,
      { Allow: "POST" }
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return buildJsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const maxRequests = parsePositiveInteger(body?.maxRequests);
  const windowMs = parsePositiveInteger(body?.windowMs);
  if (!maxRequests || !windowMs) {
    return buildJsonResponse({ ok: false, error: "Invalid rate limit request." }, 400);
  }

  const nowMs = Date.now();
  const windowStartMs = getFixedWindowStartMs(nowMs, windowMs);
  const expiresAtMs = windowStartMs + windowMs;
  const storage = state?.storage;
  if (!storage) {
    return buildJsonResponse({ ok: false, error: "Durable storage unavailable." }, 503);
  }

  const stored = await readStoredCounter(storage);
  const count =
    stored.windowStartMs === windowStartMs && stored.expiresAtMs === expiresAtMs
      ? stored.count + 1
      : 1;

  await writeStoredCounter(storage, { windowStartMs, count, expiresAtMs });

  return buildJsonResponse({
    ok: true,
    limited: count > maxRequests,
    count,
    window_start_ms: windowStartMs,
    expires_at_ms: expiresAtMs,
  });
}

export async function handleDurableNonceReplayRequest(state, request) {
  if (request.method !== "POST") {
    return buildJsonResponse(
      { ok: false, error: "Method not allowed." },
      405,
      { Allow: "POST" }
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return buildJsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const ttlMs = parsePositiveInteger(body?.ttlMs);
  if (!ttlMs || ttlMs > 60 * 60 * 1000) {
    return buildJsonResponse({ ok: false, error: "Invalid nonce replay request." }, 400);
  }

  const storage = state?.storage;
  if (!storage) {
    return buildJsonResponse({ ok: false, error: "Durable storage unavailable." }, 503);
  }

  const nowMs = Date.now();
  const existingExpiresAtMs = await storage.get(EXPIRES_AT_MS_KEY);
  if (Number.isInteger(existingExpiresAtMs) && existingExpiresAtMs > nowMs) {
    return buildJsonResponse({
      ok: true,
      replayed: true,
      expires_at_ms: existingExpiresAtMs,
    });
  }

  const expiresAtMs = nowMs + ttlMs;
  await Promise.all([
    storage.put(NONCE_USED_KEY, true),
    storage.put(EXPIRES_AT_MS_KEY, expiresAtMs),
  ]);
  if (typeof storage.setAlarm === "function") {
    await storage.setAlarm(expiresAtMs);
  }

  return buildJsonResponse({
    ok: true,
    replayed: false,
    expires_at_ms: expiresAtMs,
  });
}

export async function handleDurableRateLimitRequest(state, request) {
  const pathname = getRequestPathname(request);
  if (pathname.endsWith("/nonce")) {
    return handleDurableNonceReplayRequest(state, request);
  }
  return handleDurableFixedWindowLimitRequest(state, request);
}
