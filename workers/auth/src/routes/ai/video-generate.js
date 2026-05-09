import {
  HAPPYHORSE_T2V_DEFAULT_DURATION,
  HAPPYHORSE_T2V_DEFAULT_RATIO,
  HAPPYHORSE_T2V_DEFAULT_RESOLUTION,
  HAPPYHORSE_T2V_DEFAULT_WATERMARK,
  HAPPYHORSE_T2V_MAX_DURATION,
  HAPPYHORSE_T2V_MAX_PROMPT_LENGTH,
  HAPPYHORSE_T2V_MAX_SEED,
  HAPPYHORSE_T2V_MIN_DURATION,
  HAPPYHORSE_T2V_MODEL_ID,
  HAPPYHORSE_T2V_MODEL_LABEL,
  HAPPYHORSE_T2V_RATIOS,
  HAPPYHORSE_T2V_RESOLUTIONS,
  HAPPYHORSE_T2V_VENDOR,
} from "../../../../../js/shared/happyhorse-t2v-pricing.mjs";
import {
  isPixverseV6AspectRatio,
  isPixverseV6Quality,
  PIXVERSE_V6_ASPECT_RATIOS,
  PIXVERSE_V6_MAX_DURATION,
  PIXVERSE_V6_MAX_NEGATIVE_PROMPT_LENGTH,
  PIXVERSE_V6_MAX_PROMPT_LENGTH,
  PIXVERSE_V6_MAX_SEED,
  PIXVERSE_V6_MIN_DURATION,
  PIXVERSE_V6_MODEL_ID,
  PIXVERSE_V6_MODEL_LABEL,
} from "../../../../../js/shared/pixverse-v6-pricing.mjs";
import { calculateAiVideoCreditCost } from "../../../../../js/shared/ai-model-pricing.mjs";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
} from "../../../../../js/shared/remote-media-policy.mjs";
import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../../js/shared/worker-observability.mjs";
import {
  AI_USAGE_OPERATIONS,
  aiUsagePolicyErrorResponse,
  prepareAiUsagePolicy,
} from "../../lib/ai-usage-policy.js";
import { saveGeneratedVideoAsset } from "../../lib/ai-text-assets.js";
import {
  fetchRemoteAsset,
  VIDEO_OUTPUT_CONTENT_TYPES,
  VIDEO_OUTPUT_MAX_BYTES,
  VIDEO_POSTER_CONTENT_TYPES,
  VIDEO_POSTER_MAX_BYTES,
} from "../../lib/ai-video-jobs.js";
import { json } from "../../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import {
  evaluateSharedRateLimit,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../../lib/rate-limit.js";
import { requireUser } from "../../lib/session.js";
import { sha256Hex } from "../../lib/tokens.js";
import { deleteUserAiTextAsset } from "./lifecycle.js";
import { hasControlCharacters } from "./helpers.js";

const ROUTE_PATH = "/api/ai/generate-video";
const GENERATION_LIMIT = 12;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 120;
const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_DURATION = 5;
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_QUALITY = "720p";
const DEFAULT_GENERATE_AUDIO = true;
const DEFAULT_TITLE = "PixVerse Video";
const HAPPYHORSE_DEFAULT_TITLE = "HappyHorse Video";
const PIXVERSE_ALLOWED_BODY_FIELDS = new Set([
  "model",
  "prompt",
  "negative_prompt",
  "image_input",
  "duration",
  "aspect_ratio",
  "quality",
  "seed",
  "generate_audio",
  "folder_id",
  "folderId",
  "title",
]);
const HAPPYHORSE_ALLOWED_BODY_FIELDS = new Set([
  "model",
  "prompt",
  "duration",
  "resolution",
  "ratio",
  "seed",
  "watermark",
  "folder_id",
  "folderId",
  "title",
]);

function respondWith(correlationId, body, init) {
  return withCorrelationId(json(body, init), correlationId);
}

function validationError(message, code = "validation_error", status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeOptionalString(value, maxLength, fieldName, { allowNewlines = false } = {}) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const unsafeControlCharacters = allowNewlines
    ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
    : hasControlCharacters(text);
  if (text.length > maxLength || unsafeControlCharacters) {
    throw validationError(`${fieldName} must be 1-${maxLength} safe characters.`, `invalid_${fieldName}`);
  }
  return text;
}

function normalizeInteger(value, { fieldName, min, max, fallback = undefined }) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw validationError(`${fieldName} is required.`, `invalid_${fieldName}`);
  }
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(`${fieldName} must be an integer from ${min} to ${max}.`, `invalid_${fieldName}`);
  }
  return number;
}

function normalizeEnum(value, allowed, fallback, fieldName) {
  const raw = value === undefined || value === null || value === "" ? fallback : String(value).trim();
  if (!allowed(raw)) {
    throw validationError(`Unsupported ${fieldName}.`, `invalid_${fieldName}`);
  }
  return raw;
}

function enumIncludes(allowedValues) {
  return (value) => allowedValues.includes(value);
}

function normalizeModelId(value) {
  const modelId = value === undefined || value === null || value === ""
    ? PIXVERSE_V6_MODEL_ID
    : String(value).trim();
  if (modelId === PIXVERSE_V6_MODEL_ID || modelId === HAPPYHORSE_T2V_MODEL_ID) return modelId;
  throw validationError("Video model is not available for member generation.", "model_not_allowed");
}

function assertAllowedBodyFields(body, allowedFields) {
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      throw validationError("Unsupported video generation option.", "unsupported_option");
    }
  }
}

function normalizeFolderId(body) {
  const raw = body.folder_id ?? body.folderId ?? null;
  if (raw === undefined || raw === null || raw === "") return null;
  const value = String(raw).trim();
  if (!/^[a-f0-9]+$/i.test(value)) {
    throw validationError("Invalid folder ID.", "invalid_folder_id");
  }
  return value;
}

function titleFromPrompt(prompt, fallback = DEFAULT_TITLE) {
  const compact = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.slice(0, MAX_TITLE_LENGTH);
}

function normalizeImageInput(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw validationError("image_input must be a data URI image.", "invalid_image_input");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    const error = attachRemoteMediaPolicyContext(
      new Error(buildRemoteMediaUrlRejectedMessage(
        "image_input",
        "Upload the source frame as a data URI image instead."
      )),
      trimmed,
      {
        field: "image_input",
        reason: "remote_video_input_url_rejected",
      }
    );
    error.status = 400;
    error.code = REMOTE_MEDIA_URL_POLICY_CODE;
    throw error;
  }
  if (!trimmed.startsWith("data:image/")) {
    throw validationError("image_input must be a data URI image.", "invalid_image_input");
  }
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex === -1) {
    throw validationError("image_input is not a valid data URI.", "invalid_image_input");
  }
  const base64 = trimmed.slice(commaIndex + 1);
  const estimatedBytes = Math.ceil(base64.length * 0.75);
  if (estimatedBytes > MAX_IMAGE_INPUT_BYTES) {
    throw validationError(`image_input exceeds the ${MAX_IMAGE_INPUT_BYTES} byte size limit.`, "invalid_image_input");
  }
  return trimmed;
}

async function normalizePixverseBody(body) {
  assertAllowedBodyFields(body, PIXVERSE_ALLOWED_BODY_FIELDS);
  const prompt = normalizeOptionalString(body.prompt, PIXVERSE_V6_MAX_PROMPT_LENGTH, "prompt", { allowNewlines: true });
  if (!prompt) {
    throw validationError(`prompt must be 1-${PIXVERSE_V6_MAX_PROMPT_LENGTH} safe characters.`, "invalid_prompt");
  }
  const negativePrompt = normalizeOptionalString(
    body.negative_prompt,
    PIXVERSE_V6_MAX_NEGATIVE_PROMPT_LENGTH,
    "negative_prompt",
    { allowNewlines: true }
  );
  const duration = normalizeInteger(body.duration, {
    fieldName: "duration",
    min: PIXVERSE_V6_MIN_DURATION,
    max: PIXVERSE_V6_MAX_DURATION,
    fallback: DEFAULT_DURATION,
  });
  const aspectRatio = normalizeEnum(body.aspect_ratio, isPixverseV6AspectRatio, DEFAULT_ASPECT_RATIO, "aspect_ratio");
  const quality = normalizeEnum(body.quality, isPixverseV6Quality, DEFAULT_QUALITY, "quality");
  const generateAudio = normalizeBoolean(body.generate_audio, DEFAULT_GENERATE_AUDIO);
  const seed = body.seed === undefined || body.seed === null || body.seed === ""
    ? null
    : normalizeInteger(body.seed, {
      fieldName: "seed",
      min: 0,
      max: PIXVERSE_V6_MAX_SEED,
    });
  const imageInput = normalizeImageInput(body.image_input);
  const title = normalizeOptionalString(body.title, MAX_TITLE_LENGTH, "title") || titleFromPrompt(prompt);
  const folderId = normalizeFolderId(body);
  const pricing = calculateAiVideoCreditCost(PIXVERSE_V6_MODEL_ID, {
    duration,
    quality,
    generateAudio,
  });
  if (!pricing) {
    throw validationError("Video model pricing is unavailable.", "pricing_unavailable", 503);
  }
  const price = pricing.credits;
  const imageInputHash = imageInput ? await sha256Hex(imageInput) : null;

  return {
    modelId: PIXVERSE_V6_MODEL_ID,
    modelLabel: PIXVERSE_V6_MODEL_LABEL,
    vendor: "PixVerse",
    provider: "workers-ai",
    preset: "member_video_pixverse_v6",
    pricingSource: "pixverse-v6-shared-pricing",
    prompt,
    negativePrompt,
    duration,
    aspectRatio,
    quality,
    generateAudio,
    seed,
    imageInput,
    imageInputHash,
    title,
    folderId,
    price,
    policyBody: {
      model: PIXVERSE_V6_MODEL_ID,
      prompt,
      negativePrompt: Boolean(negativePrompt),
      duration,
      aspectRatio,
      quality,
      generateAudio,
      seed,
      imageInputHash,
    },
  };
}

function normalizeHappyHorseBody(body) {
  assertAllowedBodyFields(body, HAPPYHORSE_ALLOWED_BODY_FIELDS);
  const prompt = normalizeOptionalString(body.prompt, HAPPYHORSE_T2V_MAX_PROMPT_LENGTH, "prompt", { allowNewlines: true });
  if (!prompt) {
    throw validationError(`prompt must be 1-${HAPPYHORSE_T2V_MAX_PROMPT_LENGTH} safe characters.`, "invalid_prompt");
  }
  const duration = normalizeInteger(body.duration, {
    fieldName: "duration",
    min: HAPPYHORSE_T2V_MIN_DURATION,
    max: HAPPYHORSE_T2V_MAX_DURATION,
    fallback: HAPPYHORSE_T2V_DEFAULT_DURATION,
  });
  const resolution = normalizeEnum(
    body.resolution,
    enumIncludes(HAPPYHORSE_T2V_RESOLUTIONS),
    HAPPYHORSE_T2V_DEFAULT_RESOLUTION,
    "resolution"
  );
  const ratio = normalizeEnum(
    body.ratio,
    enumIncludes(HAPPYHORSE_T2V_RATIOS),
    HAPPYHORSE_T2V_DEFAULT_RATIO,
    "ratio"
  );
  const seed = body.seed === undefined || body.seed === null || body.seed === ""
    ? null
    : normalizeInteger(body.seed, {
      fieldName: "seed",
      min: 0,
      max: HAPPYHORSE_T2V_MAX_SEED,
    });
  const watermark = normalizeBoolean(body.watermark, HAPPYHORSE_T2V_DEFAULT_WATERMARK);
  const title = normalizeOptionalString(body.title, MAX_TITLE_LENGTH, "title") || titleFromPrompt(prompt, HAPPYHORSE_DEFAULT_TITLE);
  const folderId = normalizeFolderId(body);
  const pricing = calculateAiVideoCreditCost(HAPPYHORSE_T2V_MODEL_ID, {
    duration,
    resolution,
    ratio,
    watermark,
  });
  if (!pricing) {
    throw validationError("Video model pricing is unavailable.", "pricing_unavailable", 503);
  }
  const price = pricing.credits;

  return {
    modelId: HAPPYHORSE_T2V_MODEL_ID,
    modelLabel: HAPPYHORSE_T2V_MODEL_LABEL,
    vendor: HAPPYHORSE_T2V_VENDOR,
    provider: "workers-ai",
    preset: "member_video_happyhorse_1_0_t2v",
    pricingSource: "happyhorse-1-0-t2v-shared-pricing",
    prompt,
    duration,
    resolution,
    ratio,
    seed,
    watermark,
    workflow: "text-to-video",
    title,
    folderId,
    price,
    policyBody: {
      model: HAPPYHORSE_T2V_MODEL_ID,
      prompt,
      duration,
      resolution,
      ratio,
      seed,
      watermark,
    },
  };
}

async function normalizeMemberVideoBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("JSON body is required.", "bad_request");
  }
  const modelId = normalizeModelId(body.model);
  if (modelId === HAPPYHORSE_T2V_MODEL_ID) {
    return normalizeHappyHorseBody(body);
  }
  return normalizePixverseBody(body);
}

function buildPixversePayload(input) {
  const payload = {
    prompt: input.prompt,
    duration: input.duration,
    aspect_ratio: input.aspectRatio,
    quality: input.quality,
    generate_audio: input.generateAudio,
  };
  if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
  if (input.imageInput) payload.image_input = input.imageInput;
  if (input.seed !== null && input.seed !== undefined) payload.seed = input.seed;
  return payload;
}

function buildHappyHorsePayload(input) {
  const payload = {
    prompt: input.prompt,
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio,
    watermark: input.watermark,
  };
  if (input.seed !== null && input.seed !== undefined) payload.seed = input.seed;
  return payload;
}

function buildProviderPayload(input) {
  if (input.modelId === HAPPYHORSE_T2V_MODEL_ID) return buildHappyHorsePayload(input);
  return buildPixversePayload(input);
}

function findUrl(value, fieldNames) {
  if (!value || typeof value !== "object") return "";
  for (const field of fieldNames) {
    if (typeof value[field] === "string" && value[field].trim()) {
      return value[field].trim();
    }
  }
  return "";
}

function extractProviderVideoUrl(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  const direct = findUrl(raw, ["video", "video_url", "url", "output_url", "file_url", "asset_url"]);
  if (direct) return direct;
  if (raw.result) {
    const nested = extractProviderVideoUrl(raw.result);
    if (nested) return nested;
  }
  if (raw.data) {
    const nested = extractProviderVideoUrl(raw.data);
    if (nested) return nested;
  }
  if (raw.output) {
    const nested = extractProviderVideoUrl(raw.output);
    if (nested) return nested;
  }
  return "";
}

function extractProviderPosterUrl(raw) {
  if (!raw || typeof raw !== "object") return "";
  const direct = findUrl(raw, ["poster", "poster_url", "thumbnail", "thumbnail_url", "cover", "cover_url", "image_url"]);
  if (direct) return direct;
  if (raw.result) {
    const nested = extractProviderPosterUrl(raw.result);
    if (nested) return nested;
  }
  if (raw.data) {
    const nested = extractProviderPosterUrl(raw.data);
    if (nested) return nested;
  }
  if (raw.output) {
    const nested = extractProviderPosterUrl(raw.output);
    if (nested) return nested;
  }
  return "";
}

async function invokeMemberVideoModel(env, modelId, payload, { correlationId, userId }) {
  const startedAt = Date.now();
  if (!env?.AI || typeof env.AI.run !== "function") {
    return {
      ok: false,
      status: 503,
      code: "upstream_unavailable",
      error: "AI video service unavailable.",
    };
  }

  try {
    const result = await env.AI.run(modelId, payload, { gateway: { id: "default" } });
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-video",
      event: "member_video_provider_completed",
      correlationId,
      user_id: userId,
      duration_ms: getDurationMs(startedAt),
      model: modelId,
    });
    return { ok: true, result, elapsedMs: getDurationMs(startedAt) };
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-video",
      event: "member_video_provider_failed",
      level: "error",
      correlationId,
      user_id: userId,
      duration_ms: getDurationMs(startedAt),
      model: modelId,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: "Video generation failed.",
    };
  }
}

async function persistVideoResult({ env, userId, input, providerResult, elapsedMs, correlationId }) {
  const videoUrl = extractProviderVideoUrl(providerResult);
  if (!videoUrl) {
    const error = new Error("Video provider returned no savable video.");
    error.status = 502;
    error.code = "provider_empty_result";
    throw error;
  }

  const videoAsset = await fetchRemoteAsset(env, videoUrl, {
    maxBytes: VIDEO_OUTPUT_MAX_BYTES,
    allowedContentTypes: VIDEO_OUTPUT_CONTENT_TYPES,
    label: "video",
  });

  let posterBytes = null;
  const posterUrl = extractProviderPosterUrl(providerResult);
  if (posterUrl) {
    try {
      const posterAsset = await fetchRemoteAsset(env, posterUrl, {
        maxBytes: VIDEO_POSTER_MAX_BYTES,
        allowedContentTypes: VIDEO_POSTER_CONTENT_TYPES,
        label: "poster",
      });
      posterBytes = posterAsset.body;
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-video",
        event: "member_video_poster_fetch_failed",
        level: "warn",
        correlationId,
        user_id: userId,
        ...getErrorFields(error),
      });
    }
  }

  const saved = await saveGeneratedVideoAsset(env, {
    userId,
    folderId: input.folderId,
    title: input.title,
    videoBytes: videoAsset.body,
    mimeType: videoAsset.contentType,
    posterBytes,
    payload: {
      prompt: input.prompt,
      model: {
        id: input.modelId,
        label: input.modelLabel,
        vendor: input.vendor,
      },
      provider: input.provider,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      quality: input.quality,
      resolution: input.resolution,
      ratio: input.ratio,
      seed: input.seed,
      generate_audio: input.generateAudio,
      watermark: input.watermark,
      hasImageInput: Boolean(input.imageInput),
      workflow: input.workflow || (input.imageInput ? "image-to-video" : "text-to-video"),
      elapsedMs,
      receivedAt: new Date().toISOString(),
    },
  });

  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-generate-video",
    event: "member_video_saved",
    correlationId,
    user_id: userId,
    asset_id: saved.id,
    folder_id: saved.folder_id,
    size_bytes: saved.size_bytes,
  });

  return saved;
}

async function cleanupSavedAsset(env, userId, assetId) {
  if (!assetId) return;
  try {
    await deleteUserAiTextAsset({ env, userId, assetId });
  } catch {}
}

export async function handleGenerateVideo(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const requestInfo = { request, pathname: ROUTE_PATH, method: request.method };
  const respond = (body, init) => respondWith(correlationId, body, init);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const limit = await evaluateSharedRateLimit(
    env,
    "ai-generate-video-user",
    userId,
    GENERATION_LIMIT,
    GENERATION_WINDOW_MS,
    sensitiveRateLimitOptions({
      component: "ai-generate-video",
      correlationId,
      requestInfo,
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (limit.limited) return rateLimitResponse();

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiGenerateVideoJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);

  let input;
  try {
    input = await normalizeMemberVideoBody(parsed.body);
  } catch (error) {
    return respond({ ok: false, error: error.message, code: error.code || "validation_error" }, {
      status: error.status || 400,
    });
  }

  let usagePolicy;
  try {
    usagePolicy = await prepareAiUsagePolicy({
      env,
      request,
      user: session.user,
      body: input.policyBody,
      operation: {
        ...AI_USAGE_OPERATIONS.MEMBER_VIDEO_GENERATE,
        credits: input.price,
        source: "member_video_generation",
      },
      route: ROUTE_PATH,
    });
  } catch (error) {
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-video",
      event: "member_video_policy_rejected",
      level: policyError.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "member_video_policy_rejected",
      ...getErrorFields(error),
    });
    return respond(policyError.body, { status: policyError.status });
  }

  if (usagePolicy.mode === "organization") {
    return respond({
      ok: false,
      error: "Personal video generation does not accept organization context.",
      code: "organization_context_not_supported",
    }, { status: 400 });
  }

  if (usagePolicy.mode === "member") {
    try {
      await usagePolicy.prepareForProvider();
    } catch (error) {
      const policyError = aiUsagePolicyErrorResponse(error);
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-video",
        event: "member_video_credit_policy_rejected",
        level: policyError.status >= 500 ? "error" : "warn",
        correlationId,
        user_id: userId,
        code: policyError.body?.code || "member_video_credit_policy_rejected",
        ...getErrorFields(error),
      });
      return respond(policyError.body, { status: policyError.status });
    }
  }

  const providerPayload = buildProviderPayload(input);
  const providerResponse = await invokeMemberVideoModel(env, input.modelId, providerPayload, { correlationId, userId });
  if (!providerResponse.ok) {
    return respond({
      ok: false,
      error: providerResponse.error || "Video generation failed.",
      code: providerResponse.code || "upstream_error",
    }, { status: providerResponse.status || 502 });
  }

  let savedAsset = null;
  try {
    savedAsset = await persistVideoResult({
      env,
      userId,
      input,
      providerResult: providerResponse.result,
      elapsedMs: providerResponse.elapsedMs ?? null,
      correlationId,
    });
  } catch (error) {
    const status = error?.status || 500;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-video",
      event: "member_video_save_failed",
      level: status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      ...getErrorFields(error),
    });
    return respond({
      ok: false,
      error: error?.message || "Generated video could not be saved.",
      code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
    }, { status });
  }

  let billingMetadata = null;
  try {
    billingMetadata = await usagePolicy.chargeAfterSuccess({
      model: input.modelId,
      preset: input.preset,
      request_mode: "workers-ai-gateway",
      pricing_source: input.pricingSource,
      duration: input.duration,
      quality: input.quality,
      resolution: input.resolution,
      ratio: input.ratio,
      generate_audio: input.generateAudio,
      watermark: input.watermark,
      asset_id: savedAsset.id,
      source_module: "video",
    });
  } catch (error) {
    await cleanupSavedAsset(env, userId, savedAsset?.id || null);
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-video",
      event: "member_video_charge_failed",
      level: "error",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "member_video_charge_failed",
      ...getErrorFields(error),
    });
    return respond(policyError.body, { status: policyError.status });
  }

  return respond({
    ok: true,
    data: {
      prompt: input.prompt,
      model: {
        id: input.modelId,
        label: input.modelLabel,
        vendor: input.vendor,
      },
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      quality: input.quality,
      resolution: input.resolution,
      ratio: input.ratio,
      seed: input.seed,
      watermark: input.watermark,
      generate_audio: input.generateAudio,
      mimeType: savedAsset.mime_type,
      videoUrl: savedAsset.file_url,
      posterUrl: savedAsset.poster_url || null,
      asset: savedAsset,
    },
    ...(billingMetadata ? {
      billing: {
        ...billingMetadata,
        credits_charged: input.price,
        price: input.price,
      },
    } : {}),
  });
}
