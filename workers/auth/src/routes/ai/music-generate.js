import { AdminAiValidationError, validateAdminAiMusicBody } from "../../../../../js/shared/admin-ai-contract.mjs";
import {
  MINIMAX_MUSIC_2_6_BASE_CREDITS,
  MINIMAX_MUSIC_2_6_MODEL_ID,
  MINIMAX_MUSIC_2_6_WITH_SEPARATE_LYRICS_CREDITS,
  calculateMinimaxMusic26CreditCost,
} from "../../../../../js/shared/music-2-6-pricing.mjs";
import { buildServiceAuthHeaders } from "../../../../../js/shared/service-auth.mjs";
import {
  BITBI_CORRELATION_HEADER,
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
import { saveAdminAiTextAsset } from "../../lib/ai-text-assets.js";
import {
  assertAuthAiServiceConfig,
  logWorkerConfigFailure,
  workerConfigUnavailableResponse,
  WorkerConfigError,
} from "../../lib/config.js";
import { fetchGeneratedAudioForSave } from "../../lib/generated-audio-save.js";
import { scheduleMemberMusicCoverGeneration } from "../../lib/member-music-cover.js";
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
import { nowIso } from "../../lib/tokens.js";
import { deleteUserAiTextAsset } from "./lifecycle.js";
import { hasControlCharacters } from "./helpers.js";

export const MEMBER_MUSIC_26_BASE_CREDITS = MINIMAX_MUSIC_2_6_BASE_CREDITS;
export const MEMBER_MUSIC_26_WITH_SEPARATE_LYRICS_CREDITS = MINIMAX_MUSIC_2_6_WITH_SEPARATE_LYRICS_CREDITS;

const ROUTE_PATH = "/api/ai/generate-music";
const INTERNAL_TEXT_PATH = "/internal/ai/test-text";
const INTERNAL_MUSIC_PATH = "/internal/ai/test-music";
const AI_LAB_BASE_URL = "https://bitbi-ai.internal";
const GENERATION_LIMIT = 24;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_PROMPT_LENGTH = 2000;
const MAX_LYRICS_LENGTH = 3500;
const MAX_TITLE_LENGTH = 120;
const MAX_GENERATED_LYRICS_LENGTH = 3500;
const DEFAULT_MUSIC_TITLE = "Sound Lab Track";
const ALLOWED_BODY_FIELDS = new Set([
  "prompt",
  "lyrics",
  "instrumental",
  "generateLyrics",
  "separateLyrics",
  "folder_id",
  "folderId",
  "title",
  "credits",
  "creditPrice",
  "price",
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

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hasUnsafeControlCharacters(value, { allowNewlines = false } = {}) {
  if (allowNewlines) {
    return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
  }
  return hasControlCharacters(value);
}

function normalizeOptionalString(value, maxLength, fieldName, { allowNewlines = false } = {}) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text.length > maxLength || hasUnsafeControlCharacters(text, { allowNewlines })) {
    throw validationError(`${fieldName} must be 1-${maxLength} safe characters.`, `invalid_${fieldName}`);
  }
  return text;
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
  if (!compact) return DEFAULT_MUSIC_TITLE;
  return compact.slice(0, MAX_TITLE_LENGTH);
}

export function calculateMemberMusic26CreditCost({ separateLyricsGeneration = false } = {}) {
  return calculateMinimaxMusic26CreditCost({ separateLyricsGeneration }).credits;
}

function normalizeMemberMusicBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("JSON body is required.", "bad_request");
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_FIELDS.has(key)) {
      throw validationError("Unsupported music generation option.", "unsupported_option");
    }
  }

  const prompt = normalizeOptionalString(body.prompt, MAX_PROMPT_LENGTH, "prompt");
  if (!prompt) {
    throw validationError(`prompt must be 1-${MAX_PROMPT_LENGTH} safe characters.`, "invalid_prompt");
  }
  const lyrics = normalizeOptionalString(body.lyrics, MAX_LYRICS_LENGTH, "lyrics", { allowNewlines: true });
  const instrumental = normalizeBoolean(body.instrumental);
  const separateLyricsGeneration = normalizeBoolean(body.generateLyrics) || normalizeBoolean(body.separateLyrics);
  if (instrumental && separateLyricsGeneration) {
    throw validationError("Separate lyrics generation is not available in instrumental mode.", "invalid_lyrics_generation");
  }
  if (lyrics && separateLyricsGeneration) {
    throw validationError("Use either manual lyrics or generated lyrics, not both.", "invalid_lyrics_generation");
  }

  const title = normalizeOptionalString(body.title, MAX_TITLE_LENGTH, "title") || titleFromPrompt(prompt);
  const folderId = normalizeFolderId(body);
  const price = calculateMemberMusic26CreditCost({ separateLyricsGeneration });
  const musicMode = instrumental ? "instrumental" : "vocals";
  const lyricsMode = instrumental ? "auto" : lyrics ? "custom" : "auto";

  return {
    prompt,
    lyrics,
    instrumental,
    separateLyricsGeneration,
    title,
    folderId,
    price,
    musicMode,
    lyricsMode,
    policyBody: {
      prompt,
      instrumental,
      generateLyrics: separateLyricsGeneration,
      hasManualLyrics: Boolean(lyrics),
    },
  };
}

function buildLyricsPrompt(input) {
  return [
    "Write complete song lyrics for a MiniMax Music 2.6 generation.",
    "Return only the lyrics, with concise section labels like [Verse] and [Chorus].",
    "Keep it under 220 words and make it singable.",
    "",
    `Music description: ${input.prompt}`,
  ].join("\n");
}

async function signedAiLabJsonRequest({
  env,
  path,
  payload,
  user,
  correlationId,
  requestInfo,
  component,
}) {
  const startedAt = Date.now();
  if (!env?.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component,
      event: "member_ai_music_binding_missing",
      level: "error",
      correlationId,
      status: 503,
      upstream_path: path,
      user_id: user?.id || null,
    });
    return { ok: false, status: 503, code: "upstream_unavailable", error: "AI lab service unavailable." };
  }

  const bodyText = JSON.stringify(payload);
  let serviceAuthHeaders;
  try {
    assertAuthAiServiceConfig(env);
    serviceAuthHeaders = await buildServiceAuthHeaders({
      secret: env.AI_SERVICE_AUTH_SECRET,
      method: "POST",
      path,
      body: bodyText,
    });
  } catch (error) {
    if (error instanceof WorkerConfigError || error?.code === "service_auth_unavailable") {
      logWorkerConfigFailure({
        env,
        error,
        correlationId,
        requestInfo,
        component,
      });
      return { ok: false, response: workerConfigUnavailableResponse(correlationId) };
    }
    logDiagnostic({
      service: "bitbi-auth",
      component,
      event: "member_ai_music_service_auth_sign_failed",
      level: "error",
      correlationId,
      user_id: user?.id || null,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { ok: false, status: 503, code: "service_auth_unavailable", error: "AI lab service unavailable." };
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(new Request(`${AI_LAB_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        accept: "application/json",
        "x-bitbi-user-id": user?.id || "",
        [BITBI_CORRELATION_HEADER]: correlationId,
        ...serviceAuthHeaders,
      },
      body: bodyText,
    }));
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component,
      event: "member_ai_music_proxy_failed",
      level: "error",
      correlationId,
      user_id: user?.id || null,
      duration_ms: getDurationMs(startedAt),
      upstream_path: path,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { ok: false, status: 503, code: "upstream_unavailable", error: "AI lab service unavailable." };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    logDiagnostic({
      service: "bitbi-auth",
      component,
      event: "member_ai_music_upstream_error",
      level: response.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: user?.id || null,
      status: response.status,
      duration_ms: getDurationMs(startedAt),
      upstream_path: path,
      upstream_code: body?.code || null,
    });
    return {
      ok: false,
      status: response.status >= 500 ? 502 : response.status,
      code: body?.code || "upstream_error",
      error: body?.error || "Music generation failed.",
      body,
    };
  }

  return {
    ok: true,
    body,
    elapsedMs: body.elapsedMs ?? null,
  };
}

async function generateLyrics({ env, input, user, correlationId, requestInfo }) {
  const response = await signedAiLabJsonRequest({
    env,
    path: INTERNAL_TEXT_PATH,
    payload: {
      preset: "fast",
      prompt: buildLyricsPrompt(input),
      maxTokens: 520,
      temperature: 0.82,
    },
    user,
    correlationId,
    requestInfo,
    component: "ai-generate-music-lyrics",
  });
  if (response.response) return response;
  if (!response.ok) return response;

  const text = String(response.body?.result?.text || response.body?.text || "").trim();
  if (!text) {
    return {
      ok: false,
      status: 502,
      code: "provider_empty_result",
      error: "Lyrics generation returned no text.",
    };
  }
  return {
    ok: true,
    lyrics: text.slice(0, MAX_GENERATED_LYRICS_LENGTH),
    model: response.body?.model || null,
    elapsedMs: response.elapsedMs,
  };
}

async function generateMusic({ env, input, lyrics, user, correlationId, requestInfo }) {
  const providerBody = validateAdminAiMusicBody({
    preset: "music_studio",
    prompt: input.prompt,
    mode: input.musicMode,
    lyricsMode: input.instrumental ? "auto" : lyrics ? "custom" : "auto",
    lyrics: input.instrumental ? null : lyrics || null,
  });

  return signedAiLabJsonRequest({
    env,
    path: INTERNAL_MUSIC_PATH,
    payload: providerBody,
    user,
    correlationId,
    requestInfo,
    component: "ai-generate-music",
  });
}

async function persistMusicResult({ env, userId, input, result, generatedLyrics, traceId, elapsedMs, correlationId }) {
  let audioBase64 = result.audioBase64 || null;
  let mimeType = String(result.mimeType || "audio/mpeg").trim();
  let sizeBytes = result.sizeBytes ?? null;

  if (!audioBase64 && result.audioUrl) {
    const fetched = await fetchGeneratedAudioForSave(result.audioUrl);
    audioBase64 = fetched.audioBase64;
    mimeType = fetched.mimeType;
    sizeBytes = fetched.sizeBytes;
  }
  if (!audioBase64) {
    const error = new Error("Music provider returned no savable audio.");
    error.status = 502;
    error.code = "provider_empty_result";
    throw error;
  }

  const saved = await saveAdminAiTextAsset(env, {
    userId,
    folderId: input.folderId,
    title: input.title,
    sourceModule: "music",
    payload: {
      audioBase64,
      mimeType,
      prompt: input.prompt,
      model: result.model || null,
      mode: result.mode || input.musicMode,
      lyricsMode: result.lyricsMode || (input.instrumental ? "auto" : generatedLyrics || input.lyrics ? "custom" : "auto"),
      lyricsPreview: generatedLyrics || result.lyricsPreview || input.lyrics || null,
      durationMs: result.durationMs ?? null,
      sampleRate: result.sampleRate ?? null,
      channels: result.channels ?? null,
      bitrate: result.bitrate ?? null,
      sizeBytes,
      traceId: traceId || null,
      warnings: [],
      elapsedMs,
      receivedAt: nowIso(),
    },
  });

  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-generate-music",
    event: "member_music_saved",
    correlationId,
    user_id: userId,
    asset_id: saved.id,
    folder_id: saved.folder_id,
    size_bytes: saved.size_bytes,
  });

  return {
    ...saved,
    file_url: `/api/ai/text-assets/${saved.id}/file`,
  };
}

async function cleanupSavedAsset(env, userId, assetId) {
  if (!assetId) return;
  try {
    await deleteUserAiTextAsset({ env, userId, assetId });
  } catch {}
}

export async function handleGenerateMusic(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const requestInfo = { request, pathname: ROUTE_PATH, method: request.method };
  const respond = (body, init) => respondWith(correlationId, body, init);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const limit = await evaluateSharedRateLimit(
    env,
    "ai-generate-music-user",
    userId,
    GENERATION_LIMIT,
    GENERATION_WINDOW_MS,
    sensitiveRateLimitOptions({
      component: "ai-generate-music",
      correlationId,
      requestInfo,
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (limit.limited) return rateLimitResponse();

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiGenerateJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);

  let input;
  try {
    input = normalizeMemberMusicBody(parsed.body);
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
        ...AI_USAGE_OPERATIONS.MEMBER_MUSIC_GENERATE,
        credits: input.price,
      },
      route: ROUTE_PATH,
    });
  } catch (error) {
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-music",
      event: "member_music_policy_rejected",
      level: policyError.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "member_music_policy_rejected",
      ...getErrorFields(error),
    });
    return respond(policyError.body, { status: policyError.status });
  }

  if (usagePolicy.mode === "organization") {
    return respond({
      ok: false,
      error: "Personal music generation does not accept organization context.",
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
        component: "ai-generate-music",
        event: "member_music_credit_policy_rejected",
        level: policyError.status >= 500 ? "error" : "warn",
        correlationId,
        user_id: userId,
        code: policyError.body?.code || "member_music_credit_policy_rejected",
        ...getErrorFields(error),
      });
      return respond(policyError.body, { status: policyError.status });
    }
  }

  let generatedLyrics = null;
  let lyricsModel = null;
  let lyricsElapsedMs = null;
  if (input.separateLyricsGeneration) {
    const lyricsResponse = await generateLyrics({ env, input, user: session.user, correlationId, requestInfo });
    if (lyricsResponse.response) return lyricsResponse.response;
    if (!lyricsResponse.ok) {
      return respond({
        ok: false,
        error: lyricsResponse.error || "Lyrics generation failed.",
        code: lyricsResponse.code || "upstream_error",
      }, { status: lyricsResponse.status || 502 });
    }
    generatedLyrics = lyricsResponse.lyrics;
    lyricsModel = lyricsResponse.model;
    lyricsElapsedMs = lyricsResponse.elapsedMs;
  }

  let musicResponse;
  try {
    musicResponse = await generateMusic({
      env,
      input,
      lyrics: generatedLyrics || input.lyrics || "",
      user: session.user,
      correlationId,
      requestInfo,
    });
  } catch (error) {
    if (error instanceof AdminAiValidationError) {
      return respond({ ok: false, error: error.message, code: error.code || "validation_error" }, {
        status: error.status || 400,
      });
    }
    throw error;
  }
  if (musicResponse.response) return musicResponse.response;
  if (!musicResponse.ok) {
    return respond({
      ok: false,
      error: musicResponse.error || "Music generation failed.",
      code: musicResponse.code || "upstream_error",
    }, { status: musicResponse.status || 502 });
  }

  const result = musicResponse.body?.result || {};
  if (!result.audioBase64 && !result.audioUrl) {
    return respond({ ok: false, error: "Music provider returned no audio.", code: "provider_empty_result" }, {
      status: 502,
    });
  }

  let savedAsset = null;
  try {
    savedAsset = await persistMusicResult({
      env,
      userId,
      input,
      result: {
        ...result,
        model: musicResponse.body?.model || null,
      },
      generatedLyrics,
      traceId: musicResponse.body?.traceId || null,
      elapsedMs: musicResponse.body?.elapsedMs ?? null,
      correlationId,
    });
  } catch (error) {
    const status = error?.status || 500;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-music",
      event: "member_music_save_failed",
      level: status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      ...getErrorFields(error),
    });
    return respond({
      ok: false,
      error: error?.message || "Generated music could not be saved.",
      code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
    }, { status });
  }

  let billingMetadata = null;
  try {
    billingMetadata = await usagePolicy.chargeAfterSuccess({
      model: musicResponse.body?.model?.id || MINIMAX_MUSIC_2_6_MODEL_ID,
      preset: musicResponse.body?.preset || "music_studio",
      request_mode: "service-binding",
      pricing_source: "minimax-music-2.6-shared-pricing",
      lyrics_generation: input.separateLyricsGeneration ? "separate_call" : "none",
      lyrics_model_id: lyricsModel?.id || null,
      lyrics_elapsed_ms: lyricsElapsedMs,
      asset_id: savedAsset.id,
      source_module: "music",
    });
  } catch (error) {
    await cleanupSavedAsset(env, userId, savedAsset?.id || null);
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-music",
      event: "member_music_charge_failed",
      level: "error",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "member_music_charge_failed",
      ...getErrorFields(error),
    });
    return respond(policyError.body, { status: policyError.status });
  }

  scheduleMemberMusicCoverGeneration(ctx, {
    env,
    userId,
    assetId: savedAsset.id,
    styleInput: input.prompt,
    correlationId,
  });

  return respond({
    ok: true,
    data: {
      prompt: input.prompt,
      mode: result.mode || input.musicMode,
      lyricsMode: result.lyricsMode || (input.instrumental ? "auto" : generatedLyrics || input.lyrics ? "custom" : "auto"),
      generatedLyrics,
      model: musicResponse.body?.model || null,
      preset: musicResponse.body?.preset || "music_studio",
      mimeType: savedAsset.mime_type,
      audioUrl: savedAsset.file_url,
      durationMs: result.durationMs ?? null,
      sampleRate: result.sampleRate ?? null,
      channels: result.channels ?? null,
      bitrate: result.bitrate ?? null,
      sizeBytes: savedAsset.size_bytes,
      lyricsPreview: generatedLyrics || result.lyricsPreview || input.lyrics || null,
      traceId: musicResponse.body?.traceId || null,
      asset: savedAsset,
    },
    ...(billingMetadata ? {
      billing: {
        ...billingMetadata,
        credits_charged: input.price,
        price: input.price,
        lyrics_generation: input.separateLyricsGeneration ? "separate_call" : "none",
      },
    } : {}),
  });
}
