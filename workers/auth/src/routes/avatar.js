/* ============================================================
   BITBI — Avatar routes: GET/POST/DELETE /api/profile/avatar
   ============================================================ */

import { json } from "../lib/response.js";
import { readJsonBody } from "../lib/request.js";
import { requireUser } from "../lib/session.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import { logUserActivity } from "../lib/activity.js";
import { nowIso } from "../lib/tokens.js";
import {
  AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS,
  AI_IMAGE_DERIVATIVE_VERSION,
  buildAiImageDerivativeMessage,
  processAiImageDerivativeMessage,
  shouldAttemptOnDemandAiImageDerivative,
} from "../lib/ai-image-derivatives.js";
import {
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
import {
  avatarKey,
  persistAvatarPresence,
} from "../lib/profile-avatar-state.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const THUMB_UNAVAILABLE_ERROR = "Preview pending. This image thumbnail is not ready yet.";
const OWNED_IMAGE_THUMB_SELECT =
  "SELECT thumb_key AS derivative_key, thumb_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?";

function isHexAssetId(value) {
  return typeof value === "string" && /^[a-f0-9]+$/.test(value);
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      // Fall through to the remaining duck-typed branches.
    }
  }
  if (value.buffer instanceof ArrayBuffer && typeof value.byteLength === "number") {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value.getReader === "function") {
    try {
      return await new Response(value).arrayBuffer();
    } catch {
      return null;
    }
  }
  return null;
}

// Validate file content matches declared MIME type via magic bytes
async function validateImageBytes(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 12) return { valid: false, buffer };

  let valid = false;

  if (file.type === "image/jpeg") {
    // JPEG: FF D8 FF
    valid = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  } else if (file.type === "image/png") {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    valid =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4E &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0D &&
      bytes[5] === 0x0A &&
      bytes[6] === 0x1A &&
      bytes[7] === 0x0A;
  } else if (file.type === "image/webp") {
    // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
    valid =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
  }

  return { valid, buffer };
}

async function resolveOwnedAvatarSourceThumb(env, userId, imageId) {
  const row = await env.DB.prepare(OWNED_IMAGE_THUMB_SELECT).bind(imageId, userId).first();

  if (!row) {
    return {
      ok: false,
      status: 404,
      error: "Saved image not found.",
      code: "avatar_source_not_found",
    };
  }

  if (row.derivative_key) {
    const object = await env.USER_IMAGES.get(row.derivative_key);
    if (object) {
      const body = await toArrayBuffer(object.body ?? object);
      if (body && body.byteLength) {
        return {
          ok: true,
          body,
          mimeType: row.mime_type || object.httpMetadata?.contentType || "image/webp",
        };
      }
    }
  }

  if (!row.r2_key) {
    return {
      ok: false,
      status: 409,
      error: THUMB_UNAVAILABLE_ERROR,
      code: "avatar_thumb_unavailable",
    };
  }

  if (!shouldAttemptOnDemandAiImageDerivative(row, { cooldownMs: AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS })) {
    return {
      ok: false,
      status: 409,
      error: row.derivatives_status === "failed"
        ? "Thumbnail unavailable. Please retry when the preview is available."
        : THUMB_UNAVAILABLE_ERROR,
      code: "avatar_thumb_unavailable",
    };
  }

  try {
    const result = await processAiImageDerivativeMessage(
      env,
      buildAiImageDerivativeMessage({
        imageId,
        userId,
        originalKey: row.r2_key,
        derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
        trigger: "on_demand",
      }),
      { isLastAttempt: true }
    );

    if (result.status === "ready") {
      const generated = await env.USER_IMAGES.get(result.keys.thumb);
      if (generated) {
        const body = await toArrayBuffer(generated.body ?? generated);
        if (body && body.byteLength) {
          return {
            ok: true,
            body,
            mimeType: generated.httpMetadata?.contentType || "image/webp",
          };
        }
      }
    }
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "avatar",
      event: "avatar_thumb_generation_failed",
      level: "warn",
      user_id: userId,
      image_id: imageId,
      ...getErrorFields(error),
    });
  }

  return {
    ok: false,
    status: 409,
    error: row.derivatives_status === "failed"
      ? "Thumbnail unavailable. Please retry when the preview is available."
      : THUMB_UNAVAILABLE_ERROR,
    code: "avatar_thumb_unavailable",
  };
}

async function handleSavedAssetAvatarSelection(ctx, session, imageId, ip, correlationId) {
  const { env } = ctx;
  const resolved = await resolveOwnedAvatarSourceThumb(env, session.user.id, imageId);
  if (!resolved.ok) {
    return withCorrelationId(json(
      { ok: false, error: resolved.error, code: resolved.code || null },
      { status: resolved.status }
    ), correlationId);
  }

  await env.PRIVATE_MEDIA.put(avatarKey(session.user.id), resolved.body, {
    httpMetadata: { contentType: resolved.mimeType || "image/webp" },
  });
  const avatarUpdatedAt = nowIso();
  await persistAvatarPresence(env, session.user.id, true, {
    updatedAt: avatarUpdatedAt,
    avatarUpdatedAt,
  });
  logDiagnostic({
    service: "bitbi-auth",
    component: "avatar",
    event: "avatar_saved_asset_stored",
    correlationId,
    user_id: session.user.id,
    source_image_id: imageId,
    mime_type: resolved.mimeType || "image/webp",
  });

  ctx.execCtx.waitUntil(
    logUserActivity(
      env,
      session.user.id,
      "select_avatar_saved_asset",
      { image_id: imageId },
      ip,
      {
        correlationId,
        requestInfo: ctx,
      }
    )
  );

  return withCorrelationId(json({
    ok: true,
    message: "Avatar updated.",
    source: "saved_assets",
  }), correlationId);
}

/* ── GET /api/profile/avatar ── */
export async function handleGetAvatar(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const object = await env.PRIVATE_MEDIA.get(avatarKey(session.user.id));

  if (!object) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/png");
  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
}

/* ── POST /api/profile/avatar ── */
export async function handleUploadAvatar(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);

  const ip = getClientIp(request);
  const limit = await evaluateSharedRateLimit(env, "avatar-upload-ip", ip, 10, 3_600_000, sensitiveRateLimitOptions({
    component: "avatar-upload",
    correlationId,
    requestInfo: { request, pathname: "/api/profile/avatar", method: request.method },
  }));
  if (limit.unavailable) {
    return rateLimitUnavailableResponse(correlationId);
  }
  if (limit.limited) {
    return rateLimitResponse();
  }

  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") {
      return respond({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }
    const imageId = String(body.source_image_id || "").trim();
    if (!imageId) {
      return respond({ ok: false, error: "source_image_id is required." }, { status: 400 });
    }
    if (!isHexAssetId(imageId)) {
      return respond({ ok: false, error: "Invalid image ID." }, { status: 400 });
    }
    return handleSavedAssetAvatarSelection(ctx, session, imageId, ip, correlationId);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return respond({ ok: false, error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("avatar");

  if (!file || typeof file === "string") {
    return respond({ ok: false, error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return respond(
      { ok: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return respond(
      { ok: false, error: "File too large. Maximum size is 2 MB." },
      { status: 400 }
    );
  }

  // Validate magic bytes match declared MIME type
  const { valid, buffer } = await validateImageBytes(file);
  if (!valid) {
    return respond(
      { ok: false, error: "File content does not match the declared type." },
      { status: 400 }
    );
  }

  // Use the already-read buffer (arrayBuffer() consumed the stream)
  await env.PRIVATE_MEDIA.put(avatarKey(session.user.id), buffer, {
    httpMetadata: { contentType: file.type },
  });
  const avatarUpdatedAt = nowIso();
  await persistAvatarPresence(env, session.user.id, true, {
    updatedAt: avatarUpdatedAt,
    avatarUpdatedAt,
  });
  logDiagnostic({
    service: "bitbi-auth",
    component: "avatar",
    event: "avatar_uploaded",
    correlationId,
    user_id: session.user.id,
    mime_type: file.type,
    size_bytes: file.size,
  });

  // Log avatar upload (durable background write)
  ctx.execCtx.waitUntil(
    logUserActivity(env, session.user.id, "upload_avatar", { type: file.type }, ip, {
      correlationId,
      requestInfo: ctx,
    })
  );

  return respond({ ok: true, message: "Avatar uploaded." });
}

/* ── DELETE /api/profile/avatar ── */
export async function handleDeleteAvatar(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  await env.PRIVATE_MEDIA.delete(avatarKey(session.user.id));
  await persistAvatarPresence(env, session.user.id, false, {
    updatedAt: nowIso(),
    avatarUpdatedAt: null,
  });
  logDiagnostic({
    service: "bitbi-auth",
    component: "avatar",
    event: "avatar_deleted",
    correlationId,
    user_id: session.user.id,
  });

  // Log avatar deletion (durable background write)
  const ip = getClientIp(request);
  ctx.execCtx.waitUntil(
    logUserActivity(env, session.user.id, "delete_avatar", null, ip, {
      correlationId,
      requestInfo: ctx,
    })
  );

  return withCorrelationId(json({ ok: true, message: "Avatar removed." }), correlationId);
}
