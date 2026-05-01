import { AI_MUSIC_ASSET_MAX_BYTES } from "./ai-text-assets.js";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
} from "../../../../js/shared/remote-media-policy.mjs";

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

  let response;
  try {
    response = await fetch(trustedUrl.toString(), {
      method: "GET",
      redirect: "manual",
    });
  } catch {
    throw makeGeneratedAudioSaveError("Generated audio could not be fetched for saving.", {
      status: 502,
      code: "upstream_audio_fetch_failed",
    });
  }

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

  let bytes;
  try {
    bytes = await readResponseBytesWithLimit(response, AI_MUSIC_ASSET_MAX_BYTES);
  } catch (error) {
    if (error?.status && error?.code) {
      throw error;
    }
    throw makeGeneratedAudioSaveError("Generated audio could not be read for saving.", {
      status: 502,
      code: "upstream_audio_fetch_failed",
    });
  }

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
    audioBase64: uint8ArrayToBase64(bytes),
    mimeType,
    sizeBytes: bytes.byteLength,
  };
}
