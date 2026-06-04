import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import {
  assetStorageQuotaErrorBody,
  isAssetStorageQuotaError,
} from "../../lib/asset-storage-quota.js";
import {
  attachVideoPosterToAiTextAsset,
  processGeneratedMusicCoverPoster,
  saveAdminAiTextAsset,
} from "../../lib/ai-text-assets.js";
import { enforceSensitiveUserRateLimit } from "../../lib/sensitive-write-limit.js";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import {
  getRemoteMediaPolicyLogFields,
} from "../../../../../js/shared/remote-media-policy.mjs";
import {
  buildRejectedRemoteAudioUrlError,
  fetchGeneratedAudioForSave,
  getTrustedGeneratedAudioOutputUrl,
} from "../../lib/generated-audio-save.js";
import {
  buildRenamedFileName,
  hasControlCharacters,
  isMissingTextAssetTableError,
  parseBase64Image,
} from "./helpers.js";
import { AiAssetLifecycleError, deleteUserAiTextAsset } from "./lifecycle.js";

const MAX_PROMPT_LENGTH = 1000;
const MAX_SAVED_FILE_TITLE_LENGTH = 120;
// Generated admin image outputs can be larger than the final saved-assets poster.
// Keep this cover-only raw input cap bounded, then immediately normalize through
// the existing 320px poster pipeline instead of storing the raw generated image.
const MAX_AUDIO_SAVE_COVER_BASE64_CHARS = 11_000_000;
const MAX_AUDIO_SAVE_COVER_BYTES = 8_000_000;
const AUDIO_SAVE_COVER_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function decodeAudioSaveCoverPayload(body) {
  const rawValue = body?.coverImageBase64 ?? body?.cover_image_base64 ?? null;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { coverBytes: null, coverMimeType: null, error: null };
  }
  if (typeof rawValue !== "string") {
    return {
      coverBytes: null,
      coverMimeType: null,
      error: { status: 400, body: { ok: false, error: "coverImageBase64 must be a base64 image string.", code: "invalid_cover_image" } },
    };
  }

  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.length > MAX_AUDIO_SAVE_COVER_BASE64_CHARS) {
    return {
      coverBytes: null,
      coverMimeType: null,
      error: { status: 400, body: { ok: false, error: "Cover image payload is invalid or too large.", code: "invalid_cover_image" } },
    };
  }

  const requestedMime = String(body?.coverMimeType ?? body?.cover_mime_type ?? "image/png")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!AUDIO_SAVE_COVER_MIME_TYPES.has(requestedMime)) {
    return {
      coverBytes: null,
      coverMimeType: null,
      error: { status: 400, body: { ok: false, error: "coverMimeType must be png, jpeg, or webp.", code: "invalid_cover_image" } },
    };
  }

  const parsed = parseBase64Image(trimmed.startsWith("data:")
    ? trimmed
    : `data:${requestedMime};base64,${trimmed}`);
  if (!parsed || !AUDIO_SAVE_COVER_MIME_TYPES.has(String(parsed.mimeType || "").toLowerCase())) {
    return {
      coverBytes: null,
      coverMimeType: null,
      error: { status: 400, body: { ok: false, error: "coverImageBase64 must be a supported base64 image.", code: "invalid_cover_image" } },
    };
  }

  try {
    const normalizedBase64 = parsed.base64.replace(/\s+/g, "");
    const coverBytes = Uint8Array.from(atob(normalizedBase64), (ch) => ch.charCodeAt(0));
    if (!coverBytes.byteLength || coverBytes.byteLength > MAX_AUDIO_SAVE_COVER_BYTES) {
      return {
        coverBytes: null,
        coverMimeType: null,
        error: { status: 400, body: { ok: false, error: "Cover image payload is invalid or too large.", code: "invalid_cover_image" } },
      };
    }
    return {
      coverBytes,
      coverMimeType: String(parsed.mimeType || requestedMime).toLowerCase(),
      error: null,
    };
  } catch {
    return {
      coverBytes: null,
      coverMimeType: null,
      error: { status: 400, body: { ok: false, error: "coverImageBase64 must be valid base64.", code: "invalid_cover_image" } },
    };
  }
}

export async function handleAttachTextAssetPoster(ctx, assetId) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-text-asset-write-user",
    userId: session.user.id,
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-text-asset-poster",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiSaveVideoPosterJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);

  try {
    const saved = await attachVideoPosterToAiTextAsset(env, {
      userId: session.user.id,
      assetId,
      posterBase64: parsed.body?.posterBase64,
    });

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-asset-poster",
      event: "video_poster_attached",
      correlationId,
      user_id: session.user.id,
      asset_id: assetId,
      poster_width: saved.poster_width,
      poster_height: saved.poster_height,
      poster_size_bytes: saved.poster_size_bytes,
    });

    return respond({ ok: true, data: saved });
  } catch (error) {
    if (isAssetStorageQuotaError(error)) {
      return respond(assetStorageQuotaErrorBody(error), { status: error?.status || 413 });
    }
    const status = error?.status || 500;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-asset-poster",
      event: "video_poster_attach_failed",
      level: status >= 500 ? "error" : "warn",
      correlationId,
      user_id: session.user.id,
      asset_id: assetId,
      ...getErrorFields(error),
    });
    return respond({
      ok: false,
      error: error?.message || "Video poster could not be attached.",
      code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
    }, { status });
  }
}

export async function handleRenameTextAsset(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-text-asset-write-user",
    userId: session.user.id,
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-text-asset-write",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const name = String(body?.name || "").trim();
  if (name.length === 0 || name.length > MAX_SAVED_FILE_TITLE_LENGTH) {
    return json({ ok: false, error: `Asset name must be 1–${MAX_SAVED_FILE_TITLE_LENGTH} characters.` }, { status: 400 });
  }
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Asset name cannot contain control characters." }, { status: 400 });
  }

  let existing;
  try {
    existing = await env.DB.prepare(
      "SELECT id, title, file_name, mime_type, source_module FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Text asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!existing) {
    return json({ ok: false, error: "Text asset not found." }, { status: 404 });
  }

  const nextFileName = buildRenamedFileName(name, existing);
  if (existing.title === name && existing.file_name === nextFileName) {
    return json({
      ok: true,
      data: {
        id: existing.id,
        title: existing.title,
        file_name: existing.file_name,
        unchanged: true,
      },
    });
  }

  await env.DB.prepare(
    "UPDATE ai_text_assets SET title = ?, file_name = ? WHERE id = ? AND user_id = ?"
  ).bind(name, nextFileName, assetId, session.user.id).run();

  return json({
    ok: true,
    data: {
      id: assetId,
      title: name,
      file_name: nextFileName,
      unchanged: false,
    },
  });
}

export async function handleSaveAudio(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-audio-save-user",
    userId: session.user.id,
    maxRequests: 30,
    windowMs: 60 * 60_000,
    component: "ai-audio-save",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiSaveAudioJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);
  const body = parsed.body;
  const audioUrl = body?.audioUrl !== undefined && body?.audioUrl !== null
    ? String(body.audioUrl).trim()
    : "";
  const hasAudioUrl = audioUrl.length > 0;
  const hasAudioBase64 = body?.audioBase64 !== undefined
    && body?.audioBase64 !== null
    && body?.audioBase64 !== "";
  let trustedAudioUrl = null;

  if (hasAudioUrl) {
    trustedAudioUrl = getTrustedGeneratedAudioOutputUrl(audioUrl);
    if (!trustedAudioUrl) {
      const error = buildRejectedRemoteAudioUrlError(audioUrl);
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-save-audio",
        event: "ai_audio_save_rejected_remote_url",
        level: "warn",
        correlationId,
        user_id: session.user.id,
        ...getRemoteMediaPolicyLogFields(error),
      });
      return respond({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
  }

  if (!body || (!hasAudioBase64 && !hasAudioUrl)) {
    return respond({ ok: false, error: "Audio data is required (audioBase64 or audioUrl)." }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  if (!title || title.length > MAX_SAVED_FILE_TITLE_LENGTH) {
    return respond(
      { ok: false, error: `Title is required and must be at most ${MAX_SAVED_FILE_TITLE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  if (body.audioBase64 && (typeof body.audioBase64 !== "string" || body.audioBase64.length === 0)) {
    return respond({ ok: false, error: "audioBase64 must be a non-empty string." }, { status: 400 });
  }

  const coverPayload = decodeAudioSaveCoverPayload(body);
  if (coverPayload.error) {
    return respond(coverPayload.error.body, { status: coverPayload.error.status });
  }

  let audioBase64 = hasAudioBase64 ? body.audioBase64 : null;
  let mimeType = String(body.mimeType || "audio/mpeg").trim();
  let sizeBytes = body.sizeBytes ?? null;

  if (!hasAudioBase64 && trustedAudioUrl) {
    try {
      const fetched = await fetchGeneratedAudioForSave(trustedAudioUrl.toString());
      audioBase64 = fetched.audioBase64;
      mimeType = fetched.mimeType;
      sizeBytes = fetched.sizeBytes;
    } catch (error) {
      const status = error?.status || 500;
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-save-audio",
        event: "ai_audio_save_fetch_failed",
        level: status >= 500 ? "error" : "warn",
        correlationId,
        user_id: session.user.id,
        ...getErrorFields(error),
      });
      return respond(
        {
          ok: false,
          error: error?.message || "Generated audio could not be fetched for saving.",
          code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
        },
        { status }
      );
    }
  }

  if (!audioBase64) {
    return respond({ ok: false, error: "Audio data is required (audioBase64 or audioUrl)." }, { status: 400 });
  }

  if (!String(mimeType).startsWith("audio/")) {
    return respond({ ok: false, error: "mimeType must be an audio MIME type." }, { status: 400 });
  }

  if (hasAudioUrl) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: hasAudioBase64 ? "ai_audio_save_remote_url_validated" : "ai_audio_save_fetched_remote_url",
      correlationId,
      user_id: session.user.id,
      remote_url_host: trustedAudioUrl.hostname,
      remote_url_has_query: trustedAudioUrl.search ? true : false,
      size_bytes: sizeBytes,
    });
  }

  const folderId = body.folder_id || null;
  if (folderId && (typeof folderId !== "string" || !/^[a-f0-9]+$/.test(folderId))) {
    return respond({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  }

  const payload = {
    audioBase64,
    mimeType,
    prompt: body.prompt ? String(body.prompt).slice(0, MAX_PROMPT_LENGTH) : null,
    model: body.model || null,
    mode: body.mode || null,
    lyricsMode: body.lyricsMode || null,
    bpm: body.bpm ?? null,
    key: body.key || null,
    lyricsPreview: body.lyricsPreview || null,
    durationMs: body.durationMs ?? null,
    sampleRate: body.sampleRate ?? null,
    channels: body.channels ?? null,
    bitrate: body.bitrate ?? null,
    sizeBytes,
    source: body.source ? String(body.source).slice(0, 120) : null,
    coverPrompt: body.coverPrompt ? String(body.coverPrompt).slice(0, MAX_PROMPT_LENGTH) : null,
    coverModel: body.coverModel ? String(body.coverModel).slice(0, 180) : null,
    coverMimeType: coverPayload.coverMimeType,
    traceId: body.traceId || null,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    elapsedMs: body.elapsedMs ?? null,
    receivedAt: body.receivedAt || null,
  };

  try {
    const saved = await saveAdminAiTextAsset(env, {
      userId: session.user.id,
      folderId,
      title,
      sourceModule: "music",
      payload,
    });

    let responseData = saved;
    let coverWarning = null;
    if (coverPayload.coverBytes) {
      const poster = await processGeneratedMusicCoverPoster(env, {
        userId: session.user.id,
        assetId: saved.id,
        coverBytes: coverPayload.coverBytes,
      });
      if (poster) {
        responseData = {
          ...saved,
          poster_r2_key: poster.r2Key,
          poster_width: poster.width,
          poster_height: poster.height,
          poster_size_bytes: poster.sizeBytes,
        };
      } else {
        coverWarning = "Cover image could not be attached to the saved audio asset.";
      }
    }

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_saved",
      correlationId,
      user_id: session.user.id,
      asset_id: saved.id,
      folder_id: saved.folder_id,
      size_bytes: saved.size_bytes,
      cover_attached: !!responseData.poster_r2_key,
    });

    return respond({
      ok: true,
      data: responseData,
      ...(coverWarning ? { cover_warning: coverWarning } : {}),
    }, { status: 201 });
  } catch (error) {
    if (isAssetStorageQuotaError(error)) {
      return respond(assetStorageQuotaErrorBody(error), { status: error?.status || 413 });
    }
    const status = error?.status || 500;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_save_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      ...getErrorFields(error),
    });
    return respond(
      {
        ok: false,
        error: error?.message || "Audio save failed.",
        code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
      },
      { status }
    );
  }
}

export async function handleDeleteTextAsset(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "ai-text-asset-write-user",
    userId: session.user.id,
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-text-asset-write",
  });
  if (limited) return limited;

  try {
    const result = await deleteUserAiTextAsset({
      env,
      userId: session.user.id,
      assetId,
    });
    return json({
      ok: true,
      code: result?.code || "deleted",
      data: result || { code: "deleted", deleted: true },
    });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    return json(
      {
        ok: false,
        error: error.message,
        code: error.code || error.branch || "delete_failed",
        details: error.details || undefined,
      },
      { status: error.status }
    );
  }
}
