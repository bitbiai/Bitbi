import { nowIso, randomTokenHex } from "./tokens.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export const AI_IMAGE_DERIVATIVE_VERSION = 1;
export const AI_IMAGE_DERIVATIVE_QUEUE_SCHEMA_VERSION = 1;
export const AI_IMAGE_DERIVATIVE_LEASE_MS = 15 * 60 * 1000;
export const AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS = 2 * 60 * 1000;
export const AI_IMAGE_DERIVATIVE_RECOVERY_REENQUEUE_COOLDOWN_MS = 15 * 60 * 1000;
export const AI_IMAGE_DERIVATIVE_PRESETS = {
  thumb: {
    variant: "thumb",
    maxWidth: 320,
    maxHeight: 320,
    quality: 82,
    format: "image/webp",
  },
  medium: {
    variant: "medium",
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 86,
    format: "image/webp",
  },
};

const MAX_DERIVATIVE_ERROR_LENGTH = 500;

class PermanentAiImageDerivativeError extends Error {
  constructor(message, code = "permanent_error") {
    super(message);
    this.name = "PermanentAiImageDerivativeError";
    this.code = code;
    this.permanent = true;
  }
}

function permanentAiImageDerivativeError(message, code) {
  return new PermanentAiImageDerivativeError(message, code);
}

function toLeaseExpiresAt(baseMs = Date.now()) {
  return new Date(baseMs + AI_IMAGE_DERIVATIVE_LEASE_MS).toISOString();
}

function toIsoOrNull(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function sanitizeDerivativeError(error) {
  const raw = error?.message || String(error || "Derivative generation failed.");
  return raw.slice(0, MAX_DERIVATIVE_ERROR_LENGTH);
}

function parseDimensionsFromMockPayload(bytes) {
  try {
    const text = new TextDecoder().decode(bytes);
    const match = text.match(/^mock-image:(\d+)x(\d+):/);
    if (!match) return null;
    return {
      width: Math.max(1, Number(match[1]) || 1),
      height: Math.max(1, Number(match[2]) || 1),
    };
  } catch {
    return null;
  }
}

function scaleDownDimensions(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(1, Number(width) || maxWidth || 1);
  const safeHeight = Math.max(1, Number(height) || maxHeight || 1);
  const ratio = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);
  return {
    width: Math.max(1, Math.round(safeWidth * ratio)),
    height: Math.max(1, Math.round(safeHeight * ratio)),
  };
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (typeof value.getReader === "function") {
    try {
      return await new Response(value).arrayBuffer();
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value).buffer;
  }
  return null;
}

export function buildAiImageDerivativeKeys(userId, imageId, version = AI_IMAGE_DERIVATIVE_VERSION) {
  return {
    thumb: `users/${userId}/derivatives/v${version}/${imageId}/thumb.webp`,
    medium: `users/${userId}/derivatives/v${version}/${imageId}/medium.webp`,
  };
}

export function buildAiImageDerivativeMessage({
  imageId,
  userId,
  originalKey,
  derivativesVersion = AI_IMAGE_DERIVATIVE_VERSION,
  enqueuedAt = nowIso(),
  correlationId = randomTokenHex(16),
  trigger = "save",
} = {}) {
  return {
    schema_version: AI_IMAGE_DERIVATIVE_QUEUE_SCHEMA_VERSION,
    type: "ai_image_derivative.generate",
    image_id: imageId,
    user_id: userId,
    original_key: originalKey,
    derivatives_version: derivativesVersion,
    enqueued_at: enqueuedAt,
    correlation_id: correlationId,
    trigger,
  };
}

export function getAiImageOriginalUrl(imageId) {
  return `/api/ai/images/${imageId}/file`;
}

export function getAiImageThumbUrl(imageId) {
  return `/api/ai/images/${imageId}/thumb`;
}

export function getAiImageMediumUrl(imageId) {
  return `/api/ai/images/${imageId}/medium`;
}

export function hasReadyAiImageDerivatives(row) {
  return !!(
    row &&
    row.derivatives_status === "ready" &&
    row.thumb_key &&
    row.medium_key
  );
}

export function hasActiveAiImageDerivativeLease(row, now = nowIso()) {
  return !!(
    row &&
    row.derivatives_status === "processing" &&
    row.derivatives_lease_expires_at &&
    String(row.derivatives_lease_expires_at) > now
  );
}

export function hasRecentAiImageDerivativeAttempt(
  row,
  cooldownMs = AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS,
  nowMs = Date.now()
) {
  if (!row || !cooldownMs || cooldownMs <= 0) return false;
  const attemptedMs = parseIsoMs(row.derivatives_attempted_at);
  if (!attemptedMs) return false;
  return attemptedMs > (nowMs - cooldownMs);
}

export function shouldAttemptOnDemandAiImageDerivative(
  row,
  {
    now = nowIso(),
    cooldownMs = AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS,
  } = {}
) {
  if (!row?.r2_key) return false;
  if (hasActiveAiImageDerivativeLease(row, now)) return false;
  return !hasRecentAiImageDerivativeAttempt(row, cooldownMs, Date.parse(now) || Date.now());
}

export function needsAiImageDerivativeRefresh(
  row,
  targetVersion = AI_IMAGE_DERIVATIVE_VERSION,
  now = nowIso()
) {
  if (!row) return false;
  if (hasReadyAiImageDerivatives(row) && Number(row.derivatives_version || 0) >= targetVersion) {
    return false;
  }
  if (hasActiveAiImageDerivativeLease(row, now)) {
    return false;
  }
  return true;
}

export function getAiImageDerivativeRetryDelaySeconds(attempts = 1) {
  const attemptNumber = Math.max(1, Number(attempts) || 1);
  return Math.min(30 * (2 ** Math.max(0, attemptNumber - 1)), 15 * 60);
}

export function listAiImageObjectKeys(row) {
  return Array.from(new Set([row?.r2_key, row?.thumb_key, row?.medium_key].filter(Boolean)));
}

export function buildAiImageCleanupQueueInsertSql(whereClause) {
  return `WITH matches AS (
    SELECT r2_key, thumb_key, medium_key
    FROM ai_images
    WHERE ${whereClause}
  )
  INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
  SELECT r2_key, 'pending', ? FROM matches
  UNION ALL
  SELECT thumb_key, 'pending', ? FROM matches WHERE thumb_key IS NOT NULL
  UNION ALL
  SELECT medium_key, 'pending', ? FROM matches WHERE medium_key IS NOT NULL`;
}

export function toAiImageAssetRecord(row, options = {}) {
  const originalUrl = getAiImageOriginalUrl(row.id);
  const ready = hasReadyAiImageDerivatives(row);
  const record = {
    id: row.id,
    folder_id: row.folder_id,
    title: row.prompt,
    prompt: row.prompt,
    preview_text: row.prompt,
    model: row.model,
    steps: row.steps,
    seed: row.seed,
    created_at: row.created_at,
    file_url: originalUrl,
    original_url: originalUrl,
    thumb_url: ready ? getAiImageThumbUrl(row.id) : null,
    medium_url: ready ? getAiImageMediumUrl(row.id) : null,
    derivatives_status: row.derivatives_status || "pending",
    derivatives_version: row.derivatives_version ?? null,
    visibility: row.visibility || "private",
    is_public: (row.visibility || "private") === "public",
    published_at: row.published_at ?? null,
    thumb_width: row.thumb_width ?? null,
    thumb_height: row.thumb_height ?? null,
    medium_width: row.medium_width ?? null,
    medium_height: row.medium_height ?? null,
  };
  if (options.assetType) {
    record.asset_type = options.assetType;
  }
  return record;
}

export async function enqueueAiImageDerivativeJob(env, payload) {
  if (!env.AI_IMAGE_DERIVATIVES_QUEUE || typeof env.AI_IMAGE_DERIVATIVES_QUEUE.send !== "function") {
    throw permanentAiImageDerivativeError("AI image derivative queue binding is unavailable.", "queue_binding_missing");
  }
  const message = buildAiImageDerivativeMessage(payload);
  await env.AI_IMAGE_DERIVATIVES_QUEUE.send(message);
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-image-derivatives",
    event: "ai_derivative_enqueued",
    correlationId: message.correlation_id,
    image_id: message.image_id,
    user_id: message.user_id,
    derivatives_version: message.derivatives_version,
    trigger: message.trigger,
  });
  return message;
}

export function parseAiImageDerivativeCursor(cursor) {
  if (!cursor) return null;
  const normalized = String(cursor);
  const sep = normalized.indexOf("|");
  if (sep <= 0 || sep === normalized.length - 1) {
    throw new Error("Invalid cursor.");
  }
  return {
    createdAt: normalized.slice(0, sep),
    id: normalized.slice(sep + 1),
  };
}

export function buildAiImageDerivativeCursor(row) {
  if (!row) return null;
  return `${row.created_at}|${row.id}`;
}

export async function listAiImagesNeedingDerivativeWork(
  env,
  {
    limit = 50,
    cursor = null,
    includeFailed = true,
    now = nowIso(),
    targetVersion = AI_IMAGE_DERIVATIVE_VERSION,
    attemptedBefore = null,
  } = {}
) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const cursorParts = parseAiImageDerivativeCursor(cursor);
  const conditions = [
    "(" +
      "COALESCE(derivatives_version, 0) < ?" +
      " OR derivatives_status != 'ready'" +
      " OR thumb_key IS NULL" +
      " OR medium_key IS NULL" +
    ")",
    "(derivatives_status != 'processing' OR derivatives_lease_expires_at IS NULL OR derivatives_lease_expires_at < ?)",
  ];
  const bindings = [targetVersion, now];

  if (!includeFailed) {
    conditions.push("derivatives_status != 'failed'");
  }

  const attemptedBeforeIso = toIsoOrNull(attemptedBefore);
  if (attemptedBeforeIso) {
    conditions.push("(derivatives_attempted_at IS NULL OR derivatives_attempted_at <= ?)");
    bindings.push(attemptedBeforeIso);
  }

  if (cursorParts) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    bindings.push(cursorParts.createdAt, cursorParts.createdAt, cursorParts.id);
  }

  const rows = await env.DB.prepare(
    `SELECT id, user_id, r2_key, created_at, thumb_key, medium_key,
            derivatives_status, derivatives_version, derivatives_attempted_at, derivatives_lease_expires_at
     FROM ai_images
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(...bindings, safeLimit + 1).all();

  const resultRows = rows.results || [];
  const hasMore = resultRows.length > safeLimit;
  const items = hasMore ? resultRows.slice(0, safeLimit) : resultRows;
  return {
    rows: items,
    hasMore,
    nextCursor: hasMore ? buildAiImageDerivativeCursor(items[items.length - 1]) : null,
  };
}

export function isPermanentAiImageDerivativeError(error) {
  if (error?.permanent) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("original image not found") ||
    message.includes("unsupported original image") ||
    message.includes("invalid image") ||
    message.includes("could not decode")
  );
}

function normalizeAiImageDerivativeMessage(messageBody) {
  const body = messageBody && typeof messageBody === "object" ? messageBody : null;
  if (!body) {
    throw permanentAiImageDerivativeError("Queue payload must be an object.", "bad_queue_payload");
  }
  if (body.type !== "ai_image_derivative.generate") {
    throw permanentAiImageDerivativeError("Queue payload type is invalid.", "bad_queue_payload");
  }
  if (Number(body.schema_version) !== AI_IMAGE_DERIVATIVE_QUEUE_SCHEMA_VERSION) {
    throw permanentAiImageDerivativeError("Queue payload schema version is invalid.", "bad_queue_payload");
  }
  if (typeof body.image_id !== "string" || !body.image_id) {
    throw permanentAiImageDerivativeError("Queue payload image_id is required.", "bad_queue_payload");
  }
  if (typeof body.user_id !== "string" || !body.user_id) {
    throw permanentAiImageDerivativeError("Queue payload user_id is required.", "bad_queue_payload");
  }
  if (typeof body.original_key !== "string" || !body.original_key) {
    throw permanentAiImageDerivativeError("Queue payload original_key is required.", "bad_queue_payload");
  }
  const derivativesVersion = Number(body.derivatives_version);
  if (!Number.isInteger(derivativesVersion) || derivativesVersion < 1) {
    throw permanentAiImageDerivativeError("Queue payload derivatives_version is invalid.", "bad_queue_payload");
  }
  return {
    schemaVersion: Number(body.schema_version),
    imageId: body.image_id,
    userId: body.user_id,
    originalKey: body.original_key,
    derivativesVersion,
    enqueuedAt: body.enqueued_at || null,
    correlationId: body.correlation_id || null,
    trigger: body.trigger || "unknown",
  };
}

async function fetchAiImageDerivativeRow(env, imageId, userId) {
  return env.DB.prepare(
    `SELECT id, user_id, r2_key, thumb_key, medium_key, derivatives_status,
            derivatives_version, derivatives_processing_token, derivatives_lease_expires_at
     FROM ai_images
     WHERE id = ? AND user_id = ?`
  ).bind(imageId, userId).first();
}

async function acquireAiImageDerivativeLease(env, payload, processingToken, now, leaseExpiresAt) {
  return env.DB.prepare(
    `UPDATE ai_images
     SET derivatives_status = 'processing',
         derivatives_error = NULL,
         derivatives_started_at = CASE
           WHEN derivatives_status = 'processing' AND derivatives_lease_expires_at > ? THEN derivatives_started_at
           ELSE ?
         END,
         derivatives_attempted_at = ?,
         derivatives_processing_token = ?,
         derivatives_lease_expires_at = ?
     WHERE id = ?
       AND user_id = ?
       AND (derivatives_status != 'processing' OR derivatives_lease_expires_at IS NULL OR derivatives_lease_expires_at <= ?)
       AND NOT (
         derivatives_status = 'ready'
         AND thumb_key IS NOT NULL
         AND medium_key IS NOT NULL
         AND COALESCE(derivatives_version, 0) >= ?
       )`
  ).bind(
    now,
    now,
    now,
    processingToken,
    leaseExpiresAt,
    payload.imageId,
    payload.userId,
    now,
    payload.derivativesVersion
  ).run();
}

async function finalizeAiImageDerivativeFailure(env, payload, processingToken, status, errorMessage) {
  return env.DB.prepare(
    `UPDATE ai_images
     SET derivatives_status = ?,
         derivatives_error = ?,
         derivatives_attempted_at = ?,
         derivatives_processing_token = NULL,
         derivatives_lease_expires_at = NULL
     WHERE id = ?
       AND user_id = ?
       AND derivatives_processing_token = ?`
  ).bind(status, errorMessage, nowIso(), payload.imageId, payload.userId, processingToken).run();
}

async function cleanupDerivativeKeysBestEffort(env, keys) {
  if (!env.USER_IMAGES || typeof env.USER_IMAGES.delete !== "function") return;
  for (const key of Array.from(new Set(keys.filter(Boolean)))) {
    try {
      await env.USER_IMAGES.delete(key);
    } catch {
      // Best effort cleanup only; durable delete paths use r2_cleanup_queue.
    }
  }
}

async function renderAiImageDerivative(env, originalBytes, originalInfo, preset) {
  if (!env.IMAGES || typeof env.IMAGES.input !== "function" || typeof env.IMAGES.info !== "function") {
    throw permanentAiImageDerivativeError("Images binding is unavailable.", "images_binding_missing");
  }

  // .output() returns a Promise<ImageTransformationResult>.
  // ImageTransformationResult exposes .response(), .image(), .contentType().
  const transformResult = await env.IMAGES.input(originalBytes)
    .transform({
      width: preset.maxWidth,
      height: preset.maxHeight,
      fit: "scale-down",
    })
    .output({
      format: preset.format,
      quality: preset.quality,
    });

  // Normalize to a standard Response. The Cloudflare Images binding resolves
  // .output() to an ImageTransformationResult (has .response(), .image(),
  // .contentType()). If the runtime ever changes to return a bare Response,
  // the fallback handles that too.
  let response;
  if (typeof transformResult.response === "function") {
    response = transformResult.response();
  } else if (typeof transformResult.arrayBuffer === "function") {
    response = transformResult;
  } else if (typeof transformResult.image === "function") {
    // ImageTransformationResult without .response() — read the stream
    const stream = transformResult.image();
    const contentType = typeof transformResult.contentType === "function"
      ? transformResult.contentType()
      : preset.format;
    response = new Response(stream, {
      headers: { "content-type": contentType },
    });
  } else {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-image-derivatives",
      event: "ai_derivative_transform_invalid_shape",
      level: "error",
      transform_type: typeof transformResult,
      transform_ctor: transformResult?.constructor?.name || null,
      transform_keys: Object.keys(transformResult || {}),
      preset: preset.variant,
    });
    throw new Error(`Derivative transform returned an invalid result for ${preset.variant}.`);
  }

  const buffer = await toArrayBuffer(response);
  if (!buffer || !buffer.byteLength) {
    throw new Error(`Derivative transform returned no bytes for ${preset.variant}.`);
  }

  const bytes = new Uint8Array(buffer);
  let info;
  try {
    info = await env.IMAGES.info(bytes);
  } catch {
    info = parseDimensionsFromMockPayload(bytes);
  }
  const fallback = scaleDownDimensions(
    originalInfo.width,
    originalInfo.height,
    preset.maxWidth,
    preset.maxHeight
  );

  return {
    bytes,
    mimeType: (response.headers && typeof response.headers.get === "function"
      ? response.headers.get("content-type")
      : null) || preset.format,
    width: info?.width || fallback.width,
    height: info?.height || fallback.height,
  };
}

export async function processAiImageDerivativeMessage(env, messageBody, { isLastAttempt = false } = {}) {
  const payload = normalizeAiImageDerivativeMessage(messageBody);
  const now = nowIso();
  const existing = await fetchAiImageDerivativeRow(env, payload.imageId, payload.userId);

  if (!existing) {
    return { status: "noop", reason: "missing_row", payload };
  }

  if (hasReadyAiImageDerivatives(existing) && Number(existing.derivatives_version || 0) >= payload.derivativesVersion) {
    return { status: "noop", reason: "already_ready", payload };
  }

  if (Number(existing.derivatives_version || 0) > payload.derivativesVersion) {
    return { status: "noop", reason: "stale_version", payload };
  }

  if (hasActiveAiImageDerivativeLease(existing, now)) {
    return { status: "noop", reason: "already_processing", payload };
  }

  const processingToken = randomTokenHex(16);
  const leaseExpiresAt = toLeaseExpiresAt(Date.now());
  const leaseResult = await acquireAiImageDerivativeLease(env, payload, processingToken, now, leaseExpiresAt);

  if (!leaseResult?.meta?.changes) {
    const latest = await fetchAiImageDerivativeRow(env, payload.imageId, payload.userId);
    if (!latest) return { status: "noop", reason: "missing_row", payload };
    if (hasReadyAiImageDerivatives(latest) && Number(latest.derivatives_version || 0) >= payload.derivativesVersion) {
      return { status: "noop", reason: "already_ready", payload };
    }
    if (hasActiveAiImageDerivativeLease(latest, now)) {
      return { status: "noop", reason: "already_processing", payload };
    }
    return { status: "noop", reason: "lease_not_acquired", payload };
  }

  const original = await env.USER_IMAGES.get(existing.r2_key);
  if (!original) {
    const error = permanentAiImageDerivativeError("Original image not found.", "original_missing");
    await finalizeAiImageDerivativeFailure(env, payload, processingToken, "failed", sanitizeDerivativeError(error));
    return { status: "failed", reason: "original_missing", error, payload };
  }

  const originalBuffer = await toArrayBuffer(original.body ?? original);
  if (!originalBuffer || !originalBuffer.byteLength) {
    const error = permanentAiImageDerivativeError("Unsupported original image.", "original_invalid");
    await finalizeAiImageDerivativeFailure(env, payload, processingToken, "failed", sanitizeDerivativeError(error));
    return { status: "failed", reason: "original_invalid", error, payload };
  }

  const originalBytes = new Uint8Array(originalBuffer);
  let originalInfo;
  try {
    originalInfo = await env.IMAGES.info(originalBytes);
  } catch {
    const error = permanentAiImageDerivativeError("Unsupported original image.", "original_invalid");
    await finalizeAiImageDerivativeFailure(env, payload, processingToken, "failed", sanitizeDerivativeError(error));
    return { status: "failed", reason: "original_invalid", error, payload };
  }

  const targetKeys = buildAiImageDerivativeKeys(payload.userId, payload.imageId, payload.derivativesVersion);
  const writtenKeys = [];

  try {
    const thumb = await renderAiImageDerivative(env, originalBytes, originalInfo, AI_IMAGE_DERIVATIVE_PRESETS.thumb);
    await env.USER_IMAGES.put(targetKeys.thumb, thumb.bytes, {
      httpMetadata: { contentType: thumb.mimeType },
    });
    writtenKeys.push(targetKeys.thumb);

    const medium = await renderAiImageDerivative(env, originalBytes, originalInfo, AI_IMAGE_DERIVATIVE_PRESETS.medium);
    await env.USER_IMAGES.put(targetKeys.medium, medium.bytes, {
      httpMetadata: { contentType: medium.mimeType },
    });
    writtenKeys.push(targetKeys.medium);

    const readyAt = nowIso();
    const updateResult = await env.DB.prepare(
      `UPDATE ai_images
       SET thumb_key = ?,
           medium_key = ?,
           thumb_mime_type = ?,
           medium_mime_type = ?,
           thumb_width = ?,
           thumb_height = ?,
           medium_width = ?,
           medium_height = ?,
           derivatives_status = 'ready',
           derivatives_error = NULL,
           derivatives_version = ?,
           derivatives_ready_at = ?,
           derivatives_attempted_at = ?,
           derivatives_processing_token = NULL,
           derivatives_lease_expires_at = NULL
       WHERE id = ?
         AND user_id = ?
         AND derivatives_processing_token = ?`
    ).bind(
      targetKeys.thumb,
      targetKeys.medium,
      thumb.mimeType,
      medium.mimeType,
      thumb.width,
      thumb.height,
      medium.width,
      medium.height,
      payload.derivativesVersion,
      readyAt,
      readyAt,
      payload.imageId,
      payload.userId,
      processingToken
    ).run();

    if (!updateResult?.meta?.changes) {
      await cleanupDerivativeKeysBestEffort(env, writtenKeys);
      return { status: "noop", reason: "lease_lost", payload };
    }

    const staleKeys = [existing.thumb_key, existing.medium_key].filter(
      (key) => key && key !== targetKeys.thumb && key !== targetKeys.medium
    );
    await cleanupDerivativeKeysBestEffort(env, staleKeys);

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-image-derivatives",
      event: "ai_derivative_generated",
      correlationId: payload.correlationId,
      image_id: payload.imageId,
      user_id: payload.userId,
      derivatives_version: payload.derivativesVersion,
      trigger: payload.trigger,
    });

    return {
      status: "ready",
      reason: "generated",
      payload,
      keys: targetKeys,
    };
  } catch (error) {
    await cleanupDerivativeKeysBestEffort(env, writtenKeys);

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-image-derivatives",
      event: "ai_derivative_generation_failed",
      level: isLastAttempt || isPermanentAiImageDerivativeError(error) ? "error" : "warn",
      correlationId: payload.correlationId,
      image_id: payload.imageId,
      user_id: payload.userId,
      derivatives_version: payload.derivativesVersion,
      trigger: payload.trigger,
      final_attempt: !!isLastAttempt,
      ...getErrorFields(error),
    });

    if (isPermanentAiImageDerivativeError(error)) {
      await finalizeAiImageDerivativeFailure(env, payload, processingToken, "failed", sanitizeDerivativeError(error));
      return { status: "failed", reason: "permanent_failure", error, payload };
    }

    if (isLastAttempt) {
      await finalizeAiImageDerivativeFailure(
        env, payload, processingToken, "failed",
        sanitizeDerivativeError(error) + " [retries exhausted]"
      );
      return { status: "failed", reason: "retries_exhausted", error, payload };
    }

    await finalizeAiImageDerivativeFailure(env, payload, processingToken, "pending", sanitizeDerivativeError(error));
    throw error;
  }
}
