import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { BODY_LIMITS, readJsonBodyOrResponse } from "../../lib/request.js";
import {
  evaluateSharedRateLimit,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../../lib/rate-limit.js";
import {
  AI_USAGE_OPERATIONS,
  aiUsagePolicyErrorResponse,
  prepareAiUsagePolicy,
} from "../../lib/ai-usage-policy.js";
import { getAiUsageAttemptReplayMetadata } from "../../lib/ai-usage-attempts.js";
import {
  assertAuthAiServiceConfig,
  logWorkerConfigFailure,
  workerConfigUnavailableResponse,
  WorkerConfigError,
} from "../../lib/config.js";
import { buildServiceAuthHeaders } from "../../../../../js/shared/service-auth.mjs";
import {
  BITBI_CORRELATION_HEADER,
  getDurationMs,
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../../js/shared/worker-observability.mjs";
import { hasControlCharacters } from "./helpers.js";

const ROUTE_PATH = "/api/ai/generate-text";
const INTERNAL_TEXT_PATH = "/internal/ai/test-text";
const AI_LAB_BASE_URL = "https://bitbi-ai.internal";
const MEMBER_TEXT_PRESET = "fast";
const MAX_PROMPT_LENGTH = 2000;
const DEFAULT_MAX_TOKENS = 300;
const MAX_MAX_TOKENS = 600;
const DEFAULT_TEMPERATURE = 0.7;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1.5;
const MAX_REPLAY_TEXT_LENGTH = 12_000;
const GENERATION_LIMIT = 60;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const ALLOWED_BODY_FIELDS = new Set([
  "organization_id",
  "organizationId",
  "prompt",
  "max_tokens",
  "maxTokens",
  "temperature",
]);

function validationError(error, code = "validation_error") {
  return {
    ok: false,
    error,
    code,
  };
}

function normalizeOrgContext(body) {
  const hasSnake = Object.prototype.hasOwnProperty.call(body, "organization_id");
  const hasCamel = Object.prototype.hasOwnProperty.call(body, "organizationId");
  if (!hasSnake && !hasCamel) {
    throw Object.assign(new Error("Organization context is required."), {
      status: 400,
      code: "organization_required",
    });
  }
  if (hasSnake && hasCamel && String(body.organization_id) !== String(body.organizationId)) {
    throw Object.assign(new Error("Organization context is inconsistent."), {
      status: 400,
      code: "organization_conflict",
    });
  }
  return hasSnake ? body.organization_id : body.organizationId;
}

function optionalInteger(body, snakeName, camelName, { defaultValue, min, max }) {
  const hasSnake = Object.prototype.hasOwnProperty.call(body, snakeName);
  const hasCamel = Object.prototype.hasOwnProperty.call(body, camelName);
  if (hasSnake && hasCamel && Number(body[snakeName]) !== Number(body[camelName])) {
    throw Object.assign(new Error(`${snakeName} is inconsistent.`), {
      status: 400,
      code: "validation_error",
    });
  }
  const raw = hasSnake ? body[snakeName] : (hasCamel ? body[camelName] : undefined);
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw Object.assign(new Error(`${snakeName} must be an integer from ${min} to ${max}.`), {
      status: 400,
      code: "validation_error",
    });
  }
  return value;
}

function normalizeTemperature(body) {
  if (body.temperature === undefined || body.temperature === null || body.temperature === "") {
    return DEFAULT_TEMPERATURE;
  }
  const value = Number(body.temperature);
  if (!Number.isFinite(value) || value < MIN_TEMPERATURE || value > MAX_TEMPERATURE) {
    throw Object.assign(new Error(`temperature must be from ${MIN_TEMPERATURE} to ${MAX_TEMPERATURE}.`), {
      status: 400,
      code: "validation_error",
    });
  }
  return Math.round(value * 100) / 100;
}

function normalizeTextGenerationBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("JSON body is required."), {
      status: 400,
      code: "bad_request",
    });
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_FIELDS.has(key)) {
      throw Object.assign(new Error("Unsupported text generation option."), {
        status: 400,
        code: "unsupported_option",
      });
    }
  }

  const organizationId = normalizeOrgContext(body);
  const prompt = String(body.prompt || "").trim();
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH || hasControlCharacters(prompt)) {
    throw Object.assign(new Error(`Prompt must be 1-${MAX_PROMPT_LENGTH} safe characters.`), {
      status: 400,
      code: "invalid_prompt",
    });
  }
  const maxTokens = optionalInteger(body, "max_tokens", "maxTokens", {
    defaultValue: DEFAULT_MAX_TOKENS,
    min: 1,
    max: MAX_MAX_TOKENS,
  });
  const temperature = normalizeTemperature(body);

  return {
    organizationId,
    prompt,
    maxTokens,
    temperature,
    policyBody: {
      organization_id: organizationId,
      prompt,
      preset: MEMBER_TEXT_PRESET,
      maxTokens,
      temperature,
    },
    providerPayload: {
      preset: MEMBER_TEXT_PRESET,
      prompt,
      maxTokens,
      temperature,
    },
  };
}

function textBillingMetadata(usagePolicy, { replay = false, balanceAfter = null, creditsCharged = null } = {}) {
  return {
    organization_id: usagePolicy.organizationId,
    feature: usagePolicy.featureKey,
    credits_charged: creditsCharged == null ? usagePolicy.credits : creditsCharged,
    balance_after: balanceAfter == null ? usagePolicy.attempt?.balanceAfter ?? null : balanceAfter,
    idempotent_replay: Boolean(replay),
  };
}

async function signedAiLabTextRequest({
  env,
  payload,
  user,
  correlationId,
  requestInfo,
}) {
  const startedAt = Date.now();
  if (!env?.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-text",
      event: "member_ai_text_binding_missing",
      level: "error",
      correlationId,
      status: 503,
      upstream_path: INTERNAL_TEXT_PATH,
      user_id: user?.id || null,
    });
    return { ok: false, status: 503, code: "upstream_unavailable" };
  }

  const bodyText = JSON.stringify(payload);
  let serviceAuthHeaders;
  try {
    assertAuthAiServiceConfig(env);
    serviceAuthHeaders = await buildServiceAuthHeaders({
      secret: env.AI_SERVICE_AUTH_SECRET,
      method: "POST",
      path: INTERNAL_TEXT_PATH,
      body: bodyText,
    });
  } catch (error) {
    if (error instanceof WorkerConfigError || error?.code === "service_auth_unavailable") {
      logWorkerConfigFailure({
        env,
        error,
        correlationId,
        requestInfo,
        component: "member-ai-text-service-auth",
      });
      return { ok: false, response: workerConfigUnavailableResponse(correlationId) };
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-text",
      event: "member_ai_text_service_auth_sign_failed",
      level: "error",
      correlationId,
      user_id: user?.id || null,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { ok: false, status: 503, code: "service_auth_unavailable" };
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(new Request(`${AI_LAB_BASE_URL}${INTERNAL_TEXT_PATH}`, {
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
      component: "ai-generate-text",
      event: "member_ai_text_proxy_failed",
      level: "error",
      correlationId,
      user_id: user?.id || null,
      duration_ms: getDurationMs(startedAt),
      upstream_path: INTERNAL_TEXT_PATH,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return { ok: false, status: 503, code: "upstream_unavailable" };
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
      component: "ai-generate-text",
      event: "member_ai_text_upstream_error",
      level: response.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: user?.id || null,
      status: response.status,
      duration_ms: getDurationMs(startedAt),
      upstream_path: INTERNAL_TEXT_PATH,
    });
    return { ok: false, status: 502, code: "upstream_error" };
  }

  const text = String(body.result?.text || "").trim();
  if (!text) {
    return { ok: false, status: 502, code: "provider_empty_result" };
  }

  return {
    ok: true,
    text,
    model: body.model || null,
    maxTokens: body.result?.maxTokens ?? payload.maxTokens,
    temperature: body.result?.temperature ?? payload.temperature,
    elapsedMs: body.elapsedMs ?? null,
  };
}

async function replayTextAttempt({ env, usagePolicy, respond }) {
  if (usagePolicy.attemptKind === "completed_expired") {
    return respond({
      ok: false,
      error: "The idempotent text result is no longer available.",
      code: "ai_usage_result_expired",
      billing: textBillingMetadata(usagePolicy, { replay: true, creditsCharged: 0 }),
    }, { status: 410 });
  }

  const metadata = await getAiUsageAttemptReplayMetadata(env, usagePolicy.attempt.id);
  const replay = metadata?.replay;
  if (!replay || replay.kind !== "text" || typeof replay.text !== "string" || !replay.text) {
    return respond({
      ok: false,
      error: "The idempotent text request completed, but the generated text is no longer replayable.",
      code: "ai_usage_result_unavailable",
      billing: textBillingMetadata(usagePolicy, { replay: true, creditsCharged: 0 }),
    }, { status: 409 });
  }

  return respond({
    ok: true,
    text: replay.text,
    model: replay.model || null,
    billing: textBillingMetadata(usagePolicy, { replay: true, creditsCharged: 0 }),
  });
}

export async function handleGenerateText(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const limit = await evaluateSharedRateLimit(
    env,
    "ai-generate-text-user",
    userId,
    GENERATION_LIMIT,
    GENERATION_WINDOW_MS,
    sensitiveRateLimitOptions({
      component: "ai-generate-text",
      correlationId,
      requestInfo: { request, pathname: ROUTE_PATH, method: request.method },
    })
  );
  if (limit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (limit.limited) return rateLimitResponse();

  const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.aiGenerateJson });
  if (parsed.response) return withCorrelationId(parsed.response, correlationId);

  let input;
  try {
    input = normalizeTextGenerationBody(parsed.body);
  } catch (error) {
    return respond(validationError(error.message || "Invalid text generation request.", error.code), {
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
      operation: AI_USAGE_OPERATIONS.MEMBER_TEXT_GENERATE,
      route: ROUTE_PATH,
    });
  } catch (error) {
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-text",
      event: "ai_text_usage_policy_rejected",
      level: policyError.status >= 500 ? "error" : "warn",
      correlationId,
      user_id: userId,
      code: policyError.body?.code || "ai_usage_policy_rejected",
    });
    return respond(policyError.body, { status: policyError.status });
  }

  if (usagePolicy.mode !== "organization") {
    return respond({
      ok: false,
      error: "Organization context is required.",
      code: "organization_required",
    }, { status: 400 });
  }

  if (usagePolicy.attemptKind === "completed" || usagePolicy.attemptKind === "completed_expired") {
    return replayTextAttempt({ env, usagePolicy, respond });
  }
  if (usagePolicy.attemptKind === "in_progress") {
    return respond({
      ok: false,
      error: "This idempotent text request is already in progress.",
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
      error: "Text generation could not be finalized. Please use a new idempotency key to retry.",
      code: "ai_usage_billing_failed",
      billing: {
        organization_id: usagePolicy.organizationId,
        feature: usagePolicy.featureKey,
      },
    }, { status: 503 });
  }

  try {
    await usagePolicy.markProviderRunning();
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-text",
      event: "ai_text_usage_attempt_start_failed",
      level: "error",
      correlationId,
      user_id: userId,
      organization_id: usagePolicy.organizationId,
      ...getErrorFields(error, { includeMessage: false }),
    });
    return respond({
      ok: false,
      error: "AI usage policy could not be verified.",
      code: "ai_usage_policy_unavailable",
    }, { status: 503 });
  }

  const provider = await signedAiLabTextRequest({
    env,
    payload: input.providerPayload,
    user: session.user,
    correlationId,
    requestInfo: { request, pathname: ROUTE_PATH, method: request.method },
  });
  if (provider.response) {
    try {
      await usagePolicy.markProviderFailed({
        code: "provider_unavailable",
        message: "Text provider was unavailable.",
      });
    } catch {}
    return provider.response;
  }
  if (!provider.ok) {
    try {
      await usagePolicy.markProviderFailed({
        code: provider.code || "provider_failed",
        message: "Text provider call failed.",
      });
    } catch {}
    return respond({ ok: false, error: "Text generation failed.", code: provider.code || "upstream_error" }, {
      status: provider.status || 502,
    });
  }
  if (provider.text.length > MAX_REPLAY_TEXT_LENGTH) {
    try {
      await usagePolicy.markProviderFailed({
        code: "text_result_too_large",
        message: "Text provider returned an oversized result.",
      });
    } catch {}
    return respond({
      ok: false,
      error: "Text generation result was too large.",
      code: "text_result_too_large",
    }, { status: 502 });
  }

  let billingMetadata;
  try {
    await usagePolicy.markFinalizing();
    billingMetadata = await usagePolicy.chargeAfterSuccess({
      model: provider.model?.id || null,
      preset: MEMBER_TEXT_PRESET,
      request_mode: "service-binding",
    });
  } catch (error) {
    try {
      await usagePolicy.markBillingFailed({
        code: error?.code || "billing_failed",
        message: "AI usage billing finalization failed.",
      });
    } catch {}
    const policyError = aiUsagePolicyErrorResponse(error);
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-text",
      event: "ai_text_usage_charge_failed",
      level: "error",
      correlationId,
      user_id: userId,
      organization_id: usagePolicy.organizationId,
      code: policyError.body?.code || "ai_usage_charge_failed",
    });
    return respond(policyError.body, { status: policyError.status });
  }

  try {
    await usagePolicy.markSucceeded({
      mimeType: "text/plain; charset=utf-8",
      model: provider.model?.id || null,
      promptLength: input.prompt.length,
      balanceAfter: billingMetadata.balance_after,
      resultStatus: "stored",
      metadata: {
        replay: {
          kind: "text",
          text: provider.text.slice(0, MAX_REPLAY_TEXT_LENGTH),
          model: provider.model || null,
          maxTokens: provider.maxTokens,
          temperature: provider.temperature,
        },
      },
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-text",
      event: "ai_text_attempt_result_update_failed",
      level: "error",
      correlationId,
      user_id: userId,
      organization_id: usagePolicy.organizationId,
      ...getErrorFields(error, { includeMessage: false }),
    });
  }

  return respond({
    ok: true,
    text: provider.text,
    model: provider.model || null,
    billing: {
      ...billingMetadata,
      idempotent_replay: false,
    },
  });
}
