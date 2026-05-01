import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { saveAdminAiTextAsset } from "../../lib/ai-text-assets.js";
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
import { buildRenamedFileName, hasControlCharacters, isMissingTextAssetTableError } from "./helpers.js";
import { AiAssetLifecycleError, deleteUserAiTextAsset } from "./lifecycle.js";

const MAX_PROMPT_LENGTH = 1000;
const MAX_SAVED_FILE_TITLE_LENGTH = 120;

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

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_saved",
      correlationId,
      user_id: session.user.id,
      asset_id: saved.id,
      folder_id: saved.folder_id,
      size_bytes: saved.size_bytes,
    });

    return respond({ ok: true, data: saved }, { status: 201 });
  } catch (error) {
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
    await deleteUserAiTextAsset({
      env,
      userId: session.user.id,
      assetId,
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
