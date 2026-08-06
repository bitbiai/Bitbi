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
  AI_MUSIC_ASSET_MAX_BYTES,
  attachVideoPosterToAiTextAsset,
  normalizeMusicAssetMimeType,
  processGeneratedMusicCoverPoster,
  saveAdminAiTextAsset,
} from "../../lib/ai-text-assets.js";
import { enforceSensitiveUserRateLimit } from "../../lib/sensitive-write-limit.js";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import {
  getRemoteMediaPolicyLogFields,
} from "../../../../../js/shared/remote-media-policy.mjs";
import {
  ELEVENLABS_MUSIC_V2_MAX_PLAN_BYTES,
} from "../../../../../js/shared/elevenlabs-music-v2-pricing.mjs";
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

function boundedAudioSaveString(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function boundedAudioSaveNumber(value, {
  integer = false,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
} = {}) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  if (
    !Number.isFinite(normalized)
    || normalized < min
    || normalized > max
    || (integer && !Number.isSafeInteger(normalized))
  ) {
    return null;
  }
  return normalized;
}

function optionalAudioSaveBoolean(value) {
  return value === true ? true : value === false ? false : null;
}

function normalizeAudioSaveModel(value) {
  if (typeof value === "string") return boundedAudioSaveString(value, 180);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    id: boundedAudioSaveString(value.id || value.modelId || value.model_id, 180),
    label: boundedAudioSaveString(value.label, 120),
    vendor: boundedAudioSaveString(value.vendor || value.provider, 80),
    providerLabel: boundedAudioSaveString(value.providerLabel || value.provider_label, 120),
  };
}

function normalizeAudioSaveCompositionPlanSummary(body) {
  const source = body?.compositionPlanSummary;
  const summary = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const present = body?.compositionPlanPresent === true
    || body?.inputMode === "composition_plan"
    || source != null;
  if (!present) return null;
  return {
    present: true,
    chunk_count: boundedAudioSaveNumber(
      summary.chunkCount ?? summary.chunk_count ?? body?.compositionPlanChunkCount,
      { integer: true, max: 30 }
    ),
    serialized_length: boundedAudioSaveNumber(
      summary.serializedLength ?? summary.serialized_length ?? body?.compositionPlanSerializedLength,
      { integer: true, max: ELEVENLABS_MUSIC_V2_MAX_PLAN_BYTES }
    ),
    total_duration_ms: boundedAudioSaveNumber(
      summary.totalDurationMs ?? summary.total_duration_ms ?? body?.compositionPlanTotalDurationMs,
      { integer: true, max: 600_000 }
    ),
  };
}

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
  let audioBytes = null;
  let mimeType = String(body.mimeType || "audio/mpeg").trim();
  let sizeBytes = body.sizeBytes ?? null;

  if (!hasAudioBase64 && trustedAudioUrl) {
    try {
      const fetched = await fetchGeneratedAudioForSave(trustedAudioUrl.toString());
      audioBytes = fetched.bytes;
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

  if (!audioBase64 && !audioBytes) {
    return respond({ ok: false, error: "Audio data is required (audioBase64 or audioUrl)." }, { status: 400 });
  }

  const normalizedMimeType = normalizeMusicAssetMimeType(mimeType);
  if (!normalizedMimeType) {
    return respond({
      ok: false,
      error: "mimeType must be MP3, WAV, FLAC, or Ogg Opus audio.",
      code: "unsupported_audio_mime_type",
    }, { status: 400 });
  }
  mimeType = normalizedMimeType;

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

  const model = normalizeAudioSaveModel(body.model);
  const estimatedProviderCostUsd = boundedAudioSaveNumber(
    body.estimatedProviderCostUsd
      ?? (body.providerCostIsEstimate !== false ? body.providerCostUsd : null),
    { max: 1_000 }
  );
  const actualProviderCostUsd = boundedAudioSaveNumber(
    body.actualProviderCostUsd
      ?? (body.providerCostIsEstimate === false ? body.providerCostUsd : null),
    { max: 1_000 }
  );
  const payload = {
    audioBase64,
    // Server-fetched bytes never come from the browser JSON contract. Passing
    // them internally avoids a large URL output being Base64-encoded and then
    // decoded again before the existing MIME/quota/R2 checks.
    audioBytes,
    mimeType,
    prompt: body.prompt ? String(body.prompt).slice(0, MAX_PROMPT_LENGTH) : null,
    model,
    provider: boundedAudioSaveString(body.provider || model?.vendor, 80),
    inputMode: boundedAudioSaveString(body.inputMode, 40),
    compositionPlanSummary: normalizeAudioSaveCompositionPlanSummary(body),
    mode: boundedAudioSaveString(body.mode, 40),
    lyricsMode: boundedAudioSaveString(body.lyricsMode, 40),
    bpm: boundedAudioSaveNumber(body.bpm, { integer: true, max: 400 }),
    key: boundedAudioSaveString(body.key, 40),
    lyricsPreview: boundedAudioSaveString(body.lyricsPreview, 1_000),
    durationMs: boundedAudioSaveNumber(body.durationMs, { integer: true, max: 600_000 }),
    requestedDurationMs: boundedAudioSaveNumber(body.requestedDurationMs, { integer: true, max: 600_000 }),
    actualDurationMs: boundedAudioSaveNumber(body.actualDurationMs, { integer: true, max: 600_000 }),
    outputFormat: boundedAudioSaveString(body.outputFormat, 80),
    sampleRate: boundedAudioSaveNumber(body.sampleRate, { integer: true, max: 384_000 }),
    channels: boundedAudioSaveNumber(body.channels, { integer: true, max: 32 }),
    bitrate: boundedAudioSaveNumber(body.bitrate, { integer: true, max: 10_000_000 }),
    sizeBytes: boundedAudioSaveNumber(sizeBytes, {
      integer: true,
      max: AI_MUSIC_ASSET_MAX_BYTES,
    }),
    seed: boundedAudioSaveNumber(body.seed, { integer: true, max: 4_294_967_295 }),
    forceInstrumental: optionalAudioSaveBoolean(body.forceInstrumental),
    storeForInpainting: optionalAudioSaveBoolean(body.storeForInpainting),
    signWithC2pa: optionalAudioSaveBoolean(body.signWithC2pa),
    providerStatus: boundedAudioSaveString(body.providerStatus || body.providerState, 120),
    estimatedProviderCostUsd,
    actualProviderCostUsd,
    priceUsdPerOutputSecond: boundedAudioSaveNumber(body.priceUsdPerOutputSecond, { max: 100 }),
    providerCostEstimateDurationMs: boundedAudioSaveNumber(
      body.providerCostEstimateDurationMs,
      { integer: true, max: 600_000 }
    ),
    providerCostEstimateKind: boundedAudioSaveString(body.providerCostEstimateKind, 40),
    source: boundedAudioSaveString(body.source, 120),
    coverPrompt: body.coverPrompt ? String(body.coverPrompt).slice(0, MAX_PROMPT_LENGTH) : null,
    coverModel: boundedAudioSaveString(body.coverModel, 180),
    coverMimeType: coverPayload.coverMimeType,
    traceId: boundedAudioSaveString(body.traceId, 180),
    warnings: Array.isArray(body.warnings)
      ? body.warnings.slice(0, 20).map((warning) => boundedAudioSaveString(warning, 240)).filter(Boolean)
      : [],
    elapsedMs: boundedAudioSaveNumber(body.elapsedMs, { integer: true, max: 86_400_000 }),
    receivedAt: boundedAudioSaveString(body.receivedAt, 80),
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
