import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { addMinutesIso, nowIso, randomTokenHex } from "../../lib/tokens.js";
import { isSharedRateLimited, rateLimitResponse } from "../../lib/rate-limit.js";
import {
  AI_IMAGE_DERIVATIVE_VERSION,
  buildAiImageCleanupQueueInsertSql,
  enqueueAiImageDerivativeJob,
  listAiImageObjectKeys,
} from "../../lib/ai-image-derivatives.js";
import aiImageModels from "../../../../../js/shared/ai-image-models.mjs";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import { buildAiImageInput, hasControlCharacters, parseBase64Image, toArrayBuffer } from "./helpers.js";

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

function getQuotaDayStart(ts = nowIso()) {
  return ts.slice(0, 10) + "T00:00:00.000Z";
}

function quotaUnavailableResponse() {
  return json(
    { ok: false, error: "Service temporarily unavailable. Please try again later." },
    { status: 503 }
  );
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

  if (await isSharedRateLimited(env, "ai-generate-user", userId, GENERATION_LIMIT, GENERATION_WINDOW_MS)) {
    return rateLimitResponse();
  }

  const body = await readJsonBody(request);
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

  return respond({
    ok: true,
    data: {
      imageBase64: base64,
      mimeType,
      prompt,
      steps: aiRequest.steps,
      seed: aiRequest.seed,
      model: modelConfig.id,
    },
  });
}

export async function handleRenameImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
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

  const body = await readJsonBody(request);
  if (!body || !body.imageData || !body.prompt) {
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

  const match = String(body.imageData).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    return respond({ ok: false, error: "Invalid image data format." }, { status: 400 });
  }
  const savedMimeType = match[1];

  let imageBytes;
  try {
    const raw = atob(match[2]);
    imageBytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) imageBytes[i] = raw.charCodeAt(i);
  } catch {
    return respond({ ok: false, error: "Invalid base64 image data." }, { status: 400 });
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

  const row = await env.DB.prepare(
    "SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const ts = nowIso();
  let batchResults;
  try {
    batchResults = await env.DB.batch([
      env.DB.prepare(
        buildAiImageCleanupQueueInsertSql("id = ? AND user_id = ?")
      ).bind(imageId, session.user.id, ts, ts, ts),
      env.DB.prepare(
        "DELETE FROM ai_images WHERE id = ? AND user_id = ?"
      ).bind(imageId, session.user.id),
    ]);
  } catch (e) {
    const unavailable = String(e).includes("no such table");
    return json(
      { ok: false, error: unavailable ? "Service temporarily unavailable. Please try again later." : "Delete failed. Please try again." },
      { status: unavailable ? 503 : 500 }
    );
  }

  const deleted = batchResults[1].meta.changes || 0;
  if (deleted !== 1) {
    return json(
      { ok: false, error: "Delete failed. Image may have already been removed." },
      { status: 409 }
    );
  }

  try {
    const objectKeys = listAiImageObjectKeys(row);
    for (const key of objectKeys) {
      await env.USER_IMAGES.delete(key);
    }
    const ph = objectKeys.map(() => "?").join(",");
    await env.DB.prepare(
      `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
    ).bind(...objectKeys).run();
  } catch {}

  return json({ ok: true });
}
