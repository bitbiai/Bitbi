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
import {
  BITBI_GENERATION_TIMEOUT_SECONDS,
  fetchWithGenerationTimeout,
  isGenerationTimeoutError,
} from "../../lib/generation-timeout.js";
import { buildServiceAuthHeaders } from "../../../../../js/shared/service-auth.mjs";
import {
  AI_CALLER_POLICY_BUDGET_SCOPES,
  AI_CALLER_POLICY_CALLER_CLASSES,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES,
  AI_CALLER_POLICY_VERSION,
  withAiCallerPolicy,
} from "../../../../shared/ai-caller-policy.mjs";
import {
  BITBI_CORRELATION_HEADER,
  getDurationMs,
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../../js/shared/worker-observability.mjs";
import { hasControlCharacters } from "./helpers.js";
import {
  CANVAS_TEXT_DEFAULT_MAX_TOKENS,
  CANVAS_TEXT_MAX_PROMPT_LENGTH,
  CANVAS_TEXT_MAX_SYSTEM_PROMPT_LENGTH,
  estimateCanvasTextCredits,
  getCanvasModel,
} from "../../../../../js/shared/canvas-model-contract.mjs";

const ROUTE_PATH = "/api/ai/generate-text";
const INTERNAL_TEXT_PATH = "/internal/ai/test-text";
const AI_LAB_BASE_URL = "https://bitbi-ai.internal";
const MEMBER_TEXT_PRESET = "fast";
const DEFAULT_TEXT_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_PROMPT_LENGTH = CANVAS_TEXT_MAX_PROMPT_LENGTH;
const MAX_SYSTEM_PROMPT_LENGTH = CANVAS_TEXT_MAX_SYSTEM_PROMPT_LENGTH;
const DEFAULT_MAX_TOKENS = CANVAS_TEXT_DEFAULT_MAX_TOKENS;
const DEFAULT_TEMPERATURE = 0.7;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1.5;
const MAX_REPLAY_TEXT_LENGTH = 64_000;
const MAX_MESSAGES = 20;
const GENERATION_LIMIT = 60;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const ALLOWED_BODY_FIELDS = new Set([
  "organization_id",
  "organizationId",
  "model",
  "prompt",
  "system",
  "system_prompt",
  "systemPrompt",
  "messages",
  "max_tokens",
  "maxTokens",
  "temperature",
]);

function buildMemberTextCallerPolicy({ correlationId, budgetFingerprint = null, modelId, mode } = {}) {
  return {
    policy_version: AI_CALLER_POLICY_VERSION,
    operation_id: AI_USAGE_OPERATIONS.MEMBER_TEXT_GENERATE.id,
    budget_scope: mode === "organization"
      ? AI_CALLER_POLICY_BUDGET_SCOPES.ORGANIZATION_CREDIT_ACCOUNT
      : AI_CALLER_POLICY_BUDGET_SCOPES.MEMBER_CREDIT_ACCOUNT,
    enforcement_status: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.GATEWAY_ENFORCED,
    caller_class: mode === "organization"
      ? AI_CALLER_POLICY_CALLER_CLASSES.ORGANIZATION
      : AI_CALLER_POLICY_CALLER_CLASSES.MEMBER,
    owner_domain: "member-text",
    provider_family: "ai_worker",
    model_id: modelId,
    model_resolver_key: "member.text.model_catalog",
    idempotency_policy: "required",
    source_route: ROUTE_PATH,
    source_component: "auth-worker-member-text",
    budget_fingerprint: budgetFingerprint,
    request_fingerprint: budgetFingerprint,
    correlation_id: correlationId || null,
    reason: mode === "organization"
      ? "member_text_organization_credit_gateway_verified"
      : "member_text_personal_credit_gateway_verified",
  };
}

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
  if (!hasSnake && !hasCamel) return null;
  if (hasSnake && hasCamel && String(body.organization_id) !== String(body.organizationId)) {
    throw Object.assign(new Error("Organization context is inconsistent."), {
      status: 400,
      code: "organization_conflict",
    });
  }
  return hasSnake ? body.organization_id : body.organizationId;
}

function normalizeMessages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    throw Object.assign(new Error(`messages must contain at most ${MAX_MESSAGES} items.`), {
      status: 400,
      code: "invalid_messages",
    });
  }
  let totalLength = 0;
  const messages = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw Object.assign(new Error("Each message must be an object."), { status: 400, code: "invalid_messages" });
    }
    const role = String(entry.role || "").trim().toLowerCase();
    if (role !== "user" && role !== "assistant") {
      throw Object.assign(new Error("Message role must be user or assistant."), { status: 400, code: "invalid_messages" });
    }
    const content = String(entry.content || "").trim();
    if (!content || hasControlCharacters(content)) {
      throw Object.assign(new Error("Message content must be safe text."), { status: 400, code: "invalid_messages" });
    }
    totalLength += content.length;
    return { role, content };
  });
  if (totalLength > MAX_PROMPT_LENGTH) {
    throw Object.assign(new Error(`Message content must be at most ${MAX_PROMPT_LENGTH} characters.`), {
      status: 400,
      code: "invalid_messages",
    });
  }
  return messages;
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

function normalizeTextGenerationBody(body, { canvasMemberContext = false } = {}) {
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
  if (!canvasMemberContext && !organizationId) {
    throw Object.assign(new Error("Organization context is required."), {
      status: 400,
      code: "organization_required",
    });
  }
  const modelId = String(body.model || DEFAULT_TEXT_MODEL_ID).trim();
  const model = getCanvasModel(modelId);
  if (!model || model.capability !== "text" || !model.runnable) {
    throw Object.assign(new Error("Text model is not available for member generation."), {
      status: 400,
      code: "model_not_allowed",
    });
  }
  if (!canvasMemberContext && modelId !== DEFAULT_TEXT_MODEL_ID) {
    throw Object.assign(new Error("This text model is available through BITBI Canvas only."), {
      status: 400,
      code: "model_not_allowed",
    });
  }
  if (!canvasMemberContext && (body.messages !== undefined || body.system !== undefined || body.system_prompt !== undefined || body.systemPrompt !== undefined)) {
    throw Object.assign(new Error("Advanced text controls are available through BITBI Canvas only."), {
      status: 400,
      code: "unsupported_option",
    });
  }
  const messages = normalizeMessages(body.messages);
  const directPrompt = String(body.prompt || "").trim();
  const prompt = directPrompt || messages.map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`).join("\n\n");
  const promptLimit = canvasMemberContext ? MAX_PROMPT_LENGTH : 2000;
  if (!prompt || prompt.length > promptLimit || hasControlCharacters(prompt)) {
    throw Object.assign(new Error(`Prompt must be 1-${promptLimit} safe characters.`), {
      status: 400,
      code: "invalid_prompt",
    });
  }
  const system = String(body.system ?? body.system_prompt ?? body.systemPrompt ?? "").trim();
  if (system.length > MAX_SYSTEM_PROMPT_LENGTH || hasControlCharacters(system)) {
    throw Object.assign(new Error(`System prompt must be at most ${MAX_SYSTEM_PROMPT_LENGTH} safe characters.`), {
      status: 400,
      code: "invalid_system_prompt",
    });
  }
  const maxTokenLimit = canvasMemberContext ? Number(model.controls?.maxTokens?.max || DEFAULT_MAX_TOKENS) : 600;
  const maxTokens = optionalInteger(body, "max_tokens", "maxTokens", {
    defaultValue: canvasMemberContext ? Number(model.controls?.maxTokens?.default || DEFAULT_MAX_TOKENS) : 300,
    min: 1,
    max: maxTokenLimit,
  });
  const temperature = normalizeTemperature(body);
  const credits = canvasMemberContext ? estimateCanvasTextCredits(modelId, { prompt, systemPrompt: system, maxTokens }) : 1;
  if (!Number.isSafeInteger(credits) || credits < 1) {
    throw Object.assign(new Error("Text model pricing is unavailable."), {
      status: 503,
      code: "pricing_unavailable",
    });
  }

  return {
    organizationId,
    modelId,
    model,
    prompt,
    system,
    messages,
    maxTokens,
    temperature,
    credits,
    policyBody: {
      ...(organizationId ? { organization_id: organizationId } : {}),
      ...(canvasMemberContext ? { model: modelId } : { preset: MEMBER_TEXT_PRESET }),
      prompt,
      system,
      messageCount: messages.length,
      maxTokens,
      temperature,
    },
    providerPayload: {
      ...(canvasMemberContext ? { model: modelId } : { preset: MEMBER_TEXT_PRESET }),
      prompt,
      ...(system ? { system } : {}),
      maxTokens,
      temperature,
    },
  };
}

function textBillingMetadata(usagePolicy, { replay = false, balanceAfter = null, creditsCharged = null } = {}) {
  if (typeof usagePolicy.billingMetadata === "function") {
    return {
      ...usagePolicy.billingMetadata({ replay, balanceAfter }),
      credits_charged: creditsCharged == null ? usagePolicy.credits : creditsCharged,
      idempotent_replay: Boolean(replay),
    };
  }
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
  callerPolicy = null,
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

  const requestBody = callerPolicy ? withAiCallerPolicy(payload, callerPolicy) : payload;
  const bodyText = JSON.stringify(requestBody);
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
    response = await fetchWithGenerationTimeout(env.AI_LAB.fetch.bind(env.AI_LAB), new Request(`${AI_LAB_BASE_URL}${INTERNAL_TEXT_PATH}`, {
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
    if (isGenerationTimeoutError(error)) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "ai-generate-text",
        event: "member_ai_text_proxy_timeout",
        level: "error",
        correlationId,
        user_id: user?.id || null,
        duration_ms: getDurationMs(startedAt),
        upstream_path: INTERNAL_TEXT_PATH,
      });
      return {
        ok: false,
        status: 504,
        code: "generation_timeout",
        error: `Text generation timed out after ${BITBI_GENERATION_TIMEOUT_SECONDS} seconds.`,
      };
    }
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
    usage: body.result?.usage || null,
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

  const metadata = usagePolicy.mode === "member"
    ? usagePolicy.attempt?.metadata
    : await getAiUsageAttemptReplayMetadata(env, usagePolicy.attempt.id);
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
    input = normalizeTextGenerationBody(parsed.body, { canvasMemberContext: ctx.canvasMemberContext === true });
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
      operation: {
        ...AI_USAGE_OPERATIONS.MEMBER_TEXT_GENERATE,
        credits: input.credits,
        modelId: input.modelId,
        source: "member_text_generation",
      },
      route: ROUTE_PATH,
      allowAdminMemberCredits: ctx.canvasMemberContext === true,
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
  ctx.captureCanvasUsageAttemptId?.(usagePolicy.attempt?.id || null);

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

  if (usagePolicy.mode === "member") {
    try {
      await usagePolicy.prepareForProvider();
    } catch (error) {
      const policyError = aiUsagePolicyErrorResponse(error);
      return respond(policyError.body, { status: policyError.status });
    }
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
    callerPolicy: buildMemberTextCallerPolicy({
      correlationId,
      budgetFingerprint: usagePolicy.gatewayPlan?.fingerprint || usagePolicy.requestFingerprint || null,
      modelId: input.modelId,
      mode: usagePolicy.mode,
    }),
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
      preset: null,
      request_mode: "service-binding",
      pricing_mode: input.modelId === "anthropic/claude-fable-5" ? "estimated_upper_bound" : "fixed_member_credit",
      requested_max_tokens: input.maxTokens,
      provider_usage_available: Boolean(provider.usage),
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
          estimatedCredits: input.credits,
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
    usage: provider.usage || null,
    billing: {
      ...billingMetadata,
      estimated_credits: input.credits,
      idempotent_replay: false,
    },
  });
}
