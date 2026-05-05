import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../../lib/request.js";
import { nowIso, randomTokenHex } from "../../lib/tokens.js";
import {
  evaluateSharedRateLimit,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../../lib/rate-limit.js";
import {
  AI_IMAGE_DERIVATIVE_VERSION,
  enqueueAiImageDerivativeJob,
} from "../../lib/ai-image-derivatives.js";
import {
  AI_USAGE_OPERATIONS,
  aiUsagePolicyErrorResponse,
  prepareAiUsagePolicy,
} from "../../lib/ai-usage-policy.js";
import { calculateAiImageCreditCost } from "../../lib/ai-image-credit-pricing.js";
import aiImageModels from "../../../../../js/shared/ai-image-models.mjs";
import {
  GPT_IMAGE_2_BACKGROUND_OPTIONS,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
  GPT_IMAGE_2_QUALITY_OPTIONS,
  GPT_IMAGE_2_SIZE_OPTIONS,
} from "../../../../../js/shared/gpt-image-2-pricing.mjs";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../../js/shared/worker-observability.mjs";
import { buildAiImageInput, hasControlCharacters, parseBase64Image, toArrayBuffer } from "./helpers.js";
import {
  AiGeneratedSaveReferenceError,
  createAiGeneratedSaveReferenceFromBase64,
  decodeAiGeneratedSaveReference,
} from "./generated-image-save-reference.js";
import { AiAssetLifecycleError, deleteUserAiImage } from "./lifecycle.js";

const { DEFAULT_AI_IMAGE_MODEL, resolveAiImageModel } = aiImageModels;

const MODEL = DEFAULT_AI_IMAGE_MODEL;
const MAX_PROMPT_LENGTH = 1000;
const MIN_STEPS = 1;
const MAX_STEPS = 8;
const DEFAULT_STEPS = 4;
const GENERATION_LIMIT = 20;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_SAVED_AI_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_FETCH_BYTES = 25 * 1024 * 1024;
const GPT_IMAGE_2_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const GPT_IMAGE_2_REFERENCE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SAVE_REFERENCE_LENGTH = 500;

async function enforceAiImageWriteRateLimit(ctx, userId, {
  scope = "ai-image-write-user",
  maxRequests = 60,
  windowMs = 10 * 60_000,
  component = "ai-image-write",
} = {}) {
  const { request, env, correlationId } = ctx;
  const limit = await evaluateSharedRateLimit(
    env,
    scope,
    userId,
    maxRequests,
    windowMs,
    sensitiveRateLimitOptions({
      component,
      correlationId: correlationId || null,
      requestInfo: ctx,
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(correlationId || null);
  if (limit.limited) return rateLimitResponse();
  return null;
}

function decodeBase64ToBytes(base64) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function encodeBytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isGptImage2Model(modelConfig) {
  return modelConfig?.id === GPT_IMAGE_2_MODEL_ID || modelConfig?.requestMode === "gpt-image-2";
}

function normalizeGptImage2Option(value, allowed, fallback, field) {
  const normalized = String(value || "").trim() || fallback;
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported GPT Image 2 ${field}.`);
  }
  return normalized;
}

function estimateBase64Bytes(base64) {
  const compact = String(base64 || "").replace(/\s+/g, "");
  if (!compact) return 0;
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function validateGptImage2ReferenceImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("referenceImages must be an array.");
  }
  if (value.length > 16) {
    throw new Error("referenceImages must contain at most 16 items.");
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.startsWith("data:")) {
      throw new Error(`referenceImages[${index}] must be a data URI string.`);
    }
    const commaIndex = item.indexOf(",");
    if (commaIndex === -1) {
      throw new Error(`referenceImages[${index}] is not a valid data URI.`);
    }
    const meta = item.slice(0, commaIndex);
    const mimeMatch = meta.match(/^data:([^;,]+);base64$/i);
    const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : "";
    if (!GPT_IMAGE_2_REFERENCE_IMAGE_TYPES.has(mimeType)) {
      throw new Error(`referenceImages[${index}] must be a PNG, JPEG, or WebP data URI.`);
    }
    const base64 = item.slice(commaIndex + 1);
    if (estimateBase64Bytes(base64) > GPT_IMAGE_2_REFERENCE_IMAGE_BYTES) {
      throw new Error(`referenceImages[${index}] exceeds the 10 MB byte size limit.`);
    }
    return item;
  });
}

function normalizeGptImage2Request(body, prompt, modelConfig) {
  const quality = normalizeGptImage2Option(
    body?.quality,
    modelConfig?.qualityOptions || GPT_IMAGE_2_QUALITY_OPTIONS,
    modelConfig?.defaultQuality || "medium",
    "quality"
  );
  const size = normalizeGptImage2Option(
    body?.size,
    modelConfig?.sizeOptions || GPT_IMAGE_2_SIZE_OPTIONS,
    modelConfig?.defaultSize || "1024x1024",
    "size"
  );
  const outputFormat = normalizeGptImage2Option(
    body?.outputFormat ?? body?.output_format,
    modelConfig?.outputFormatOptions || GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
    modelConfig?.defaultOutputFormat || "png",
    "output format"
  );
  if (String(body?.background || "").trim() === "transparent") {
    throw new Error("Transparent background is not supported by GPT Image 2.");
  }
  const background = normalizeGptImage2Option(
    body?.background,
    modelConfig?.backgroundOptions || GPT_IMAGE_2_BACKGROUND_OPTIONS,
    modelConfig?.defaultBackground || "auto",
    "background"
  );
  const referenceImages = validateGptImage2ReferenceImages(body?.referenceImages);
  const payload = {
    prompt,
    quality,
    size,
    output_format: outputFormat,
    background,
  };
  if (referenceImages.length > 0) {
    payload.images = referenceImages;
  }
  return {
    payload,
    quality,
    size,
    outputFormat,
    background,
    referenceImages,
    referenceImageCount: referenceImages.length,
  };
}

function pushImageCandidate(candidates, value) {
  if (value === undefined || value === null) return;
  candidates.push(value);
}

function collectImageCandidates(result) {
  const candidates = [];
  if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
    pushImageCandidate(candidates, result.result?.image);
    pushImageCandidate(candidates, result.image);
    if (Array.isArray(result.images) && result.images.length > 0) pushImageCandidate(candidates, result.images[0]);
    pushImageCandidate(candidates, result.data?.image);
    if (Array.isArray(result.data) && result.data.length > 0) {
      pushImageCandidate(candidates, result.data[0]?.url);
      pushImageCandidate(candidates, result.data[0]?.image);
      pushImageCandidate(candidates, result.data[0]);
    } else {
      pushImageCandidate(candidates, result.data);
    }
    if (Array.isArray(result.output) && result.output.length > 0) {
      pushImageCandidate(candidates, result.output[0]?.image);
      pushImageCandidate(candidates, result.output[0]);
    }
  }
  pushImageCandidate(candidates, result);
  return candidates;
}

function isHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchProviderImageUrl(env, url) {
  const fetcher = env.__TEST_FETCH || globalThis.fetch;
  const response = await fetcher(url, { method: "GET" });
  if (!response?.ok) {
    throw new Error("provider_image_fetch_failed");
  }
  const mimeType = String(response.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!GPT_IMAGE_2_REFERENCE_IMAGE_TYPES.has(mimeType)) {
    throw new Error("provider_image_unsupported_type");
  }
  const contentLength = Number(response.headers?.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_IMAGE_FETCH_BYTES) {
    throw new Error("provider_image_too_large");
  }
  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_PROVIDER_IMAGE_FETCH_BYTES) {
    throw new Error("provider_image_too_large");
  }
  return {
    base64: encodeBytesToBase64(new Uint8Array(buffer)),
    mimeType,
    imageUrl: String(url),
  };
}

async function extractGeneratedImage(env, result, { allowProviderUrl = false } = {}) {
  for (const v of collectImageCandidates(result)) {
    if (typeof v === "string" && v.length > 0) {
      const parsed = parseBase64Image(v);
      if (parsed) {
        return {
          base64: parsed.base64,
          mimeType: parsed.mimeType,
          imageUrl: null,
        };
      }
      if (allowProviderUrl && isHttpsUrl(v)) {
        return fetchProviderImageUrl(env, v);
      }
    }

    const buf = await toArrayBuffer(v);
    if (buf && buf.byteLength > 0) {
      return {
        base64: encodeBytesToBase64(new Uint8Array(buf)),
        mimeType: "image/png",
        imageUrl: null,
      };
    }
  }
  return null;
}

function decodeDataUriImage(imageData) {
  const match = String(imageData).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("invalid_image_data_format");
  }

  try {
    return {
      mimeType: match[1],
      imageBytes: decodeBase64ToBytes(match[2]),
    };
  } catch {
    throw new Error("invalid_base64_image_data");
  }
}

function logSaveReferenceRejection({ correlationId, userId, reason }) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-save-image",
    event: "ai_image_save_reference_rejected",
    level: "warn",
    correlationId,
    user_id: userId,
    failure_reason: reason,
  });
}

async function resolveSaveImageInput(env, body, userId, correlationId) {
  const saveReference = typeof body?.save_reference === "string"
    ? body.save_reference.trim()
    : "";

  if (saveReference) {
    if (saveReference.length > MAX_SAVE_REFERENCE_LENGTH) {
      logSaveReferenceRejection({
        correlationId,
        userId,
        reason: "reference_too_long",
      });
      throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
        reason: "malformed",
      });
    }

    let reference;
    try {
      reference = await decodeAiGeneratedSaveReference(env, saveReference, { userId });
    } catch (error) {
      if (error instanceof AiGeneratedSaveReferenceError) {
        logSaveReferenceRejection({
          correlationId,
          userId,
          reason: error.reason,
        });
      }
      throw error;
    }

    const tempObject = await env.USER_IMAGES.get(reference.tempKey);
    if (!tempObject) {
      logSaveReferenceRejection({
        correlationId,
        userId,
        reason: "object_missing",
      });
      throw new AiGeneratedSaveReferenceError(
        "Generated image is no longer available. Please generate it again.",
        {
          status: 404,
          code: "SAVE_REFERENCE_UNAVAILABLE",
          reason: "object_missing",
        }
      );
    }

    const tempBuffer = await toArrayBuffer(tempObject.body ?? tempObject);
    if (!tempBuffer || tempBuffer.byteLength === 0) {
      logSaveReferenceRejection({
        correlationId,
        userId,
        reason: "object_unreadable",
      });
      throw new AiGeneratedSaveReferenceError(
        "Generated image is no longer available. Please generate it again.",
        {
          status: 404,
          code: "SAVE_REFERENCE_UNAVAILABLE",
          reason: "object_unreadable",
        }
      );
    }

    return {
      imageBytes: new Uint8Array(tempBuffer),
      savedMimeType: tempObject.httpMetadata?.contentType || "image/png",
      tempKey: reference.tempKey,
    };
  }

  if (!body?.imageData) {
    throw new Error("missing_image_data");
  }

  const { mimeType, imageBytes } = decodeDataUriImage(body.imageData);
  return {
    imageBytes,
    savedMimeType: mimeType,
    tempKey: null,
  };
}

async function replayOrgScopedGeneratedImage({
  env,
  usagePolicy,
  prompt,
  aiRequest,
  modelConfig,
  respond,
  correlationId,
  userId,
}) {
  const attempt = usagePolicy.attempt;
  if (usagePolicy.attemptKind === "completed_expired") {
    return respond({
      ok: false,
      error: "The idempotent image result is no longer available.",
      code: "ai_usage_result_expired",
      billing: usagePolicy.billingMetadata({ replay: true }),
    }, { status: 410 });
  }

  if (
    attempt.resultStatus !== "stored" ||
    !attempt.resultTempKey ||
    !attempt.resultSaveReference
  ) {
    return respond({
      ok: false,
      error: "The idempotent image request completed, but the generated image is no longer replayable.",
      code: "ai_usage_result_unavailable",
      billing: usagePolicy.billingMetadata({ replay: true }),
    }, { status: 409 });
  }

  const tempObject = await env.USER_IMAGES.get(attempt.resultTempKey);
  if (!tempObject) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_usage_replay_temp_missing",
      level: "warn",
      correlationId,
      user_id: userId,
      organization_id: usagePolicy.organizationId,
    });
    return respond({
      ok: false,
      error: "The idempotent image result is no longer available.",
      code: "ai_usage_result_unavailable",
      billing: usagePolicy.billingMetadata({ replay: true }),
    }, { status: 410 });
  }

  const tempBuffer = await toArrayBuffer(tempObject.body ?? tempObject);
  if (!tempBuffer || tempBuffer.byteLength === 0) {
    return respond({
      ok: false,
      error: "The idempotent image result is no longer available.",
      code: "ai_usage_result_unavailable",
      billing: usagePolicy.billingMetadata({ replay: true }),
    }, { status: 410 });
  }

  return respond({
    ok: true,
    data: {
      imageBase64: encodeBytesToBase64(new Uint8Array(tempBuffer)),
      mimeType: tempObject.httpMetadata?.contentType || attempt.resultMimeType || "image/png",
      prompt,
      steps: attempt.resultSteps ?? aiRequest.steps,
      seed: attempt.resultSeed ?? aiRequest.seed,
      model: attempt.resultModel || modelConfig.id,
      saveReference: attempt.resultSaveReference,
    },
    billing: usagePolicy.billingMetadata({ replay: true }),
  });
}

export async function handleGenerateImage(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";

  const limit = await evaluateSharedRateLimit(env, "ai-generate-user", userId, GENERATION_LIMIT, GENERATION_WINDOW_MS, sensitiveRateLimitOptions({
    component: "ai-generate",
    correlationId,
    requestInfo: { request, pathname: "/api/ai/generate-image", method: request.method },
  }));
  if (limit.unavailable) {
    return rateLimitUnavailableResponse(correlationId);
  }
  if (limit.limited) {
    return rateLimitResponse();
  }

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiGenerateImageJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);
  const body = parsed.body;
  if (!body || !body.prompt) {
    return respond({ ok: false, error: "Prompt is required." }, { status: 400 });
  }

  const prompt = String(body.prompt).trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    return respond(
      { ok: false, error: `Prompt must be 1–${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const requestedModel = body.model;
  const modelConfig = resolveAiImageModel(requestedModel);
  if (!modelConfig) {
    return respond({ ok: false, error: "Unsupported image model." }, { status: 400 });
  }

  let steps = DEFAULT_STEPS;
  if (body.steps !== undefined && body.steps !== null) {
    steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.floor(Number(body.steps))));
    if (isNaN(steps)) steps = DEFAULT_STEPS;
  }

  let seed = null;
  if (body.seed !== undefined && body.seed !== null) {
    seed = Math.floor(Number(body.seed));
    if (isNaN(seed) || seed < 0) seed = null;
  }
  const gptImage2 = isGptImage2Model(modelConfig);
  let aiRequest = null;
  let gptRequest = null;
  try {
    if (gptImage2) {
      gptRequest = normalizeGptImage2Request(body, prompt, modelConfig);
      aiRequest = {
        payload: gptRequest.payload,
        steps: null,
        seed: null,
      };
    } else {
      aiRequest = buildAiImageInput(modelConfig, prompt, steps, seed);
    }
  } catch (error) {
    return respond({ ok: false, error: error.message || "Invalid image request." }, { status: 400 });
  }
  const imagePricing = calculateAiImageCreditCost(modelConfig.id, gptImage2
    ? {
        quality: gptRequest.quality,
        size: gptRequest.size,
        outputFormat: gptRequest.outputFormat,
        background: gptRequest.background,
        referenceImageCount: gptRequest.referenceImageCount,
      }
    : {
        width: 1024,
        height: 1024,
        steps: aiRequest.steps,
      });
  if (!imagePricing) {
    return respond({ ok: false, error: "Image model pricing is unavailable." }, { status: 503 });
  }
  let usagePolicy = null;
  try {
    usagePolicy = await prepareAiUsagePolicy({
      env,
      request,
      user: session.user,
      body,
      operation: {
        ...AI_USAGE_OPERATIONS.MEMBER_IMAGE_GENERATE,
        credits: imagePricing.credits,
      },
      route: "/api/ai/generate-image",
    });
  } catch (error) {
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_usage_policy_rejected",
      level: policyError.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "ai_usage_policy_rejected",
      ...getErrorFields(error),
    });
    return respond(policyError.body, { status: policyError.status });
  }

  if (usagePolicy.mode === "organization") {
    if (usagePolicy.attemptKind === "completed" || usagePolicy.attemptKind === "completed_expired") {
      return replayOrgScopedGeneratedImage({
        env,
        usagePolicy,
        prompt,
        aiRequest,
        modelConfig,
        respond,
        correlationId,
        userId,
      });
    }
    if (usagePolicy.attemptKind === "in_progress") {
      return respond({
        ok: false,
        error: "This idempotent image request is already in progress.",
        code: "ai_usage_attempt_in_progress",
        billing: {
          organization_id: usagePolicy.organizationId,
          feature: usagePolicy.featureKey,
          credits_reserved: usagePolicy.credits,
        },
      }, { status: 409 });
    }
    if (usagePolicy.attemptKind === "billing_failed") {
      return respond({
        ok: false,
        error: "Image generation could not be finalized. Please use a new idempotency key to retry.",
        code: "ai_usage_billing_failed",
        billing: {
          organization_id: usagePolicy.organizationId,
          feature: usagePolicy.featureKey,
        },
      }, { status: 503 });
    }
  }

  if (usagePolicy.mode === "member") {
    try {
      await usagePolicy.prepareForProvider();
    } catch (error) {
      const policyError = aiUsagePolicyErrorResponse(error);
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-image",
        event: "member_credit_policy_rejected",
        level: policyError.status >= 500 ? "error" : "warn",
        correlationId,
        user_id: userId,
        code: policyError.body?.code || "member_credit_policy_rejected",
        ...getErrorFields(error),
      });
      return respond(policyError.body, { status: policyError.status });
    }
  }

  let base64 = null;
  let mimeType = "image/png";
  let providerImageUrl = null;

  if (usagePolicy.mode === "organization") {
    try {
      await usagePolicy.markProviderRunning();
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-image",
        event: "ai_usage_attempt_start_failed",
        level: "error",
        correlationId,
        user_id: userId,
        organization_id: usagePolicy.organizationId,
        ...getErrorFields(error),
      });
      return respond({
        ok: false,
        error: "AI usage policy could not be verified.",
        code: "ai_usage_policy_unavailable",
      }, { status: 503 });
    }
  }

  try {
    const runOptions = gptImage2
      ? { gateway: { id: env.AI_GATEWAY_ID || "default" } }
      : undefined;
    if (gptImage2) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-image",
        event: "gpt_image_2_provider_request",
        level: "info",
        correlationId,
        user_id: userId,
        model: modelConfig.id,
        gateway_id: runOptions.gateway.id,
        quality: gptRequest.quality,
        size: gptRequest.size,
        output_format: gptRequest.outputFormat,
        background: gptRequest.background,
        reference_image_count: gptRequest.referenceImageCount,
        prompt_length: prompt.length,
        credits: imagePricing.credits,
      });
    }
    const result = gptImage2
      ? await env.AI.run(modelConfig.id, aiRequest.payload, runOptions)
      : await env.AI.run(modelConfig.id, aiRequest.payload);
    const extracted = await extractGeneratedImage(env, result, { allowProviderUrl: gptImage2 });
    if (extracted) {
      base64 = extracted.base64;
      mimeType = extracted.mimeType || mimeType;
      providerImageUrl = extracted.imageUrl || null;
    }
  } catch (e) {
    if (usagePolicy.mode === "organization") {
      try {
        await usagePolicy.markProviderFailed({
          code: "provider_failed",
          message: "Image provider call failed.",
        });
      } catch {}
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      request_mode: modelConfig.requestMode || "json",
      is_admin: isAdmin,
      ...getErrorFields(e),
    });
    return respond({ ok: false, error: "Image generation failed." }, { status: 502 });
  }

  if (!base64) {
    if (usagePolicy.mode === "organization") {
      try {
        await usagePolicy.markProviderFailed({
          code: "provider_empty_result",
          message: "Image provider returned no image.",
        });
      } catch {}
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_empty_result",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      is_admin: isAdmin,
    });
    return respond({ ok: false, error: "No image was generated." }, { status: 502 });
  }

  const logId = randomTokenHex(16);
  const completedAt = nowIso();
  try {
    await env.DB.prepare(
      "INSERT INTO ai_generation_log (id, user_id, created_at) VALUES (?, ?, ?)"
    ).bind(logId, userId, completedAt).run();
  } catch (e) {
    if (usagePolicy.mode === "organization") {
      try {
        await usagePolicy.markProviderFailed({
          code: "generation_finalize_failed",
          message: "Image generation finalization failed before billing.",
        });
      } catch {}
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_finalize_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      ...getErrorFields(e),
    });
    return respond(
      { ok: false, error: "Image generation could not be finalized. Please try again." },
      { status: 500 }
    );
  }

  let billingMetadata = null;
  try {
    if (usagePolicy.mode === "organization") {
      await usagePolicy.markFinalizing();
    }
    billingMetadata = await usagePolicy.chargeAfterSuccess({
      model: modelConfig.id,
      request_mode: modelConfig.requestMode || "json",
      pricing_source: "ai-image-credit-pricing",
      provider_cost_usd: imagePricing.providerCostUsd,
      pricing_normalized: imagePricing.normalized,
      ...(gptImage2 ? {
        quality: gptRequest.quality,
        size: gptRequest.size,
        output_format: gptRequest.outputFormat,
        background: gptRequest.background,
        reference_image_count: gptRequest.referenceImageCount,
        pricing_version: imagePricing.formula?.pricingVersion || "gpt-image-2-v1",
      } : {}),
    });
    if (usagePolicy.mode === "organization") {
      await usagePolicy.markSucceeded({
        mimeType,
        model: modelConfig.id,
        promptLength: prompt.length,
        steps: aiRequest.steps,
        seed: aiRequest.seed,
        balanceAfter: billingMetadata.balance_after,
      });
    }
  } catch (error) {
    if (usagePolicy.mode === "organization") {
      try {
        await usagePolicy.markBillingFailed({
          code: error?.code || "billing_failed",
          message: "AI usage billing finalization failed.",
        });
      } catch {}
    }
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_usage_charge_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      code: policyError.body?.code || "ai_usage_charge_failed",
    });
    return respond(policyError.body, { status: policyError.status });
  }

  let tempSavePayload = {};
  let tempSaveResult = null;
  try {
    tempSaveResult = await createAiGeneratedSaveReferenceFromBase64(env, {
      userId,
      imageBase64: base64,
      mimeType,
    });
    tempSavePayload = {
      saveReference: tempSaveResult.saveReference,
    };
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generated_temp_store_failed",
      level: "warn",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      is_admin: isAdmin,
      ...getErrorFields(error),
    });
  }

  if (usagePolicy.mode === "organization" && tempSaveResult) {
    try {
      await usagePolicy.markSucceeded({
        tempKey: tempSaveResult.tempKey,
        saveReference: tempSaveResult.saveReference,
        mimeType,
        model: modelConfig.id,
        promptLength: prompt.length,
        steps: aiRequest.steps,
        seed: aiRequest.seed,
        balanceAfter: billingMetadata?.balance_after ?? null,
      });
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-image",
        event: "ai_usage_attempt_result_update_failed",
        level: "error",
        correlationId,
        user_id: userId,
        organization_id: usagePolicy.organizationId,
        ...getErrorFields(error),
      });
    }
  }

  return respond({
    ok: true,
    data: {
      imageBase64: base64,
      mimeType,
      prompt,
      steps: aiRequest.steps,
      seed: aiRequest.seed,
      model: modelConfig.id,
      ...(gptImage2 ? {
        quality: gptRequest.quality,
        size: gptRequest.size,
        outputFormat: gptRequest.outputFormat,
        background: gptRequest.background,
        referenceImageCount: gptRequest.referenceImageCount,
        imageUrl: providerImageUrl,
      } : {}),
      ...tempSavePayload,
    },
    ...(billingMetadata ? { billing: billingMetadata } : {}),
  });
}

export async function handleRenameImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceAiImageWriteRateLimit(ctx, session.user.id, {
    scope: "ai-image-rename-user",
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-image-rename",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const name = String(body?.name || "").trim();
  if (name.length === 0 || name.length > MAX_PROMPT_LENGTH) {
    return json({ ok: false, error: `Image name must be 1–${MAX_PROMPT_LENGTH} characters.` }, { status: 400 });
  }
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Image name cannot contain control characters." }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    "SELECT id, prompt FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!existing) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  if (existing.prompt === name) {
    return json({
      ok: true,
      data: {
        id: existing.id,
        title: existing.prompt,
        prompt: existing.prompt,
        unchanged: true,
      },
    });
  }

  await env.DB.prepare(
    "UPDATE ai_images SET prompt = ? WHERE id = ? AND user_id = ?"
  ).bind(name, imageId, session.user.id).run();

  return json({
    ok: true,
    data: {
      id: imageId,
      title: name,
      prompt: name,
      unchanged: false,
    },
  });
}

export async function handleSaveImage(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceAiImageWriteRateLimit(ctx, session.user.id, {
    scope: "ai-save-image-user",
    maxRequests: 30,
    windowMs: 60 * 60_000,
    component: "ai-save-image",
  });
  if (limited) return limited;

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiSaveImageJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);
  const body = parsed.body;
  if (!body || !body.prompt || (!body.imageData && !body.save_reference)) {
    return respond({ ok: false, error: "Image data and prompt are required." }, { status: 400 });
  }

  let folderId = null;
  let folderSlug = "unsorted";
  if (body.folder_id) {
    const folder = await env.DB.prepare(
      "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(body.folder_id, session.user.id).first();
    if (!folder) {
      return respond({ ok: false, error: "Folder not found." }, { status: 404 });
    }
    folderId = folder.id;
    folderSlug = folder.slug;
  }

  let imageBytes;
  let savedMimeType = "image/png";
  let tempKey = null;
  try {
    const resolved = await resolveSaveImageInput(env, body, session.user.id, correlationId);
    imageBytes = resolved.imageBytes;
    savedMimeType = resolved.savedMimeType;
    tempKey = resolved.tempKey;
  } catch (error) {
    if (error instanceof AiGeneratedSaveReferenceError) {
      return respond(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error?.message === "invalid_image_data_format") {
      return respond({ ok: false, error: "Invalid image data format." }, { status: 400 });
    }
    if (error?.message === "invalid_base64_image_data") {
      return respond({ ok: false, error: "Invalid base64 image data." }, { status: 400 });
    }
    if (error?.message === "missing_image_data") {
      return respond({ ok: false, error: "Image data and prompt are required." }, { status: 400 });
    }
    throw error;
  }

  if (imageBytes.byteLength > MAX_SAVED_AI_IMAGE_BYTES) {
    return respond({ ok: false, error: "Image data must be 10 MB or smaller." }, { status: 400 });
  }

  const isPng = imageBytes.length >= 4 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47;
  const isJpeg = imageBytes.length >= 3 && imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
  const isWebp = imageBytes.length >= 12 && imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x46 && imageBytes[8] === 0x57 && imageBytes[9] === 0x45 && imageBytes[10] === 0x42 && imageBytes[11] === 0x50;
  if (!isPng && !isJpeg && !isWebp) {
    return respond({ ok: false, error: "Invalid image format." }, { status: 400 });
  }

  if (!env?.IMAGES || typeof env.IMAGES.info !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_inspection_unavailable",
      level: "error",
      correlationId,
      user_id: session.user.id,
    });
    return respond(
      { ok: false, error: "Image save is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  let imageInfo;
  try {
    imageInfo = await env.IMAGES.info(imageBytes);
  } catch {
    return respond({ ok: false, error: "Image dimensions could not be inspected." }, { status: 400 });
  }

  const width = Number(imageInfo?.width);
  const height = Number(imageInfo?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return respond({ ok: false, error: "Image dimensions could not be inspected." }, { status: 400 });
  }

  const imageId = randomTokenHex(16);
  const timestamp = Date.now();
  const random = randomTokenHex(4);
  const r2Key = `users/${session.user.id}/folders/${folderSlug}/${timestamp}-${random}.png`;
  const now = nowIso();

  await env.USER_IMAGES.put(r2Key, imageBytes.buffer, {
    httpMetadata: { contentType: savedMimeType },
  });
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-save-image",
    event: "ai_image_stored",
    correlationId,
    user_id: session.user.id,
    image_id: imageId,
    r2_key: r2Key,
    size_bytes: imageBytes.byteLength,
    mime_type: savedMimeType,
    width,
    height,
    folder_id: folderId,
  });

  const prompt = String(body.prompt).slice(0, MAX_PROMPT_LENGTH);
  const model = String(body.model || MODEL).slice(0, 100);
  const steps = body.steps ? Math.floor(Number(body.steps)) : null;
  const seed = body.seed !== undefined && body.seed !== null ? Math.floor(Number(body.seed)) : null;

  let insertResult;
  try {
    if (folderId) {
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
      ).bind(imageId, session.user.id, folderId, r2Key, prompt, model, steps, seed, now,
        folderId, session.user.id).run();
    } else {
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(imageId, session.user.id, null, r2Key, prompt, model, steps, seed, now).run();
    }
  } catch (e) {
    try { await env.USER_IMAGES.delete(r2Key); } catch {}
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_metadata_insert_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      folder_id: folderId,
      r2_key: r2Key,
      ...getErrorFields(e),
    });
    return respond({ ok: false, error: "Failed to save image. The folder may have been deleted." }, { status: 409 });
  }

  if (!insertResult.meta.changes) {
    try { await env.USER_IMAGES.delete(r2Key); } catch {}
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_folder_deleted_before_insert",
      level: "warn",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      folder_id: folderId,
      r2_key: r2Key,
    });
    return respond({ ok: false, error: "Folder was deleted. Image not saved." }, { status: 404 });
  }

  let derivativesEnqueued = true;
  try {
    await enqueueAiImageDerivativeJob(env, {
      imageId,
      userId: session.user.id,
      originalKey: r2Key,
      derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
      correlationId,
      trigger: "save",
    });
  } catch (error) {
    derivativesEnqueued = false;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_derivative_enqueue_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      r2_key: r2Key,
      ...getErrorFields(error),
    });
    try {
      await env.DB.prepare(
        "UPDATE ai_images SET derivatives_error = ?, derivatives_attempted_at = ? WHERE id = ? AND user_id = ?"
      ).bind(
        String(error?.message || error || "Queue enqueue failed.").slice(0, 500),
        nowIso(),
        imageId,
        session.user.id
      ).run();
    } catch {}
  }

  if (tempKey) {
    try {
      await env.USER_IMAGES.delete(tempKey);
    } catch (error) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-save-image",
        event: "ai_generated_temp_delete_failed",
        level: "warn",
        correlationId,
        user_id: session.user.id,
        image_id: imageId,
        failure_reason: "post_save_cleanup_failed",
        ...getErrorFields(error),
      });
    }
  }

  return respond({
    ok: true,
    data: {
      id: imageId,
      folder_id: folderId,
      prompt,
      model,
      steps,
      seed,
      created_at: now,
      derivatives_status: "pending",
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      derivatives_enqueued: derivativesEnqueued,
    },
  }, { status: 201 });
}

export async function handleDeleteImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const limited = await enforceAiImageWriteRateLimit(ctx, session.user.id, {
    scope: "ai-delete-image-user",
    maxRequests: 60,
    windowMs: 10 * 60_000,
    component: "ai-delete-image",
  });
  if (limited) return limited;

  try {
    await deleteUserAiImage({
      env,
      userId: session.user.id,
      imageId,
    });
  } catch (error) {
    if (!(error instanceof AiAssetLifecycleError)) {
      throw error;
    }
    return json(
      { ok: false, error: error.message },
      { status: error.status }
    );
  }
  return json({ ok: true });
}
