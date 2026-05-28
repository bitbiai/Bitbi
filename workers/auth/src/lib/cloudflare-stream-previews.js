import {
  VIDEO_DELIVERY_FEATURE_KEYS,
  getVideoDeliveryFeatureStatus,
  parseVideoFeatureFlag,
} from "./video-delivery-settings.js";

const DEFAULT_PREVIEW_DURATION_SECONDS = 5;
const DEFAULT_PREVIEW_MAX_LOOPS = 3;
const MAX_PREVIEW_DURATION_SECONDS = 8;
const MAX_PREVIEW_MAX_LOOPS = 3;

function clampNumber(value, { fallback, min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function isMemvidStreamPreviewMetadataEnabled(env) {
  return parseVideoFeatureFlag(env?.ENABLE_MEMVID_STREAM_PREVIEWS, true);
}

export function isMemvidStreamPreviewAutoplayEnabled(env) {
  return parseVideoFeatureFlag(env?.ENABLE_MEMVID_STREAM_PREVIEW_AUTOPLAY, true);
}

export function getMemvidStreamPreviewConfig(env) {
  return {
    enabled: isMemvidStreamPreviewMetadataEnabled(env),
    autoplayEnabled: isMemvidStreamPreviewAutoplayEnabled(env),
    providerConfigured: Boolean(
      (env?.CLOUDFLARE_ACCOUNT_ID || env?.STREAM_ACCOUNT_ID)
      && (env?.CLOUDFLARE_STREAM_API_TOKEN || env?.STREAM_API_TOKEN)
    ),
    previewDurationSeconds: clampNumber(
      env?.MEMVID_STREAM_PREVIEW_MAX_DURATION_SECONDS,
      {
        fallback: DEFAULT_PREVIEW_DURATION_SECONDS,
        min: 1,
        max: MAX_PREVIEW_DURATION_SECONDS,
      }
    ),
    maxLoopCount: clampNumber(
      env?.MEMVID_STREAM_PREVIEW_MAX_LOOPS,
      {
        fallback: DEFAULT_PREVIEW_MAX_LOOPS,
        min: 1,
        max: MAX_PREVIEW_MAX_LOOPS,
      }
    ),
  };
}

export async function getEffectiveMemvidStreamPreviewConfig(env) {
  const [config, status] = await Promise.all([
    Promise.resolve(getMemvidStreamPreviewConfig(env)),
    getVideoDeliveryFeatureStatus(env),
  ]);
  const metadata = status.features[VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS];
  const autoplay = status.features[VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEW_AUTOPLAY];
  return {
    ...config,
    enabled: metadata?.effective_enabled === true,
    autoplayEnabled: autoplay?.effective_enabled === true && metadata?.effective_enabled === true,
    providerConfigured: metadata?.provider_configured === true,
    featureStatus: status,
  };
}

export function normalizeStreamUid(value) {
  const uid = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) return null;
  return uid;
}

export function buildCloudflareStreamPlayback(streamUid) {
  const uid = normalizeStreamUid(streamUid);
  if (!uid) return null;
  const encoded = encodeURIComponent(uid);
  return {
    iframe_url: `https://iframe.videodelivery.net/${encoded}`,
    mp4_url: `https://videodelivery.net/${encoded}/downloads/default.mp4`,
    hls_url: `https://videodelivery.net/${encoded}/manifest/video.m3u8`,
    dash_url: `https://videodelivery.net/${encoded}/manifest/video.mpd`,
    thumbnail_url: `https://videodelivery.net/${encoded}/thumbnails/thumbnail.jpg?time=1s`,
  };
}

export function toPublicStreamPreview(row, env, effectiveConfig = null) {
  const config = effectiveConfig || getMemvidStreamPreviewConfig(env);
  if (!row || !config.enabled) return null;
  const uid = normalizeStreamUid(row.stream_uid);
  if (!uid || row.status !== "ready") return null;
  return {
    provider: "cloudflare_stream",
    uid,
    autoplay_enabled: config.autoplayEnabled === true,
    preview_duration_seconds: clampNumber(row.preview_duration_seconds, {
      fallback: config.previewDurationSeconds,
      min: 1,
      max: MAX_PREVIEW_DURATION_SECONDS,
    }),
    max_loop_count: clampNumber(row.max_loop_count, {
      fallback: config.maxLoopCount,
      min: 1,
      max: MAX_PREVIEW_MAX_LOOPS,
    }),
    playback: buildCloudflareStreamPlayback(uid),
  };
}

export function summarizeMemvidStreamPreviews(rows = [], events = [], env = {}) {
  const config = getMemvidStreamPreviewConfig(env);
  const statusCounts = {};
  let readyCount = 0;
  let failedCount = 0;
  let storedPreviewSeconds = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = String(row?.status || "unknown");
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === "ready") {
      readyCount += 1;
      storedPreviewSeconds += Number(row.preview_duration_seconds || config.previewDurationSeconds) || 0;
    }
    if (status === "failed") failedCount += 1;
  }

  let hoverStarts = 0;
  let estimatedDeliveredSeconds = 0;
  for (const event of Array.isArray(events) ? events : []) {
    const count = Number(event?.event_count || 0);
    hoverStarts += Number.isFinite(count) ? count : 0;
    const seconds = Number(event?.estimated_delivered_seconds || 0);
    if (Number.isFinite(seconds)) estimatedDeliveredSeconds += seconds;
  }

  return {
    feature_flags: {
      metadata_enabled: config.enabled,
      autoplay_enabled: config.autoplayEnabled,
      provider_configured: config.providerConfigured,
    },
    status_counts: statusCounts,
    ready_count: readyCount,
    failed_count: failedCount,
    estimated_stored_preview_minutes: Math.round((storedPreviewSeconds / 60) * 100) / 100,
    max_loop_count: config.maxLoopCount,
    hover_starts: hoverStarts,
    estimated_delivered_minutes: Math.round((estimatedDeliveredSeconds / 60) * 100) / 100,
    cost_safety: {
      lazy_hover_only: true,
      autoplay_mobile_disabled: true,
      reduced_motion_disabled: true,
      no_preload_required: true,
      max_loops_per_hover: config.maxLoopCount,
    },
  };
}
