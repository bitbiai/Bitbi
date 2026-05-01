import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { AI_MUSIC_ASSET_MAX_BYTES, saveAdminAiTextAsset } from "../../lib/ai-text-assets.js";
import { enforceSensitiveUserRateLimit } from "../../lib/sensitive-write-limit.js";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
  getRemoteMediaPolicyLogFields,
} from "../../../../../js/shared/remote-media-policy.mjs";
import { buildRenamedFileName, hasControlCharacters, isMissingTextAssetTableError } from "./helpers.js";
import { AiAssetLifecycleError, deleteUserAiTextAsset } from "./lifecycle.js";

const MAX_PROMPT_LENGTH = 1000;
const MAX_SAVED_FILE_TITLE_LENGTH = 120;
const GENERATED_AUDIO_URL_MAX_LENGTH = 4096;
const TRUSTED_AUDIO_OUTPUT_PATH_PREFIX = "/provider-outputs/";
const TRUSTED_AUDIO_OUTPUT_HOST_PREFIX = "ai-gateway-outputs";
const TRUSTED_AUDIO_OUTPUT_HOST_SUFFIX = ".cloudflarestorage.com";
const FETCHED_AUDIO_MIME_TYPES = new Map([
  ["audio/mpeg", "audio/mpeg"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-mpeg", "audio/mpeg"],
  ["audio/wav", "audio/wav"],
  ["audio/wave", "audio/wav"],
  ["audio/x-wav", "audio/wav"],
  ["audio/flac", "audio/flac"],
  ["audio/x-flac", "audio/flac"],
]);

function makeAudioSaveError(message, { status = 400, code = "validation_error" } = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function buildRejectedRemoteAudioUrlError(audioUrl, reason = "remote_audio_save_url_rejected") {
  const error = attachRemoteMediaPolicyContext(
    new Error(
      buildRemoteMediaUrlRejectedMessage(
        "audioUrl",
        "Only trusted Bitbi-generated audio output URLs can be saved by reference."
      )
    ),
    audioUrl,
    {
      field: "audioUrl",
      reason,
    }
  );
  error.status = 400;
  error.code = REMOTE_MEDIA_URL_POLICY_CODE;
  return error;
}

function getTrustedGeneratedAudioOutputUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > GENERATED_AUDIO_URL_MAX_LENGTH) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isTrustedHost = hostname.startsWith(TRUSTED_AUDIO_OUTPUT_HOST_PREFIX)
    && hostname.endsWith(TRUSTED_AUDIO_OUTPUT_HOST_SUFFIX);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    !isTrustedHost ||
    !parsed.pathname.startsWith(TRUSTED_AUDIO_OUTPUT_PATH_PREFIX)
  ) {
    return null;
  }

  return parsed;
}

function parseContentLength(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function uint8ArrayToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeContentType(contentType) {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function sniffAudioMimeType(bytes) {
  if (!bytes || bytes.byteLength < 4) return null;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mpeg";
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return "audio/flac";
  }
  return null;
}

function normalizeFetchedAudioMimeType(contentType, bytes) {
  const declared = normalizeContentType(contentType);
  const normalized = FETCHED_AUDIO_MIME_TYPES.get(declared);
  if (normalized) return normalized;
  if (!declared || declared === "application/octet-stream" || declared === "binary/octet-stream") {
    return sniffAudioMimeType(bytes);
  }
  return null;
}

async function readResponseBytesWithLimit(response, limit) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > limit) {
      throw makeAudioSaveError(`Music asset exceeds the ${limit} byte limit.`);
    }
    return bytes;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limit) {
        if (typeof reader.cancel === "function") {
          try {
            await reader.cancel();
          } catch {
            // Best effort only; the caller receives the size-limit error.
          }
        }
        throw makeAudioSaveError(`Music asset exceeds the ${limit} byte limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    if (typeof reader.releaseLock === "function") {
      try {
        reader.releaseLock();
      } catch {
        // The stream may already be closed or cancelled.
      }
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchGeneratedAudioForSave(audioUrl) {
  let response;
  try {
    response = await fetch(audioUrl, {
      method: "GET",
      redirect: "manual",
    });
  } catch {
    throw makeAudioSaveError("Generated audio could not be fetched for saving.", {
      status: 502,
      code: "upstream_audio_fetch_failed",
    });
  }

  if (!response?.ok) {
    throw makeAudioSaveError("Generated audio could not be fetched for saving.", {
      status: 502,
      code: "upstream_audio_fetch_failed",
    });
  }

  const declaredLength = parseContentLength(response.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > AI_MUSIC_ASSET_MAX_BYTES) {
    throw makeAudioSaveError(`Music asset exceeds the ${AI_MUSIC_ASSET_MAX_BYTES} byte limit.`);
  }

  let bytes;
  try {
    bytes = await readResponseBytesWithLimit(response, AI_MUSIC_ASSET_MAX_BYTES);
  } catch (error) {
    if (error?.status && error?.code) {
      throw error;
    }
    throw makeAudioSaveError("Generated audio could not be read for saving.", {
      status: 502,
      code: "upstream_audio_fetch_failed",
    });
  }

  if (bytes.byteLength === 0) {
    throw makeAudioSaveError("Audio payload is empty.");
  }
  if (bytes.byteLength > AI_MUSIC_ASSET_MAX_BYTES) {
    throw makeAudioSaveError(`Music asset exceeds the ${AI_MUSIC_ASSET_MAX_BYTES} byte limit.`);
  }

  const mimeType = normalizeFetchedAudioMimeType(response.headers.get("content-type"), bytes);
  if (!mimeType) {
    throw makeAudioSaveError("Generated audio is not a supported audio file.");
  }

  return {
    audioBase64: uint8ArrayToBase64(bytes),
    mimeType,
    sizeBytes: bytes.byteLength,
  };
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
