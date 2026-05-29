import {
  getMemvidStreamPreviewConfig,
  hasReadyStreamDownloadMetadata,
  parseStreamProviderMetadata,
  summarizeMemvidStreamPreviews,
} from "./cloudflare-stream-previews.js";
import { VIDEO_DELIVERY_FEATURE_KEYS, getVideoDeliveryFeature } from "./video-delivery-settings.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const ACTIVE_PREVIEW_STATUSES = Object.freeze(["queued", "uploading", "processing", "ready"]);
const DEFAULT_MISSING_LIMIT = 10;
const DEFAULT_REPAIR_LIMIT = 50;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clampLimit(value, { fallback, min = 1, max = 200 } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isMissingStreamPreviewTable(error) {
  return String(error?.message || error).includes("no such table")
    && String(error?.message || error).includes("memvid_stream_preview");
}

function isEligibleVideoAsset(asset) {
  return Boolean(
    asset
      && asset.id
      && asset.user_id
      && asset.r2_key
      && asset.visibility === "public"
      && asset.source_module === "video"
  );
}

export async function getMemvidStreamPreviewSummary(env) {
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
    if (isMissingStreamPreviewTable(error)) return summarizeMemvidStreamPreviews([], [], env);
    throw error;
  }
}

export async function buildMemvidPreviewFingerprint(env, asset) {
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

async function getStreamPreviewFeature(env) {
  try {
    return await getVideoDeliveryFeature(env, VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS);
  } catch (error) {
    if (String(error?.message || error).includes("no such table")) {
      return { effective_enabled: false };
    }
    throw error;
  }
}

async function listActivePreviewRowsForAsset(env, assetId, userId) {
  const rows = await env.DB.prepare(
    `SELECT id,
            source_fingerprint,
            status,
            stream_uid,
            provider_metadata_json
     FROM memvid_stream_previews
     WHERE asset_id = ?
       AND user_id = ?
       AND status IN ('queued', 'uploading', 'processing', 'ready')
     ORDER BY updated_at DESC, created_at DESC`
  ).bind(assetId, userId).all();
  return rows.results || [];
}

async function supersedeStaleActivePreviews(env, rows, fingerprint, source = "publish") {
  const now = nowIso();
  for (const row of rows) {
    if (row.source_fingerprint === fingerprint) continue;
    const metadata = parseStreamProviderMetadata(row.provider_metadata_json);
    const providerMetadata = metadata.provider_metadata && typeof metadata.provider_metadata === "object"
      ? metadata.provider_metadata
      : {};
    await env.DB.prepare(
      `UPDATE memvid_stream_previews
       SET status = 'superseded',
           updated_at = ?,
           provider_metadata_json = ?
       WHERE id = ?
         AND status IN ('queued', 'uploading', 'processing', 'ready')`
    ).bind(
      now,
      JSON.stringify({
        ...metadata,
        provider: "cloudflare_stream",
        provider_metadata: {
          ...providerMetadata,
          superseded_at: now,
          superseded_source: source,
          superseded_reason: "source_fingerprint_changed",
        },
      }),
      row.id
    ).run();
  }
}

async function insertPreviewJob(env, asset, {
  fingerprint,
  operatorReason = "",
  source = "unknown",
} = {}) {
  const config = getMemvidStreamPreviewConfig(env);
  const now = nowIso();
  const id = `msp_${randomTokenHex(16)}`;
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
      source,
      operator_reason_present: Boolean(operatorReason),
      queued_at: now,
    })
  ).run();
  return { id, asset_id: asset.id, status: "queued" };
}

export async function queueMemvidStreamPreviewForPublishedAsset(env, asset, options = {}) {
  if (!isEligibleVideoAsset(asset)) {
    return {
      queued_count: 0,
      skipped: true,
      skipped_reason: "asset_not_eligible",
      queued: [],
    };
  }
  const feature = await getStreamPreviewFeature(env);
  if (!feature?.effective_enabled) {
    return {
      queued_count: 0,
      skipped: true,
      skipped_reason: "stream_previews_disabled",
      queued: [],
    };
  }
  const fingerprint = await buildMemvidPreviewFingerprint(env, asset);
  const activeRows = await listActivePreviewRowsForAsset(env, asset.id, asset.user_id);
  const sameActive = activeRows.find((row) => row.source_fingerprint === fingerprint);
  if (sameActive) {
    return {
      queued_count: 0,
      existing_count: 1,
      existing_id: sameActive.id,
      skipped: true,
      skipped_reason: "active_preview_exists",
      queued: [],
    };
  }
  await supersedeStaleActivePreviews(env, activeRows, fingerprint, options.source || "publish");
  const queued = await insertPreviewJob(env, asset, {
    fingerprint,
    operatorReason: options.operatorReason,
    source: options.source || "publish",
  });
  return {
    queued_count: 1,
    existing_count: 0,
    skipped: false,
    queued: [queued],
  };
}

export async function listMemvidsNeedingStreamPreview(env, limit = DEFAULT_MISSING_LIMIT) {
  const rows = await env.DB.prepare(
    `SELECT assets.id,
            assets.user_id,
            assets.r2_key,
            assets.mime_type,
            assets.size_bytes,
            assets.title,
            assets.source_module,
            assets.visibility,
            assets.created_at,
            assets.published_at
     FROM ai_text_assets assets
     LEFT JOIN memvid_stream_previews active
       ON active.asset_id = assets.id
      AND active.status IN ('queued', 'uploading', 'processing', 'ready')
     WHERE assets.visibility = 'public'
       AND assets.source_module = 'video'
       AND assets.r2_key IS NOT NULL
       AND active.id IS NULL
     ORDER BY COALESCE(assets.published_at, assets.created_at) DESC, assets.created_at DESC, assets.id DESC
     LIMIT ?`
  ).bind(clampLimit(limit, { fallback: DEFAULT_MISSING_LIMIT, max: 200 })).all();
  return rows.results || [];
}

export async function queueMissingMemvidStreamPreviewJobs(env, {
  limit = DEFAULT_MISSING_LIMIT,
  operatorReason = "",
  source = "admin_manual",
} = {}) {
  const feature = await getStreamPreviewFeature(env);
  if (!feature?.effective_enabled) {
    return {
      queued: [],
      queued_count: 0,
      skipped: true,
      skipped_reason: "stream_previews_disabled",
    };
  }
  const rows = await listMemvidsNeedingStreamPreview(env, limit);
  const queued = [];
  for (const asset of rows) {
    const result = await queueMemvidStreamPreviewForPublishedAsset(env, asset, {
      operatorReason,
      source,
    });
    queued.push(...(result.queued || []));
  }
  return {
    queued,
    queued_count: queued.length,
    scanned_count: rows.length,
  };
}

export async function listRepairableMemvidStreamPreviewDownloads(env, limit = DEFAULT_REPAIR_LIMIT) {
  const rows = await env.DB.prepare(
    `SELECT id,
            stream_uid,
            provider_metadata_json
     FROM memvid_stream_previews
     WHERE status = 'ready'
       AND stream_uid IS NOT NULL
     ORDER BY completed_at DESC, updated_at DESC
     LIMIT ?`
  ).bind(clampLimit(limit, { fallback: DEFAULT_REPAIR_LIMIT, max: 500 })).all();
  return (rows.results || [])
    .filter((row) => !hasReadyStreamDownloadMetadata(row.provider_metadata_json));
}

export async function markMemvidStreamPreviewDownloadRepairsRequested(env, rows = [], {
  source = "admin_manual",
} = {}) {
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
          download_repair_source: source,
        },
      }),
      now,
      row.id
    ).run();
  }
}

export async function queueMemvidStreamPreviewRepairJobs(env, {
  limit = DEFAULT_REPAIR_LIMIT,
  source = "admin_manual",
} = {}) {
  const rows = await listRepairableMemvidStreamPreviewDownloads(env, limit);
  await markMemvidStreamPreviewDownloadRepairsRequested(env, rows, { source });
  return {
    queued: rows.map((row) => ({ id: row.id, stream_uid: row.stream_uid, status: "ready", repair_download: true })),
    queued_count: rows.length,
  };
}

export async function getMemvidStreamPreviewBacklogCounts(env, {
  repairLimit = 200,
} = {}) {
  const queuedRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM memvid_stream_previews previews
     JOIN ai_text_assets assets ON assets.id = previews.asset_id
     WHERE previews.status = 'queued'
       AND assets.visibility = 'public'
       AND assets.source_module = 'video'`
  ).first();
  const repairs = await listRepairableMemvidStreamPreviewDownloads(env, repairLimit);
  return {
    queued_count: Number(queuedRow?.count || 0),
    repair_count: repairs.length,
    total_count: Number(queuedRow?.count || 0) + repairs.length,
  };
}

export async function listQueuedMemvidStreamPreviewJobs(env, limit, { repairDownloads = false } = {}) {
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
  ).bind(clampLimit(limit, { fallback: 1, max: 8 })).all();
  const queued = (queuedRows.results || []).map((row) => ({ ...row, repair_download: false }));
  if (!repairDownloads || queued.length >= limit) return queued;

  const repairLimit = Math.max(0, limit - queued.length);
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

export function serializeMemvidStreamPreviewJob(row) {
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
