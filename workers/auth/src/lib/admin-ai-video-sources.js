import {
  ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
  ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  buildPublicMempicUrl,
  buildPublicMempicVersion,
  buildPublicMemvidUrl,
  buildPublicMemvidVersion,
} from "../../../../js/shared/public-media-contract.mjs";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import {
  getAiSaveReferenceSigningSecret,
  getAiSaveReferenceSigningSecretCandidates,
} from "./security-secrets.js";
import { randomTokenHex, sha256Hex } from "./tokens.js";

export const ADMIN_AI_MEDIA_SOURCE_TOKEN_PURPOSE = "admin_ai_grok_preview_media_source";
export const ADMIN_AI_VIDEO_SOURCE_TOKEN_PURPOSE = "admin_ai_grok_preview_video_source";
export const ADMIN_AI_VIDEO_SOURCE_TOKEN_VERSION = 1;
export const ADMIN_AI_VIDEO_SOURCE_TOKEN_TTL_MS = 45 * 60 * 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const signingKeyCache = new Map();
const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

class AdminAiVideoSourceError extends Error {
  constructor(message, { status = 400, code = "invalid_video_source" } = {}) {
    super(message);
    this.name = "AdminAiVideoSourceError";
    this.status = status;
    this.code = code;
  }
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toBase64Url(value) {
  return String(value || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  if (padding === 1) throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  return padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

async function getSigningKey(secret) {
  const cacheKey = String(secret || "");
  if (!cacheKey) throw new AdminAiVideoSourceError("Media source signing is unavailable.", { status: 503, code: "media_source_signing_unavailable" });
  if (!signingKeyCache.has(cacheKey)) {
    signingKeyCache.set(
      cacheKey,
      crypto.subtle.importKey(
        "raw",
        textEncoder.encode(`admin-ai-video-source:${cacheKey}`),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      )
    );
  }
  return signingKeyCache.get(cacheKey);
}

async function signPayload(secret, payload) {
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(stableStringify(payload)));
  return toBase64Url(bytesToBase64(new Uint8Array(signature)));
}

function safeEqualString(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function normalizeMediaType(value) {
  const media = String(value || "video").trim().toLowerCase();
  return media === "image" || media === "video" ? media : "video";
}

function normalizeSourceType(value, mediaType = "video") {
  const type = String(value || "").trim();
  if (mediaType === "image") return type === "saved_asset" || type === "mempic" ? type : "";
  return type === "saved_asset" || type === "memvid" ? type : "";
}

function normalizeAssetId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : "";
}

function normalizeScope(value, mediaType = "video") {
  const scope = String(value || "all").trim();
  if (scope === "saved_assets" || scope === "all" || scope === "public") return scope;
  if (mediaType === "video" && scope === "memvids") return "public";
  if (mediaType === "image" && scope === "mempics") return "public";
  return "all";
}

function normalizeLegacyScope(scope, mediaType) {
  if (mediaType === "video" && scope === "public") return "memvids";
  if (mediaType === "image" && scope === "public") return "mempics";
  return scope;
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

function normalizeCursorOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1000, Math.max(0, Math.trunc(parsed)));
}

function safeTitle(row, fallback) {
  return String(row?.title || row?.file_name || row?.prompt || fallback || "Media").trim().slice(0, 180);
}

function parseMetadata(row) {
  try {
    const parsed = JSON.parse(row?.metadata_json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function durationFromMetadata(row) {
  const metadata = parseMetadata(row);
  const value = Number(metadata.duration_seconds ?? metadata.durationSeconds ?? metadata.duration);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function toSavedVideoCandidate(row) {
  return {
    media_type: "video",
    source_type: "saved_asset",
    asset_id: row.id,
    title: safeTitle(row, "Saved video asset"),
    mime_type: row.mime_type || "video/mp4",
    size_bytes: row.size_bytes ?? null,
    duration_seconds: durationFromMetadata(row),
    created_at: row.created_at || null,
    published_at: null,
    poster_url: row.poster_r2_key ? `/api/ai/text-assets/${encodeURIComponent(row.id)}/poster` : null,
    preview_url: `/api/ai/text-assets/${encodeURIComponent(row.id)}/file`,
  };
}

function toMemvidCandidate(row) {
  const version = buildPublicMemvidVersion(row);
  return {
    media_type: "video",
    source_type: "memvid",
    asset_id: row.id,
    title: safeTitle(row, "Published Memvid"),
    mime_type: row.mime_type || "video/mp4",
    size_bytes: row.size_bytes ?? null,
    duration_seconds: durationFromMetadata(row),
    created_at: row.created_at || null,
    published_at: row.published_at || null,
    poster_url: row.poster_r2_key ? buildPublicMemvidUrl(row.id, version, "poster") : null,
    preview_url: buildPublicMemvidUrl(row.id, version, "file"),
  };
}

function toSavedImageCandidate(row) {
  return {
    media_type: "image",
    source_type: "saved_asset",
    asset_id: row.id,
    title: safeTitle(row, "Saved image asset"),
    mime_type: row.medium_mime_type || row.thumb_mime_type || "image/png",
    size_bytes: row.size_bytes ?? null,
    duration_seconds: null,
    created_at: row.created_at || null,
    published_at: null,
    poster_url: null,
    thumb_url: row.thumb_key ? `/api/ai/images/${encodeURIComponent(row.id)}/thumb` : null,
    preview_url: row.medium_key
      ? `/api/ai/images/${encodeURIComponent(row.id)}/medium`
      : `/api/ai/images/${encodeURIComponent(row.id)}/file`,
  };
}

function toMempicCandidate(row) {
  const version = buildPublicMempicVersion(row);
  return {
    media_type: "image",
    source_type: "mempic",
    asset_id: row.id,
    title: safeTitle(row, "Published Mempic"),
    mime_type: row.medium_mime_type || row.thumb_mime_type || "image/png",
    size_bytes: row.size_bytes ?? null,
    duration_seconds: null,
    created_at: row.created_at || null,
    published_at: row.published_at || null,
    poster_url: null,
    thumb_url: buildPublicMempicUrl(row.id, version, "thumb"),
    preview_url: buildPublicMempicUrl(row.id, version, "medium"),
  };
}

function assertSupportedVideoRow(row) {
  if (!row?.r2_key) {
    throw new AdminAiVideoSourceError("Video source is missing media.", { status: 404, code: "video_source_not_found" });
  }
  const mimeType = String(row.mime_type || "").toLowerCase();
  if (!mimeType.startsWith("video/") || !SUPPORTED_VIDEO_MIME_TYPES.has(mimeType)) {
    throw new AdminAiVideoSourceError("Video source MIME type is not supported.", { status: 400, code: "unsupported_video_source" });
  }
}

function assertSupportedImageRow(row) {
  if (!row?.r2_key) {
    throw new AdminAiVideoSourceError("Image source is missing media.", { status: 404, code: "image_source_not_found" });
  }
}

function assertSupportedObjectContentType(mediaType, contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (mediaType === "image" && !SUPPORTED_IMAGE_MIME_TYPES.has(normalized)) {
    throw new AdminAiVideoSourceError("Image source MIME type is not supported.", { status: 400, code: "unsupported_image_source" });
  }
  if (mediaType === "video" && !SUPPORTED_VIDEO_MIME_TYPES.has(normalized)) {
    throw new AdminAiVideoSourceError("Video source MIME type is not supported.", { status: 400, code: "unsupported_video_source" });
  }
}

async function listSavedVideoCandidates(env, adminUserId, limit, offset) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json, r2_key,
            created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes
     FROM ai_text_assets
     WHERE user_id = ?
       AND source_module = 'video'
       AND r2_key IS NOT NULL
       AND mime_type LIKE 'video/%'
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(adminUserId, limit + 1, offset).all();
  const resultRows = Array.isArray(rows?.results) ? rows.results : [];
  return resultRows.map(toSavedVideoCandidate);
}

async function listMemvidCandidates(env, limit, offset) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json, r2_key,
            created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes
     FROM ai_text_assets
     WHERE visibility = 'public'
       AND source_module = 'video'
       AND r2_key IS NOT NULL
       AND mime_type LIKE 'video/%'
     ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(limit + 1, offset).all();
  const resultRows = Array.isArray(rows?.results) ? rows.results : [];
  return resultRows.map(toMemvidCandidate);
}

async function listSavedImageCandidates(env, adminUserId, limit, offset) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, prompt, model, r2_key, size_bytes, visibility, published_at,
            created_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width,
            medium_height, derivatives_status, derivatives_version, derivatives_ready_at,
            thumb_mime_type, medium_mime_type
     FROM ai_images
     WHERE user_id = ?
       AND r2_key IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(adminUserId, limit + 1, offset).all();
  const resultRows = Array.isArray(rows?.results) ? rows.results : [];
  return resultRows.map(toSavedImageCandidate);
}

async function listMempicCandidates(env, limit, offset) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, prompt, model, r2_key, size_bytes, visibility, published_at,
            created_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width,
            medium_height, derivatives_status, derivatives_version, derivatives_ready_at,
            thumb_mime_type, medium_mime_type
     FROM ai_images
     WHERE visibility = 'public'
       AND derivatives_status = 'ready'
       AND thumb_key IS NOT NULL
       AND medium_key IS NOT NULL
       AND r2_key IS NOT NULL
     ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(limit + 1, offset).all();
  const resultRows = Array.isArray(rows?.results) ? rows.results : [];
  return resultRows.map(toMempicCandidate);
}

async function listSavedCandidates(env, adminUserId, mediaType, limit, offset) {
  return mediaType === "image"
    ? listSavedImageCandidates(env, adminUserId, limit, offset)
    : listSavedVideoCandidates(env, adminUserId, limit, offset);
}

async function listPublicCandidates(env, mediaType, limit, offset) {
  return mediaType === "image"
    ? listMempicCandidates(env, limit, offset)
    : listMemvidCandidates(env, limit, offset);
}

export async function listAdminAiMediaSourceCandidates(env, adminUser, searchParams = new URLSearchParams()) {
  if (!env?.DB) {
    throw new AdminAiVideoSourceError("Media sources are unavailable.", { status: 503, code: "media_sources_unavailable" });
  }
  const mediaType = normalizeMediaType(searchParams.get("media"));
  const scope = normalizeScope(searchParams.get("scope"), mediaType);
  const limit = normalizeLimit(searchParams.get("limit"));
  const offset = normalizeCursorOffset(searchParams.get("cursor"));
  let candidates = [];
  if (scope === "saved_assets") {
    candidates = await listSavedCandidates(env, adminUser.id, mediaType, limit, offset);
  } else if (scope === "public") {
    candidates = await listPublicCandidates(env, mediaType, limit, offset);
  } else {
    const [saved, published] = await Promise.all([
      listSavedCandidates(env, adminUser.id, mediaType, limit, offset),
      listPublicCandidates(env, mediaType, limit, offset),
    ]);
    candidates = [...saved, ...published]
      .sort((a, b) => String(b.published_at || b.created_at || "").localeCompare(String(a.published_at || a.created_at || "")));
  }
  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;
  return {
    candidates: page,
    next_cursor: hasMore ? String(offset + limit) : null,
    has_more: hasMore,
    scope,
    media: mediaType,
    applied_limit: limit,
  };
}

export async function listAdminAiVideoSourceCandidates(env, adminUser, searchParams = new URLSearchParams()) {
  const params = new URLSearchParams(searchParams);
  params.set("media", "video");
  const result = await listAdminAiMediaSourceCandidates(env, adminUser, params);
  return {
    ...result,
    scope: normalizeLegacyScope(result.scope, "video"),
  };
}

export function normalizeAdminAiMediaSourceReference(value, mediaType = "video", field = mediaType === "image" ? "source_image" : "source_video") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiVideoSourceError(`${field} is required.`, { status: 400, code: `invalid_${field}` });
  }
  const normalizedMedia = normalizeMediaType(mediaType);
  const sourceType = normalizeSourceType(value.source_type || value.sourceType, normalizedMedia);
  const assetId = normalizeAssetId(value.asset_id || value.assetId);
  if (!sourceType || !assetId) {
    throw new AdminAiVideoSourceError(`${field} is invalid.`, { status: 400, code: `invalid_${field}` });
  }
  return { media_type: normalizedMedia, source_type: sourceType, asset_id: assetId };
}

export function normalizeAdminAiVideoSourceReference(value) {
  const ref = normalizeAdminAiMediaSourceReference(value, "video", "source_video");
  return { source_type: ref.source_type, asset_id: ref.asset_id };
}

async function getSavedVideoSource(env, adminUserId, assetId) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json, r2_key,
            created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes
     FROM ai_text_assets
     WHERE id = ?
       AND user_id = ?
       AND source_module = 'video'
       AND r2_key IS NOT NULL
       AND mime_type LIKE 'video/%'
     LIMIT 1`
  ).bind(assetId, adminUserId).first();
  if (!row) {
    throw new AdminAiVideoSourceError("Video source was not found.", { status: 404, code: "video_source_not_found" });
  }
  assertSupportedVideoRow(row);
  return row;
}

async function getMemvidSource(env, assetId) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json, r2_key,
            created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes
     FROM ai_text_assets
     WHERE id = ?
       AND visibility = 'public'
       AND source_module = 'video'
       AND r2_key IS NOT NULL
       AND mime_type LIKE 'video/%'
     LIMIT 1`
  ).bind(assetId).first();
  if (!row) {
    throw new AdminAiVideoSourceError("Video source was not found.", { status: 404, code: "video_source_not_found" });
  }
  assertSupportedVideoRow(row);
  return row;
}

async function getSavedImageSource(env, adminUserId, assetId) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, prompt, model, r2_key, size_bytes, visibility, published_at,
            created_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width,
            medium_height, derivatives_status, derivatives_version, derivatives_ready_at,
            thumb_mime_type, medium_mime_type
     FROM ai_images
     WHERE id = ?
       AND user_id = ?
       AND r2_key IS NOT NULL
     LIMIT 1`
  ).bind(assetId, adminUserId).first();
  if (!row) {
    throw new AdminAiVideoSourceError("Image source was not found.", { status: 404, code: "image_source_not_found" });
  }
  assertSupportedImageRow(row);
  return row;
}

async function getMempicSource(env, assetId) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, prompt, model, r2_key, size_bytes, visibility, published_at,
            created_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width,
            medium_height, derivatives_status, derivatives_version, derivatives_ready_at,
            thumb_mime_type, medium_mime_type
     FROM ai_images
     WHERE id = ?
       AND visibility = 'public'
       AND derivatives_status = 'ready'
       AND thumb_key IS NOT NULL
       AND medium_key IS NOT NULL
       AND r2_key IS NOT NULL
     LIMIT 1`
  ).bind(assetId).first();
  if (!row) {
    throw new AdminAiVideoSourceError("Image source was not found.", { status: 404, code: "image_source_not_found" });
  }
  assertSupportedImageRow(row);
  return row;
}

async function getSourceRow(env, sourceRef, adminUserId) {
  if (sourceRef.media_type === "image") {
    return sourceRef.source_type === "saved_asset"
      ? getSavedImageSource(env, adminUserId, sourceRef.asset_id)
      : getMempicSource(env, sourceRef.asset_id);
  }
  return sourceRef.source_type === "saved_asset"
    ? getSavedVideoSource(env, adminUserId, sourceRef.asset_id)
    : getMemvidSource(env, sourceRef.asset_id);
}

function getProviderOrigin(env, origin = null) {
  const raw = String(origin || env?.APP_BASE_URL || "https://bitbi.ai").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return "https://bitbi.ai";
    return parsed.origin;
  } catch {
    return "https://bitbi.ai";
  }
}

async function createMediaSourceToken(env, sourceRef, {
  model = ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
  operation = "extend",
  sourceRole = null,
  userId = null,
  jobId = null,
  expiresAt = Date.now() + ADMIN_AI_VIDEO_SOURCE_TOKEN_TTL_MS,
} = {}) {
  const payload = {
    v: ADMIN_AI_VIDEO_SOURCE_TOKEN_VERSION,
    purpose: ADMIN_AI_MEDIA_SOURCE_TOKEN_PURPOSE,
    model,
    operation,
    media: sourceRef.media_type,
    source_role: sourceRole || null,
    source_type: sourceRef.source_type,
    asset_id: sourceRef.asset_id,
    user_id: userId || null,
    job_id: jobId || null,
    exp: Math.floor(Number(expiresAt)),
    nonce: randomTokenHex(12),
  };
  const unsigned = toBase64Url(bytesToBase64(textEncoder.encode(JSON.stringify(payload))));
  const sig = await signPayload(getAiSaveReferenceSigningSecret(env), payload);
  return `${unsigned}.${sig}`;
}

async function parseMediaSourceToken(env, token, { now = Date.now() } = {}) {
  const raw = String(token || "").trim();
  const separator = raw.lastIndexOf(".");
  if (separator <= 0 || separator === raw.length - 1 || raw.length > 2200) {
    throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  }
  let payload;
  try {
    payload = JSON.parse(textDecoder.decode(base64ToBytes(fromBase64Url(raw.slice(0, separator)))));
  } catch {
    throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  }
  const signature = raw.slice(separator + 1);
  let matched = false;
  for (const candidate of getAiSaveReferenceSigningSecretCandidates(env)) {
    if (safeEqualString(signature, await signPayload(candidate.secret, payload))) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  }
  const isLegacyVideoToken = payload.purpose === ADMIN_AI_VIDEO_SOURCE_TOKEN_PURPOSE;
  const mediaType = isLegacyVideoToken ? "video" : String(payload.media || "").trim().toLowerCase();
  const operation = String(payload.operation || "").trim();
  const modelId = String(payload.model || "").trim();
  const isGrokVideoModel = modelId === ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID;
  const isGrokImageModel = modelId === ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID;
  const isGrokImageOperation = operation === "image_generate" || operation === "generate";
  if (
    payload.v !== ADMIN_AI_VIDEO_SOURCE_TOKEN_VERSION ||
    (payload.purpose !== ADMIN_AI_MEDIA_SOURCE_TOKEN_PURPOSE && !isLegacyVideoToken) ||
    (!isGrokVideoModel && !isGrokImageModel) ||
    !["image", "video"].includes(mediaType) ||
    (isGrokVideoModel && !["generate", "edit", "extend"].includes(operation)) ||
    (isGrokVideoModel && operation === "generate" && mediaType !== "image") ||
    (isGrokVideoModel && (operation === "edit" || operation === "extend") && mediaType !== "video") ||
    (isGrokImageModel && (!isGrokImageOperation || mediaType !== "image")) ||
    !normalizeSourceType(payload.source_type, mediaType) ||
    !normalizeAssetId(payload.asset_id)
  ) {
    throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  }
  if (isLegacyVideoToken && operation !== "extend") {
    throw new AdminAiVideoSourceError("Invalid media source token.", { status: 403, code: "invalid_media_source_token" });
  }
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) {
    throw new AdminAiVideoSourceError("Media source token expired.", { status: 410, code: "media_source_token_expired" });
  }
  return {
    media_type: mediaType,
    operation,
    source_type: payload.source_type,
    asset_id: payload.asset_id,
    source_role: typeof payload.source_role === "string" && payload.source_role ? payload.source_role : null,
    model: modelId,
    user_id: typeof payload.user_id === "string" && payload.user_id ? payload.user_id : null,
    job_id: typeof payload.job_id === "string" && payload.job_id ? payload.job_id : null,
  };
}

function getSourceRefForOperation(payload) {
  const operation = String(payload?._operation || "generate").trim() || "generate";
  if (operation === "generate") {
    return normalizeAdminAiMediaSourceReference(payload.source_image, "image", "source_image");
  }
  return normalizeAdminAiMediaSourceReference(payload.source_video, "video", "source_video");
}

function stripPreviewMediaSourceFields(payload) {
  const {
    source_image: _sourceImage,
    sourceImage: _sourceImageAlias,
    source_video: _sourceVideo,
    sourceVideo: _sourceVideoAlias,
    image: _image,
    image_url: _imageUrl,
    imageInput: _imageInput,
    video: _video,
    video_url: _videoUrl,
    videoInput: _videoInput,
    reference_images: _referenceImages,
    referenceImages: _referenceImagesAlias,
    ...rest
  } = payload || {};
  return rest;
}

function stripGrokImagineImageSourceFields(payload) {
  const {
    source_image: _sourceImage,
    sourceImage: _sourceImageAlias,
    source_images: _sourceImages,
    sourceImages: _sourceImagesAlias,
    source_mask: _sourceMask,
    sourceMask: _sourceMaskAlias,
    image: _image,
    images: _images,
    mask: _mask,
    organization_id: _organizationId,
    organizationId: _organizationIdAlias,
    ...rest
  } = payload || {};
  return rest;
}

function optionalSourceRef(value, role) {
  if (!value) return null;
  return normalizeAdminAiMediaSourceReference(value, "image", role);
}

function sourceRefsForGrokImage(payload) {
  const sourceImage = optionalSourceRef(payload?.source_image || payload?.sourceImage, "source_image");
  const sourceImagesRaw = Array.isArray(payload?.source_images)
    ? payload.source_images
    : Array.isArray(payload?.sourceImages)
      ? payload.sourceImages
      : [];
  const sourceImages = sourceImagesRaw.map((entry, index) =>
    normalizeAdminAiMediaSourceReference(entry, "image", `source_images[${index}]`)
  );
  const sourceMask = optionalSourceRef(payload?.source_mask || payload?.sourceMask, "source_mask");
  return {
    sourceImage,
    sourceImages,
    sourceMask,
  };
}

function imageObjectForProvider(providerUrl, source) {
  const mimeType = String(source?.medium_mime_type || source?.thumb_mime_type || "").trim();
  return mimeType ? { url: providerUrl, type: mimeType } : { url: providerUrl };
}

async function resolveImageSourceForProvider(env, adminUser, sourceRef, {
  correlationId = null,
  jobId = null,
  origin = null,
  sourceRole = "image",
} = {}) {
  const source = await getSourceRow(env, sourceRef, adminUser?.id || null);
  const token = await createMediaSourceToken(env, sourceRef, {
    model: ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID,
    operation: "image_generate",
    sourceRole,
    userId: sourceRef.source_type === "saved_asset" ? adminUser?.id || null : null,
    jobId,
  });
  const providerUrl = `${getProviderOrigin(env, origin)}/api/internal/ai/media-source/${encodeURIComponent(token)}`;
  const sourceIdHash = await sha256Hex(sourceRef.asset_id);
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-ai-media-source",
    event: "admin_ai_grok_imagine_image_media_source_resolved",
    level: "info",
    correlationId,
    job_id: jobId || null,
    model: ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID,
    source_role: sourceRole,
    source_media_type: sourceRef.media_type,
    source_type: sourceRef.source_type,
    source_asset_id_hash: sourceIdHash,
    source_mime_type: source.medium_mime_type || source.thumb_mime_type || null,
    source_size_bytes: source.size_bytes ?? null,
  });
  return imageObjectForProvider(providerUrl, source);
}

export async function resolveAdminAiGrokPreviewMediaSourcesForProvider(env, adminUser, payload, {
  correlationId = null,
  jobId = null,
  origin = null,
} = {}) {
  if (payload?.model !== ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID) {
    return payload;
  }
  const operation = String(payload?._operation || "generate").trim() || "generate";
  if (!["generate", "edit", "extend"].includes(operation)) return payload;
  const sourceRef = getSourceRefForOperation(payload);
  const source = await getSourceRow(env, sourceRef, adminUser?.id || null);
  const token = await createMediaSourceToken(env, sourceRef, {
    operation,
    userId: sourceRef.source_type === "saved_asset" ? adminUser?.id || null : null,
    jobId,
  });
  const providerUrl = `${getProviderOrigin(env, origin)}/api/internal/ai/media-source/${encodeURIComponent(token)}`;
  const sourceIdHash = await sha256Hex(sourceRef.asset_id);
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-ai-media-source",
    event: "admin_ai_grok_preview_media_source_resolved",
    level: "info",
    correlationId,
    job_id: jobId || null,
    model: ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
    operation,
    source_media_type: sourceRef.media_type,
    source_type: sourceRef.source_type,
    source_asset_id_hash: sourceIdHash,
    source_mime_type: source.mime_type || null,
    source_size_bytes: source.size_bytes ?? null,
  });
  const rest = stripPreviewMediaSourceFields(payload);
  return operation === "generate"
    ? { ...rest, image: { url: providerUrl } }
    : { ...rest, video: { url: providerUrl } };
}

export async function resolveAdminAiGrokPreviewExtendSourceForProvider(env, adminUser, payload, options = {}) {
  return resolveAdminAiGrokPreviewMediaSourcesForProvider(env, adminUser, payload, options);
}

export async function resolveAdminAiGrokImagineImageSourcesForProvider(env, adminUser, payload, {
  correlationId = null,
  jobId = null,
  origin = null,
} = {}) {
  if (payload?.model !== ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID) {
    return payload;
  }
  const { sourceImage, sourceImages, sourceMask } = sourceRefsForGrokImage(payload);
  const rest = stripGrokImagineImageSourceFields(payload);
  const resolved = { ...rest };
  if (sourceImage) {
    resolved.image = await resolveImageSourceForProvider(env, adminUser, sourceImage, {
      correlationId,
      jobId,
      origin,
      sourceRole: "image",
    });
  }
  if (sourceImages.length > 0) {
    resolved.images = [];
    for (const [index, sourceRef] of sourceImages.entries()) {
      resolved.images.push(await resolveImageSourceForProvider(env, adminUser, sourceRef, {
        correlationId,
        jobId,
        origin,
        sourceRole: `images.${index}`,
      }));
    }
  }
  if (sourceMask) {
    resolved.mask = await resolveImageSourceForProvider(env, adminUser, sourceMask, {
      correlationId,
      jobId,
      origin,
      sourceRole: "mask",
    });
  }
  return resolved;
}

function errorResponse(error) {
  const status = Number(error?.status || 500);
  return new Response(JSON.stringify({
    ok: false,
    error: status >= 500 ? "Media source is unavailable." : error.message,
    code: error?.code || "media_source_error",
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleAdminAiMediaSourceTokenRequest(ctx, token) {
  const { env, method, correlationId } = ctx;
  if (method !== "GET" && method !== "HEAD") return null;
  try {
    const ref = await parseMediaSourceToken(env, token);
    const source = await getSourceRow(env, ref, ref.user_id);
    const object = await env.USER_IMAGES.get(source.r2_key);
    if (!object) {
      throw new AdminAiVideoSourceError("Media source was not found.", { status: 404, code: "media_source_not_found" });
    }
    const contentType = ref.media_type === "image"
      ? object.httpMetadata?.contentType || source.medium_mime_type || source.thumb_mime_type || "image/png"
      : source.mime_type || object.httpMetadata?.contentType || "video/mp4";
    assertSupportedObjectContentType(ref.media_type, contentType);
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const size = Number(source.size_bytes || object.size || 0);
    if (Number.isFinite(size) && size > 0) headers.set("Content-Length", String(size));
    return new Response(method === "HEAD" ? null : object.body, { status: 200, headers });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-media-source",
      event: "admin_ai_media_source_token_failed",
      level: Number(error?.status || 500) >= 500 ? "error" : "warn",
      correlationId,
      error_code: error?.code || "media_source_error",
      ...getErrorFields(error, { includeMessage: false }),
    });
    return errorResponse(error);
  }
}

export async function handleAdminAiVideoSourceTokenRequest(ctx, token) {
  return handleAdminAiMediaSourceTokenRequest(ctx, token);
}
