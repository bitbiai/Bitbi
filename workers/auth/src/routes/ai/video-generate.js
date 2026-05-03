import {
  calculatePixverseV6MemberCredits,
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
const ALLOWED_BODY_FIELDS = new Set([
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

function normalizeFolderId(body) {
  const raw = body.folder_id ?? body.folderId ?? null;
  if (raw === undefined || raw === null || raw === "") return null;
  const value = String(raw).trim();
  if (!/^[a-f0-9]+$/i.test(value)) {
    throw validationError("Invalid folder ID.", "invalid_folder_id");
  }
  return value;
}

function titleFromPrompt(prompt) {
  const compact = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!compact) return DEFAULT_TITLE;
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

async function normalizeMemberVideoBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("JSON body is required.", "bad_request");
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_FIELDS.has(key)) {
      throw validationError("Unsupported video generation option.", "unsupported_option");
    }
  }

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
  const price = calculatePixverseV6MemberCredits({
    duration,
    quality,
    generateAudio,
  });
  const imageInputHash = imageInput ? await sha256Hex(imageInput) : null;

  return {
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

function findUrl(value, fieldNames) {
  if (!value || typeof value !== "object") return "";
  for (const field of fieldNames) {
    if (typeof value[field] === "string" && value[field].trim()) {
      return value[field].trim();
    }
  }
  return "";
}

function extractPixverseVideoUrl(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  const direct = findUrl(raw, ["video", "video_url", "url", "output_url"]);
  if (direct) return direct;
  if (raw.result) {
    const nested = extractPixverseVideoUrl(raw.result);
    if (nested) return nested;
  }
  if (raw.data) {
    const nested = extractPixverseVideoUrl(raw.data);
    if (nested) return nested;
  }
  if (raw.output) {
    const nested = extractPixverseVideoUrl(raw.output);
    if (nested) return nested;
  }
  return "";
}

function extractPixversePosterUrl(raw) {
  if (!raw || typeof raw !== "object") return "";
  const direct = findUrl(raw, ["poster", "poster_url", "thumbnail", "thumbnail_url", "cover", "cover_url"]);
  if (direct) return direct;
  if (raw.result) {
    const nested = extractPixversePosterUrl(raw.result);
    if (nested) return nested;
  }
  if (raw.data) {
    const nested = extractPixversePosterUrl(raw.data);
    if (nested) return nested;
  }
  if (raw.output) {
    const nested = extractPixversePosterUrl(raw.output);
    if (nested) return nested;
  }
  return "";
}

async function invokePixverse(env, payload, { correlationId, userId }) {
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
    const result = await env.AI.run(PIXVERSE_V6_MODEL_ID, payload, { gateway: { id: "default" } });
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-video",
      event: "member_video_provider_completed",
      correlationId,
      user_id: userId,
      duration_ms: getDurationMs(startedAt),
      model: PIXVERSE_V6_MODEL_ID,
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
      model: PIXVERSE_V6_MODEL_ID,
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
  const videoUrl = extractPixverseVideoUrl(providerResult);
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
  const posterUrl = extractPixversePosterUrl(providerResult);
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
        id: PIXVERSE_V6_MODEL_ID,
        label: PIXVERSE_V6_MODEL_LABEL,
        vendor: "PixVerse",
      },
      provider: "workers-ai",
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      quality: input.quality,
      seed: input.seed,
      generate_audio: input.generateAudio,
      hasImageInput: Boolean(input.imageInput),
      workflow: input.imageInput ? "image-to-video" : "text-to-video",
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

  const providerPayload = buildPixversePayload(input);
  const providerResponse = await invokePixverse(env, providerPayload, { correlationId, userId });
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
      model: PIXVERSE_V6_MODEL_ID,
      preset: "member_video_pixverse_v6",
      request_mode: "workers-ai-gateway",
      pricing_source: "pixverse-v6-provider-credit-formula",
      duration: input.duration,
      quality: input.quality,
      generate_audio: input.generateAudio,
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
        id: PIXVERSE_V6_MODEL_ID,
        label: PIXVERSE_V6_MODEL_LABEL,
        vendor: "PixVerse",
      },
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      quality: input.quality,
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
