import {
  AI_MUSIC_ASSET_MAX_BYTES,
  detectMusicAssetMimeTypeFromBytes,
  normalizeMusicAssetMimeType,
} from "./ai-text-assets.js";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
} from "../../../../js/shared/remote-media-policy.mjs";
import {
  getTrustedGeneratedAudioOutputUrl as parseTrustedGeneratedAudioOutputUrl,
} from "../../../../js/shared/generated-audio-output-url.mjs";

const GENERATED_AUDIO_FETCH_TIMEOUT_MS = 60_000;

export function makeGeneratedAudioSaveError(message, { status = 400, code = "validation_error" } = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function buildRejectedRemoteAudioUrlError(audioUrl, reason = "remote_audio_save_url_rejected") {
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

export function getTrustedGeneratedAudioOutputUrl(value) {
  return parseTrustedGeneratedAudioOutputUrl(value);
}

function parseContentLength(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeContentType(contentType) {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function normalizeFetchedAudioMimeType(contentType, bytes) {
  const declared = normalizeContentType(contentType);
  const normalized = normalizeMusicAssetMimeType(declared);
  const detected = detectMusicAssetMimeTypeFromBytes(bytes);
  if (normalized === "audio/ogg") {
    return detected === "audio/ogg" ? "audio/ogg" : null;
  }
  if (normalized) return detected && detected !== normalized ? null : normalized;
  if (!declared || declared === "application/octet-stream" || declared === "binary/octet-stream") {
    return detected;
  }
  return null;
}

async function readResponseBytesWithLimit(response, limit) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > limit) {
      throw makeGeneratedAudioSaveError(`Music asset exceeds the ${limit} byte limit.`);
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
          } catch {}
        }
        throw makeGeneratedAudioSaveError(`Music asset exceeds the ${limit} byte limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    if (typeof reader.releaseLock === "function") {
      try {
        reader.releaseLock();
      } catch {}
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

export async function fetchGeneratedAudioForSave(audioUrl) {
  const trustedUrl = getTrustedGeneratedAudioOutputUrl(audioUrl);
  if (!trustedUrl) {
    throw buildRejectedRemoteAudioUrlError(audioUrl);
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), GENERATED_AUDIO_FETCH_TIMEOUT_MS)
    : null;
  let stage = "fetch";
  try {
    const response = await fetch(trustedUrl.toString(), {
      method: "GET",
      redirect: "manual",
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response?.ok) {
      throw makeGeneratedAudioSaveError("Generated audio could not be fetched for saving.", {
        status: 502,
        code: "upstream_audio_fetch_failed",
      });
    }

    const declaredLength = parseContentLength(response.headers.get("content-length"));
    if (declaredLength !== null && declaredLength > AI_MUSIC_ASSET_MAX_BYTES) {
      throw makeGeneratedAudioSaveError(`Music asset exceeds the ${AI_MUSIC_ASSET_MAX_BYTES} byte limit.`);
    }

    stage = "read";
    const bytes = await readResponseBytesWithLimit(response, AI_MUSIC_ASSET_MAX_BYTES);
    if (bytes.byteLength === 0) {
      throw makeGeneratedAudioSaveError("Audio payload is empty.");
    }
    if (bytes.byteLength > AI_MUSIC_ASSET_MAX_BYTES) {
      throw makeGeneratedAudioSaveError(`Music asset exceeds the ${AI_MUSIC_ASSET_MAX_BYTES} byte limit.`);
    }

    const mimeType = normalizeFetchedAudioMimeType(response.headers.get("content-type"), bytes);
    if (!mimeType) {
      throw makeGeneratedAudioSaveError("Generated audio is not a supported audio file.");
    }

    return {
      bytes,
      mimeType,
      sizeBytes: bytes.byteLength,
    };
  } catch (error) {
    if (error?.status && error?.code) {
      throw error;
    }
    if (controller?.signal?.aborted) {
      throw makeGeneratedAudioSaveError("Generated audio fetch timed out before it could be saved.", {
        status: 504,
        code: "upstream_audio_fetch_timeout",
      });
    }
    throw makeGeneratedAudioSaveError(
      stage === "fetch"
        ? "Generated audio could not be fetched for saving."
        : "Generated audio could not be read for saving.",
      {
        status: 502,
        code: "upstream_audio_fetch_failed",
      }
    );
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
