import {
  ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
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

export const ADMIN_AI_VIDEO_SOURCE_TOKEN_PURPOSE = "admin_ai_grok_preview_video_source";
export const ADMIN_AI_VIDEO_SOURCE_TOKEN_VERSION = 1;
export const ADMIN_AI_VIDEO_SOURCE_TOKEN_TTL_MS = 45 * 60 * 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const signingKeyCache = new Map();
const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

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
  if (padding === 1) throw new AdminAiVideoSourceError("Invalid video source token.", { status: 403, code: "invalid_video_source_token" });
  return padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

async function getSigningKey(secret) {
  const cacheKey = String(secret || "");
  if (!cacheKey) throw new AdminAiVideoSourceError("Video source signing is unavailable.", { status: 503, code: "video_source_signing_unavailable" });
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
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function normalizeSourceType(value) {
  const type = String(value || "").trim();
  return type === "saved_asset" || type === "memvid" ? type : "";
}

function normalizeAssetId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : "";
}

function normalizeScope(value) {
  const scope = String(value || "all").trim();
  return ["all", "saved_assets", "memvids"].includes(scope) ? scope : "all";
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
  return String(row?.title || row?.file_name || fallback || "Video").trim().slice(0, 180);
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

function toSavedAssetCandidate(row) {
  return {
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

function assertSupportedVideoRow(row) {
  if (!row?.r2_key) {
    throw new AdminAiVideoSourceError("Video source is missing media.", { status: 404, code: "video_source_not_found" });
  }
  const mimeType = String(row.mime_type || "").toLowerCase();
  if (!mimeType.startsWith("video/") || !SUPPORTED_VIDEO_MIME_TYPES.has(mimeType)) {
    throw new AdminAiVideoSourceError("Video source MIME type is not supported.", { status: 400, code: "unsupported_video_source" });
  }
}

async function listSavedAssetCandidates(env, adminUserId, limit, offset) {
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
  return resultRows.map(toSavedAssetCandidate);
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

export async function listAdminAiVideoSourceCandidates(env, adminUser, searchParams = new URLSearchParams()) {
  if (!env?.DB) {
    throw new AdminAiVideoSourceError("Video sources are unavailable.", { status: 503, code: "video_sources_unavailable" });
  }
  const scope = normalizeScope(searchParams.get("scope"));
  const limit = normalizeLimit(searchParams.get("limit"));
  const offset = normalizeCursorOffset(searchParams.get("cursor"));
  let candidates = [];
  if (scope === "saved_assets") {
    candidates = await listSavedAssetCandidates(env, adminUser.id, limit, offset);
  } else if (scope === "memvids") {
    candidates = await listMemvidCandidates(env, limit, offset);
  } else {
    const [saved, memvids] = await Promise.all([
      listSavedAssetCandidates(env, adminUser.id, limit, offset),
      listMemvidCandidates(env, limit, offset),
    ]);
    candidates = [...saved, ...memvids]
      .sort((a, b) => String(b.published_at || b.created_at || "").localeCompare(String(a.published_at || a.created_at || "")));
  }
  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;
  return {
    candidates: page,
    next_cursor: hasMore ? String(offset + limit) : null,
    has_more: hasMore,
    scope,
    applied_limit: limit,
  };
}

export function normalizeAdminAiVideoSourceReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiVideoSourceError("source_video is required.", { status: 400, code: "invalid_source_video" });
  }
  const sourceType = normalizeSourceType(value.source_type || value.sourceType);
  const assetId = normalizeAssetId(value.asset_id || value.assetId);
  if (!sourceType || !assetId) {
    throw new AdminAiVideoSourceError("source_video is invalid.", { status: 400, code: "invalid_source_video" });
  }
  return { source_type: sourceType, asset_id: assetId };
}

async function getSavedAssetSource(env, adminUserId, assetId) {
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

async function getSourceRow(env, sourceRef, adminUserId) {
  return sourceRef.source_type === "saved_asset"
    ? getSavedAssetSource(env, adminUserId, sourceRef.asset_id)
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

async function createVideoSourceToken(env, sourceRef, {
  userId = null,
  jobId = null,
  expiresAt = Date.now() + ADMIN_AI_VIDEO_SOURCE_TOKEN_TTL_MS,
} = {}) {
  const payload = {
    v: ADMIN_AI_VIDEO_SOURCE_TOKEN_VERSION,
    purpose: ADMIN_AI_VIDEO_SOURCE_TOKEN_PURPOSE,
    model: ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
    operation: "extend",
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

async function parseVideoSourceToken(env, token, { now = Date.now() } = {}) {
  const raw = String(token || "").trim();
  const separator = raw.lastIndexOf(".");
  if (separator <= 0 || separator === raw.length - 1 || raw.length > 2000) {
    throw new AdminAiVideoSourceError("Invalid video source token.", { status: 403, code: "invalid_video_source_token" });
  }
  let payload;
  try {
    payload = JSON.parse(textDecoder.decode(base64ToBytes(fromBase64Url(raw.slice(0, separator)))));
  } catch {
    throw new AdminAiVideoSourceError("Invalid video source token.", { status: 403, code: "invalid_video_source_token" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminAiVideoSourceError("Invalid video source token.", { status: 403, code: "invalid_video_source_token" });
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
    throw new AdminAiVideoSourceError("Invalid video source token.", { status: 403, code: "invalid_video_source_token" });
  }
  if (
    payload.v !== ADMIN_AI_VIDEO_SOURCE_TOKEN_VERSION ||
    payload.purpose !== ADMIN_AI_VIDEO_SOURCE_TOKEN_PURPOSE ||
    payload.model !== ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID ||
    payload.operation !== "extend" ||
    !normalizeSourceType(payload.source_type) ||
    !normalizeAssetId(payload.asset_id)
  ) {
    throw new AdminAiVideoSourceError("Invalid video source token.", { status: 403, code: "invalid_video_source_token" });
  }
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) {
    throw new AdminAiVideoSourceError("Video source token expired.", { status: 410, code: "video_source_token_expired" });
  }
  return {
    source_type: payload.source_type,
    asset_id: payload.asset_id,
    user_id: typeof payload.user_id === "string" && payload.user_id ? payload.user_id : null,
    job_id: typeof payload.job_id === "string" && payload.job_id ? payload.job_id : null,
  };
}

export async function resolveAdminAiGrokPreviewExtendSourceForProvider(env, adminUser, payload, {
  correlationId = null,
  jobId = null,
  origin = null,
} = {}) {
  if (
    payload?.model !== ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID ||
    payload?._operation !== "extend"
  ) {
    return payload;
  }
  const sourceRef = normalizeAdminAiVideoSourceReference(payload.source_video);
  const source = await getSourceRow(env, sourceRef, adminUser?.id || null);
  const token = await createVideoSourceToken(env, sourceRef, {
    userId: sourceRef.source_type === "saved_asset" ? adminUser?.id || null : null,
    jobId,
  });
  const providerUrl = `${getProviderOrigin(env, origin)}/api/internal/ai/video-source/${encodeURIComponent(token)}`;
  const sourceIdHash = await sha256Hex(sourceRef.asset_id);
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-ai-video-source",
    event: "admin_ai_grok_preview_extend_source_resolved",
    level: "info",
    correlationId,
    job_id: jobId || null,
    model: ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
    operation: "extend",
    source_type: sourceRef.source_type,
    source_asset_id_hash: sourceIdHash,
    source_mime_type: source.mime_type || null,
    source_size_bytes: source.size_bytes ?? null,
  });
  const { source_video: _sourceVideo, video: _video, video_url: _videoUrl, videoInput: _videoInput, ...rest } = payload;
  return {
    ...rest,
    video: { url: providerUrl },
  };
}

function errorResponse(error) {
  const status = Number(error?.status || 500);
  return new Response(JSON.stringify({
    ok: false,
    error: status >= 500 ? "Video source is unavailable." : error.message,
    code: error?.code || "video_source_error",
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleAdminAiVideoSourceTokenRequest(ctx, token) {
  const { env, method, correlationId } = ctx;
  if (method !== "GET" && method !== "HEAD") return null;
  try {
    const ref = await parseVideoSourceToken(env, token);
    const source = ref.source_type === "saved_asset"
      ? await getSavedAssetSource(env, ref.user_id, ref.asset_id)
      : await getMemvidSource(env, ref.asset_id);
    const object = await env.USER_IMAGES.get(source.r2_key);
    if (!object) {
      throw new AdminAiVideoSourceError("Video source was not found.", { status: 404, code: "video_source_not_found" });
    }
    const contentType = source.mime_type || object.httpMetadata?.contentType || "video/mp4";
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
      component: "admin-ai-video-source",
      event: "admin_ai_video_source_token_failed",
      level: Number(error?.status || 500) >= 500 ? "error" : "warn",
      correlationId,
      error_code: error?.code || "video_source_error",
      ...getErrorFields(error, { includeMessage: false }),
    });
    return errorResponse(error);
  }
}
