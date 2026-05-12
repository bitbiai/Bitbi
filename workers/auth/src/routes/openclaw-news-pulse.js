import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  isRequestBodyError,
  readTextBodyLimited,
} from "../lib/request.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import { sha256Hex } from "../lib/tokens.js";
import {
  OpenClawNewsPulseValidationError,
  ingestOpenClawNewsPulseItems,
} from "../lib/news-pulse.js";
import {
  NEWS_PULSE_VISUAL_INGEST_BATCH_LIMIT,
  processNewsPulseVisualBackfillForItemIds,
} from "../lib/news-pulse-visuals.js";
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

const OPENCLAW_INGEST_PATH = "/api/openclaw/news-pulse/ingest";
const OPENCLAW_SIGNATURE_PREFIX = "sha256=";
const OPENCLAW_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const OPENCLAW_RATE_WINDOW_MS = 10 * 60 * 1000;
const OPENCLAW_AGENT_RATE_LIMIT = 30;
const OPENCLAW_IP_RATE_LIMIT = 60;
const OPENCLAW_AGENT_PATTERN = /^[A-Za-z0-9._:-]{2,64}$/;
const OPENCLAW_NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const textEncoder = new TextEncoder();

class OpenClawIngestError extends Error {
  constructor(message, {
    status = 400,
    code = "openclaw_ingest_invalid_payload",
    reason = null,
  } = {}) {
    super(message);
    this.name = "OpenClawIngestError";
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

function openClawErrorResponse(error, correlationId = null) {
  return withCorrelationId(
    json({
      ok: false,
      error: error?.message || "OpenClaw ingest request failed.",
      code: error?.code || "openclaw_ingest_invalid_payload",
    }, { status: Number(error?.status || 400) }),
    correlationId
  );
}

function logOpenClawEvent(ctx, {
  event,
  level = "info",
  agent = null,
  locale = null,
  itemCount = null,
  storedCount = null,
  dryRun = null,
  queuedCount = null,
  scannedCount = null,
  readyCount = null,
  failedCount = null,
  skippedCount = null,
  reason = null,
  status = null,
  code = null,
  error = null,
} = {}) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "openclaw-news-pulse-ingest",
    event,
    level,
    correlationId: ctx.correlationId,
    agent,
    locale,
    item_count: itemCount,
    stored_count: storedCount,
    dry_run: dryRun,
    queued_count: queuedCount,
    scanned_count: scannedCount,
    ready_count: readyCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
    reason,
    status,
    code,
    ...getRequestLogFields(ctx),
    ...getErrorFields(error, { includeMessage: false }),
  });
}

function normalizeOpenClawSecret(value) {
  const secret = String(value || "").trim();
  if (secret.length < 32) {
    throw new OpenClawIngestError("OpenClaw ingest is not configured.", {
      status: 503,
      code: "openclaw_ingest_not_configured",
      reason: "secret_missing_or_short",
    });
  }
  return secret;
}

function getOpenClawSecrets(env, keyId) {
  const current = normalizeOpenClawSecret(env?.OPENCLAW_INGEST_SECRET);
  const next = String(env?.OPENCLAW_INGEST_SECRET_NEXT || "").trim();
  const normalizedKeyId = String(keyId || "").trim().toLowerCase();

  if (normalizedKeyId && normalizedKeyId !== "current" && normalizedKeyId !== "next") {
    throw new OpenClawIngestError("OpenClaw ingest authentication failed.", {
      status: 401,
      code: "openclaw_ingest_unauthorized",
      reason: "key_id_invalid",
    });
  }
  if (normalizedKeyId === "current") return [current];
  if (normalizedKeyId === "next") {
    if (next.length < 32) {
      throw new OpenClawIngestError("OpenClaw ingest authentication failed.", {
        status: 401,
        code: "openclaw_ingest_unauthorized",
        reason: "next_secret_unavailable",
      });
    }
    return [next];
  }
  return next.length >= 32 ? [current, next] : [current];
}

function normalizeAgent(value) {
  const agent = String(value || "").trim();
  if (!OPENCLAW_AGENT_PATTERN.test(agent)) {
    throw new OpenClawIngestError("OpenClaw ingest authentication failed.", {
      status: 401,
      code: "openclaw_ingest_unauthorized",
      reason: "agent_invalid",
    });
  }
  return agent;
}

function normalizeNonce(value) {
  const nonce = String(value || "").trim();
  if (!OPENCLAW_NONCE_PATTERN.test(nonce)) {
    throw new OpenClawIngestError("OpenClaw ingest authentication failed.", {
      status: 401,
      code: "openclaw_ingest_unauthorized",
      reason: "nonce_invalid",
    });
  }
  return nonce;
}

function parseOpenClawTimestamp(value, { now = Date.now() } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new OpenClawIngestError("OpenClaw ingest timestamp is invalid.", {
      status: 401,
      code: "openclaw_ingest_timestamp_invalid",
      reason: "timestamp_missing",
    });
  }
  let timestampMs = Number.NaN;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    timestampMs = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  } else {
    timestampMs = Date.parse(raw);
  }
  if (!Number.isFinite(timestampMs) || Math.abs(Number(now) - timestampMs) > OPENCLAW_REPLAY_WINDOW_MS) {
    throw new OpenClawIngestError("OpenClaw ingest timestamp is invalid.", {
      status: 401,
      code: "openclaw_ingest_timestamp_invalid",
      reason: "timestamp_stale_or_invalid",
    });
  }
  return { raw, timestampMs };
}

function parseOpenClawSignature(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw.startsWith(OPENCLAW_SIGNATURE_PREFIX)) {
    throw new OpenClawIngestError("OpenClaw ingest authentication failed.", {
      status: 401,
      code: "openclaw_ingest_unauthorized",
      reason: "signature_missing",
    });
  }
  const signature = raw.slice(OPENCLAW_SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new OpenClawIngestError("OpenClaw ingest signature is invalid.", {
      status: 401,
      code: "openclaw_ingest_signature_invalid",
      reason: "signature_malformed",
    });
  }
  return signature;
}

export function buildOpenClawCanonicalString({ method, pathname, timestamp, nonce, bodyHash }) {
  return [
    String(method || "").toUpperCase(),
    String(pathname || ""),
    String(timestamp || ""),
    String(nonce || ""),
    String(bodyHash || ""),
  ].join("\n");
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqualHex(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function verifyOpenClawSignature({ secrets, suppliedSignature, canonical }) {
  for (const secret of secrets) {
    const expected = await hmacSha256Hex(secret, canonical);
    if (constantTimeEqualHex(suppliedSignature, expected)) return true;
  }
  return false;
}

function isMissingNonceTable(error) {
  return String(error?.message || error).includes("no such table") &&
    String(error?.message || error).includes("openclaw_ingest_nonces");
}

function isConstraintError(error) {
  const message = String(error?.message || error).toLowerCase();
  return message.includes("constraint") || message.includes("unique");
}

async function recordOpenClawNonce(env, { nonce, agent, bodyHash, nowMs }) {
  if (!env?.DB) {
    throw new OpenClawIngestError("OpenClaw ingest is not configured.", {
      status: 503,
      code: "openclaw_ingest_not_configured",
      reason: "db_missing",
    });
  }
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + OPENCLAW_REPLAY_WINDOW_MS).toISOString();
  try {
    await env.DB.prepare(
      "DELETE FROM openclaw_ingest_nonces WHERE expires_at < ?"
    ).bind(createdAt).run();
    await env.DB.prepare(
      `INSERT INTO openclaw_ingest_nonces (nonce, agent, body_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(nonce, agent, bodyHash, createdAt, expiresAt).run();
  } catch (error) {
    if (isMissingNonceTable(error)) {
      throw new OpenClawIngestError("OpenClaw ingest is not configured.", {
        status: 503,
        code: "openclaw_ingest_not_configured",
        reason: "nonce_table_missing",
      });
    }
    if (isConstraintError(error)) {
      throw new OpenClawIngestError("OpenClaw ingest replay rejected.", {
        status: 409,
        code: "openclaw_ingest_replay",
        reason: "nonce_reused",
      });
    }
    throw error;
  }
}

async function enforceOpenClawRateLimit(ctx, { scope, key, maxRequests }) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    scope,
    key,
    maxRequests,
    OPENCLAW_RATE_WINDOW_MS,
    sensitiveRateLimitOptions({
      component: "openclaw-news-pulse-ingest",
      correlationId: ctx.correlationId,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) {
    throw new OpenClawIngestError("OpenClaw ingest rate limit is unavailable.", {
      status: 503,
      code: "openclaw_ingest_rate_limited",
      reason: "rate_limit_unavailable",
    });
  }
  if (result.limited) {
    throw new OpenClawIngestError("OpenClaw ingest rate limit exceeded.", {
      status: 429,
      code: "openclaw_ingest_rate_limited",
      reason: "rate_limited",
    });
  }
}

function parseOpenClawPayload(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be an object");
    }
    return parsed;
  } catch {
    throw new OpenClawIngestError("OpenClaw ingest payload is invalid.", {
      status: 400,
      code: "openclaw_ingest_invalid_payload",
      reason: "invalid_json",
    });
  }
}

function mapOpenClawValidationError(error) {
  if (error instanceof OpenClawNewsPulseValidationError) {
    return new OpenClawIngestError(error.message, {
      status: error.status || 400,
      code: error.code || "openclaw_ingest_validation_error",
      reason: error.field || "validation",
    });
  }
  if (String(error?.message || error).includes("no such table") &&
      String(error?.message || error).includes("news_pulse_items")) {
    return new OpenClawIngestError("OpenClaw ingest is not configured.", {
      status: 503,
      code: "openclaw_ingest_not_configured",
      reason: "news_pulse_table_missing",
    });
  }
  if (String(error?.message || error).includes("no such column") &&
      String(error?.message || error).includes("visual_")) {
    return new OpenClawIngestError("OpenClaw ingest is not configured.", {
      status: 503,
      code: "openclaw_ingest_not_configured",
      reason: "news_pulse_visual_schema_missing",
    });
  }
  return error;
}

function scheduleOpenClawNewsPulseVisualBackfill(ctx, {
  result,
  agent = null,
  locale = null,
} = {}) {
  const itemIds = (result?.items || [])
    .map((item) => item?.id)
    .filter(Boolean);
  const limit = Math.min(
    NEWS_PULSE_VISUAL_INGEST_BATCH_LIMIT,
    Math.max(Number(result?.stored_count || 0), 0),
    itemIds.length
  );

  if (result?.dry_run || limit <= 0) return;

  if (!ctx?.execCtx || typeof ctx.execCtx.waitUntil !== "function") {
    logOpenClawEvent(ctx, {
      event: "openclaw_news_pulse_visual_backfill_skipped",
      level: "info",
      agent,
      locale,
      itemCount: itemIds.length,
      storedCount: result?.stored_count || 0,
      queuedCount: 0,
      reason: "exec_ctx_missing",
    });
    return;
  }

  logOpenClawEvent(ctx, {
    event: "openclaw_news_pulse_visual_backfill_queued",
    level: "info",
    agent,
    locale,
    itemCount: itemIds.length,
    storedCount: result?.stored_count || 0,
    queuedCount: limit,
  });

  const promise = Promise.resolve()
    .then(() => processNewsPulseVisualBackfillForItemIds({
      env: ctx.env,
      itemIds,
      now: new Date().toISOString(),
      limit,
      correlationId: ctx.correlationId,
    }))
    .then((backfill) => {
      logOpenClawEvent(ctx, {
        event: backfill.skipped
          ? "openclaw_news_pulse_visual_backfill_skipped"
          : "openclaw_news_pulse_visual_backfill_completed",
        level: backfill.failedCount > 0 ? "warn" : "info",
        agent,
        locale,
        itemCount: itemIds.length,
        storedCount: result?.stored_count || 0,
        queuedCount: limit,
        scannedCount: backfill.scannedCount,
        readyCount: backfill.readyCount,
        failedCount: backfill.failedCount,
        skippedCount: backfill.skippedCount,
        reason: backfill.reason || null,
      });
    })
    .catch((error) => {
      logOpenClawEvent(ctx, {
        event: "openclaw_news_pulse_visual_backfill_failed",
        level: "warn",
        agent,
        locale,
        itemCount: itemIds.length,
        storedCount: result?.stored_count || 0,
        queuedCount: limit,
        error,
      });
    });

  ctx.execCtx.waitUntil(promise);
}

export async function handleOpenClawNewsPulseIngest(ctx) {
  let agent = null;
  let payload = null;

  try {
    if (!ctx.isSecure) {
      throw new OpenClawIngestError("OpenClaw ingest requires HTTPS.", {
        status: 403,
        code: "openclaw_ingest_unauthorized",
        reason: "https_required",
      });
    }

    await enforceOpenClawRateLimit(ctx, {
      scope: "openclaw-news-pulse-ip",
      key: getClientIp(ctx.request),
      maxRequests: OPENCLAW_IP_RATE_LIMIT,
    });

    agent = normalizeAgent(ctx.request.headers.get("X-OpenClaw-Agent"));
    await enforceOpenClawRateLimit(ctx, {
      scope: "openclaw-news-pulse-agent",
      key: agent.toLowerCase(),
      maxRequests: OPENCLAW_AGENT_RATE_LIMIT,
    });

    const secrets = getOpenClawSecrets(ctx.env, ctx.request.headers.get("X-OpenClaw-Key-Id"));
    const timestamp = parseOpenClawTimestamp(ctx.request.headers.get("X-OpenClaw-Timestamp"));
    const nonce = normalizeNonce(ctx.request.headers.get("X-OpenClaw-Nonce"));
    const suppliedSignature = parseOpenClawSignature(ctx.request.headers.get("X-OpenClaw-Signature"));

    let rawBody = "";
    try {
      rawBody = await readTextBodyLimited(ctx.request, {
        maxBytes: BODY_LIMITS.openClawIngestRaw,
        allowedTypes: ["application/json"],
      });
    } catch (error) {
      if (isRequestBodyError(error)) {
        throw new OpenClawIngestError(error.publicMessage || "OpenClaw ingest payload is invalid.", {
          status: error.status || 400,
          code: "openclaw_ingest_invalid_payload",
          reason: error.code || "body_error",
        });
      }
      throw error;
    }

    const bodyHash = await sha256Hex(rawBody);
    const canonical = buildOpenClawCanonicalString({
      method: ctx.method,
      pathname: OPENCLAW_INGEST_PATH,
      timestamp: timestamp.raw,
      nonce,
      bodyHash,
    });
    const verified = await verifyOpenClawSignature({
      secrets,
      suppliedSignature,
      canonical,
    });
    if (!verified) {
      throw new OpenClawIngestError("OpenClaw ingest signature is invalid.", {
        status: 401,
        code: "openclaw_ingest_signature_invalid",
        reason: "signature_invalid",
      });
    }

    await recordOpenClawNonce(ctx.env, {
      nonce,
      agent,
      bodyHash,
      nowMs: timestamp.timestampMs,
    });

    payload = parseOpenClawPayload(rawBody);
    const result = await ingestOpenClawNewsPulseItems(ctx.env, payload, {
      agent,
      now: new Date().toISOString(),
      dryRun: payload.dry_run === true,
    }).catch((error) => {
      throw mapOpenClawValidationError(error);
    });

    scheduleOpenClawNewsPulseVisualBackfill(ctx, {
      result,
      agent,
      locale: payload.locale,
    });

    logOpenClawEvent(ctx, {
      event: "openclaw_news_pulse_ingest_accepted",
      agent,
      locale: payload.locale,
      itemCount: Array.isArray(payload.items) ? payload.items.length : null,
      storedCount: result.stored_count,
      dryRun: result.dry_run,
      status: 200,
    });

    return withCorrelationId(json({
      ok: true,
      stored_count: result.stored_count,
      skipped_count: result.skipped_count,
      dry_run: result.dry_run,
      items: result.items,
    }), ctx.correlationId);
  } catch (error) {
    const mapped = error instanceof OpenClawIngestError ? error : mapOpenClawValidationError(error);
    const responseError = mapped instanceof OpenClawIngestError
      ? mapped
      : new OpenClawIngestError("OpenClaw ingest request failed.", {
          status: 500,
          code: "openclaw_ingest_invalid_payload",
          reason: "unexpected",
        });
    logOpenClawEvent(ctx, {
      event: responseError.code === "openclaw_ingest_replay"
        ? "openclaw_news_pulse_ingest_replay_rejected"
        : (responseError.code === "openclaw_ingest_signature_invalid" || responseError.code === "openclaw_ingest_unauthorized"
            ? "openclaw_news_pulse_ingest_auth_rejected"
            : "openclaw_news_pulse_ingest_rejected"),
      level: responseError.status >= 500 ? "error" : "warn",
      agent,
      locale: payload?.locale || null,
      itemCount: Array.isArray(payload?.items) ? payload.items.length : null,
      storedCount: 0,
      dryRun: payload?.dry_run === true ? true : null,
      status: responseError.status,
      code: responseError.code,
      error: responseError,
    });
    return openClawErrorResponse(responseError, ctx.correlationId);
  }
}
