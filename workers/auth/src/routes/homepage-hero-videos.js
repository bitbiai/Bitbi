import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { buildPublicMediaHeaders } from "../lib/public-media.js";
import { requireAdmin } from "../lib/session.js";
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

const HERO_VIDEO_SLOTS = Object.freeze(["right_top", "right_bottom", "left_top", "left_bottom"]);
const HERO_VIDEO_SLOT_SET = new Set(HERO_VIDEO_SLOTS);
const DEFAULT_CANDIDATE_LIMIT = 24;
const MAX_CANDIDATE_LIMIT = 60;
const MIN_OPERATOR_REASON_LENGTH = 8;
const MAX_OPERATOR_REASON_LENGTH = 500;
const HERO_DERIVATIVE_VERSION = "v1";
const TARGET_PRESET = Object.freeze({
  container: "mp4",
  videoCodec: "h264",
  audio: "removed",
  maxWidth: 720,
  fps: "24/30",
  maxDurationSeconds: 8,
  targetDurationSeconds: 6,
  faststart: true,
  idealSizeBytes: [1_000_000, 3_000_000],
});

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

function normalizeCandidateLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CANDIDATE_LIMIT;
  return Math.max(1, Math.min(MAX_CANDIDATE_LIMIT, parsed));
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
    target_preset: parseJson(row.target_preset_json) || TARGET_PRESET,
    error_message: row.error_message || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
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
      target_preset_json: row.derivative_target_preset_json,
      error_message: row.derivative_error_message,
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
    poster_url: null,
    poster_width: row.poster_width ?? null,
    poster_height: row.poster_height ?? null,
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
            derivatives.target_preset_json AS derivative_target_preset_json,
            derivatives.error_message AS derivative_error_message,
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
            original_size_bytes, original_mime_type, target_preset_json,
            error_message, created_at, updated_at, completed_at
     FROM homepage_hero_video_derivatives
     WHERE id = ?`
  ).bind(derivativeId).first();
}

async function getDerivativeByIdempotency(env, idempotencyKeyHash) {
  return env.DB.prepare(
    `SELECT id, slot, source_type, source_asset_id, source_user_id, source_title,
            provider, status, version, file_mime_type, poster_mime_type, width,
            height, duration_seconds, fps, size_bytes, poster_size_bytes,
            original_size_bytes, original_mime_type, target_preset_json,
            error_message, request_hash, created_at, updated_at, completed_at
     FROM homepage_hero_video_derivatives
     WHERE idempotency_key_hash = ?
     LIMIT 1`
  ).bind(idempotencyKeyHash).first();
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
      `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json,
              created_at, published_at, poster_r2_key, poster_width, poster_height
       FROM ai_text_assets
       WHERE id = ?
         AND source_module = 'video'
         AND visibility = 'public'
       LIMIT 1`
    ).bind(assetId).first();
  }

  return env.DB.prepare(
    `SELECT id, user_id, title, file_name, mime_type, size_bytes, metadata_json,
            created_at, published_at, poster_r2_key, poster_width, poster_height
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
            created_at, published_at, r2_key, poster_r2_key, poster_width, poster_height
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
            created_at, published_at, poster_r2_key, poster_width, poster_height
     FROM ai_text_assets
     WHERE user_id = ?
       AND source_module = 'video'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(adminUserId, limit).all();
  return (rows.results || []).map((row) => toAdminAssetCandidate(row, adminUserId));
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
}) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO homepage_hero_video_derivatives (
       id, slot, source_type, source_asset_id, source_user_id, source_title,
       provider, status, original_size_bytes, original_mime_type,
       target_preset_json, provider_payload_json, idempotency_key_hash,
       request_hash, created_by_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    derivativeId,
    slot,
    sourceType,
    source.id,
    source.user_id || null,
    source.title || source.file_name || null,
    provider,
    status,
    Number(source.size_bytes || 0) || null,
    source.mime_type || "video/mp4",
    JSON.stringify(TARGET_PRESET),
    JSON.stringify(providerPayload || {}),
    idempotencyKeyHash,
    requestHash,
    adminUserId,
    now,
    now
  ).run();
}

async function markMockDerivativeSucceeded(env, derivativeId, slot) {
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
      preset: TARGET_PRESET,
    }),
    now,
    now,
    derivativeId
  ).run();
}

function conversionProviderPayload(provider) {
  if (provider === "mock") {
    return { provider, mode: "test-only", optimized: true, audio_removed: true };
  }
  if (provider === "cloudflare_stream") {
    return { provider, mode: "adapter-placeholder", requiresOperatorProvisioning: true };
  }
  return {
    provider: "external_ffmpeg",
    mode: "adapter-placeholder",
    preset: TARGET_PRESET,
    expectedOutput: "mp4/h264/no-audio",
  };
}

async function handleAdminCurrent(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) return result;

  try {
    const slots = await listAdminSlots(env);
    return json({
      ok: true,
      data: {
        slots,
        slot_order: HERO_VIDEO_SLOTS,
        target_preset: TARGET_PRESET,
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

  const requestHash = await sha256Hex(stableJson({
    route: "/api/admin/homepage/hero-videos/derivatives",
    slot,
    sourceType,
    sourceAssetId,
    provider,
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

    const derivativeId = `hhvd_${randomTokenHex(16)}`;
    const providerPayload = conversionProviderPayload(provider);
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
    });

    if (provider === "mock") {
      await markMockDerivativeSucceeded(env, derivativeId, slot);
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

  if (pathname === "/api/admin/homepage/hero-videos/candidates" && method === "GET") {
    return handleAdminCandidates(ctx);
  }

  // route-policy: admin.homepage.hero-videos.derivatives.create
  if (pathname === "/api/admin/homepage/hero-videos/derivatives" && method === "POST") {
    return handleCreateDerivative(ctx);
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

  if (pathname === "/api/homepage/hero-videos" && method === "GET") {
    return handlePublicHeroVideos(ctx);
  }

  const mediaMatch = pathname.match(/^\/api\/homepage\/hero-videos\/([^/]+)\/([^/]+)\/(file|poster)$/);
  if (mediaMatch && method === "GET") {
    return handlePublicHeroMedia(ctx, mediaMatch[1], mediaMatch[2], mediaMatch[3]);
  }

  return null;
}
