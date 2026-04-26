import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { addMinutesIso, nowIso, randomTokenHex } from "../../lib/tokens.js";
import {
  evaluateSharedRateLimit,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../../lib/rate-limit.js";
import {
  AI_IMAGE_DERIVATIVE_VERSION,
  enqueueAiImageDerivativeJob,
} from "../../lib/ai-image-derivatives.js";
import {
  AI_USAGE_OPERATIONS,
  aiUsagePolicyErrorResponse,
  prepareAiUsagePolicy,
} from "../../lib/ai-usage-policy.js";
import aiImageModels from "../../../../../js/shared/ai-image-models.mjs";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import { buildAiImageInput, hasControlCharacters, parseBase64Image, toArrayBuffer } from "./helpers.js";
import {
  AiGeneratedSaveReferenceError,
  createAiGeneratedSaveReferenceFromBase64,
  decodeAiGeneratedSaveReference,
} from "./generated-image-save-reference.js";
import { AiAssetLifecycleError, deleteUserAiImage } from "./lifecycle.js";

const { DEFAULT_AI_IMAGE_MODEL, resolveAiImageModel } = aiImageModels;

const MODEL = DEFAULT_AI_IMAGE_MODEL;
const MAX_PROMPT_LENGTH = 1000;
const MIN_STEPS = 1;
const MAX_STEPS = 8;
const DEFAULT_STEPS = 4;
const GENERATION_LIMIT = 20;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const DAILY_IMAGE_LIMIT = 10;
const QUOTA_RESERVATION_TTL_MINUTES = 60;
const MAX_SAVED_AI_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SAVED_AI_IMAGE_WIDTH = 1024;
const MAX_SAVED_AI_IMAGE_HEIGHT = 1024;
const MAX_SAVED_AI_IMAGE_PIXELS = 1024 * 1024;
const MAX_SAVE_REFERENCE_LENGTH = 500;

async function enforceAiImageWriteRateLimit(ctx, userId, {
  scope = "ai-image-write-user",
  maxRequests = 60,
  windowMs = 10 * 60_000,
  component = "ai-image-write",
} = {}) {
  const { request, env, correlationId } = ctx;
  const limit = await evaluateSharedRateLimit(
    env,
    scope,
    userId,
    maxRequests,
    windowMs,
    sensitiveRateLimitOptions({
      component,
      correlationId: correlationId || null,
      requestInfo: ctx,
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(correlationId || null);
  if (limit.limited) return rateLimitResponse();
  return null;
}

function getQuotaDayStart(ts = nowIso()) {
  return ts.slice(0, 10) + "T00:00:00.000Z";
}

function quotaUnavailableResponse() {
  return json(
    { ok: false, error: "Service temporarily unavailable. Please try again later." },
    { status: 503 }
  );
}

function decodeBase64ToBytes(base64) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function decodeDataUriImage(imageData) {
  const match = String(imageData).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("invalid_image_data_format");
  }

  try {
    return {
      mimeType: match[1],
      imageBytes: decodeBase64ToBytes(match[2]),
    };
  } catch {
    throw new Error("invalid_base64_image_data");
  }
}

function logSaveReferenceRejection({ correlationId, userId, reason }) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-save-image",
    event: "ai_image_save_reference_rejected",
    level: "warn",
    correlationId,
    user_id: userId,
    failure_reason: reason,
  });
}

async function resolveSaveImageInput(env, body, userId, correlationId) {
  const saveReference = typeof body?.save_reference === "string"
    ? body.save_reference.trim()
    : "";

  if (saveReference) {
    if (saveReference.length > MAX_SAVE_REFERENCE_LENGTH) {
      logSaveReferenceRejection({
        correlationId,
        userId,
        reason: "reference_too_long",
      });
      throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
        reason: "malformed",
      });
    }

    let reference;
    try {
      reference = await decodeAiGeneratedSaveReference(env, saveReference, { userId });
    } catch (error) {
      if (error instanceof AiGeneratedSaveReferenceError) {
        logSaveReferenceRejection({
          correlationId,
          userId,
          reason: error.reason,
        });
      }
      throw error;
    }

    const tempObject = await env.USER_IMAGES.get(reference.tempKey);
    if (!tempObject) {
      logSaveReferenceRejection({
        correlationId,
        userId,
        reason: "object_missing",
      });
      throw new AiGeneratedSaveReferenceError(
        "Generated image is no longer available. Please generate it again.",
        {
          status: 404,
          code: "SAVE_REFERENCE_UNAVAILABLE",
          reason: "object_missing",
        }
      );
    }

    const tempBuffer = await toArrayBuffer(tempObject.body ?? tempObject);
    if (!tempBuffer || tempBuffer.byteLength === 0) {
      logSaveReferenceRejection({
        correlationId,
        userId,
        reason: "object_unreadable",
      });
      throw new AiGeneratedSaveReferenceError(
        "Generated image is no longer available. Please generate it again.",
        {
          status: 404,
          code: "SAVE_REFERENCE_UNAVAILABLE",
          reason: "object_unreadable",
        }
      );
    }

    return {
      imageBytes: new Uint8Array(tempBuffer),
      savedMimeType: tempObject.httpMetadata?.contentType || "image/png",
      tempKey: reference.tempKey,
    };
  }

  if (!body?.imageData) {
    throw new Error("missing_image_data");
  }

  const { mimeType, imageBytes } = decodeDataUriImage(body.imageData);
  return {
    imageBytes,
    savedMimeType: mimeType,
    tempKey: null,
  };
}

async function deleteExpiredQuotaReservations(env, userId, dayStart, now) {
  await env.DB.prepare(
    "DELETE FROM ai_daily_quota_usage WHERE user_id = ? AND day_start = ? AND status = 'reserved' AND expires_at < ?"
  ).bind(userId, dayStart, now).run();
}

async function reserveDailyQuota(env, userId, now = nowIso()) {
  const dayStart = getQuotaDayStart(now);
  await deleteExpiredQuotaReservations(env, userId, dayStart, now);
  const expiresAt = addMinutesIso(QUOTA_RESERVATION_TTL_MINUTES);

  for (let slot = 1; slot <= DAILY_IMAGE_LIMIT; slot += 1) {
    const reservationId = randomTokenHex(16);
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO ai_daily_quota_usage (id, user_id, day_start, slot, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?)`
    ).bind(
      reservationId,
      userId,
      dayStart,
      slot,
      now,
      expiresAt
    ).run();

    if (result?.meta?.changes > 0) {
      return { reservationId, dayStart };
    }
  }

  return null;
}

async function releaseQuotaReservation(env, reservationId) {
  if (!reservationId) return;
  await env.DB.prepare(
    "DELETE FROM ai_daily_quota_usage WHERE id = ? AND status = 'reserved'"
  ).bind(reservationId).run();
}

export async function handleGenerateImage(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";
  let quotaReservationId = null;

  const limit = await evaluateSharedRateLimit(env, "ai-generate-user", userId, GENERATION_LIMIT, GENERATION_WINDOW_MS, sensitiveRateLimitOptions({
    component: "ai-generate",
    correlationId,
    requestInfo: { request, pathname: "/api/ai/generate-image", method: request.method },
  }));
  if (limit.unavailable) {
    return rateLimitUnavailableResponse(correlationId);
  }
  if (limit.limited) {
    return rateLimitResponse();
  }

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiGenerateJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);
  const body = parsed.body;
  if (!body || !body.prompt) {
    return respond({ ok: false, error: "Prompt is required." }, { status: 400 });
  }

  const prompt = String(body.prompt).trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    return respond(
      { ok: false, error: `Prompt must be 1–${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const requestedModel = body.model;
  const modelConfig = resolveAiImageModel(requestedModel);
  if (!modelConfig) {
    return respond({ ok: false, error: "Unsupported image model." }, { status: 400 });
  }

  let steps = DEFAULT_STEPS;
  if (body.steps !== undefined && body.steps !== null) {
    steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.floor(Number(body.steps))));
    if (isNaN(steps)) steps = DEFAULT_STEPS;
  }

  let seed = null;
  if (body.seed !== undefined && body.seed !== null) {
    seed = Math.floor(Number(body.seed));
    if (isNaN(seed) || seed < 0) seed = null;
  }
  const aiRequest = buildAiImageInput(modelConfig, prompt, steps, seed);
  let usagePolicy = null;
  try {
    usagePolicy = await prepareAiUsagePolicy({
      env,
      request,
      user: session.user,
      body,
      operation: AI_USAGE_OPERATIONS.MEMBER_IMAGE_GENERATE,
      route: "/api/ai/generate-image",
    });
  } catch (error) {
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_usage_policy_rejected",
      level: policyError.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "ai_usage_policy_rejected",
    });
    return respond(policyError.body, { status: policyError.status });
  }

  if (!isAdmin) {
    try {
      const reservation = await reserveDailyQuota(env, userId);
      if (!reservation) {
        return json(
          {
            ok: false,
            code: "DAILY_IMAGE_LIMIT_REACHED",
            error: `You've reached your daily image generation limit (${DAILY_IMAGE_LIMIT}/${DAILY_IMAGE_LIMIT}). Please come back tomorrow for more creations.`,
          },
          { status: 429 }
        );
      }
      quotaReservationId = reservation.reservationId;
    } catch (e) {
      if (String(e).includes("no such table")) return quotaUnavailableResponse();
      throw e;
    }
  }

  let base64 = null;
  let mimeType = "image/png";

  try {
    const result = await env.AI.run(modelConfig.id, aiRequest.payload);
    const candidates = [];
    if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
      if (result.image != null) candidates.push(result.image);
      if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
      if (result.data != null) candidates.push(result.data);
    }
    candidates.push(result);

    for (const v of candidates) {
      if (base64) break;

      if (typeof v === "string" && v.length > 0) {
        const parsed = parseBase64Image(v);
        if (parsed) {
          base64 = parsed.base64;
          mimeType = parsed.mimeType;
          break;
        }
      }

      const buf = await toArrayBuffer(v);
      if (buf && buf.byteLength > 0) {
        const bytes = new Uint8Array(buf);
        base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ""));
        break;
      }
    }
  } catch (e) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      request_mode: modelConfig.requestMode || "json",
      is_admin: isAdmin,
      ...getErrorFields(e),
    });
    if (quotaReservationId) {
      try { await releaseQuotaReservation(env, quotaReservationId); } catch {}
    }
    return respond({ ok: false, error: "Image generation failed." }, { status: 502 });
  }

  if (!base64) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_empty_result",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      is_admin: isAdmin,
    });
    if (quotaReservationId) {
      try { await releaseQuotaReservation(env, quotaReservationId); } catch {}
    }
    return respond({ ok: false, error: "No image was generated." }, { status: 502 });
  }

  const logId = randomTokenHex(16);
  const completedAt = nowIso();
  try {
    if (quotaReservationId) {
      const results = await env.DB.batch([
        env.DB.prepare(
          "UPDATE ai_daily_quota_usage SET status = 'consumed', expires_at = NULL, consumed_at = ? WHERE id = ? AND status = 'reserved'"
        ).bind(completedAt, quotaReservationId),
        env.DB.prepare(
          "INSERT INTO ai_generation_log (id, user_id, created_at) VALUES (?, ?, ?)"
        ).bind(logId, userId, completedAt),
      ]);
      if (results?.[0]?.meta?.changes !== 1) {
        try {
          await env.DB.prepare("DELETE FROM ai_generation_log WHERE id = ?").bind(logId).run();
        } catch {}
        logDiagnostic({
          service: "bitbi-auth",
          component: "ai-generate-image",
          event: "ai_generate_finalize_conflict",
          level: "error",
          correlationId,
          user_id: userId,
          model: modelConfig.id,
          quota_reservation_id: quotaReservationId,
        });
        return respond(
          { ok: false, error: "Image generation could not be finalized. Please try again." },
          { status: 500 }
        );
      }
    } else {
      await env.DB.prepare(
        "INSERT INTO ai_generation_log (id, user_id, created_at) VALUES (?, ?, ?)"
      ).bind(logId, userId, completedAt).run();
    }
  } catch (e) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_finalize_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      quota_reservation_id: quotaReservationId,
      ...getErrorFields(e),
    });
    if (quotaReservationId) {
      try { await releaseQuotaReservation(env, quotaReservationId); } catch {}
    }
    return respond(
      { ok: false, error: "Image generation could not be finalized. Please try again." },
      { status: 500 }
    );
  }

  let billingMetadata = null;
  try {
    billingMetadata = await usagePolicy.chargeAfterSuccess({
      model: modelConfig.id,
      request_mode: modelConfig.requestMode || "json",
    });
  } catch (error) {
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_usage_charge_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      code: policyError.body?.code || "ai_usage_charge_failed",
    });
    return respond(policyError.body, { status: policyError.status });
  }

  let tempSavePayload = {};
  try {
    tempSavePayload = {
      saveReference: (await createAiGeneratedSaveReferenceFromBase64(env, {
        userId,
        imageBase64: base64,
        mimeType,
      })).saveReference,
    };
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generated_temp_store_failed",
      level: "warn",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      is_admin: isAdmin,
      ...getErrorFields(error),
    });
  }

  return respond({
    ok: true,
    data: {
      imageBase64: base64,
      mimeType,
      prompt,
      steps: aiRequest.steps,
      seed: aiRequest.seed,
      model: modelConfig.id,
      ...tempSavePayload,
    },
    ...(billingMetadata ? { billing: billingMetadata } : {}),
  });
}

export async function handleRenameImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceAiImageWriteRateLimit(ctx, session.user.id, {
    scope: "ai-image-rename-user",
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-image-rename",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const name = String(body?.name || "").trim();
  if (name.length === 0 || name.length > MAX_PROMPT_LENGTH) {
    return json({ ok: false, error: `Image name must be 1–${MAX_PROMPT_LENGTH} characters.` }, { status: 400 });
  }
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Image name cannot contain control characters." }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    "SELECT id, prompt FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!existing) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  if (existing.prompt === name) {
    return json({
      ok: true,
      data: {
        id: existing.id,
        title: existing.prompt,
        prompt: existing.prompt,
        unchanged: true,
      },
    });
  }

  await env.DB.prepare(
    "UPDATE ai_images SET prompt = ? WHERE id = ? AND user_id = ?"
  ).bind(name, imageId, session.user.id).run();

  return json({
    ok: true,
    data: {
      id: imageId,
      title: name,
      prompt: name,
      unchanged: false,
    },
  });
}

export async function handleSaveImage(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceAiImageWriteRateLimit(ctx, session.user.id, {
    scope: "ai-save-image-user",
    maxRequests: 30,
    windowMs: 60 * 60_000,
    component: "ai-save-image",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiSaveImageJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);
  const body = parsed.body;
  if (!body || !body.prompt || (!body.imageData && !body.save_reference)) {
    return respond({ ok: false, error: "Image data and prompt are required." }, { status: 400 });
  }

  let folderId = null;
  let folderSlug = "unsorted";
  if (body.folder_id) {
    const folder = await env.DB.prepare(
      "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(body.folder_id, session.user.id).first();
    if (!folder) {
      return respond({ ok: false, error: "Folder not found." }, { status: 404 });
    }
    folderId = folder.id;
    folderSlug = folder.slug;
  }

  let imageBytes;
  let savedMimeType = "image/png";
  let tempKey = null;
  try {
    const resolved = await resolveSaveImageInput(env, body, session.user.id, correlationId);
    imageBytes = resolved.imageBytes;
    savedMimeType = resolved.savedMimeType;
    tempKey = resolved.tempKey;
  } catch (error) {
    if (error instanceof AiGeneratedSaveReferenceError) {
      return respond(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error?.message === "invalid_image_data_format") {
      return respond({ ok: false, error: "Invalid image data format." }, { status: 400 });
    }
    if (error?.message === "invalid_base64_image_data") {
      return respond({ ok: false, error: "Invalid base64 image data." }, { status: 400 });
    }
    if (error?.message === "missing_image_data") {
      return respond({ ok: false, error: "Image data and prompt are required." }, { status: 400 });
    }
    throw error;
  }

  if (imageBytes.byteLength > MAX_SAVED_AI_IMAGE_BYTES) {
    return respond({ ok: false, error: "Image data must be 10 MB or smaller." }, { status: 400 });
  }

  const isPng = imageBytes.length >= 4 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47;
  const isJpeg = imageBytes.length >= 3 && imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
  const isWebp = imageBytes.length >= 12 && imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x46 && imageBytes[8] === 0x57 && imageBytes[9] === 0x45 && imageBytes[10] === 0x42 && imageBytes[11] === 0x50;
  if (!isPng && !isJpeg && !isWebp) {
    return respond({ ok: false, error: "Invalid image format." }, { status: 400 });
  }

  if (!env?.IMAGES || typeof env.IMAGES.info !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_inspection_unavailable",
      level: "error",
      correlationId,
      user_id: session.user.id,
    });
    return respond(
      { ok: false, error: "Image save is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  let imageInfo;
  try {
    imageInfo = await env.IMAGES.info(imageBytes);
  } catch {
    return respond({ ok: false, error: "Image dimensions could not be inspected." }, { status: 400 });
  }

  const width = Number(imageInfo?.width);
  const height = Number(imageInfo?.height);
  const pixels = width * height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return respond({ ok: false, error: "Image dimensions could not be inspected." }, { status: 400 });
  }
  if (
    width > MAX_SAVED_AI_IMAGE_WIDTH ||
    height > MAX_SAVED_AI_IMAGE_HEIGHT ||
    pixels > MAX_SAVED_AI_IMAGE_PIXELS
  ) {
    return respond(
      {
        ok: false,
        error: `Saved image must be ${MAX_SAVED_AI_IMAGE_WIDTH}x${MAX_SAVED_AI_IMAGE_HEIGHT} pixels or smaller. Received ${width}x${height}.`,
      },
      { status: 400 }
    );
  }

  const imageId = randomTokenHex(16);
  const timestamp = Date.now();
  const random = randomTokenHex(4);
  const r2Key = `users/${session.user.id}/folders/${folderSlug}/${timestamp}-${random}.png`;
  const now = nowIso();

  await env.USER_IMAGES.put(r2Key, imageBytes.buffer, {
    httpMetadata: { contentType: savedMimeType },
  });
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-save-image",
    event: "ai_image_stored",
    correlationId,
    user_id: session.user.id,
    image_id: imageId,
    r2_key: r2Key,
    size_bytes: imageBytes.byteLength,
    mime_type: savedMimeType,
    width,
    height,
    folder_id: folderId,
  });

  const prompt = String(body.prompt).slice(0, MAX_PROMPT_LENGTH);
  const model = String(body.model || MODEL).slice(0, 100);
  const steps = body.steps ? Math.floor(Number(body.steps)) : null;
  const seed = body.seed !== undefined && body.seed !== null ? Math.floor(Number(body.seed)) : null;

  let insertResult;
  try {
    if (folderId) {
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
      ).bind(imageId, session.user.id, folderId, r2Key, prompt, model, steps, seed, now,
        folderId, session.user.id).run();
    } else {
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(imageId, session.user.id, null, r2Key, prompt, model, steps, seed, now).run();
    }
  } catch (e) {
    try { await env.USER_IMAGES.delete(r2Key); } catch {}
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_metadata_insert_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      folder_id: folderId,
      r2_key: r2Key,
      ...getErrorFields(e),
    });
    return respond({ ok: false, error: "Failed to save image. The folder may have been deleted." }, { status: 409 });
  }

  if (!insertResult.meta.changes) {
    try { await env.USER_IMAGES.delete(r2Key); } catch {}
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_folder_deleted_before_insert",
      level: "warn",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      folder_id: folderId,
      r2_key: r2Key,
    });
    return respond({ ok: false, error: "Folder was deleted. Image not saved." }, { status: 404 });
  }

  let derivativesEnqueued = true;
  try {
    await enqueueAiImageDerivativeJob(env, {
      imageId,
      userId: session.user.id,
      originalKey: r2Key,
      derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
      correlationId,
      trigger: "save",
    });
  } catch (error) {
    derivativesEnqueued = false;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_derivative_enqueue_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      r2_key: r2Key,
      ...getErrorFields(error),
    });
    try {
      await env.DB.prepare(
        "UPDATE ai_images SET derivatives_error = ?, derivatives_attempted_at = ? WHERE id = ? AND user_id = ?"
      ).bind(
        String(error?.message || error || "Queue enqueue failed.").slice(0, 500),
        nowIso(),
        imageId,
        session.user.id
      ).run();
    } catch {}
  }

  if (tempKey) {
    try {
      await env.USER_IMAGES.delete(tempKey);
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-save-image",
        event: "ai_generated_temp_delete_failed",
        level: "warn",
        correlationId,
        user_id: session.user.id,
        image_id: imageId,
        failure_reason: "post_save_cleanup_failed",
        ...getErrorFields(error),
      });
    }
  }

  return respond({
    ok: true,
    data: {
      id: imageId,
      folder_id: folderId,
      prompt,
      model,
      steps,
      seed,
      created_at: now,
      derivatives_status: "pending",
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      derivatives_enqueued: derivativesEnqueued,
    },
  }, { status: 201 });
}

export async function handleDeleteImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceAiImageWriteRateLimit(ctx, session.user.id, {
    scope: "ai-delete-image-user",
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-delete-image",
  });
  if (limited) return limited;

  try {
    await deleteUserAiImage({
      env,
      userId: session.user.id,
      imageId,
    });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    return json(
      { ok: false, error: error.message },
      { status: error.status }
    );
  }
  return json({ ok: true });
}
