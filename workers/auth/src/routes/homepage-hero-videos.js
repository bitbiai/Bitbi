import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  isRequestBodyError,
  readFormDataLimited,
  readJsonBodyOrResponse,
  requestBodyErrorResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { buildPublicMediaHeaders } from "../lib/public-media.js";
import { requireAdmin } from "../lib/session.js";
import {
  attachVideoPosterBytesToAiTextAsset,
  attachVideoPosterToAiTextAsset,
  copyVideoPosterToAiTextAsset,
  saveGeneratedVideoAsset,
} from "../lib/ai-text-assets.js";
import {
  nowIso,
  randomTokenHex,
  sha256Hex,
} from "../lib/tokens.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  buildPublicMemvidUrl,
  buildPublicMemvidVersion,
} from "../../../../js/shared/public-media-contract.mjs";
import {
  getMemvidStreamPreviewConfig,
  getStreamDownloadUrlFromProviderMetadata,
  hasReadyStreamDownloadMetadata,
  isSafeCloudflareStreamPlaybackUrl,
  normalizeStreamUid,
  parseStreamProviderMetadata,
  summarizeMemvidStreamPreviews,
} from "../lib/cloudflare-stream-previews.js";
import {
  getMemvidStreamPreviewSummary as getSharedMemvidStreamPreviewSummary,
  listQueuedMemvidStreamPreviewJobs as listSharedQueuedMemvidStreamPreviewJobs,
  queueMemvidStreamPreviewRepairJobs,
  queueMissingMemvidStreamPreviewJobs,
  serializeMemvidStreamPreviewJob as serializeSharedMemvidStreamPreviewJob,
} from "../lib/memvid-stream-preview-jobs.js";
import {
  getMemvidStreamPreviewDispatchState,
  getMemvidStreamPreviewProcessorDispatchStatus as getSharedMemvidStreamPreviewProcessorDispatchStatus,
  maybeDispatchMemvidStreamPreviewProcessor,
} from "../lib/memvid-stream-preview-dispatch.js";
import {
  DEFAULT_HERO_FFMPEG_PRESET,
  VIDEO_DELIVERY_FEATURE_KEYS,
  VideoDeliverySettingsError,
  getHeroFfmpegPresetSetting,
  getHomepageHeroProcessorSecret,
  getMemvidStreamPreviewProcessorSecret,
  getVideoDeliveryFeature,
  getVideoDeliveryFeatureStatus,
  normalizeHeroFfmpegPreset,
  setHeroFfmpegPresetSetting,
  setVideoDeliveryFeatureSwitch,
} from "../lib/video-delivery-settings.js";

const HERO_VIDEO_SLOTS = Object.freeze(["right_top", "right_bottom", "left_top", "left_bottom"]);
const HERO_VIDEO_SLOT_SET = new Set(HERO_VIDEO_SLOTS);
const DEFAULT_CANDIDATE_LIMIT = 24;
const MAX_CANDIDATE_LIMIT = 60;
const MIN_OPERATOR_REASON_LENGTH = 8;
const MAX_OPERATOR_REASON_LENGTH = 500;
const HERO_DERIVATIVE_VERSION = "v1";
const HERO_SOURCE_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const HERO_SOURCE_POSTER_MIME_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const HERO_DERIVATIVE_VIDEO_MIME_TYPES = new Set(["video/mp4"]);
const HERO_DERIVATIVE_POSTER_MIME_TYPES = new Set(["image/webp"]);
const MANUAL_UPLOAD_DISPLAY_ASPECT_RATIOS = new Set(["9:16", "1:1", "16:9"]);
const DEFAULT_MANUAL_UPLOAD_DISPLAY_ASPECT_RATIO = "16:9";
const TARGET_PRESET = DEFAULT_HERO_FFMPEG_PRESET;
const SOURCE_POSTER_PROCESSOR_JOB_LIMIT = 8;
const SOURCE_POSTER_PROCESSOR_SCAN_LIMIT = 48;

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isMissingHomepageHeroTableError(error) {
  return String(error?.message || error || "").includes("no such table")
    && String(error?.message || error || "").includes("homepage_hero_video_");
}

function normalizeSlot(value) {
  const slot = String(value || "").trim();
  return HERO_VIDEO_SLOT_SET.has(slot) ? slot : null;
}

function normalizeSourceType(value) {
  const sourceType = String(value || "").trim();
  return sourceType === "public" || sourceType === "admin_asset" ? sourceType : null;
}

function normalizeProvider(env, value) {
  const requested = String(value || env?.HOMEPAGE_HERO_VIDEO_PROVIDER || "external_ffmpeg").trim();
  if (requested === "mock" || requested === "external_ffmpeg" || requested === "cloudflare_stream") return requested;
  return "external_ffmpeg";
}

function normalizeVideoMimeType(value) {
  const mimeType = String(value || "").split(";")[0].trim().toLowerCase();
  return HERO_SOURCE_VIDEO_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function normalizeManualUploadDisplayAspectRatio(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_MANUAL_UPLOAD_DISPLAY_ASPECT_RATIO;
  return MANUAL_UPLOAD_DISPLAY_ASPECT_RATIOS.has(normalized) ? normalized : null;
}

function normalizeDerivativeVideoMimeType(value) {
  const mimeType = String(value || "").split(";")[0].trim().toLowerCase();
  return HERO_DERIVATIVE_VIDEO_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function normalizeDerivativePosterMimeType(value) {
  const mimeType = String(value || "").split(";")[0].trim().toLowerCase();
  return HERO_DERIVATIVE_POSTER_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function normalizeSourcePosterMimeType(value) {
  const mimeType = String(value || "").split(";")[0].trim().toLowerCase();
  return HERO_SOURCE_POSTER_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function sanitizeHeroFileName(value, fallback = "homepage-hero-source.mp4") {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

function sanitizeShortText(value, fallback = "") {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

function normalizeOperatorReason(value) {
  const reason = String(value || "").replace(/\s+/g, " ").trim();
  if (reason.length < MIN_OPERATOR_REASON_LENGTH) return null;
  return reason.slice(0, MAX_OPERATOR_REASON_LENGTH);
}

function normalizeAssetId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(id)) return null;
  return id;
}

function normalizeDerivativeJobId(value) {
  const id = String(value || "").trim();
  if (!/^hhvd_[A-Fa-f0-9]{16,64}$/.test(id)) return null;
  return id;
}

function getProcessorSecret(env) {
  return getHomepageHeroProcessorSecret(env);
}

async function processorAuthResponse(ctx) {
  const expected = getProcessorSecret(ctx.env);
  const feature = await getVideoDeliveryFeature(ctx.env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG);
  if (!feature?.effective_enabled || !expected) {
    return json(
      {
        ok: false,
        error: "Homepage hero external_ffmpeg processor is not configured.",
        code: "processor_not_configured",
      },
      { status: 503 }
    );
  }
  const auth = String(ctx.request.headers.get("Authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const explicit = String(ctx.request.headers.get("X-BITBI-Processor-Secret") || "").trim();
  if (bearer !== expected && explicit !== expected) {
    return json({ ok: false, error: "Forbidden", code: "processor_auth_failed" }, { status: 403 });
  }
  return null;
}

async function memvidStreamProcessorAuthResponse(ctx) {
  const expected = getMemvidStreamPreviewProcessorSecret(ctx.env);
  const feature = await getVideoDeliveryFeature(ctx.env, VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS);
  if (!feature?.effective_enabled || !expected) {
    return json(
      {
        ok: false,
        error: "Memvid Stream preview processor is not configured.",
        code: "stream_preview_processor_not_configured",
      },
      { status: 503 }
    );
  }
  const auth = String(ctx.request.headers.get("Authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const explicit = String(ctx.request.headers.get("X-BITBI-Processor-Secret") || "").trim();
  if (bearer !== expected && explicit !== expected) {
    return json({ ok: false, error: "Forbidden", code: "processor_auth_failed" }, { status: 403 });
  }
  return null;
}

function normalizeCandidateLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CANDIDATE_LIMIT;
  return Math.max(1, Math.min(MAX_CANDIDATE_LIMIT, parsed));
}

function normalizeDerivativeListLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, parsed));
}

function normalizeDerivativeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return null;
  if (!["queued", "processing", "succeeded", "failed"].includes(status)) return null;
  return status;
}

function idempotencyKeyOrResponse(request, message = "Idempotency-Key is required for homepage hero video changes.") {
  const key = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!key) {
    return {
      response: json(
        {
          ok: false,
          error: message,
          code: "idempotency_key_required",
        },
        { status: 428 }
      ),
    };
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    return {
      response: json(
        {
          ok: false,
          error: "Invalid Idempotency-Key header.",
          code: "invalid_idempotency_key",
        },
        { status: 400 }
      ),
    };
  }
  return { key };
}

function serializeDerivative(row) {
  if (!row) return null;
  return {
    id: row.id,
    slot: row.slot,
    source_type: row.source_type,
    source_asset_id: row.source_asset_id,
    source_user_id: row.source_user_id || null,
    source_title: row.source_title || null,
    provider: row.provider,
    status: row.status,
    version: row.version || null,
    file_mime_type: row.file_mime_type || null,
    mime_type: row.file_mime_type || null,
    poster_mime_type: row.poster_mime_type || null,
    width: row.width ?? null,
    height: row.height ?? null,
    duration_seconds: row.duration_seconds ?? null,
    fps: row.fps ?? null,
    size_bytes: row.size_bytes ?? null,
    poster_size_bytes: row.poster_size_bytes ?? null,
    original_size_bytes: row.original_size_bytes ?? null,
    original_mime_type: row.original_mime_type || null,
    source_fingerprint: row.source_fingerprint || null,
    target_preset: parseJson(row.target_preset_json) || TARGET_PRESET,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    processing_started_at: row.processing_started_at || null,
    processing_completed_at: row.processing_completed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
  };
}

function serializeAdminDerivative(row) {
  if (!row) return null;
  return {
    ...serializeDerivative(row),
    assigned_slot: row.assigned_slot || null,
    is_assigned: Boolean(row.assigned_slot),
  };
}

function serializeAdminSlot(row) {
  return {
    slot: row.slot,
    enabled: Number(row.enabled) === 1,
    display_order: Number(row.display_order || 0),
    derivative_id: row.derivative_id || null,
    source_type: row.source_type || row.derivative_source_type || null,
    source_asset_id: row.source_asset_id || row.derivative_source_asset_id || null,
    source_user_id: row.source_user_id || row.derivative_source_user_id || null,
    title: row.title || row.derivative_source_title || null,
    operator_reason: row.operator_reason || null,
    updated_by_user_id: row.updated_by_user_id || null,
    updated_at: row.updated_at || null,
    derivative: row.derivative_id ? serializeDerivative({
      id: row.derivative_id,
      slot: row.derivative_slot || row.slot,
      source_type: row.derivative_source_type,
      source_asset_id: row.derivative_source_asset_id,
      source_user_id: row.derivative_source_user_id,
      source_title: row.derivative_source_title,
      provider: row.derivative_provider,
      status: row.derivative_status,
      version: row.derivative_version,
      file_mime_type: row.derivative_file_mime_type,
      poster_mime_type: row.derivative_poster_mime_type,
      width: row.derivative_width,
      height: row.derivative_height,
      duration_seconds: row.derivative_duration_seconds,
      fps: row.derivative_fps,
      size_bytes: row.derivative_size_bytes,
      poster_size_bytes: row.derivative_poster_size_bytes,
      original_size_bytes: row.derivative_original_size_bytes,
      original_mime_type: row.derivative_original_mime_type,
      source_fingerprint: row.derivative_source_fingerprint,
      target_preset_json: row.derivative_target_preset_json,
      error_code: row.derivative_error_code,
      error_message: row.derivative_error_message,
      processing_started_at: row.derivative_processing_started_at,
      processing_completed_at: row.derivative_processing_completed_at,
      created_at: row.derivative_created_at,
      updated_at: row.derivative_updated_at,
      completed_at: row.derivative_completed_at,
    }) : null,
  };
}

function parseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readHomepageHeroSourceMetadata(metadata) {
  const source = metadata?.homepage_hero_source;
  if (source && typeof source === "object" && !Array.isArray(source)) return source;
  if (typeof source === "string") {
    const parsed = parseJson(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return {};
}

function getHeroSourcePosterState(row) {
  const metadata = parseJson(row?.metadata_json) || {};
  const state = readHomepageHeroSourceMetadata(metadata);
  if (row?.poster_r2_key) {
    return {
      status: "ready",
      retryable: false,
      error_code: null,
      message: null,
    };
  }
  const isManualUpload = state.is_manual_upload
    || row?.upload_id
    || Number(row?.homepage_hero_upload_count || 0) > 0;
  const status = ["pending", "failed"].includes(String(state.poster_status || ""))
    ? String(state.poster_status)
    : (isManualUpload ? "pending" : null);
  return status ? {
    status,
    retryable: state.poster_retryable !== false,
    error_code: state.poster_error_code || null,
    message: state.poster_message || null,
  } : null;
}

function buildPublicHeroVideoUrl(slot, version, kind) {
  return `/api/homepage/hero-videos/${encodeURIComponent(slot)}/${encodeURIComponent(version)}/${kind}`;
}

function buildHomepageHeroVersion(derivativeId) {
  return `${HERO_DERIVATIVE_VERSION}-${Date.now().toString(36)}-${String(derivativeId || "").slice(-10)}`;
}

function toPublicSlot(row) {
  const version = row.version;
  return {
    slot: row.slot,
    version,
    title: row.title || row.source_title || "BITBI hero video",
    source_type: row.source_type,
    file: {
      url: buildPublicHeroVideoUrl(row.slot, version, "file"),
      mime_type: row.file_mime_type || "video/mp4",
      width: row.width ?? null,
      height: row.height ?? null,
      size_bytes: row.size_bytes ?? null,
      duration_seconds: row.duration_seconds ?? null,
      fps: row.fps ?? null,
    },
    poster: {
      url: buildPublicHeroVideoUrl(row.slot, version, "poster"),
      mime_type: row.poster_mime_type || "image/webp",
      width: row.width ?? null,
      height: row.height ?? null,
      size_bytes: row.poster_size_bytes ?? null,
    },
  };
}

function toPublicCandidate(row) {
  const version = buildPublicMemvidVersion(row);
  return {
    source_type: "public",
    source_asset_id: row.id,
    source_user_id: row.user_id,
    title: row.title || row.file_name || "Published Memvid",
    mime_type: row.mime_type || "video/mp4",
    size_bytes: row.size_bytes ?? null,
    created_at: row.created_at,
    published_at: row.published_at || null,
    duration_seconds: parseJson(row.metadata_json)?.duration_seconds ?? null,
    file_url: buildPublicMemvidUrl(row.id, version, "file"),
    poster_url: row.poster_r2_key ? buildPublicMemvidUrl(row.id, version, "poster") : null,
    poster_width: row.poster_width ?? null,
    poster_height: row.poster_height ?? null,
  };
}

function toAdminAssetCandidate(row, adminUserId) {
  const posterState = getHeroSourcePosterState(row);
  return {
    source_type: "admin_asset",
    source_asset_id: row.id,
    source_user_id: row.user_id,
    title: row.title || row.file_name || "Admin video asset",
    mime_type: row.mime_type || "video/mp4",
    size_bytes: row.size_bytes ?? null,
    created_at: row.created_at,
    published_at: row.published_at || null,
    duration_seconds: parseJson(row.metadata_json)?.duration_seconds ?? null,
    file_url: `/api/admin/users/${encodeURIComponent(adminUserId)}/assets/${encodeURIComponent(row.id)}/file`,
    poster_url: row.poster_r2_key ? `/api/ai/text-assets/${encodeURIComponent(row.id)}/poster` : null,
    poster_width: row.poster_width ?? null,
    poster_height: row.poster_height ?? null,
    poster_size_bytes: row.poster_size_bytes ?? null,
    ...(posterState ? {
      poster_status: posterState.status,
      poster_retryable: posterState.retryable,
      poster_error_code: posterState.error_code,
      poster_message: posterState.message,
    } : {}),
  };
}

function clampInteger(value, { fallback = null, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, { fallback = null, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeErrorCode(value) {
  const code = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 80);
  return code || "processor_failed";
}

function sanitizeErrorMessage(value) {
  return String(value || "Hero video processor failed.")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Hero video processor failed.";
}

function serializeProcessorJob(row) {
  return {
    id: row.id,
    slot: row.slot,
    source_type: row.source_type,
    source_asset_id: row.source_asset_id,
    source_title: row.source_title || null,
    status: row.status,
    source: {
      url: `/api/internal/homepage/hero-videos/jobs/${encodeURIComponent(row.id)}/source`,
      mime_type: row.original_mime_type || "video/mp4",
      size_bytes: row.original_size_bytes ?? null,
      fingerprint: row.source_fingerprint || null,
    },
    preset: parseJson(row.target_preset_json) || TARGET_PRESET,
    completion: {
      url: `/api/internal/homepage/hero-videos/jobs/${encodeURIComponent(row.id)}/complete`,
      failure_url: `/api/internal/homepage/hero-videos/jobs/${encodeURIComponent(row.id)}/fail`,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeSourcePosterProcessorJob(row, preset = TARGET_PRESET) {
  const posterWidth = clampInteger(preset?.posterWidth, { fallback: TARGET_PRESET.posterWidth || 640, min: 320, max: 1080 });
  return {
    id: row.id,
    upload_id: row.upload_id || null,
    type: "homepage_hero_source_poster",
    source_asset_id: row.id,
    source_user_id: row.user_id,
    source_title: row.title || row.file_name || null,
    source: {
      url: `/api/internal/homepage/hero-videos/source-posters/jobs/${encodeURIComponent(row.id)}/source`,
      mime_type: row.mime_type || "video/mp4",
      size_bytes: row.size_bytes ?? null,
      fingerprint: row.source_fingerprint || null,
    },
    preset: {
      posterFormat: "webp",
      posterWidth,
    },
    completion: {
      url: `/api/internal/homepage/hero-videos/source-posters/jobs/${encodeURIComponent(row.id)}/complete`,
      failure_url: `/api/internal/homepage/hero-videos/source-posters/jobs/${encodeURIComponent(row.id)}/fail`,
    },
    created_at: row.upload_created_at || row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

async function listAdminSlots(env) {
  const rows = await env.DB.prepare(
    `SELECT slots.slot,
            slots.display_order,
            slots.enabled,
            slots.derivative_id,
            slots.source_type,
            slots.source_asset_id,
            slots.source_user_id,
            slots.title,
            slots.operator_reason,
            slots.updated_by_user_id,
            slots.updated_at,
            derivatives.slot AS derivative_slot,
            derivatives.source_type AS derivative_source_type,
            derivatives.source_asset_id AS derivative_source_asset_id,
            derivatives.source_user_id AS derivative_source_user_id,
            derivatives.source_title AS derivative_source_title,
            derivatives.provider AS derivative_provider,
            derivatives.status AS derivative_status,
            derivatives.version AS derivative_version,
            derivatives.file_mime_type AS derivative_file_mime_type,
            derivatives.poster_mime_type AS derivative_poster_mime_type,
            derivatives.width AS derivative_width,
            derivatives.height AS derivative_height,
            derivatives.duration_seconds AS derivative_duration_seconds,
            derivatives.fps AS derivative_fps,
            derivatives.size_bytes AS derivative_size_bytes,
            derivatives.poster_size_bytes AS derivative_poster_size_bytes,
            derivatives.original_size_bytes AS derivative_original_size_bytes,
            derivatives.original_mime_type AS derivative_original_mime_type,
            derivatives.source_fingerprint AS derivative_source_fingerprint,
            derivatives.target_preset_json AS derivative_target_preset_json,
            derivatives.error_code AS derivative_error_code,
            derivatives.error_message AS derivative_error_message,
            derivatives.processing_started_at AS derivative_processing_started_at,
            derivatives.processing_completed_at AS derivative_processing_completed_at,
            derivatives.created_at AS derivative_created_at,
            derivatives.updated_at AS derivative_updated_at,
            derivatives.completed_at AS derivative_completed_at
     FROM homepage_hero_video_slots slots
     LEFT JOIN homepage_hero_video_derivatives derivatives ON derivatives.id = slots.derivative_id
     ORDER BY slots.display_order ASC`
  ).all();

  const bySlot = new Map((rows.results || []).map((row) => [row.slot, serializeAdminSlot(row)]));
  return HERO_VIDEO_SLOTS.map((slot, index) => bySlot.get(slot) || {
    slot,
    enabled: false,
    display_order: (index + 1) * 10,
    derivative_id: null,
    source_type: null,
    source_asset_id: null,
    source_user_id: null,
    title: null,
    operator_reason: null,
    updated_by_user_id: null,
    updated_at: null,
    derivative: null,
  });
}

async function getDerivativeById(env, derivativeId) {
  return env.DB.prepare(
    `SELECT id, slot, source_type, source_asset_id, source_user_id, source_title,
            provider, status, version, file_mime_type, poster_mime_type, width,
            height, duration_seconds, fps, size_bytes, poster_size_bytes,
            original_size_bytes, original_mime_type, source_r2_key, source_fingerprint,
            target_preset_json, provider_payload_json, error_code, error_message,
            processing_started_at, processing_completed_at, created_at, updated_at, completed_at
     FROM homepage_hero_video_derivatives
     WHERE id = ?`
  ).bind(derivativeId).first();
}

async function listAdminDerivatives(env, {
  slot = null,
  sourceType = null,
  sourceAssetId = null,
  status = null,
  includeUnassigned = true,
  limit = 20,
} = {}) {
  const where = [];
  const bindings = [];
  if (slot) {
    where.push("d.slot = ?");
    bindings.push(slot);
  }
  if (sourceType) {
    where.push("d.source_type = ?");
    bindings.push(sourceType);
  }
  if (sourceAssetId) {
    where.push("d.source_asset_id = ?");
    bindings.push(sourceAssetId);
  }
  if (status) {
    where.push("d.status = ?");
    bindings.push(status);
  }
  if (!includeUnassigned) {
    where.push("slots.slot IS NOT NULL");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT d.id,
            d.slot,
            d.source_type,
            d.source_asset_id,
            d.source_user_id,
            d.source_title,
            d.provider,
            d.status,
            d.version,
            d.file_mime_type,
            d.poster_mime_type,
            d.width,
            d.height,
            d.duration_seconds,
            d.fps,
            d.size_bytes,
            d.poster_size_bytes,
            d.original_size_bytes,
            d.original_mime_type,
            d.source_fingerprint,
            d.target_preset_json,
            d.error_code,
            d.error_message,
            d.processing_started_at,
            d.processing_completed_at,
            d.created_at,
            d.updated_at,
            d.completed_at,
            slots.slot AS assigned_slot
     FROM homepage_hero_video_derivatives d
     LEFT JOIN homepage_hero_video_slots slots ON slots.derivative_id = d.id
     ${whereSql}
     ORDER BY COALESCE(d.completed_at, d.processing_completed_at, d.updated_at, d.created_at) DESC,
              d.created_at DESC,
              d.id DESC
     LIMIT ?`
  ).bind(...bindings, limit).all();
  return (rows.results || []).map(serializeAdminDerivative);
}

async function getAdminDerivativeDetail(env, derivativeId) {
  const row = await env.DB.prepare(
    `SELECT d.id,
            d.slot,
            d.source_type,
            d.source_asset_id,
            d.source_user_id,
            d.source_title,
            d.provider,
            d.status,
            d.version,
            d.file_mime_type,
            d.poster_mime_type,
            d.width,
            d.height,
            d.duration_seconds,
            d.fps,
            d.size_bytes,
            d.poster_size_bytes,
            d.original_size_bytes,
            d.original_mime_type,
            d.source_fingerprint,
            d.target_preset_json,
            d.error_code,
            d.error_message,
            d.processing_started_at,
            d.processing_completed_at,
            d.created_at,
            d.updated_at,
            d.completed_at,
            slots.slot AS assigned_slot
     FROM homepage_hero_video_derivatives d
     LEFT JOIN homepage_hero_video_slots slots ON slots.derivative_id = d.id
     WHERE d.id = ?
     LIMIT 1`
  ).bind(derivativeId).first();
  return serializeAdminDerivative(row);
}

async function getDerivativeByIdempotency(env, idempotencyKeyHash) {
  return env.DB.prepare(
    `SELECT id, slot, source_type, source_asset_id, source_user_id, source_title,
            provider, status, version, file_mime_type, poster_mime_type, width,
            height, duration_seconds, fps, size_bytes, poster_size_bytes,
            original_size_bytes, original_mime_type, source_r2_key, source_fingerprint,
            target_preset_json, provider_payload_json, error_code, error_message,
            processing_started_at, processing_completed_at, request_hash,
            created_at, updated_at, completed_at
     FROM homepage_hero_video_derivatives
     WHERE idempotency_key_hash = ?
     LIMIT 1`
  ).bind(idempotencyKeyHash).first();
}

async function getProcessorDerivativeById(env, derivativeId) {
  return env.DB.prepare(
    `SELECT id, slot, source_type, source_asset_id, source_user_id, source_title,
            provider, status, version, file_r2_key, poster_r2_key,
            file_mime_type, poster_mime_type, width, height, duration_seconds,
            fps, size_bytes, poster_size_bytes, original_size_bytes,
            original_mime_type, source_r2_key, source_fingerprint,
            target_preset_json, provider_payload_json, error_code, error_message,
            processing_started_at, processing_completed_at, created_at, updated_at, completed_at
     FROM homepage_hero_video_derivatives
     WHERE id = ?
       AND provider = 'external_ffmpeg'
     LIMIT 1`
  ).bind(derivativeId).first();
}

async function listQueuedProcessorJobs(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT id, slot, source_type, source_asset_id, source_user_id, source_title,
            provider, status, original_size_bytes, original_mime_type,
            source_r2_key, source_fingerprint, target_preset_json,
            provider_payload_json, created_at, updated_at
     FROM homepage_hero_video_derivatives
     WHERE provider = 'external_ffmpeg'
       AND status = 'queued'
       AND source_r2_key IS NOT NULL
     ORDER BY created_at ASC, id ASC
     LIMIT ?`
  ).bind(limit).all();
  return rows.results || [];
}

function isSourcePosterProcessorClaimable(row) {
  if (!row || row.poster_r2_key) return false;
  const metadata = parseJson(row.metadata_json) || {};
  const sourceState = readHomepageHeroSourceMetadata(metadata);
  const status = String(sourceState.poster_status || "").toLowerCase();
  if (status === "ready") return false;
  if (status === "failed" && sourceState.poster_retryable === false) return false;
  return status !== "failed";
}

async function listQueuedSourcePosterJobs(env, limit) {
  const scanLimit = Math.max(SOURCE_POSTER_PROCESSOR_SCAN_LIMIT, limit * 6);
  const rows = await env.DB.prepare(
    `SELECT uploads.id AS upload_id,
            uploads.created_at AS upload_created_at,
            assets.id,
            assets.user_id,
            assets.title,
            assets.file_name,
            assets.mime_type,
            assets.size_bytes,
            assets.metadata_json,
            assets.created_at,
            assets.r2_key,
            assets.poster_r2_key
     FROM homepage_hero_video_uploads uploads
     JOIN ai_text_assets assets ON assets.id = uploads.asset_id
      AND assets.user_id = uploads.user_id
     WHERE assets.source_module = 'video'
       AND assets.poster_r2_key IS NULL
       AND assets.r2_key IS NOT NULL
     ORDER BY uploads.created_at ASC, uploads.id ASC
     LIMIT ?`
  ).bind(scanLimit).all();
  const jobs = [];
  for (const row of rows.results || []) {
    if (!isSourcePosterProcessorClaimable(row)) continue;
    row.source_fingerprint = await sha256Hex(stableJson({
      asset_id: row.id,
      user_id: row.user_id,
      size_bytes: row.size_bytes ?? null,
      created_at: row.created_at || null,
    }));
    jobs.push(row);
    if (jobs.length >= limit) break;
  }
  return jobs;
}

async function getSourcePosterJobAsset(env, assetId) {
  return env.DB.prepare(
    `SELECT uploads.id AS upload_id,
            uploads.created_at AS upload_created_at,
            assets.id,
            assets.user_id,
            assets.title,
            assets.file_name,
            assets.mime_type,
            assets.size_bytes,
            assets.metadata_json,
            assets.created_at,
            assets.r2_key,
            assets.poster_r2_key
     FROM homepage_hero_video_uploads uploads
     JOIN ai_text_assets assets ON assets.id = uploads.asset_id
      AND assets.user_id = uploads.user_id
     WHERE uploads.asset_id = ?
       AND assets.source_module = 'video'
     LIMIT 1`
  ).bind(assetId).first();
}

async function getSlotIdempotencyState(env, slot) {
  return env.DB.prepare(
    `SELECT slot, last_idempotency_key_hash, last_request_hash
     FROM homepage_hero_video_slots
     WHERE slot = ?`
  ).bind(slot).first();
}

async function listPublicHeroRows(env) {
  const rows = await env.DB.prepare(
    `SELECT slots.slot,
            slots.title,
            slots.updated_at,
            derivatives.source_type,
            derivatives.source_title,
            derivatives.version,
            derivatives.file_r2_key,
            derivatives.poster_r2_key,
            derivatives.file_mime_type,
            derivatives.poster_mime_type,
            derivatives.width,
            derivatives.height,
            derivatives.duration_seconds,
            derivatives.fps,
            derivatives.size_bytes,
            derivatives.poster_size_bytes
     FROM homepage_hero_video_slots slots
     JOIN homepage_hero_video_derivatives derivatives ON derivatives.id = slots.derivative_id
     WHERE slots.enabled = 1
       AND derivatives.status = 'succeeded'
       AND derivatives.version IS NOT NULL
       AND derivatives.file_r2_key IS NOT NULL
       AND derivatives.poster_r2_key IS NOT NULL
     ORDER BY slots.display_order ASC`
  ).all();
  return rows.results || [];
}

async function getPublicHeroMediaRow(env, slot, version) {
  return env.DB.prepare(
    `SELECT derivatives.file_r2_key,
            derivatives.poster_r2_key,
            derivatives.file_mime_type,
            derivatives.poster_mime_type,
            derivatives.size_bytes,
            derivatives.poster_size_bytes
     FROM homepage_hero_video_slots slots
     JOIN homepage_hero_video_derivatives derivatives ON derivatives.id = slots.derivative_id
     WHERE slots.slot = ?
       AND slots.enabled = 1
       AND derivatives.status = 'succeeded'
       AND derivatives.version = ?
     LIMIT 1`
  ).bind(slot, version).first();
}

async function findSourceAsset(env, sourceType, assetId, adminUserId = null) {
  if (sourceType === "public") {
    return env.DB.prepare(
      `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json, r2_key,
              created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes
       FROM ai_text_assets
       WHERE id = ?
         AND source_module = 'video'
         AND visibility = 'public'
       LIMIT 1`
    ).bind(assetId).first();
  }

  return env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json, r2_key,
            created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes
     FROM ai_text_assets
     WHERE id = ?
       AND user_id = ?
       AND source_module = 'video'
     LIMIT 1`
  ).bind(assetId, adminUserId).first();
}

async function listPublicCandidates(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json,
            created_at, published_at, r2_key, poster_r2_key, poster_width, poster_height, poster_size_bytes
     FROM ai_text_assets
     WHERE visibility = 'public'
       AND source_module = 'video'
     ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC, id DESC
     LIMIT ?`
  ).bind(limit).all();
  return (rows.results || []).map(toPublicCandidate);
}

async function listAdminAssetCandidates(env, adminUserId, limit) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json,
            created_at, published_at, poster_r2_key, poster_width, poster_height, poster_size_bytes,
            (SELECT COUNT(*) FROM homepage_hero_video_uploads uploads
             WHERE uploads.asset_id = ai_text_assets.id
               AND uploads.user_id = ai_text_assets.user_id) AS homepage_hero_upload_count
     FROM ai_text_assets
     WHERE user_id = ?
       AND source_module = 'video'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(adminUserId, limit).all();
  return (rows.results || []).map((row) => toAdminAssetCandidate(row, adminUserId));
}

async function getHeroUploadByIdempotency(env, idempotencyKeyHash, adminUserId) {
  return env.DB.prepare(
    `SELECT uploads.id AS upload_id,
            uploads.request_hash,
            assets.id,
            assets.user_id,
            assets.title,
            assets.file_name,
            assets.mime_type,
            assets.size_bytes,
            assets.metadata_json,
            assets.created_at,
            assets.published_at,
            assets.poster_r2_key,
            assets.poster_width,
            assets.poster_height,
            assets.poster_size_bytes
     FROM homepage_hero_video_uploads uploads
     JOIN ai_text_assets assets ON assets.id = uploads.asset_id
     WHERE uploads.idempotency_key_hash = ?
       AND uploads.user_id = ?
     LIMIT 1`
  ).bind(idempotencyKeyHash, adminUserId).first();
}

async function insertHeroUploadRecord(env, {
  uploadId,
  asset,
  adminUserId,
  originalFileName,
  idempotencyKeyHash,
  requestHash,
  operatorReason,
}) {
  await env.DB.prepare(
    `INSERT INTO homepage_hero_video_uploads (
       id, asset_id, user_id, title, original_file_name, mime_type, size_bytes,
       r2_key, idempotency_key_hash, request_hash, operator_reason,
       created_by_user_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uploadId,
    asset.id,
    adminUserId,
    asset.title || null,
    originalFileName,
    asset.mime_type || "video/mp4",
    Number(asset.size_bytes || 0) || 0,
    asset.r2_key || null,
    idempotencyKeyHash,
    requestHash,
    operatorReason,
    adminUserId,
    asset.created_at || nowIso()
  ).run();
}

async function updateHeroSourcePosterState(env, {
  assetId,
  userId,
  status,
  retryable = true,
  errorCode = null,
  message = null,
  extra = {},
} = {}) {
  if (!assetId || !userId) return null;
  const existing = await env.DB.prepare(
    "SELECT metadata_json, poster_r2_key FROM ai_text_assets WHERE id = ? AND user_id = ? AND source_module = 'video'"
  ).bind(assetId, userId).first();
  if (!existing) return null;

  const metadata = parseJson(existing.metadata_json) || {};
  const nextSource = {
    ...readHomepageHeroSourceMetadata(metadata),
    is_manual_upload: true,
    poster_status: existing.poster_r2_key ? "ready" : status,
    poster_retryable: existing.poster_r2_key ? false : retryable !== false,
    poster_error_code: existing.poster_r2_key ? null : errorCode,
    poster_message: existing.poster_r2_key ? null : message,
    poster_checked_at: nowIso(),
    ...(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}),
  };
  const nextMetadata = {
    ...metadata,
    homepage_hero_source: nextSource,
  };
  await env.DB.prepare(
    "UPDATE ai_text_assets SET metadata_json = ? WHERE id = ? AND user_id = ?"
  ).bind(JSON.stringify(nextMetadata), assetId, userId).run();
  return nextSource;
}

async function getMemvidStreamPreviewSummary(env) {
  try {
    const [previewRows, eventRows] = await Promise.all([
      env.DB.prepare(
        `SELECT status,
                stream_uid,
                preview_duration_seconds,
                max_loop_count,
                provider_metadata_json
         FROM memvid_stream_previews`
      ).all(),
      env.DB.prepare(
        `SELECT event_count,
                estimated_delivered_seconds
         FROM memvid_stream_preview_events
         WHERE event_type = 'hover_start'`
      ).all(),
    ]);
    return summarizeMemvidStreamPreviews(previewRows.results || [], eventRows.results || [], env);
  } catch (error) {
    if (String(error?.message || error).includes("no such table")
      && String(error?.message || error).includes("memvid_stream_preview")) {
      return summarizeMemvidStreamPreviews([], [], env);
    }
    throw error;
  }
}

async function listMemvidsNeedingStreamPreview(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT assets.id,
            assets.user_id,
            assets.r2_key,
            assets.mime_type,
            assets.size_bytes,
            assets.title,
            assets.created_at,
            assets.published_at
     FROM ai_text_assets assets
     LEFT JOIN memvid_stream_previews ready
       ON ready.asset_id = assets.id
      AND ready.status IN ('queued', 'uploading', 'processing', 'ready')
     WHERE assets.visibility = 'public'
       AND assets.source_module = 'video'
       AND assets.r2_key IS NOT NULL
       AND ready.id IS NULL
     ORDER BY COALESCE(assets.published_at, assets.created_at) DESC, assets.created_at DESC, assets.id DESC
     LIMIT ?`
  ).bind(limit).all();
  return rows.results || [];
}

async function buildMemvidPreviewFingerprint(env, asset) {
  const config = getMemvidStreamPreviewConfig(env);
  return sha256Hex(stableJson({
    assetId: asset.id,
    userId: asset.user_id,
    sourceR2Key: asset.r2_key,
    sourceSizeBytes: Number(asset.size_bytes || 0) || 0,
    sourceMimeType: asset.mime_type || null,
    preset: {
      provider: "cloudflare_stream",
      maxDurationSeconds: config.previewDurationSeconds,
      maxLoopCount: config.maxLoopCount,
      shortPreviewOnly: true,
    },
  }));
}

async function createMemvidStreamPreviewJobs(env, {
  limit,
  operatorReason,
} = {}) {
  const config = getMemvidStreamPreviewConfig(env);
  const rows = await listMemvidsNeedingStreamPreview(env, limit);
  const now = nowIso();
  const created = [];
  for (const asset of rows) {
    const id = `msp_${randomTokenHex(16)}`;
    const fingerprint = await buildMemvidPreviewFingerprint(env, asset);
    await env.DB.prepare(
      `INSERT INTO memvid_stream_previews (
         id, asset_id, user_id, source_r2_key, source_fingerprint, stream_uid,
         status, preview_duration_seconds, max_loop_count, created_at, updated_at,
         completed_at, error_code, error_message, provider_metadata_json
       ) VALUES (?, ?, ?, ?, ?, NULL, 'queued', ?, ?, ?, ?, NULL, NULL, NULL, ?)`
    ).bind(
      id,
      asset.id,
      asset.user_id,
      asset.r2_key,
      fingerprint,
      config.previewDurationSeconds,
      config.maxLoopCount,
      now,
      now,
      JSON.stringify({
        provider: "cloudflare_stream",
        source_title: asset.title || null,
        operator_reason_present: Boolean(operatorReason),
      })
    ).run();
    created.push({ id, asset_id: asset.id, status: "queued" });
  }
  return created;
}

async function listRepairableMemvidStreamPreviewDownloads(env, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT id,
            stream_uid,
            provider_metadata_json
     FROM memvid_stream_previews
     WHERE status = 'ready'
       AND stream_uid IS NOT NULL
     ORDER BY completed_at DESC, updated_at DESC
     LIMIT ?`
  ).bind(Math.max(1, Math.min(200, Number(limit || 50) || 50))).all();
  return (rows.results || [])
    .filter((row) => !hasReadyStreamDownloadMetadata(row.provider_metadata_json));
}

async function markMemvidStreamPreviewDownloadRepairsRequested(env, rows = []) {
  const now = nowIso();
  for (const row of rows) {
    const metadata = parseStreamProviderMetadata(row.provider_metadata_json);
    const providerMetadata = metadata.provider_metadata && typeof metadata.provider_metadata === "object"
      ? metadata.provider_metadata
      : {};
    await env.DB.prepare(
      `UPDATE memvid_stream_previews
       SET provider_metadata_json = ?,
           updated_at = ?
       WHERE id = ?
         AND status = 'ready'`
    ).bind(
      JSON.stringify({
        ...metadata,
        provider: "cloudflare_stream",
        provider_metadata: {
          ...providerMetadata,
          download_repair_status: "queued",
          download_repair_requested_at: now,
        },
      }),
      now,
      row.id
    ).run();
  }
}

function getMemvidStreamPreviewProcessorDispatchStatus(env) {
  const explicitProvider = String(env?.MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER || "").trim().toLowerCase();
  const token = String(env?.GITHUB_ACTIONS_DISPATCH_TOKEN || "").trim();
  const legacyRepository = String(env?.GITHUB_REPOSITORY || "").trim();
  const [legacyOwner, legacyRepo] = legacyRepository.split("/");
  const owner = String(env?.GITHUB_ACTIONS_DISPATCH_OWNER || legacyOwner || "").trim();
  const repo = String(env?.GITHUB_ACTIONS_DISPATCH_REPO || legacyRepo || "").trim();
  const workflowFile = String(
    env?.GITHUB_ACTIONS_DISPATCH_WORKFLOW
      || env?.GITHUB_MEMVID_STREAM_WORKFLOW_FILE
      || "memvid-stream-preview-processor.yml"
  ).trim();
  const ref = String(
    env?.GITHUB_ACTIONS_DISPATCH_REF
      || env?.GITHUB_MEMVID_STREAM_WORKFLOW_REF
      || env?.GITHUB_REF_NAME
      || "main"
  ).trim();
  const provider = explicitProvider || (token || owner || repo ? "github_actions" : "");
  const missing = [];
  if (provider && provider !== "github_actions") missing.push("MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER");
  if (!provider) missing.push("MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER");
  if (!token) missing.push("GITHUB_ACTIONS_DISPATCH_TOKEN");
  if (!owner) missing.push("GITHUB_ACTIONS_DISPATCH_OWNER");
  if (!repo) missing.push("GITHUB_ACTIONS_DISPATCH_REPO");
  if (!workflowFile) missing.push("GITHUB_ACTIONS_DISPATCH_WORKFLOW");
  if (!ref) missing.push("GITHUB_ACTIONS_DISPATCH_REF");
  return {
    provider: provider || null,
    configured: provider === "github_actions" && missing.length === 0,
    missing,
    repository_configured: Boolean(owner && repo),
    owner_configured: Boolean(owner),
    repo_configured: Boolean(repo),
    workflow_file: workflowFile || null,
    ref: ref || null,
  };
}

async function dispatchMemvidStreamPreviewProcessorWorkflow(env, {
  jobLimit = 5,
  repairDownloads = true,
  dispatchReason = "Admin requested Memvid Stream preview processing.",
} = {}) {
  const status = getMemvidStreamPreviewProcessorDispatchStatus(env);
  if (!status.configured) {
    return {
      configured: false,
      attempted: false,
      succeeded: false,
      started: false,
      provider: status.provider,
      missing: status.missing,
      message: "Automatic processor dispatch is not configured. Configure GitHub Actions dispatch or run the processor manually.",
      warning: "Automatic processor dispatch is not configured. Configure GitHub Actions dispatch or run the processor manually.",
    };
  }
  const owner = String(env?.GITHUB_ACTIONS_DISPATCH_OWNER || String(env?.GITHUB_REPOSITORY || "").split("/")[0] || "").trim();
  const repo = String(env?.GITHUB_ACTIONS_DISPATCH_REPO || String(env?.GITHUB_REPOSITORY || "").split("/")[1] || "").trim();
  if (!owner || !repo) {
    return {
      configured: false,
      attempted: false,
      succeeded: false,
      started: false,
      provider: "github_actions",
      missing: ["GITHUB_ACTIONS_DISPATCH_OWNER", "GITHUB_ACTIONS_DISPATCH_REPO"],
      message: "GitHub Actions dispatch repository is invalid.",
      warning: "Processor dispatch repository is invalid.",
    };
  }
  const workflowFile = encodeURIComponent(status.workflow_file);
  let res;
  const clampedJobLimit = String(Math.max(1, Math.min(8, Number(jobLimit || 5) || 5)));
  try {
    res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowFile}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${String(env.GITHUB_ACTIONS_DISPATCH_TOKEN || "").trim()}`,
        "Content-Type": "application/json",
        "User-Agent": "bitbi-auth-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: status.ref,
        inputs: {
          job_limit: clampedJobLimit,
          max_runs: "1",
          repair_downloads: repairDownloads ? "true" : "false",
          dry_run: "false",
          dispatch_reason: String(dispatchReason || "Admin requested Memvid Stream preview processing.").slice(0, 180),
        },
      }),
    });
  } catch {
    return {
      configured: true,
      attempted: true,
      succeeded: false,
      started: false,
      provider: "github_actions",
      message: "Processor dispatch request failed before GitHub accepted it.",
      warning: "Processor dispatch request failed before GitHub accepted it.",
    };
  }
  if (!res.ok) {
    const statusMessages = {
      401: "GitHub Actions dispatch was rejected. Check the dispatch token permissions.",
      403: "GitHub Actions dispatch was forbidden. Check the dispatch token permissions.",
      404: "GitHub Actions workflow or repository was not found.",
      422: "GitHub Actions dispatch rejected the configured ref or workflow inputs.",
    };
    const message = statusMessages[res.status] || `GitHub Actions dispatch failed with HTTP ${res.status}.`;
    return {
      configured: true,
      attempted: true,
      succeeded: false,
      started: false,
      provider: "github_actions",
      status: res.status,
      message,
      warning: message,
    };
  }
  return {
    configured: true,
    attempted: true,
    succeeded: true,
    started: true,
    provider: "github_actions",
    message: "Processor dispatch started.",
    workflow_file: status.workflow_file,
    ref: status.ref,
  };
}

async function enforceAdminHeroActionRateLimit(ctx) {
  const { request, env, pathname, method, correlationId } = ctx;
  const result = await evaluateSharedRateLimit(
    env,
    "admin-action-ip",
    getClientIp(request),
    30,
    900_000,
    sensitiveRateLimitOptions({
      component: "admin-homepage-hero-videos",
      correlationId,
      requestInfo: { request, pathname, method },
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function auditHomepageHeroVideoEvent(ctx, adminUser, action, meta = {}) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId: null,
      meta: {
        ...meta,
        actor_email: adminUser.email,
        rawIdempotencyKeyIncluded: false,
      },
      createdAt: nowIso(),
    },
    {
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

async function buildSourceFingerprint({ sourceType, source, preset = TARGET_PRESET }) {
  return sha256Hex(stableJson({
    sourceType,
    assetId: source?.id || null,
    r2Key: source?.r2_key || null,
    mimeType: source?.mime_type || null,
    sizeBytes: Number(source?.size_bytes || 0) || 0,
    preset,
  }));
}

async function insertDerivativeJob(env, {
  derivativeId,
  slot,
  sourceType,
  source,
  provider,
  idempotencyKeyHash,
  requestHash,
  adminUserId,
  operatorReason,
  status,
  providerPayload,
  targetPreset = TARGET_PRESET,
}) {
  const now = nowIso();
  const sourceFingerprint = await buildSourceFingerprint({ sourceType, source, preset: targetPreset });
  await env.DB.prepare(
    `INSERT INTO homepage_hero_video_derivatives (
       id, slot, source_type, source_asset_id, source_user_id, source_title,
       provider, status, source_r2_key, source_fingerprint,
       original_size_bytes, original_mime_type,
       target_preset_json, provider_payload_json, idempotency_key_hash,
       request_hash, created_by_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    derivativeId,
    slot,
    sourceType,
    source.id,
    source.user_id || null,
    source.title || source.file_name || null,
    provider,
    status,
    source.r2_key || null,
    sourceFingerprint,
    Number(source.size_bytes || 0) || null,
    source.mime_type || "video/mp4",
    JSON.stringify(targetPreset),
    JSON.stringify(providerPayload || {}),
    idempotencyKeyHash,
    requestHash,
    adminUserId,
    now,
    now
  ).run();
}

async function markMockDerivativeSucceeded(env, derivativeId, slot, targetPreset = TARGET_PRESET) {
  const version = buildHomepageHeroVersion(derivativeId);
  const fileKey = `homepage/hero-videos/${slot}/${version}/hero.mp4`;
  const posterKey = `homepage/hero-videos/${slot}/${version}/poster.webp`;
  const videoBody = new TextEncoder().encode(`bitbi mock optimized hero video ${derivativeId}`);
  const posterBody = new TextEncoder().encode(`bitbi mock hero poster ${derivativeId}`);

  await env.USER_IMAGES.put(fileKey, videoBody, {
    httpMetadata: { contentType: "video/mp4" },
  });
  await env.USER_IMAGES.put(posterKey, posterBody, {
    httpMetadata: { contentType: "image/webp" },
  });

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE homepage_hero_video_derivatives
     SET status = 'succeeded',
         version = ?,
         file_r2_key = ?,
         poster_r2_key = ?,
         file_mime_type = 'video/mp4',
         poster_mime_type = 'image/webp',
         width = 720,
         height = 405,
         duration_seconds = 6,
         fps = 24,
         size_bytes = ?,
         poster_size_bytes = ?,
         provider_payload_json = ?,
         error_message = NULL,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?`
  ).bind(
    version,
    fileKey,
    posterKey,
    videoBody.byteLength,
    posterBody.byteLength,
    JSON.stringify({
      provider: "mock",
      optimized: true,
      audio_removed: true,
      original_bytes_copied: false,
      preset: targetPreset,
    }),
    now,
    now,
    derivativeId
  ).run();
}

function conversionProviderPayload(provider, targetPreset = TARGET_PRESET) {
  if (provider === "mock") {
    return { provider, mode: "test-only", optimized: true, audio_removed: true, preset: targetPreset };
  }
  if (provider === "cloudflare_stream") {
    return { provider, mode: "adapter-placeholder", requiresOperatorProvisioning: true };
  }
  return {
    provider: "external_ffmpeg",
    mode: "external_processor",
    preset: targetPreset,
    expectedOutput: "mp4/h264/no-audio",
    jobClaimEndpoint: "/api/internal/homepage/hero-videos/jobs/claim",
    sourceEndpointTemplate: "/api/internal/homepage/hero-videos/jobs/{id}/source",
    completionEndpointTemplate: "/api/internal/homepage/hero-videos/jobs/{id}/complete",
    failureEndpointTemplate: "/api/internal/homepage/hero-videos/jobs/{id}/fail",
  };
}

async function handleAdminCurrent(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  try {
    const [slots, streamPreviewSummary, featureStatus, presetStatus, dispatchState] = await Promise.all([
      listAdminSlots(env),
      getSharedMemvidStreamPreviewSummary(env),
      getVideoDeliveryFeatureStatus(env),
      getHeroFfmpegPresetSetting(env),
      getMemvidStreamPreviewDispatchState(env),
    ]);
    const features = featureStatus.features || {};
    return json({
      ok: true,
      data: {
        slots,
        slot_order: HERO_VIDEO_SLOTS,
        target_preset: presetStatus.preset,
        preset_status: presetStatus,
        feature_status: featureStatus,
        manual_uploads_enabled: features[VIDEO_DELIVERY_FEATURE_KEYS.HERO_MANUAL_UPLOADS]?.effective_enabled === true,
        external_ffmpeg_enabled: features[VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG]?.effective_enabled === true,
        stream_preview_summary: streamPreviewSummary,
        stream_preview_processor_dispatch: dispatchState,
      },
    });
  } catch (error) {
    if (error instanceof VideoDeliverySettingsError) {
      return json({ ok: false, error: error.message, code: error.code, fields: error.fields }, { status: error.status || 400 });
    }
    if (isMissingHomepageHeroTableError(error)) {
      return json(
        {
          ok: false,
          error: "Homepage hero video configuration migration is not applied.",
          code: "homepage_hero_video_schema_missing",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleAdminListDerivatives(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const url = new URL(request.url);
  const slot = url.searchParams.has("slot") ? normalizeSlot(url.searchParams.get("slot")) : null;
  const sourceType = url.searchParams.has("source_type") ? normalizeSourceType(url.searchParams.get("source_type")) : null;
  const sourceAssetId = url.searchParams.has("source_asset_id") ? normalizeAssetId(url.searchParams.get("source_asset_id")) : null;
  const status = url.searchParams.has("status") ? normalizeDerivativeStatus(url.searchParams.get("status")) : null;
  const includeUnassigned = url.searchParams.get("include_unassigned") !== "false";
  const limit = normalizeDerivativeListLimit(url.searchParams.get("limit"));

  if (url.searchParams.has("slot") && !slot) {
    return json({ ok: false, error: "Invalid homepage hero video slot.", code: "invalid_slot" }, { status: 400 });
  }
  if (url.searchParams.has("source_type") && !sourceType) {
    return json({ ok: false, error: "Invalid hero video source type.", code: "invalid_source_type" }, { status: 400 });
  }
  if (url.searchParams.has("source_asset_id") && !sourceAssetId) {
    return json({ ok: false, error: "Invalid source asset ID.", code: "invalid_source_asset" }, { status: 400 });
  }
  if (url.searchParams.has("status") && !status) {
    return json({ ok: false, error: "Invalid derivative status.", code: "invalid_derivative_status" }, { status: 400 });
  }

  try {
    const derivatives = await listAdminDerivatives(env, {
      slot,
      sourceType,
      sourceAssetId,
      status,
      includeUnassigned,
      limit,
    });
    return json({
      ok: true,
      data: {
        derivatives,
        filters: {
          slot,
          source_type: sourceType,
          source_asset_id: sourceAssetId,
          status,
          include_unassigned: includeUnassigned,
          limit,
        },
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isMissingHomepageHeroTableError(error)) {
      return json(
        {
          ok: false,
          error: "Homepage hero video configuration migration is not applied.",
          code: "homepage_hero_video_schema_missing",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleAdminDerivativeDetail(ctx, derivativeIdFromPath) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const derivativeId = normalizeDerivativeJobId(derivativeIdFromPath);
  if (!derivativeId) {
    return json({ ok: false, error: "Invalid derivative ID.", code: "invalid_derivative_id" }, { status: 400 });
  }

  try {
    const derivative = await getAdminDerivativeDetail(env, derivativeId);
    if (!derivative) {
      return json({ ok: false, error: "Derivative not found.", code: "derivative_not_found" }, { status: 404 });
    }
    return json({
      ok: true,
      data: { derivative },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isMissingHomepageHeroTableError(error)) {
      return json(
        {
          ok: false,
          error: "Homepage hero video configuration migration is not applied.",
          code: "homepage_hero_video_schema_missing",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleAdminFeatureStatus(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const [featureStatus, presetStatus, streamPreviewSummary, dispatchState] = await Promise.all([
    getVideoDeliveryFeatureStatus(env),
    getHeroFfmpegPresetSetting(env),
    getSharedMemvidStreamPreviewSummary(env),
    getMemvidStreamPreviewDispatchState(env),
  ]);
  return json({
    ok: true,
    data: {
      feature_status: featureStatus,
      preset_status: presetStatus,
      stream_preview_summary: streamPreviewSummary,
      stream_preview_processor_dispatch: dispatchState,
    },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleAdminUpdateFeatureSwitch(ctx, keyFromPath) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;
  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for video delivery feature switch changes.");
  if (idempotency.response) return idempotency.response;
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;

  try {
    const body = parsed.body || {};
    const update = await setVideoDeliveryFeatureSwitch(env, {
      key: String(keyFromPath || "").trim(),
      enabled: body.enabled,
      actorUserId: result.user.id,
      reason: body.operator_reason || body.operatorReason || body.reason,
    });
    await auditHomepageHeroVideoEvent(ctx, result.user, "video_delivery_feature_switch_updated", {
      feature_key: update.feature?.key || keyFromPath,
      enabled: update.feature?.admin_enabled === true,
      effective_enabled: update.feature?.effective_enabled === true,
      provider_configured: update.feature?.provider_configured === true,
      operator_reason_present: true,
      idempotency_key_hash_present: true,
    });
    return json({ ok: true, data: update }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof VideoDeliverySettingsError) {
      return json({
        ok: false,
        error: error.message,
        code: error.code,
        fields: error.fields,
      }, { status: error.status || 400 });
    }
    throw error;
  }
}

async function handleAdminUpdateHeroPreset(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;
  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for hero conversion preset changes.");
  if (idempotency.response) return idempotency.response;
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;

  try {
    const body = parsed.body || {};
    const presetStatus = await setHeroFfmpegPresetSetting(env, {
      preset: body.preset || body,
      actorUserId: result.user.id,
      reason: body.operator_reason || body.operatorReason || body.reason,
    });
    await auditHomepageHeroVideoEvent(ctx, result.user, "homepage_hero_ffmpeg_preset_updated", {
      preset_version: presetStatus.preset?.version || null,
      max_width: presetStatus.preset?.maxWidth || null,
      duration_seconds: presetStatus.preset?.durationSeconds || null,
      audio_enabled: presetStatus.preset?.audio === true,
      warning_count: Array.isArray(presetStatus.warnings) ? presetStatus.warnings.length : 0,
      operator_reason_present: true,
      idempotency_key_hash_present: true,
    });
    return json({ ok: true, data: { preset_status: presetStatus } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof VideoDeliverySettingsError) {
      return json({
        ok: false,
        error: error.message,
        code: error.code,
        fields: error.fields,
      }, { status: error.status || 400 });
    }
    throw error;
  }
}

async function handleAdminAttachUploadPoster(ctx, assetIdFromPath) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;
  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const manualUploads = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_MANUAL_UPLOADS);
  if (!manualUploads?.effective_enabled) {
    return json(
      {
        ok: false,
        error: "Homepage hero manual uploads are disabled.",
        code: "manual_uploads_disabled",
      },
      { status: 503 }
    );
  }

  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for hero source poster retries.");
  if (idempotency.response) return idempotency.response;
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiSaveVideoPosterJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  if (!operatorReason) {
    return json({ ok: false, error: "operator_reason must be at least 8 characters.", code: "operator_reason_required" }, { status: 400 });
  }
  const assetId = normalizeAssetId(assetIdFromPath);
  if (!assetId) return json({ ok: false, error: "Invalid asset ID.", code: "invalid_asset_id" }, { status: 400 });

  const upload = await env.DB.prepare(
    `SELECT id, asset_id, user_id
     FROM homepage_hero_video_uploads
     WHERE asset_id = ?
       AND user_id = ?
     LIMIT 1`
  ).bind(assetId, result.user.id).first();
  if (!upload) return json({ ok: false, error: "Hero source upload not found.", code: "hero_upload_not_found" }, { status: 404 });

  try {
    const saved = await attachVideoPosterToAiTextAsset(env, {
      userId: result.user.id,
      assetId,
      posterBase64: body.posterBase64 || body.poster_base64,
    });
    await updateHeroSourcePosterState(env, {
      assetId,
      userId: result.user.id,
      status: "ready",
      retryable: false,
    });
    await auditHomepageHeroVideoEvent(ctx, result.user, "homepage_hero_video_source_poster_attached", {
      source_asset_id: assetId,
      poster_size_bytes: saved.poster_size_bytes ?? null,
      operator_reason_present: true,
      idempotency_key_hash_present: true,
    });
    return json({ ok: true, data: { poster: saved } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({
      ok: false,
      error: error?.message || "Video poster could not be attached.",
      code: error?.code || "video_poster_attach_failed",
    }, { status: error?.status || 500 });
  }
}

async function handleAdminRetryUploadPoster(ctx, assetIdFromPath) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;
  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const manualUploads = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_MANUAL_UPLOADS);
  if (!manualUploads?.effective_enabled) {
    return json(
      {
        ok: false,
        error: "Homepage hero manual uploads are disabled.",
        code: "manual_uploads_disabled",
      },
      { status: 503 }
    );
  }

  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for hero source poster retries.");
  if (idempotency.response) return idempotency.response;
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  if (!operatorReason) {
    return json({ ok: false, error: "operator_reason must be at least 8 characters.", code: "operator_reason_required" }, { status: 400 });
  }

  const assetId = normalizeAssetId(assetIdFromPath);
  if (!assetId) return json({ ok: false, error: "Invalid asset ID.", code: "invalid_asset_id" }, { status: 400 });
  const upload = await getSourcePosterJobAsset(env, assetId);
  if (!upload || upload.user_id !== result.user.id) {
    return json({ ok: false, error: "Hero source upload not found.", code: "hero_upload_not_found" }, { status: 404 });
  }

  if (upload.poster_r2_key) {
    await updateHeroSourcePosterState(env, {
      assetId,
      userId: result.user.id,
      status: "ready",
      retryable: false,
    });
    return json({
      ok: true,
      existing: true,
      data: {
        candidate: toAdminAssetCandidate(upload, result.user.id),
        poster_status: "ready",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const externalFfmpeg = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG);
  if (!externalFfmpeg?.effective_enabled || !getProcessorSecret(env)) {
    await updateHeroSourcePosterState(env, {
      assetId,
      userId: result.user.id,
      status: "failed",
      retryable: true,
      errorCode: "source_poster_processor_not_configured",
      message: "Poster preview processor is not configured. Enable/configure external_ffmpeg or upload a poster with the source video.",
    });
    return json(
      {
        ok: false,
        error: "Poster preview processor is not configured.",
        code: "source_poster_processor_not_configured",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const state = await updateHeroSourcePosterState(env, {
    assetId,
    userId: result.user.id,
    status: "pending",
    retryable: true,
    errorCode: null,
    message: "Poster preview is queued for the external ffmpeg processor.",
    extra: {
      poster_processor: "external_ffmpeg",
      poster_retry_requested_at: nowIso(),
    },
  });
  if (state) {
    const metadata = parseJson(upload.metadata_json) || {};
    upload.metadata_json = JSON.stringify({
      ...metadata,
      homepage_hero_source: state,
    });
  }

  await auditHomepageHeroVideoEvent(ctx, result.user, "homepage_hero_video_source_poster_retry_requested", {
    source_asset_id: assetId,
    source_upload_id: upload.upload_id || null,
    operator_reason_present: true,
    idempotency_key_hash_present: true,
  });

  return json({
    ok: true,
    data: {
      candidate: toAdminAssetCandidate(upload, result.user.id),
      poster_status: "pending",
    },
  }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

async function handleAdminCandidates(ctx) {
  const { request, env, url, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const source = String(url.searchParams.get("source") || "public").trim();
  const limit = normalizeCandidateLimit(url.searchParams.get("limit"));

  try {
    const candidates = source === "admin-assets"
      ? await listAdminAssetCandidates(env, result.user.id, limit)
      : await listPublicCandidates(env, limit);
    return json({
      ok: true,
      data: {
        source,
        candidates,
        applied_limit: limit,
      },
    });
  } catch (error) {
    if (String(error?.message || error).includes("no such table")
      && String(error?.message || error).includes("ai_text_assets")) {
      return json(
        {
          ok: false,
          error: "Saved video assets are temporarily unavailable.",
          code: "video_assets_unavailable",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleAdminUploadSource(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const manualUploads = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_MANUAL_UPLOADS);
  if (!manualUploads?.effective_enabled) {
    return json(
      {
        ok: false,
        error: "Homepage hero manual uploads are disabled.",
        code: "manual_uploads_disabled",
      },
      { status: 503 }
    );
  }

  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for homepage hero video uploads.");
  if (idempotency.response) return idempotency.response;

  let formData;
  try {
    formData = await readFormDataLimited(request, { maxBytes: BODY_LIMITS.homepageHeroVideoUpload });
  } catch (error) {
    if (isRequestBodyError(error)) return requestBodyErrorResponse(error);
    throw error;
  }

  const operatorReason = normalizeOperatorReason(
    formData.get("operator_reason")
      || formData.get("operatorReason")
      || formData.get("reason")
  );
  if (!operatorReason) {
    return json(
      {
        ok: false,
        error: "operator_reason must be at least 8 characters.",
        code: "operator_reason_required",
      },
      { status: 400 }
    );
  }

  const file = formData.get("video") || formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ ok: false, error: "A video file is required.", code: "video_file_required" }, { status: 400 });
  }

  const originalFileName = sanitizeHeroFileName(file.name || "homepage-hero-source.mp4");
  const mimeType = normalizeVideoMimeType(file.type);
  if (!mimeType) {
    return json({ ok: false, error: "Unsupported hero source video type.", code: "unsupported_video_type" }, { status: 415 });
  }
  const sizeBytes = Number(file.size || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return json({ ok: false, error: "Uploaded video is empty.", code: "empty_video_file" }, { status: 400 });
  }
  if (sizeBytes > BODY_LIMITS.homepageHeroVideoUpload) {
    return json({ ok: false, error: "Uploaded video is too large.", code: "payload_too_large" }, { status: 413 });
  }

  const normalizedAspectRatio = normalizeManualUploadDisplayAspectRatio(
    formData.get("aspect_ratio")
      || formData.get("aspectRatio")
      || formData.get("display_aspect_ratio")
      || formData.get("displayAspectRatio")
  );
  if (!normalizedAspectRatio) {
    return json({
      ok: false,
      error: "aspect_ratio must be one of 9:16, 1:1, or 16:9.",
      code: "invalid_aspect_ratio",
    }, { status: 400 });
  }

  const poster = formData.get("poster");
  let posterBytes = null;
  let posterWarning = null;
  if (poster && typeof poster.arrayBuffer === "function" && Number(poster.size || 0) > 0) {
    const posterMimeType = normalizeSourcePosterMimeType(poster.type);
    if (!posterMimeType) {
      return json({ ok: false, error: "Unsupported hero source poster type.", code: "unsupported_poster_type" }, { status: 415 });
    }
    if (Number(poster.size || 0) > 2 * 1024 * 1024) {
      return json({ ok: false, error: "Hero source poster is too large.", code: "poster_too_large" }, { status: 413 });
    }
    posterBytes = new Uint8Array(await poster.arrayBuffer());
  } else {
    posterWarning = "Poster preview is pending. Retry poster generation or complete a derivative conversion before relying on this source in Admin asset views.";
  }

  const title = sanitizeShortText(formData.get("title"), originalFileName.replace(/\.[^.]+$/, ""));
  const requestHash = await sha256Hex(stableJson({
    route: "/api/admin/homepage/hero-videos/uploads",
    title,
    originalFileName,
    mimeType,
    sizeBytes,
    aspectRatio: normalizedAspectRatio,
    posterSizeBytes: posterBytes?.byteLength || 0,
    operatorReason,
  }));
  const idempotencyKeyHash = await sha256Hex(idempotency.key);

  try {
    const existing = await getHeroUploadByIdempotency(env, idempotencyKeyHash, result.user.id);
    if (existing) {
      if (existing.request_hash && existing.request_hash !== requestHash) {
        return json(
          {
            ok: false,
            error: "Idempotency-Key was already used for a different homepage hero video upload.",
            code: "idempotency_key_conflict",
          },
          { status: 409 }
        );
      }
      return json({
        ok: true,
        existing: true,
        data: {
          candidate: toAdminAssetCandidate(existing, result.user.id),
        },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await saveGeneratedVideoAsset(env, {
      userId: result.user.id,
      title,
      videoBytes: bytes,
      mimeType,
      payload: {
        prompt: "Homepage hero manual source upload",
        source: "admin_homepage_hero_videos",
        aspect_ratio: normalizedAspectRatio,
        original_file_name: originalFileName,
        operator_reason_present: true,
        homepage_hero_source: {
          is_manual_upload: true,
          display_aspect_ratio: normalizedAspectRatio,
          poster_status: "pending",
          poster_retryable: true,
          poster_message: posterBytes?.byteLength
            ? "Poster preview is being validated."
            : "Poster preview is being prepared. Attach a poster or complete a hero derivative conversion to fill this source preview.",
        },
      },
      posterBytes,
    });
    const asset = await findSourceAsset(env, "admin_asset", saved.id, result.user.id);
    if (!asset?.r2_key) {
      return json({ ok: false, error: "Uploaded hero video source could not be recorded.", code: "upload_record_failed" }, { status: 500 });
    }

    await insertHeroUploadRecord(env, {
      uploadId: `hhvu_${randomTokenHex(16)}`,
      asset,
      adminUserId: result.user.id,
      originalFileName,
      idempotencyKeyHash,
      requestHash,
      operatorReason,
    });
    const posterState = await updateHeroSourcePosterState(env, {
      assetId: asset.id,
      userId: result.user.id,
      status: asset.poster_r2_key ? "ready" : (posterBytes?.byteLength ? "failed" : "pending"),
      retryable: !asset.poster_r2_key,
      errorCode: asset.poster_r2_key ? null : (posterBytes?.byteLength ? "poster_processing_failed" : "poster_pending_processor"),
      message: asset.poster_r2_key
        ? null
        : (posterBytes?.byteLength
          ? "Poster preview could not be processed. Retry poster generation from Homepage Hero Videos."
          : "Poster preview is being prepared. Convert this source or retry with a poster frame before relying on preview cards."),
    });
    if (posterState) {
      const metadata = parseJson(asset.metadata_json) || {};
      asset.metadata_json = JSON.stringify({
        ...metadata,
        homepage_hero_source: posterState,
      });
    }

    await auditHomepageHeroVideoEvent(ctx, result.user, "homepage_hero_video_source_uploaded", {
      source_type: "admin_asset",
      source_asset_id: asset.id,
      size_bytes: Number(asset.size_bytes || 0) || null,
      mime_type: asset.mime_type || null,
      operator_reason_present: true,
      idempotency_key_hash_present: true,
    });

    return json({
      ok: true,
      existing: false,
      data: {
        candidate: toAdminAssetCandidate(asset, result.user.id),
        poster_warning: asset.poster_r2_key ? null : posterWarning || "Poster preview is pending. Retry poster generation or complete a derivative conversion before relying on this source in Admin asset views.",
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof VideoDeliverySettingsError) {
      return json({ ok: false, error: error.message, code: error.code, fields: error.fields }, { status: error.status || 400 });
    }
    if (isMissingHomepageHeroTableError(error)) {
      return json(
        {
          ok: false,
          error: "Homepage hero video upload migration is not applied.",
          code: "homepage_hero_video_schema_missing",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleAdminMemvidStreamPreviewBackfill(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const streamPreviews = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS);
  if (!streamPreviews?.effective_enabled) {
    return json({ ok: false, error: "Memvid Stream previews are disabled.", code: "stream_previews_disabled" }, { status: 503 });
  }
  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for Memvid Stream preview backfill.");
  if (idempotency.response) return idempotency.response;
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  if (!operatorReason) {
    return json({ ok: false, error: "operator_reason must be at least 8 characters.", code: "operator_reason_required" }, { status: 400 });
  }
  const limit = clampInteger(body.limit, { fallback: 10, min: 1, max: 50 });
  const requestHash = await sha256Hex(stableJson({
    route: "/api/admin/homepage/hero-videos/memvid-stream-previews/backfill",
    limit,
    operatorReason,
  }));
  const idempotencyKeyHash = await sha256Hex(idempotency.key);
  const existing = await env.DB.prepare(
    `SELECT id, request_hash, queued_count
     FROM memvid_stream_preview_backfill_requests
     WHERE idempotency_key_hash = ?
     LIMIT 1`
  ).bind(idempotencyKeyHash).first();
  if (existing) {
    if (existing.request_hash && existing.request_hash !== requestHash) {
      return json({ ok: false, error: "Idempotency-Key was already used for a different Memvid Stream preview backfill.", code: "idempotency_key_conflict" }, { status: 409 });
    }
    return json({ ok: true, existing: true, data: { queued_count: Number(existing.queued_count || 0) } });
  }
  const now = nowIso();
  const queued = await queueMissingMemvidStreamPreviewJobs(env, {
    limit,
    operatorReason,
    source: "admin_backfill",
  });
  await env.DB.prepare(
    `INSERT INTO memvid_stream_preview_backfill_requests (
       id, idempotency_key_hash, request_hash, queued_count,
       operator_user_id, operator_reason, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    `msp_bfr_${randomTokenHex(16)}`,
    idempotencyKeyHash,
    requestHash,
    queued.queued_count,
    result.user.id,
    operatorReason,
    now
  ).run();

  await auditHomepageHeroVideoEvent(ctx, result.user, "memvid_stream_preview_backfill_queued", {
    queued_count: queued.queued_count,
    requested_limit: limit,
    operator_reason_present: true,
    idempotency_key_hash_present: true,
  });

  return json({ ok: true, data: { queued: queued.queued, queued_count: queued.queued_count } }, { status: 202 });
}

async function handleAdminMemvidStreamPreviewRun(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const streamPreviews = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS);
  if (!streamPreviews?.effective_enabled) {
    return json({ ok: false, error: "Memvid Stream previews are disabled.", code: "stream_previews_disabled" }, { status: 503 });
  }
  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for Memvid Stream preview processing.");
  if (idempotency.response) return idempotency.response;
  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  if (!operatorReason) {
    return json({ ok: false, error: "operator_reason must be at least 8 characters.", code: "operator_reason_required" }, { status: 400 });
  }
  const limit = clampInteger(body.limit, { fallback: 25, min: 1, max: 100 });
  const repairLimit = clampInteger(body.repair_limit || body.repairLimit, { fallback: 100, min: 1, max: 200 });
  const requestHash = await sha256Hex(stableJson({
    route: "/api/admin/homepage/hero-videos/memvid-stream-previews/run",
    limit,
    repairLimit,
    operatorReason,
  }));
  const idempotencyKeyHash = await sha256Hex(idempotency.key);
  const existing = await env.DB.prepare(
    `SELECT id, request_hash, queued_count
     FROM memvid_stream_preview_backfill_requests
     WHERE idempotency_key_hash = ?
     LIMIT 1`
  ).bind(idempotencyKeyHash).first();
  if (existing) {
    if (existing.request_hash && existing.request_hash !== requestHash) {
      return json({ ok: false, error: "Idempotency-Key was already used for a different Memvid Stream preview run.", code: "idempotency_key_conflict" }, { status: 409 });
    }
    const [featureStatus, streamPreviewSummary, dispatchState] = await Promise.all([
      getVideoDeliveryFeatureStatus(env),
      getSharedMemvidStreamPreviewSummary(env),
      getMemvidStreamPreviewDispatchState(env),
    ]);
    return json({
      ok: true,
      existing: true,
      data: {
        queued_new_count: Number(existing.queued_count || 0),
        queued_count: Number(existing.queued_count || 0),
        queued_repair_count: streamPreviewSummary.ready_missing_download_url || 0,
        repair_queued_count: streamPreviewSummary.ready_missing_download_url || 0,
        dispatch_configured: dispatchState.configured,
        dispatch_attempted: false,
        dispatch_succeeded: false,
        dispatch_provider: dispatchState.provider,
        dispatch_message: "This idempotent run request was already recorded; processor dispatch was not re-attempted.",
        dispatch_skipped_reason: "idempotent_replay",
        auto_dispatch_enabled: dispatchState.auto_dispatch_enabled,
        last_dispatch_at: dispatchState.last_dispatch_at,
        next_dispatch_after: dispatchState.next_dispatch_after,
        processor_dispatch_configured: dispatchState.configured,
        processor_dispatch_started: false,
        feature_status: featureStatus,
        stream_preview_summary: streamPreviewSummary,
        warnings: ["This idempotent run request was already recorded."],
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const queued = await queueMissingMemvidStreamPreviewJobs(env, {
    limit,
    operatorReason,
    source: "admin_manual",
  });
  const repair = await queueMemvidStreamPreviewRepairJobs(env, {
    limit: repairLimit,
    source: "admin_manual",
  });
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO memvid_stream_preview_backfill_requests (
       id, idempotency_key_hash, request_hash, queued_count,
       operator_user_id, operator_reason, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    `msp_bfr_${randomTokenHex(16)}`,
    idempotencyKeyHash,
    requestHash,
    queued.queued_count,
    result.user.id,
    operatorReason,
    now
  ).run();

  const dispatch = await maybeDispatchMemvidStreamPreviewProcessor(env, {
    reason: "admin_manual",
    force: true,
    jobLimit: Math.min(8, Math.max(1, Number(body.job_limit || body.jobLimit || 5) || 5)),
    repairDownloads: true,
    dispatchReason: operatorReason,
    queuedNewCount: queued.queued_count,
    queuedRepairCount: repair.queued_count,
  });
  const [featureStatus, streamPreviewSummary] = await Promise.all([
    getVideoDeliveryFeatureStatus(env),
    getSharedMemvidStreamPreviewSummary(env),
  ]);
  const warnings = [];
  if (!dispatch.configured) {
    warnings.push(dispatch.message || "Preview jobs were queued, but automatic processor dispatch is not configured.");
  } else if (!dispatch.started) {
    warnings.push(dispatch.message || dispatch.warning || "Preview jobs were queued, but automatic processor dispatch did not start.");
  }

  await auditHomepageHeroVideoEvent(ctx, result.user, "memvid_stream_preview_run_requested", {
    queued_count: queued.queued_count,
    repair_queued_count: repair.queued_count,
    dispatch_provider: dispatch.provider || null,
    dispatch_configured: dispatch.configured === true,
    dispatch_attempted: dispatch.attempted === true,
    dispatch_succeeded: dispatch.succeeded === true,
    operator_reason_present: true,
    idempotency_key_hash_present: true,
  });

  return json({
    ok: true,
    data: {
      queued: queued.queued,
      queued_new_count: queued.queued_count,
      queued_count: queued.queued_count,
      queued_repair_count: repair.queued_count,
      repair_queued_count: repair.queued_count,
      dispatch_configured: dispatch.configured === true,
      dispatch_attempted: dispatch.attempted === true,
      dispatch_succeeded: dispatch.succeeded === true,
      dispatch_provider: dispatch.provider || null,
      dispatch_message: dispatch.message || dispatch.warning || null,
      dispatch_skipped_reason: dispatch.dispatch_skipped_reason || null,
      auto_dispatch_enabled: dispatch.auto_dispatch_enabled === true,
      last_dispatch_at: dispatch.last_dispatch_at || null,
      next_dispatch_after: dispatch.next_dispatch_after || null,
      processor_dispatch_configured: dispatch.configured === true,
      processor_dispatch_started: dispatch.succeeded === true,
      feature_status: featureStatus,
      stream_preview_summary: streamPreviewSummary,
      warnings,
    },
  }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

async function handleCreateDerivative(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for homepage hero video derivative jobs.");
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const slot = normalizeSlot(body.slot);
  const sourceType = normalizeSourceType(body.source_type || body.sourceType);
  const sourceAssetId = normalizeAssetId(body.source_asset_id || body.sourceAssetId);
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  const provider = normalizeProvider(env, body.provider);

  if (!slot) return json({ ok: false, error: "Invalid homepage hero video slot.", code: "invalid_slot" }, { status: 400 });
  if (!sourceType) return json({ ok: false, error: "Invalid hero video source type.", code: "invalid_source_type" }, { status: 400 });
  if (!sourceAssetId) return json({ ok: false, error: "Invalid source asset ID.", code: "invalid_source_asset" }, { status: 400 });
  if (!operatorReason) {
    return json(
      {
        ok: false,
        error: "operator_reason must be at least 8 characters.",
        code: "operator_reason_required",
      },
      { status: 400 }
    );
  }
  const externalFfmpeg = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG);
  if (provider === "external_ffmpeg" && (!externalFfmpeg?.effective_enabled || !getProcessorSecret(env))) {
    return json(
      {
        ok: false,
        error: "external_ffmpeg hero processing is disabled or missing its processor secret.",
        code: "external_ffmpeg_not_configured",
      },
      { status: 503 }
    );
  }
  const presetStatus = await getHeroFfmpegPresetSetting(env);
  const targetPreset = normalizeHeroFfmpegPreset(body.preset || presetStatus.preset || TARGET_PRESET);

  const requestHash = await sha256Hex(stableJson({
    route: "/api/admin/homepage/hero-videos/derivatives",
    slot,
    sourceType,
    sourceAssetId,
    provider,
    targetPreset,
    operatorReason,
  }));
  const idempotencyKeyHash = await sha256Hex(idempotency.key);

  try {
    const existing = await getDerivativeByIdempotency(env, idempotencyKeyHash);
    if (existing) {
      if (existing.request_hash && existing.request_hash !== requestHash) {
        return json(
          {
            ok: false,
            error: "Idempotency-Key was already used for a different homepage hero video derivative request.",
            code: "idempotency_key_conflict",
          },
          { status: 409 }
        );
      }
      return json({
        ok: true,
        existing: true,
        data: {
          derivative: serializeDerivative(existing),
        },
      });
    }

    const source = await findSourceAsset(env, sourceType, sourceAssetId, result.user.id);
    if (!source) {
      return json({ ok: false, error: "Source video asset was not found.", code: "source_video_not_found" }, { status: 404 });
    }
    if (!source.r2_key) {
      return json({ ok: false, error: "Source video storage pointer is missing.", code: "source_video_unavailable" }, { status: 409 });
    }

    const derivativeId = `hhvd_${randomTokenHex(16)}`;
    const providerPayload = conversionProviderPayload(provider, targetPreset);
    await insertDerivativeJob(env, {
      derivativeId,
      slot,
      sourceType,
      source,
      provider,
      idempotencyKeyHash,
      requestHash,
      adminUserId: result.user.id,
      operatorReason,
      status: "queued",
      providerPayload,
      targetPreset,
    });

    if (provider === "mock") {
      await markMockDerivativeSucceeded(env, derivativeId, slot, targetPreset);
    }

    const derivative = await getDerivativeById(env, derivativeId);
    await auditHomepageHeroVideoEvent(ctx, result.user, "homepage_hero_video_derivative_requested", {
      slot,
      source_type: sourceType,
      source_asset_id: sourceAssetId,
      source_user_id: source.user_id || null,
      provider,
      status: derivative?.status || "queued",
      derivative_id: derivativeId,
      operator_reason_present: true,
      idempotency_key_hash_present: true,
    });

    return json({
      ok: true,
      existing: false,
      data: {
        derivative: serializeDerivative(derivative),
      },
    }, { status: 202 });
  } catch (error) {
    if (isMissingHomepageHeroTableError(error)) {
      return json(
        {
          ok: false,
          error: "Homepage hero video configuration migration is not applied.",
          code: "homepage_hero_video_schema_missing",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleUpdateSlot(ctx, slotFromPath) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const slot = normalizeSlot(slotFromPath);
  if (!slot) return json({ ok: false, error: "Invalid homepage hero video slot.", code: "invalid_slot" }, { status: 400 });

  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for homepage hero video slot changes.");
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const enabled = body.enabled === true;
  const derivativeId = normalizeAssetId(body.derivative_id || body.derivativeId);
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  if (!operatorReason) {
    return json(
      {
        ok: false,
        error: "operator_reason must be at least 8 characters.",
        code: "operator_reason_required",
      },
      { status: 400 }
    );
  }
  if (enabled && !derivativeId) {
    return json({ ok: false, error: "derivative_id is required when enabling a slot.", code: "derivative_required" }, { status: 400 });
  }

  const requestHash = await sha256Hex(stableJson({
    route: "/api/admin/homepage/hero-videos/slots/:slot",
    slot,
    enabled,
    derivativeId: enabled ? derivativeId : null,
    operatorReason,
  }));
  const idempotencyKeyHash = await sha256Hex(idempotency.key);

  try {
    const existingSlot = await getSlotIdempotencyState(env, slot);
    if (existingSlot?.last_idempotency_key_hash === idempotencyKeyHash) {
      if (existingSlot.last_request_hash && existingSlot.last_request_hash !== requestHash) {
        return json(
          {
            ok: false,
            error: "Idempotency-Key was already used for a different homepage hero video slot request.",
            code: "idempotency_key_conflict",
          },
          { status: 409 }
        );
      }
      const slots = await listAdminSlots(env);
      return json({
        ok: true,
        existing: true,
        data: {
          slot: slots.find((entry) => entry.slot === slot) || null,
          slots,
        },
      });
    }

    let derivative = null;
    if (enabled) {
      derivative = await getDerivativeById(env, derivativeId);
      if (!derivative || derivative.slot !== slot) {
        return json({ ok: false, error: "Derivative does not belong to this slot.", code: "derivative_slot_mismatch" }, { status: 400 });
      }
      if (derivative.status !== "succeeded" || !derivative.version) {
        return json({ ok: false, error: "Only succeeded hero video derivatives can be assigned to a public slot.", code: "derivative_not_ready" }, { status: 409 });
      }
    }

    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO homepage_hero_video_slots (
         slot, display_order, enabled, derivative_id, source_type, source_asset_id,
         source_user_id, title, operator_reason, updated_by_user_id,
         last_idempotency_key_hash, last_request_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET
         enabled = excluded.enabled,
         derivative_id = excluded.derivative_id,
         source_type = excluded.source_type,
         source_asset_id = excluded.source_asset_id,
         source_user_id = excluded.source_user_id,
         title = excluded.title,
         operator_reason = excluded.operator_reason,
         updated_by_user_id = excluded.updated_by_user_id,
         last_idempotency_key_hash = excluded.last_idempotency_key_hash,
         last_request_hash = excluded.last_request_hash,
         updated_at = excluded.updated_at`
    ).bind(
      slot,
      (HERO_VIDEO_SLOTS.indexOf(slot) + 1) * 10,
      enabled ? 1 : 0,
      enabled ? derivative.id : null,
      enabled ? derivative.source_type : null,
      enabled ? derivative.source_asset_id : null,
      enabled ? derivative.source_user_id : null,
      enabled ? (derivative.source_title || body.title || null) : null,
      operatorReason,
      result.user.id,
      idempotencyKeyHash,
      requestHash,
      now,
      now
    ).run();

    const slots = await listAdminSlots(env);
    await auditHomepageHeroVideoEvent(ctx, result.user, enabled
      ? "homepage_hero_video_slot_enabled"
      : "homepage_hero_video_slot_disabled", {
      slot,
      enabled,
      derivative_id: enabled ? derivative.id : null,
      source_type: enabled ? derivative.source_type : null,
      source_asset_id: enabled ? derivative.source_asset_id : null,
      operator_reason_present: true,
      idempotency_key_hash_present: true,
    });

    return json({
      ok: true,
      existing: false,
      data: {
        slot: slots.find((entry) => entry.slot === slot) || null,
        slots,
      },
    });
  } catch (error) {
    if (isMissingHomepageHeroTableError(error)) {
      return json(
        {
          ok: false,
          error: "Homepage hero video configuration migration is not applied.",
          code: "homepage_hero_video_schema_missing",
        },
        { status: 503 }
      );
    }
    throw error;
  }
}

async function handleRetryDerivative(ctx, derivativeIdFromPath) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  const limited = await enforceAdminHeroActionRateLimit(ctx);
  if (limited) return limited;

  const derivativeId = normalizeDerivativeJobId(derivativeIdFromPath);
  if (!derivativeId) return json({ ok: false, error: "Invalid derivative id.", code: "invalid_derivative_id" }, { status: 400 });

  const idempotency = idempotencyKeyOrResponse(request, "Idempotency-Key is required for homepage hero video derivative retries.");
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const operatorReason = normalizeOperatorReason(body.operator_reason || body.operatorReason || body.reason);
  if (!operatorReason) {
    return json(
      {
        ok: false,
        error: "operator_reason must be at least 8 characters.",
        code: "operator_reason_required",
      },
      { status: 400 }
    );
  }
  const externalFfmpeg = await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG);
  if (!externalFfmpeg?.effective_enabled || !getProcessorSecret(env)) {
    return json(
      {
        ok: false,
        error: "external_ffmpeg hero processing is disabled or missing its processor secret.",
        code: "external_ffmpeg_not_configured",
      },
      { status: 503 }
    );
  }

  const derivative = await getProcessorDerivativeById(env, derivativeId);
  if (!derivative) return json({ ok: false, error: "Derivative job not found.", code: "derivative_not_found" }, { status: 404 });
  if (!["failed", "queued"].includes(derivative.status)) {
    return json({ ok: false, error: "Only failed or queued external_ffmpeg derivatives can be retried.", code: "derivative_not_retryable" }, { status: 409 });
  }

  const presetStatus = await getHeroFfmpegPresetSetting(env);
  const targetPreset = presetStatus.preset || TARGET_PRESET;
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE homepage_hero_video_derivatives
     SET status = 'queued',
         error_code = NULL,
         error_message = NULL,
         target_preset_json = ?,
         provider_payload_json = ?,
         processing_started_at = NULL,
         processing_completed_at = NULL,
         updated_at = ?
     WHERE id = ?
       AND provider = 'external_ffmpeg'`
  ).bind(
    JSON.stringify(targetPreset),
    JSON.stringify(conversionProviderPayload("external_ffmpeg", targetPreset)),
    now,
    derivativeId
  ).run();

  await auditHomepageHeroVideoEvent(ctx, result.user, "homepage_hero_video_derivative_retry_requested", {
    derivative_id: derivativeId,
    slot: derivative.slot,
    operator_reason_present: true,
    idempotency_key_hash_present: true,
  });

  return json({
    ok: true,
    data: {
      derivative: serializeDerivative(await getDerivativeById(env, derivativeId)),
    },
  });
}

async function handleProcessorClaimJobs(ctx) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.homepageHeroProcessorJson,
    requiredContentType: false,
  });
  if (parsed.response) return parsed.response;
  const limit = clampInteger(parsed.body?.limit, { fallback: 1, min: 1, max: 4 });

  const rows = await listQueuedProcessorJobs(ctx.env, limit);
  const now = nowIso();
  for (const row of rows) {
    await ctx.env.DB.prepare(
      `UPDATE homepage_hero_video_derivatives
       SET status = 'processing',
           processing_started_at = COALESCE(processing_started_at, ?),
           updated_at = ?
       WHERE id = ?
         AND provider = 'external_ffmpeg'
         AND status = 'queued'`
    ).bind(now, now, row.id).run();
    row.status = "processing";
    row.updated_at = now;
  }

  return json(
    {
      ok: true,
      data: {
        jobs: rows.map(serializeProcessorJob),
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

async function handleProcessorSource(ctx, derivativeIdFromPath) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const derivativeId = normalizeDerivativeJobId(derivativeIdFromPath);
  if (!derivativeId) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });
  const derivative = await getProcessorDerivativeById(ctx.env, derivativeId);
  if (!derivative?.source_r2_key || !["queued", "processing"].includes(derivative.status)) {
    return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });
  }

  const object = await ctx.env.USER_IMAGES.get(derivative.source_r2_key);
  if (!object) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });

  const headers = buildPublicMediaHeaders(
    derivative.original_mime_type || object.httpMetadata?.contentType || "video/mp4",
    object.size,
    { immutable: false }
  );
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", "attachment; filename=\"homepage-hero-source.mp4\"");
  return new Response(object.body, { headers });
}

async function handleSourcePosterClaimJobs(ctx) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.homepageHeroProcessorJson,
    requiredContentType: false,
  });
  if (parsed.response) return parsed.response;
  const limit = clampInteger(parsed.body?.limit, { fallback: 1, min: 1, max: SOURCE_POSTER_PROCESSOR_JOB_LIMIT });

  const rows = await listQueuedSourcePosterJobs(ctx.env, limit);
  const now = nowIso();
  for (const row of rows) {
    const state = await updateHeroSourcePosterState(ctx.env, {
      assetId: row.id,
      userId: row.user_id,
      status: "pending",
      retryable: true,
      errorCode: null,
      message: "Poster preview is being prepared by the external ffmpeg processor.",
      extra: {
        poster_processor: "external_ffmpeg",
        poster_attempted_at: now,
      },
    });
    if (state) {
      const metadata = parseJson(row.metadata_json) || {};
      row.metadata_json = JSON.stringify({
        ...metadata,
        homepage_hero_source: state,
      });
    }
  }
  const presetStatus = await getHeroFfmpegPresetSetting(ctx.env);
  const preset = presetStatus.preset || TARGET_PRESET;

  return json(
    {
      ok: true,
      data: {
        jobs: rows.map((row) => serializeSourcePosterProcessorJob(row, preset)),
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

async function handleSourcePosterSource(ctx, assetIdFromPath) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const assetId = normalizeAssetId(assetIdFromPath);
  if (!assetId) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });
  const source = await getSourcePosterJobAsset(ctx.env, assetId);
  if (!source?.r2_key) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });

  const object = await ctx.env.USER_IMAGES.get(source.r2_key);
  if (!object) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });

  const headers = buildPublicMediaHeaders(
    source.mime_type || object.httpMetadata?.contentType || "video/mp4",
    object.size,
    { immutable: false }
  );
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", "attachment; filename=\"homepage-hero-source.mp4\"");
  return new Response(object.body, { headers });
}

async function handleSourcePosterComplete(ctx, assetIdFromPath) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const assetId = normalizeAssetId(assetIdFromPath);
  if (!assetId) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  const source = await getSourcePosterJobAsset(ctx.env, assetId);
  if (!source) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  if (source.poster_r2_key) {
    await updateHeroSourcePosterState(ctx.env, {
      assetId,
      userId: source.user_id,
      status: "ready",
      retryable: false,
    });
    return json({
      ok: true,
      existing: true,
      data: {
        poster: {
          id: assetId,
          poster_url: `/api/ai/text-assets/${assetId}/poster`,
        },
      },
    });
  }

  let formData;
  try {
    formData = await readFormDataLimited(ctx.request, { maxBytes: BODY_LIMITS.homepageHeroProcessorUpload });
  } catch (error) {
    if (isRequestBodyError(error)) return requestBodyErrorResponse(error);
    throw error;
  }

  const poster = formData.get("poster");
  if (!poster || typeof poster.arrayBuffer !== "function") {
    return json({ ok: false, error: "Source poster file is required.", code: "source_poster_required" }, { status: 400 });
  }
  const posterMimeType = normalizeSourcePosterMimeType(poster.type);
  if (!posterMimeType) {
    return json({ ok: false, error: "Source poster must be a PNG, JPEG, or WebP image.", code: "unsupported_source_poster_type" }, { status: 415 });
  }
  if (Number(poster.size || 0) <= 0 || Number(poster.size || 0) > 2 * 1024 * 1024) {
    return json({ ok: false, error: "Source poster size is outside the allowed range.", code: "invalid_source_poster_size" }, { status: 400 });
  }

  try {
    const saved = await attachVideoPosterBytesToAiTextAsset(ctx.env, {
      userId: source.user_id,
      assetId,
      posterBytes: new Uint8Array(await poster.arrayBuffer()),
      successEvent: "homepage_hero_source_poster_saved",
      failureEvent: "homepage_hero_source_poster_save_failed",
    });
    await updateHeroSourcePosterState(ctx.env, {
      assetId,
      userId: source.user_id,
      status: "ready",
      retryable: false,
      extra: {
        poster_processor: "external_ffmpeg",
        poster_completed_at: nowIso(),
      },
    });
    return json({
      ok: true,
      existing: false,
      data: {
        poster: saved,
      },
    });
  } catch (error) {
    await updateHeroSourcePosterState(ctx.env, {
      assetId,
      userId: source.user_id,
      status: "failed",
      retryable: true,
      errorCode: error?.code || "source_poster_processing_failed",
      message: sanitizeErrorMessage(error?.message || "Source poster could not be processed."),
      extra: {
        poster_processor: "external_ffmpeg",
        poster_failed_at: nowIso(),
      },
    });
    return json({
      ok: false,
      error: error?.message || "Source poster could not be processed.",
      code: error?.code || "source_poster_processing_failed",
    }, { status: error?.status || 500 });
  }
}

async function handleSourcePosterFail(ctx, assetIdFromPath) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const assetId = normalizeAssetId(assetIdFromPath);
  if (!assetId) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  const source = await getSourcePosterJobAsset(ctx.env, assetId);
  if (!source) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });

  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.homepageHeroProcessorJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const errorCode = sanitizeErrorCode(body.error_code || body.code || "source_poster_external_ffmpeg_failed");
  const errorMessage = sanitizeErrorMessage(body.error_message || body.message || "Source poster processor failed.");
  await updateHeroSourcePosterState(ctx.env, {
    assetId,
    userId: source.user_id,
    status: "failed",
    retryable: true,
    errorCode,
    message: errorMessage,
    extra: {
      poster_processor: "external_ffmpeg",
      poster_failed_at: nowIso(),
    },
  });
  return json({ ok: true, data: { source_asset_id: assetId, status: "failed" } });
}

async function handleProcessorComplete(ctx, derivativeIdFromPath) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const derivativeId = normalizeDerivativeJobId(derivativeIdFromPath);
  if (!derivativeId) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  const derivative = await getProcessorDerivativeById(ctx.env, derivativeId);
  if (!derivative) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  if (derivative.status === "succeeded") {
    return json({ ok: true, existing: true, data: { derivative: serializeDerivative(derivative) } });
  }
  if (!["queued", "processing", "failed"].includes(derivative.status)) {
    return json({ ok: false, error: "Job cannot be completed from its current state.", code: "job_not_completable" }, { status: 409 });
  }

  let formData;
  try {
    formData = await readFormDataLimited(ctx.request, { maxBytes: BODY_LIMITS.homepageHeroProcessorUpload });
  } catch (error) {
    if (isRequestBodyError(error)) return requestBodyErrorResponse(error);
    throw error;
  }

  const file = formData.get("file") || formData.get("video");
  const poster = formData.get("poster");
  if (!file || typeof file.arrayBuffer !== "function" || !poster || typeof poster.arrayBuffer !== "function") {
    return json({ ok: false, error: "Derivative file and poster are required.", code: "derivative_files_required" }, { status: 400 });
  }

  const fileMimeType = normalizeDerivativeVideoMimeType(file.type);
  const posterMimeType = normalizeDerivativePosterMimeType(poster.type);
  if (!fileMimeType || !posterMimeType) {
    return json({ ok: false, error: "Derivative outputs must be MP4 video and WebP poster files.", code: "unsupported_derivative_type" }, { status: 415 });
  }
  if (Number(file.size || 0) <= 0 || Number(file.size || 0) > 8 * 1024 * 1024) {
    return json({ ok: false, error: "Derivative video size is outside the allowed range.", code: "invalid_derivative_size" }, { status: 400 });
  }
  if (Number(poster.size || 0) <= 0 || Number(poster.size || 0) > 2 * 1024 * 1024) {
    return json({ ok: false, error: "Derivative poster size is outside the allowed range.", code: "invalid_poster_size" }, { status: 400 });
  }

  const version = buildHomepageHeroVersion(derivativeId);
  const fileKey = `homepage/hero-videos/${derivative.slot}/${version}/hero.mp4`;
  const posterKey = `homepage/hero-videos/${derivative.slot}/${version}/poster.webp`;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const posterBytes = new Uint8Array(await poster.arrayBuffer());

  await ctx.env.USER_IMAGES.put(fileKey, fileBytes, {
    httpMetadata: { contentType: "video/mp4", contentDisposition: "inline; filename=\"hero.mp4\"" },
  });
  await ctx.env.USER_IMAGES.put(posterKey, posterBytes, {
    httpMetadata: { contentType: "image/webp", contentDisposition: "inline; filename=\"poster.webp\"" },
  });

  const targetPreset = parseJson(derivative.target_preset_json) || TARGET_PRESET;
  const metadata = {
    provider: "external_ffmpeg",
    optimized: true,
    audio_removed: targetPreset.audio !== true,
    preset: targetPreset,
    processor_metadata: parseJson(formData.get("metadata_json")) || {},
    source_fingerprint: sanitizeShortText(formData.get("source_fingerprint"), derivative.source_fingerprint || ""),
  };
  const width = clampInteger(formData.get("width"), { fallback: null, min: 1, max: 4096 });
  const height = clampInteger(formData.get("height"), { fallback: null, min: 1, max: 4096 });
  const durationSeconds = clampNumber(formData.get("duration_seconds"), { fallback: targetPreset.targetDurationSeconds || 8, min: 0.1, max: targetPreset.maxDurationSeconds || 12 });
  const fps = clampNumber(formData.get("fps"), { fallback: targetPreset.fps || 24, min: 1, max: 60 });
  const now = nowIso();

  await ctx.env.DB.prepare(
    `UPDATE homepage_hero_video_derivatives
     SET status = 'succeeded',
         version = ?,
         file_r2_key = ?,
         poster_r2_key = ?,
         file_mime_type = 'video/mp4',
         poster_mime_type = 'image/webp',
         width = ?,
         height = ?,
         duration_seconds = ?,
         fps = ?,
         size_bytes = ?,
         poster_size_bytes = ?,
         source_fingerprint = COALESCE(?, source_fingerprint),
         provider_payload_json = ?,
         error_code = NULL,
         error_message = NULL,
         processing_completed_at = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND provider = 'external_ffmpeg'`
  ).bind(
    version,
    fileKey,
    posterKey,
    width,
    height,
    durationSeconds,
    fps,
    fileBytes.byteLength,
    posterBytes.byteLength,
    metadata.source_fingerprint || null,
    JSON.stringify(metadata),
    now,
    now,
    now,
    derivativeId
  ).run();

  if (derivative.source_type === "admin_asset" && derivative.source_asset_id && derivative.source_user_id) {
    const sourcePoster = await copyVideoPosterToAiTextAsset(ctx.env, {
      userId: derivative.source_user_id,
      assetId: derivative.source_asset_id,
      sourceKey: posterKey,
      contentType: "image/webp",
    });
    await updateHeroSourcePosterState(ctx.env, {
      assetId: derivative.source_asset_id,
      userId: derivative.source_user_id,
      status: sourcePoster?.r2Key ? "ready" : "failed",
      retryable: !sourcePoster?.r2Key,
      errorCode: sourcePoster?.r2Key ? null : "source_poster_copy_failed",
      message: sourcePoster?.r2Key
        ? null
        : "Optimized derivative completed, but the private source preview could not be copied. Retry poster generation from Homepage Hero Videos.",
    });
  }

  return json({
    ok: true,
    existing: false,
    data: {
      derivative: serializeDerivative(await getDerivativeById(ctx.env, derivativeId)),
    },
  });
}

async function handleProcessorFail(ctx, derivativeIdFromPath) {
  const authResponse = await processorAuthResponse(ctx);
  if (authResponse) return authResponse;

  const derivativeId = normalizeDerivativeJobId(derivativeIdFromPath);
  if (!derivativeId) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.homepageHeroProcessorJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const now = nowIso();
  await ctx.env.DB.prepare(
    `UPDATE homepage_hero_video_derivatives
     SET status = 'failed',
         error_code = ?,
         error_message = ?,
         processing_completed_at = ?,
         updated_at = ?
     WHERE id = ?
       AND provider = 'external_ffmpeg'
       AND status IN ('queued', 'processing', 'failed')`
  ).bind(
    sanitizeErrorCode(body.error_code || body.code),
    sanitizeErrorMessage(body.error_message || body.message),
    now,
    now,
    derivativeId
  ).run();

  return json({
    ok: true,
    data: {
      derivative: serializeDerivative(await getDerivativeById(ctx.env, derivativeId)),
    },
  });
}

async function listQueuedMemvidStreamPreviewJobs(env, limit, { repairDownloads = false } = {}) {
  const queuedRows = await env.DB.prepare(
    `SELECT previews.id,
            previews.asset_id,
            previews.user_id,
            previews.source_r2_key,
            previews.source_fingerprint,
            previews.stream_uid,
            previews.status,
            previews.preview_duration_seconds,
            previews.max_loop_count,
            previews.provider_metadata_json,
            assets.title,
            assets.mime_type,
            assets.size_bytes
     FROM memvid_stream_previews previews
     JOIN ai_text_assets assets ON assets.id = previews.asset_id
     WHERE previews.status = 'queued'
       AND assets.visibility = 'public'
       AND assets.source_module = 'video'
     ORDER BY previews.created_at ASC, previews.id ASC
     LIMIT ?`
  ).bind(limit).all();
  const queued = (queuedRows.results || []).map((row) => ({ ...row, repair_download: false }));
  if (!repairDownloads || queued.length >= limit) return queued;

  const repairLimit = limit - queued.length;
  const repairRows = await env.DB.prepare(
    `SELECT previews.id,
            previews.asset_id,
            previews.user_id,
            previews.source_r2_key,
            previews.source_fingerprint,
            previews.stream_uid,
            previews.status,
            previews.preview_duration_seconds,
            previews.max_loop_count,
            previews.provider_metadata_json,
            assets.title,
            assets.mime_type,
            assets.size_bytes
     FROM memvid_stream_previews previews
     JOIN ai_text_assets assets ON assets.id = previews.asset_id
     WHERE previews.status = 'ready'
       AND previews.stream_uid IS NOT NULL
       AND assets.visibility = 'public'
       AND assets.source_module = 'video'
     ORDER BY previews.completed_at DESC, previews.updated_at DESC
     LIMIT ?`
  ).bind(Math.max(repairLimit * 4, repairLimit)).all();
  const repairs = [];
  for (const row of repairRows.results || []) {
    if (hasReadyStreamDownloadMetadata(row.provider_metadata_json)) continue;
    repairs.push({ ...row, repair_download: true });
    if (repairs.length >= repairLimit) break;
  }
  return [...queued, ...repairs];
}

function serializeMemvidStreamPreviewJob(row) {
  return {
    id: row.id,
    asset_id: row.asset_id,
    type: row.repair_download ? "memvid_stream_download_repair" : "memvid_stream_preview",
    stream_uid: row.stream_uid || null,
    repair_download: row.repair_download === true,
    source: {
      url: `/api/internal/memvid-stream-previews/jobs/${encodeURIComponent(row.id)}/source`,
      mime_type: row.mime_type || "video/mp4",
      size_bytes: row.size_bytes ?? null,
      fingerprint: row.source_fingerprint || null,
    },
    preset: {
      provider: "cloudflare_stream",
      maxDurationSeconds: row.preview_duration_seconds ?? getMemvidStreamPreviewConfig({}).previewDurationSeconds,
      maxLoopCount: row.max_loop_count ?? getMemvidStreamPreviewConfig({}).maxLoopCount,
      shortPreviewOnly: true,
    },
    completion: {
      url: `/api/internal/memvid-stream-previews/jobs/${encodeURIComponent(row.id)}/complete`,
      failure_url: `/api/internal/memvid-stream-previews/jobs/${encodeURIComponent(row.id)}/fail`,
    },
  };
}

async function getMemvidStreamPreviewJob(env, jobId) {
  return env.DB.prepare(
    `SELECT previews.id,
            previews.asset_id,
            previews.user_id,
            previews.source_r2_key,
            previews.source_fingerprint,
            previews.stream_uid,
            previews.status,
            previews.preview_duration_seconds,
            previews.max_loop_count,
            previews.provider_metadata_json,
            assets.visibility,
            assets.source_module,
            assets.mime_type,
            assets.size_bytes
     FROM memvid_stream_previews previews
     JOIN ai_text_assets assets ON assets.id = previews.asset_id
     WHERE previews.id = ?
     LIMIT 1`
  ).bind(jobId).first();
}

async function handleMemvidStreamPreviewClaimJobs(ctx) {
  const authResponse = await memvidStreamProcessorAuthResponse(ctx);
  if (authResponse) return authResponse;
  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.homepageHeroProcessorJson,
    requiredContentType: false,
  });
  if (parsed.response) return parsed.response;
  const limit = clampInteger(parsed.body?.limit, { fallback: 1, min: 1, max: 8 });
  const repairDownloads = parsed.body?.repair_downloads === true
    || parsed.body?.repairDownloads === true
    || String(parsed.body?.repair_downloads || "").toLowerCase() === "true";
  const rows = await listSharedQueuedMemvidStreamPreviewJobs(ctx.env, limit, { repairDownloads });
  const now = nowIso();
  for (const row of rows) {
    if (row.repair_download) continue;
    await ctx.env.DB.prepare(
      `UPDATE memvid_stream_previews
       SET status = 'processing',
           updated_at = ?
       WHERE id = ?
         AND status = 'queued'`
    ).bind(now, row.id).run();
    row.status = "processing";
  }
  return json({ ok: true, data: { jobs: rows.map(serializeSharedMemvidStreamPreviewJob) } }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleMemvidStreamPreviewSource(ctx, jobIdFromPath) {
  const authResponse = await memvidStreamProcessorAuthResponse(ctx);
  if (authResponse) return authResponse;
  const jobId = String(jobIdFromPath || "").trim();
  if (!/^msp_[A-Fa-f0-9]{16,64}$/.test(jobId)) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });
  const job = await getMemvidStreamPreviewJob(ctx.env, jobId);
  if (!job?.source_r2_key || job.visibility !== "public" || job.source_module !== "video" || !["queued", "processing"].includes(job.status)) {
    return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });
  }
  const object = await ctx.env.USER_IMAGES.get(job.source_r2_key);
  if (!object) return json({ ok: false, error: "Source not found.", code: "source_not_found" }, { status: 404 });
  const headers = buildPublicMediaHeaders(job.mime_type || object.httpMetadata?.contentType || "video/mp4", object.size);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", "attachment; filename=\"memvid-source.mp4\"");
  return new Response(object.body, { headers });
}

async function handleMemvidStreamPreviewComplete(ctx, jobIdFromPath) {
  const authResponse = await memvidStreamProcessorAuthResponse(ctx);
  if (authResponse) return authResponse;
  const jobId = String(jobIdFromPath || "").trim();
  if (!/^msp_[A-Fa-f0-9]{16,64}$/.test(jobId)) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.homepageHeroProcessorJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const streamUid = normalizeStreamUid(body.stream_uid || body.streamUid);
  if (!streamUid) return json({ ok: false, error: "Valid Stream UID is required.", code: "invalid_stream_uid" }, { status: 400 });
  const providerMetadata = body.provider_metadata || body.providerMetadata || {};
  const downloadUrl = getStreamDownloadUrlFromProviderMetadata(providerMetadata);
  const downloadStatus = String(
    providerMetadata.cloudflare_stream_download_status
      || providerMetadata.download_status
      || providerMetadata.download?.status
      || ""
  ).toLowerCase();
  if (downloadStatus !== "ready" || !isSafeCloudflareStreamPlaybackUrl(downloadUrl)) {
    return json({
      ok: false,
      error: "Cloudflare Stream MP4 download must be ready before marking a Memvid preview ready.",
      code: "stream_download_url_required",
    }, { status: 400 });
  }
  const config = getMemvidStreamPreviewConfig(ctx.env);
  const duration = clampNumber(body.preview_duration_seconds || body.duration_seconds, {
    fallback: config.previewDurationSeconds,
    min: 1,
    max: config.previewDurationSeconds,
  });
  const maxLoops = clampInteger(body.max_loop_count || body.maxLoopCount, {
    fallback: config.maxLoopCount,
    min: 1,
    max: config.maxLoopCount,
  });
  const now = nowIso();
  await ctx.env.DB.prepare(
    `UPDATE memvid_stream_previews
     SET status = 'ready',
         stream_uid = ?,
         preview_duration_seconds = ?,
         max_loop_count = ?,
         completed_at = ?,
         updated_at = ?,
         error_code = NULL,
         error_message = NULL,
         provider_metadata_json = ?
     WHERE id = ?
       AND status IN ('queued', 'uploading', 'processing', 'ready')`
  ).bind(
    streamUid,
    duration,
    maxLoops,
    now,
    now,
    JSON.stringify({
      provider: "cloudflare_stream",
      provider_metadata: {
        ...providerMetadata,
        download_status: "ready",
        download_url: downloadUrl,
        cloudflare_stream_download_status: "ready",
        cloudflare_stream_download_url: downloadUrl,
        cloudflare_stream_download_percent_complete: providerMetadata.cloudflare_stream_download_percent_complete
          ?? providerMetadata.download_percent_complete
          ?? providerMetadata.download?.percent_complete
          ?? null,
        cloudflare_stream_download_checked_at: providerMetadata.cloudflare_stream_download_checked_at || now,
      },
      source_fingerprint: sanitizeShortText(body.source_fingerprint, ""),
    }),
    jobId
  ).run();
  return json({ ok: true, data: { id: jobId, status: "ready", stream_uid: streamUid } });
}

async function handleMemvidStreamPreviewFail(ctx, jobIdFromPath) {
  const authResponse = await memvidStreamProcessorAuthResponse(ctx);
  if (authResponse) return authResponse;
  const jobId = String(jobIdFromPath || "").trim();
  if (!/^msp_[A-Fa-f0-9]{16,64}$/.test(jobId)) return json({ ok: false, error: "Job not found.", code: "job_not_found" }, { status: 404 });
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.homepageHeroProcessorJson });
  if (parsed.response) return parsed.response;
  const now = nowIso();
  const existing = await getMemvidStreamPreviewJob(ctx.env, jobId);
  if (existing?.status === "ready") {
    const metadata = parseStreamProviderMetadata(existing.provider_metadata_json);
    const providerMetadata = metadata.provider_metadata && typeof metadata.provider_metadata === "object"
      ? metadata.provider_metadata
      : {};
    await ctx.env.DB.prepare(
      `UPDATE memvid_stream_previews
       SET provider_metadata_json = ?,
           updated_at = ?
       WHERE id = ?
         AND status = 'ready'`
    ).bind(
      JSON.stringify({
        ...metadata,
        provider: "cloudflare_stream",
        provider_metadata: {
          ...providerMetadata,
          download_repair_status: "failed",
          download_repair_error_code: sanitizeErrorCode(parsed.body?.error_code || parsed.body?.code),
          download_repair_error_message: sanitizeErrorMessage(parsed.body?.error_message || parsed.body?.message),
          download_repair_failed_at: now,
        },
      }),
      now,
      jobId
    ).run();
    return json({ ok: true, data: { id: jobId, status: "ready", download_repair_status: "failed" } });
  }
  await ctx.env.DB.prepare(
    `UPDATE memvid_stream_previews
     SET status = 'failed',
         error_code = ?,
         error_message = ?,
         updated_at = ?
     WHERE id = ?
       AND status IN ('queued', 'uploading', 'processing', 'failed')`
  ).bind(
    sanitizeErrorCode(parsed.body?.error_code || parsed.body?.code),
    sanitizeErrorMessage(parsed.body?.error_message || parsed.body?.message),
    now,
    jobId
  ).run();
  return json({ ok: true, data: { id: jobId, status: "failed" } });
}

async function handlePublicHeroVideos(ctx) {
  const { env } = ctx;
  try {
    const rows = await listPublicHeroRows(env);
    const slots = rows.filter((row) => HERO_VIDEO_SLOT_SET.has(row.slot));
    const complete = HERO_VIDEO_SLOTS.every((slot) => slots.some((row) => row.slot === slot));
    if (slots.length !== HERO_VIDEO_SLOTS.length || !complete) {
      return json({
        ok: true,
        data: {
          configured: false,
          slots: [],
          slot_order: HERO_VIDEO_SLOTS,
        },
      });
    }
    return json({
      ok: true,
      data: {
        configured: true,
        slots: HERO_VIDEO_SLOTS.map((slot) => toPublicSlot(slots.find((row) => row.slot === slot))),
        slot_order: HERO_VIDEO_SLOTS,
      },
    });
  } catch (error) {
    if (isMissingHomepageHeroTableError(error)) {
      return json({
        ok: true,
        data: {
          configured: false,
          slots: [],
          slot_order: HERO_VIDEO_SLOTS,
        },
      });
    }
    throw error;
  }
}

async function handlePublicHeroMedia(ctx, slot, version, kind) {
  const normalizedSlot = normalizeSlot(slot);
  if (!normalizedSlot || !version) {
    return json({ ok: false, error: "Hero video not found." }, { status: 404 });
  }
  try {
    const row = await getPublicHeroMediaRow(ctx.env, normalizedSlot, version);
    const key = kind === "poster" ? row?.poster_r2_key : row?.file_r2_key;
    if (!key) {
      return json({ ok: false, error: "Hero video not found." }, { status: 404 });
    }
    const object = await ctx.env.USER_IMAGES.get(key);
    if (!object) {
      return json({ ok: false, error: "Hero video not found." }, { status: 404 });
    }
    return new Response(object.body, {
      headers: buildPublicMediaHeaders(
        kind === "poster"
          ? (row.poster_mime_type || object.httpMetadata?.contentType || "image/webp")
          : (row.file_mime_type || object.httpMetadata?.contentType || "video/mp4"),
        object.size,
        { immutable: true }
      ),
    });
  } catch (error) {
    if (isMissingHomepageHeroTableError(error)) {
      return json({ ok: false, error: "Hero video not found." }, { status: 404 });
    }
    throw error;
  }
}

export async function handleAdminHomepageHeroVideos(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/admin/homepage/hero-videos" && method === "GET") {
    return handleAdminCurrent(ctx);
  }

  if (pathname === "/api/admin/homepage/hero-videos/feature-status" && method === "GET") {
    return handleAdminFeatureStatus(ctx);
  }

  const featureStatusMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/feature-status\/([^/]+)$/);
  // route-policy: admin.homepage.hero-videos.feature-status.update
  if (featureStatusMatch && method === "PATCH") {
    return handleAdminUpdateFeatureSwitch(ctx, featureStatusMatch[1]);
  }

  // route-policy: admin.homepage.hero-videos.preset.update
  if (pathname === "/api/admin/homepage/hero-videos/preset" && method === "PATCH") {
    return handleAdminUpdateHeroPreset(ctx);
  }

  if (pathname === "/api/admin/homepage/hero-videos/candidates" && method === "GET") {
    return handleAdminCandidates(ctx);
  }

  // route-policy: admin.homepage.hero-videos.uploads.create
  if (pathname === "/api/admin/homepage/hero-videos/uploads" && method === "POST") {
    return handleAdminUploadSource(ctx);
  }

  const uploadPosterMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/uploads\/([^/]+)\/poster$/);
  // route-policy: admin.homepage.hero-videos.uploads.poster
  if (uploadPosterMatch && method === "POST") {
    return handleAdminAttachUploadPoster(ctx, uploadPosterMatch[1]);
  }

  const uploadPosterRetryMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/uploads\/([^/]+)\/poster\/retry$/);
  // route-policy: admin.homepage.hero-videos.uploads.poster.retry
  if (uploadPosterRetryMatch && method === "POST") {
    return handleAdminRetryUploadPoster(ctx, uploadPosterRetryMatch[1]);
  }

  // route-policy: admin.homepage.hero-videos.memvid-stream-previews.backfill
  if (pathname === "/api/admin/homepage/hero-videos/memvid-stream-previews/backfill" && method === "POST") {
    return handleAdminMemvidStreamPreviewBackfill(ctx);
  }

  // route-policy: admin.homepage.hero-videos.memvid-stream-previews.run
  if (pathname === "/api/admin/homepage/hero-videos/memvid-stream-previews/run" && method === "POST") {
    return handleAdminMemvidStreamPreviewRun(ctx);
  }

  // route-policy: admin.homepage.hero-videos.derivatives.list
  if (pathname === "/api/admin/homepage/hero-videos/derivatives" && method === "GET") {
    return handleAdminListDerivatives(ctx);
  }

  // route-policy: admin.homepage.hero-videos.derivatives.create
  if (pathname === "/api/admin/homepage/hero-videos/derivatives" && method === "POST") {
    return handleCreateDerivative(ctx);
  }

  const derivativeDetailMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/derivatives\/([^/]+)$/);
  // route-policy: admin.homepage.hero-videos.derivatives.detail
  if (derivativeDetailMatch && method === "GET") {
    return handleAdminDerivativeDetail(ctx, derivativeDetailMatch[1]);
  }

  const retryMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/derivatives\/([^/]+)\/retry$/);
  // route-policy: admin.homepage.hero-videos.derivatives.retry
  if (retryMatch && method === "POST") {
    return handleRetryDerivative(ctx, retryMatch[1]);
  }

  const slotMatch = pathname.match(/^\/api\/admin\/homepage\/hero-videos\/slots\/([^/]+)$/);
  // route-policy: admin.homepage.hero-videos.slots.update
  if (slotMatch && method === "PUT") {
    return handleUpdateSlot(ctx, slotMatch[1]);
  }

  return null;
}

export async function handleHomepageHeroVideos(ctx) {
  const { pathname, method } = ctx;

  // route-policy: internal.memvid-stream-previews.jobs.claim
  if (pathname === "/api/internal/memvid-stream-previews/jobs/claim" && method === "POST") {
    return handleMemvidStreamPreviewClaimJobs(ctx);
  }

  const streamPreviewSourceMatch = pathname.match(/^\/api\/internal\/memvid-stream-previews\/jobs\/([^/]+)\/source$/);
  if (streamPreviewSourceMatch && method === "GET") {
    return handleMemvidStreamPreviewSource(ctx, streamPreviewSourceMatch[1]);
  }

  const streamPreviewCompleteMatch = pathname.match(/^\/api\/internal\/memvid-stream-previews\/jobs\/([^/]+)\/complete$/);
  // route-policy: internal.memvid-stream-previews.jobs.complete
  if (streamPreviewCompleteMatch && method === "POST") {
    return handleMemvidStreamPreviewComplete(ctx, streamPreviewCompleteMatch[1]);
  }

  const streamPreviewFailMatch = pathname.match(/^\/api\/internal\/memvid-stream-previews\/jobs\/([^/]+)\/fail$/);
  // route-policy: internal.memvid-stream-previews.jobs.fail
  if (streamPreviewFailMatch && method === "POST") {
    return handleMemvidStreamPreviewFail(ctx, streamPreviewFailMatch[1]);
  }

  // route-policy: internal.homepage.hero-videos.jobs.claim
  if (pathname === "/api/internal/homepage/hero-videos/jobs/claim" && method === "POST") {
    return handleProcessorClaimJobs(ctx);
  }

  // route-policy: internal.homepage.hero-videos.source-posters.jobs.claim
  if (pathname === "/api/internal/homepage/hero-videos/source-posters/jobs/claim" && method === "POST") {
    return handleSourcePosterClaimJobs(ctx);
  }

  const sourcePosterSourceMatch = pathname.match(/^\/api\/internal\/homepage\/hero-videos\/source-posters\/jobs\/([^/]+)\/source$/);
  if (sourcePosterSourceMatch && method === "GET") {
    return handleSourcePosterSource(ctx, sourcePosterSourceMatch[1]);
  }

  const sourcePosterCompleteMatch = pathname.match(/^\/api\/internal\/homepage\/hero-videos\/source-posters\/jobs\/([^/]+)\/complete$/);
  // route-policy: internal.homepage.hero-videos.source-posters.jobs.complete
  if (sourcePosterCompleteMatch && method === "POST") {
    return handleSourcePosterComplete(ctx, sourcePosterCompleteMatch[1]);
  }

  const sourcePosterFailMatch = pathname.match(/^\/api\/internal\/homepage\/hero-videos\/source-posters\/jobs\/([^/]+)\/fail$/);
  // route-policy: internal.homepage.hero-videos.source-posters.jobs.fail
  if (sourcePosterFailMatch && method === "POST") {
    return handleSourcePosterFail(ctx, sourcePosterFailMatch[1]);
  }

  const processorSourceMatch = pathname.match(/^\/api\/internal\/homepage\/hero-videos\/jobs\/([^/]+)\/source$/);
  if (processorSourceMatch && method === "GET") {
    return handleProcessorSource(ctx, processorSourceMatch[1]);
  }

  const processorCompleteMatch = pathname.match(/^\/api\/internal\/homepage\/hero-videos\/jobs\/([^/]+)\/complete$/);
  // route-policy: internal.homepage.hero-videos.jobs.complete
  if (processorCompleteMatch && method === "POST") {
    return handleProcessorComplete(ctx, processorCompleteMatch[1]);
  }

  const processorFailMatch = pathname.match(/^\/api\/internal\/homepage\/hero-videos\/jobs\/([^/]+)\/fail$/);
  // route-policy: internal.homepage.hero-videos.jobs.fail
  if (processorFailMatch && method === "POST") {
    return handleProcessorFail(ctx, processorFailMatch[1]);
  }

  if (pathname === "/api/homepage/hero-videos" && method === "GET") {
    return handlePublicHeroVideos(ctx);
  }

  const mediaMatch = pathname.match(/^\/api\/homepage\/hero-videos\/([^/]+)\/([^/]+)\/(file|poster)$/);
  if (mediaMatch && method === "GET") {
    return handlePublicHeroMedia(ctx, mediaMatch[1], mediaMatch[2], mediaMatch[3]);
  }

  return null;
}
