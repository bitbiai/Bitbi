import { nowIso } from "./tokens.js";

export const VIDEO_DELIVERY_FEATURE_KEYS = Object.freeze({
  HERO_EXTERNAL_FFMPEG: "homepage_hero_external_ffmpeg",
  HERO_MANUAL_UPLOADS: "homepage_hero_manual_uploads",
  MEMVID_STREAM_PREVIEWS: "memvid_stream_previews",
  MEMVID_STREAM_PREVIEW_AUTOPLAY: "memvid_stream_preview_autoplay",
});

export const VIDEO_DELIVERY_FEATURES = Object.freeze({
  [VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG]: Object.freeze({
    key: VIDEO_DELIVERY_FEATURE_KEYS.HERO_EXTERNAL_FFMPEG,
    settingKey: "homepage_hero_external_ffmpeg_enabled",
    envName: "ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG",
    label: "Homepage external ffmpeg derivatives",
    description: "Allows admins to create/retry optimized external_ffmpeg derivatives for Homepage Hero slots.",
    provider: "homepage_external_ffmpeg",
    providerRequired: true,
  }),
  [VIDEO_DELIVERY_FEATURE_KEYS.HERO_MANUAL_UPLOADS]: Object.freeze({
    key: VIDEO_DELIVERY_FEATURE_KEYS.HERO_MANUAL_UPLOADS,
    settingKey: "homepage_hero_manual_uploads_enabled",
    envName: "ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS",
    label: "Homepage manual hero uploads",
    description: "Allows admins to upload private source videos for Homepage Hero conversion.",
    provider: null,
    providerRequired: false,
  }),
  [VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS]: Object.freeze({
    key: VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEWS,
    settingKey: "memvid_stream_previews_enabled",
    envName: "ENABLE_MEMVID_STREAM_PREVIEWS",
    label: "Memvid Stream previews",
    description: "Allows short Cloudflare Stream preview metadata/backfill for Memvid Explore.",
    provider: "cloudflare_stream_previews",
    providerRequired: true,
  }),
  [VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEW_AUTOPLAY]: Object.freeze({
    key: VIDEO_DELIVERY_FEATURE_KEYS.MEMVID_STREAM_PREVIEW_AUTOPLAY,
    settingKey: "memvid_stream_preview_autoplay_enabled",
    envName: "ENABLE_MEMVID_STREAM_PREVIEW_AUTOPLAY",
    label: "Memvid Stream hover autoplay",
    description: "Allows desktop hover autoplay for ready Memvid Stream preview clips.",
    provider: null,
    providerRequired: false,
  }),
});

export const HERO_FFMPEG_PRESET_SETTING_KEY = "homepage_hero_ffmpeg_preset";
export const DEFAULT_HERO_FFMPEG_PRESET = Object.freeze({
  version: "hero_desktop_custom_v1",
  name: "hero_desktop_mp4_720p_v1",
  format: "mp4",
  container: "mp4",
  codec: "h264",
  videoCodec: "h264",
  ffmpegCodec: "libx264",
  maxWidth: 720,
  fps: 24,
  durationSeconds: 8,
  maxDurationSeconds: 8,
  targetDurationSeconds: 8,
  audio: false,
  crf: 30,
  encoderPreset: "slow",
  faststart: true,
  posterFormat: "webp",
  posterWidth: 640,
  idealSizeBytes: [1_000_000, 3_000_000],
  hardWarningSizeBytes: 4_000_000,
});

const FALSE_VALUES = new Set(["false", "0", "off", "disabled", "no"]);
const TRUE_VALUES = new Set(["true", "1", "on", "enabled", "yes"]);
const FEATURE_DEFAULT_ENABLED = true;
const MAX_REASON_LENGTH = 500;
const MIN_REASON_LENGTH = 8;
const ENCODER_PRESETS = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower"]);
const FORMATS = new Set(["mp4"]);
const CODECS = new Set(["h264", "libx264"]);
const POSTER_FORMATS = new Set(["webp"]);

export class VideoDeliverySettingsError extends Error {
  constructor(message, { status = 400, code = "video_delivery_settings_error", fields = {} } = {}) {
    super(message);
    this.name = "VideoDeliverySettingsError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function hasMissingSettingsTableError(error) {
  return /no such table:\s*app_settings/i.test(String(error?.message || error));
}

function parseJson(raw) {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeReason(value, { required = true } = {}) {
  const reason = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (required && reason.length < MIN_REASON_LENGTH) {
    throw new VideoDeliverySettingsError("operator_reason must be at least 8 characters.", {
      code: "operator_reason_required",
      fields: { operator_reason: "min_length_8" },
    });
  }
  return reason.slice(0, MAX_REASON_LENGTH);
}

export function parseVideoFeatureFlag(value, defaultValue = FEATURE_DEFAULT_ENABLED) {
  if (value === undefined || value === null || String(value).trim() === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return defaultValue;
}

export function getHomepageHeroProcessorSecret(env) {
  const primary = String(env?.HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET || "").trim();
  if (primary) return primary;
  return String(env?.HOMEPAGE_HERO_PROCESSOR_SECRET || "").trim();
}

export function getMemvidStreamPreviewProcessorSecret(env) {
  const primary = String(env?.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET || "").trim();
  if (primary) return primary;
  return getHomepageHeroProcessorSecret(env);
}

export function getVideoDeliveryProviderReadiness(env = {}) {
  const homepageProcessorSecretConfigured = Boolean(getHomepageHeroProcessorSecret(env));
  const streamAccountConfigured = Boolean(env?.CLOUDFLARE_ACCOUNT_ID || env?.STREAM_ACCOUNT_ID);
  const streamTokenConfigured = Boolean(env?.CLOUDFLARE_STREAM_API_TOKEN || env?.STREAM_API_TOKEN);
  const streamProcessorSecretConfigured = Boolean(getMemvidStreamPreviewProcessorSecret(env));
  return {
    homepage_external_ffmpeg: {
      provider: "external_ffmpeg",
      configured: homepageProcessorSecretConfigured,
      missing: homepageProcessorSecretConfigured ? [] : ["HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET or HOMEPAGE_HERO_PROCESSOR_SECRET"],
    },
    cloudflare_stream_previews: {
      provider: "cloudflare_stream",
      configured: streamAccountConfigured && streamTokenConfigured && streamProcessorSecretConfigured,
      missing: [
        ...(streamAccountConfigured ? [] : ["CLOUDFLARE_ACCOUNT_ID or STREAM_ACCOUNT_ID"]),
        ...(streamTokenConfigured ? [] : ["CLOUDFLARE_STREAM_API_TOKEN or STREAM_API_TOKEN"]),
        ...(streamProcessorSecretConfigured ? [] : ["MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET or HOMEPAGE_HERO_PROCESSOR_SECRET"]),
      ],
    },
  };
}

async function readAppSetting(env, key) {
  if (!env?.DB) return { row: null, storageAvailable: false };
  try {
    const row = await env.DB.prepare(
      "SELECT key, value_json, updated_at, updated_by_user_id, reason FROM app_settings WHERE key = ? LIMIT 1"
    ).bind(key).first();
    return { row, storageAvailable: true };
  } catch (error) {
    if (hasMissingSettingsTableError(error)) return { row: null, storageAvailable: false };
    throw error;
  }
}

async function writeAppSetting(env, key, value, { actorUserId = null, reason = "" } = {}) {
  if (!env?.DB) {
    throw new VideoDeliverySettingsError("Video delivery settings storage is unavailable.", {
      status: 503,
      code: "video_delivery_settings_storage_unavailable",
    });
  }
  const updatedAt = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at, updated_by_user_id, reason)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id,
         reason = excluded.reason`
    ).bind(
      key,
      JSON.stringify(value),
      updatedAt,
      actorUserId || null,
      reason || null
    ).run();
  } catch (error) {
    if (hasMissingSettingsTableError(error)) {
      throw new VideoDeliverySettingsError("Video delivery settings migration is not applied.", {
        status: 503,
        code: "video_delivery_settings_migration_required",
      });
    }
    throw error;
  }
  return { updatedAt };
}

function buildFeatureState(feature, row, storageAvailable, providerReadiness) {
  const value = parseJson(row?.value_json);
  const workerEnabled = parseVideoFeatureFlag(feature.envValue, FEATURE_DEFAULT_ENABLED);
  const adminEnabled = value.enabled !== false;
  const provider = feature.provider ? providerReadiness[feature.provider] : null;
  const providerConfigured = feature.providerRequired ? provider?.configured === true : true;
  return {
    key: feature.key,
    setting_key: feature.settingKey,
    env_name: feature.envName,
    label: feature.label,
    description: feature.description,
    worker_default_enabled: FEATURE_DEFAULT_ENABLED,
    worker_env_present: feature.envPresent,
    worker_enabled: workerEnabled,
    admin_enabled: adminEnabled,
    admin_override_present: Boolean(row),
    effective_enabled: workerEnabled && adminEnabled && providerConfigured,
    provider_required: feature.providerRequired,
    provider_configured: providerConfigured,
    provider: provider || null,
    storage_available: storageAvailable,
    updated_at: row?.updated_at || value.updatedAt || null,
    updated_by_user_id: row?.updated_by_user_id || null,
    reason: row?.reason || value.reason || "",
  };
}

export async function getVideoDeliveryFeatureStatus(env = {}) {
  const providerReadiness = getVideoDeliveryProviderReadiness(env);
  const states = {};
  let storageAvailable = true;
  for (const baseFeature of Object.values(VIDEO_DELIVERY_FEATURES)) {
    const feature = {
      ...baseFeature,
      envValue: env?.[baseFeature.envName],
      envPresent: Object.prototype.hasOwnProperty.call(env || {}, baseFeature.envName)
        && String(env?.[baseFeature.envName] ?? "").trim() !== "",
    };
    const setting = await readAppSetting(env, feature.settingKey);
    storageAvailable = storageAvailable && setting.storageAvailable;
    states[feature.key] = buildFeatureState(feature, setting.row, setting.storageAvailable, providerReadiness);
  }
  return {
    storage_available: storageAvailable,
    features: states,
    providers: providerReadiness,
  };
}

export async function getVideoDeliveryFeature(env, key) {
  const status = await getVideoDeliveryFeatureStatus(env);
  return status.features[key] || null;
}

export async function setVideoDeliveryFeatureSwitch(env, {
  key,
  enabled,
  actorUserId = null,
  reason = "",
} = {}) {
  const feature = VIDEO_DELIVERY_FEATURES[key];
  if (!feature) {
    throw new VideoDeliverySettingsError("Unknown video delivery feature switch.", {
      status: 404,
      code: "video_delivery_feature_not_found",
    });
  }
  if (typeof enabled !== "boolean") {
    throw new VideoDeliverySettingsError("Feature switch enabled state must be true or false.", {
      code: "video_delivery_feature_enabled_invalid",
      fields: { enabled: "boolean_required" },
    });
  }
  const safeReason = normalizeReason(reason);
  const { updatedAt } = await writeAppSetting(
    env,
    feature.settingKey,
    { enabled, updatedAt: nowIso() },
    { actorUserId, reason: safeReason }
  );
  const status = await getVideoDeliveryFeatureStatus(env);
  return {
    updated_at: updatedAt,
    feature: status.features[key],
    status,
  };
}

function numberValue(value, { field, fallback, min, max, integer = true }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    throw new VideoDeliverySettingsError(`Invalid hero ffmpeg preset ${field}.`, {
      code: "homepage_hero_ffmpeg_preset_invalid",
      fields: { [field]: "number_required" },
    });
  }
  const normalized = integer ? Math.round(parsed) : parsed;
  if (normalized < min || normalized > max) {
    throw new VideoDeliverySettingsError(`Hero ffmpeg preset ${field} is outside the safe range.`, {
      code: "homepage_hero_ffmpeg_preset_invalid",
      fields: { [field]: `range_${min}_${max}` },
    });
  }
  return normalized;
}

function enumValue(value, { field, fallback, allowed }) {
  const normalized = String(value ?? fallback ?? "").trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new VideoDeliverySettingsError(`Unsupported hero ffmpeg preset ${field}.`, {
      code: "homepage_hero_ffmpeg_preset_invalid",
      fields: { [field]: "unsupported_value" },
    });
  }
  return normalized;
}

export function normalizeHeroFfmpegPreset(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const format = enumValue(source.format || source.container, {
    field: "format",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.format,
    allowed: FORMATS,
  });
  const codec = enumValue(source.codec || source.videoCodec, {
    field: "codec",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.codec,
    allowed: CODECS,
  }) === "libx264" ? "h264" : "h264";
  const audio = source.audio === true;
  const maxWidth = numberValue(source.maxWidth ?? source.max_width, {
    field: "maxWidth",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.maxWidth,
    min: 320,
    max: 1080,
  });
  const fps = numberValue(source.fps, {
    field: "fps",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.fps,
    min: 12,
    max: 30,
  });
  const durationSeconds = numberValue(source.durationSeconds ?? source.maxDurationSeconds ?? source.duration_seconds, {
    field: "durationSeconds",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.durationSeconds,
    min: 3,
    max: 12,
  });
  const crf = numberValue(source.crf, {
    field: "crf",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.crf,
    min: 24,
    max: 36,
  });
  const encoderPreset = enumValue(source.encoderPreset || source.encoder_preset, {
    field: "encoderPreset",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.encoderPreset,
    allowed: ENCODER_PRESETS,
  });
  const posterFormat = enumValue(source.posterFormat || source.poster_format, {
    field: "posterFormat",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.posterFormat,
    allowed: POSTER_FORMATS,
  });
  const posterWidth = numberValue(source.posterWidth ?? source.poster_width, {
    field: "posterWidth",
    fallback: DEFAULT_HERO_FFMPEG_PRESET.posterWidth,
    min: 320,
    max: 1080,
  });
  const versionBase = String(source.version || DEFAULT_HERO_FFMPEG_PRESET.version)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 80) || DEFAULT_HERO_FFMPEG_PRESET.version;
  return {
    version: versionBase,
    name: source.name ? String(source.name).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) : DEFAULT_HERO_FFMPEG_PRESET.name,
    format,
    container: format,
    codec,
    videoCodec: codec,
    ffmpegCodec: "libx264",
    maxWidth,
    fps,
    durationSeconds,
    maxDurationSeconds: durationSeconds,
    targetDurationSeconds: durationSeconds,
    audio,
    crf,
    encoderPreset,
    faststart: true,
    posterFormat,
    posterWidth,
    idealSizeBytes: DEFAULT_HERO_FFMPEG_PRESET.idealSizeBytes,
    hardWarningSizeBytes: DEFAULT_HERO_FFMPEG_PRESET.hardWarningSizeBytes,
  };
}

export function validateHeroFfmpegPreset(input = {}) {
  const preset = normalizeHeroFfmpegPreset(input);
  const warnings = [];
  if (preset.audio) warnings.push("Audio is enabled. Homepage hero clips should normally remain muted/no-audio.");
  if (preset.maxWidth > 720 || preset.durationSeconds > 8 || preset.crf < 28) {
    warnings.push("This preset may create larger homepage files. Review derivative sizes before assigning public slots.");
  }
  return { preset, warnings };
}

export async function getHeroFfmpegPresetSetting(env = {}) {
  const setting = await readAppSetting(env, HERO_FFMPEG_PRESET_SETTING_KEY);
  const value = parseJson(setting.row?.value_json);
  const { preset, warnings } = validateHeroFfmpegPreset(value.preset || value);
  return {
    setting_key: HERO_FFMPEG_PRESET_SETTING_KEY,
    storage_available: setting.storageAvailable,
    setting_present: Boolean(setting.row),
    preset,
    warnings,
    updated_at: setting.row?.updated_at || value.updatedAt || null,
    updated_by_user_id: setting.row?.updated_by_user_id || null,
    reason: setting.row?.reason || value.reason || "",
  };
}

export async function setHeroFfmpegPresetSetting(env, {
  preset,
  actorUserId = null,
  reason = "",
} = {}) {
  const safeReason = normalizeReason(reason);
  const validation = validateHeroFfmpegPreset(preset || {});
  const { updatedAt } = await writeAppSetting(
    env,
    HERO_FFMPEG_PRESET_SETTING_KEY,
    { preset: validation.preset, updatedAt: nowIso() },
    { actorUserId, reason: safeReason }
  );
  return {
    ...(await getHeroFfmpegPresetSetting(env)),
    updated_at: updatedAt,
  };
}
