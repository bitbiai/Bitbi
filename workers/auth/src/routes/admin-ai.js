import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { json } from "../lib/response.js";
import { requireAdmin } from "../lib/session.js";
import {
  AdminAiValidationError as InputError,
  validateAdminAiCompareBody as validateComparePayload,
  validateAdminAiEmbeddingsBody as validateEmbeddingsPayload,
  validateAdminAiImageBody as validateImagePayload,
  validateAdminAiLiveAgentBody as validateLiveAgentPayload,
  validateAdminAiMusicBody as validateMusicPayload,
  validateAdminAiTextBody as validateTextPayload,
  validateAdminAiVideoBody as validateVideoPayload,
  validateFlux2DevReferenceImageDimensions,
  resolveAdminAiModelSelection,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
import {
  AI_CALLER_POLICY_BUDGET_SCOPES,
  AI_CALLER_POLICY_CALLER_CLASSES,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES,
  AI_CALLER_POLICY_VERSION,
} from "../../../shared/ai-caller-policy.mjs";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
  getRemoteMediaPolicyLogFields,
} from "../../../../js/shared/remote-media-policy.mjs";
import {
  proxyLiveAgentToAiLab,
  proxyToAiLab,
  rateLimitAdminAi,
} from "../lib/admin-ai-proxy.js";
import {
  BillingError,
  assertOrganizationFeatureEnabled,
  billingErrorResponse,
  consumeOrganizationCredits,
  normalizeBillingIdempotencyKey,
} from "../lib/billing.js";
import {
  createAdminAiVideoJob,
  getAdminAiVideoJob,
  getAdminAiVideoJobOutput,
  getAdminAiVideoFailedJob,
  getAdminAiVideoPoisonMessage,
  listAdminAiVideoFailedJobs,
  listAdminAiVideoPoisonMessages,
  normalizeAiVideoIdempotencyKey,
  serializeAiVideoJob,
} from "../lib/ai-video-jobs.js";
import {
  adminAiUsageAttemptCursorExpiry,
  beginAiUsageAttempt,
  buildAdminAiUsageAttemptFilterHash,
  cleanupExpiredAiUsageAttempts,
  getAdminAiUsageAttempt,
  listAdminAiUsageAttempts,
  markAiUsageAttemptBillingFailed,
  markAiUsageAttemptFinalizing,
  markAiUsageAttemptProviderFailed,
  markAiUsageAttemptProviderRunning,
  markAiUsageAttemptSucceeded,
  normalizeAdminAiUsageAttemptFilters,
} from "../lib/ai-usage-attempts.js";
import {
  AdminAiIdempotencyError,
  beginAdminAiIdempotencyAttempt,
  markAdminAiIdempotencyProviderFailed,
  markAdminAiIdempotencyProviderRunning,
  markAdminAiIdempotencySucceeded,
} from "../lib/admin-ai-idempotency.js";
import {
  calculateAdminImageTestCreditCost,
  isChargeableAdminImageTestModel,
} from "../lib/admin-ai-image-credit-pricing.js";
import {
  ADMIN_PLATFORM_BUDGET_SCOPES,
  buildAdminPlatformBudgetFingerprint,
  classifyAdminPlatformBudgetPlan,
} from "../lib/admin-platform-budget-policy.js";
import { buildAdminPlatformBudgetEvidenceReport } from "../lib/admin-platform-budget-evidence.js";
import { getAiCostOperationRegistryEntry } from "../lib/ai-cost-operations.js";
import { normalizeOrgId } from "../lib/orgs.js";
import { sha256Hex } from "../lib/tokens.js";
import { handleAdminAiDerivativeBackfillRequest } from "../lib/admin-ai-derivative-backfill.js";
import { handleAdminAiSaveTextAssetRequest } from "../lib/admin-ai-save-text.js";
import { withAdminAiCode } from "../lib/admin-ai-response.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorInteger,
  readCursorString,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import {
  logWorkerConfigFailure,
  workerConfigUnavailableResponse,
  WorkerConfigError,
} from "../lib/config.js";
import { createAiGeneratedSaveReferenceFromBase64 } from "./ai/generated-image-save-reference.js";

const ADMIN_AI_USAGE_ATTEMPT_CURSOR_TYPE = "admin_ai_usage_attempts";
const DEFAULT_ADMIN_AI_USAGE_ATTEMPT_LIMIT = 25;
const MAX_ADMIN_AI_USAGE_ATTEMPT_LIMIT = 100;
const CHARGED_ADMIN_IMAGE_OPERATION_ID = "admin.image.test.charged";
const ADMIN_TEXT_OPERATION_ID = "admin.text.test";
const ADMIN_EMBEDDINGS_OPERATION_ID = "admin.embeddings.test";
const ADMIN_TEXT_BUDGET_KILL_SWITCH = "ENABLE_ADMIN_AI_TEXT_BUDGET";
const ADMIN_EMBEDDINGS_BUDGET_KILL_SWITCH = "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET";
const ADMIN_LAB_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ADMIN_LAB_IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const ADMIN_LAB_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

function buildAdminAiCallerPolicy({
  operationId,
  budgetScope = AI_CALLER_POLICY_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
  enforcementStatus = AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BASELINE_ALLOWED,
  callerClass = AI_CALLER_POLICY_CALLER_CLASSES.ADMIN,
  ownerDomain = "admin-ai",
  providerFamily = "ai_worker",
  modelId = null,
  modelResolverKey = null,
  idempotencyPolicy = "optional",
  sourceRoute,
  sourceComponent = "auth-worker-admin-ai",
  budgetFingerprint = null,
  requestFingerprint = null,
  killSwitchTarget = null,
  correlationId = null,
  reason = "baseline_admin_ai_provider_cost_route",
  notes = null,
} = {}) {
  return {
    policy_version: AI_CALLER_POLICY_VERSION,
    operation_id: operationId,
    budget_scope: budgetScope,
    enforcement_status: enforcementStatus,
    caller_class: callerClass,
    owner_domain: ownerDomain,
    provider_family: providerFamily,
    model_id: modelId || null,
    model_resolver_key: modelResolverKey || null,
    idempotency_policy: idempotencyPolicy,
    source_route: sourceRoute,
    source_component: sourceComponent,
    budget_fingerprint: budgetFingerprint || null,
    request_fingerprint: requestFingerprint || null,
    kill_switch_target: killSwitchTarget || null,
    correlation_id: correlationId || null,
    reason,
    notes,
  };
}

function inputErrorResponse(error, correlationId = null) {
  return withCorrelationId(json(
    {
      ok: false,
      error: error.message,
      code: error.code || "validation_error",
    },
    { status: error.status || 400 }
  ), correlationId);
}

function badJsonResponse(correlationId) {
  return withCorrelationId(
    json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 }),
    correlationId
  );
}

async function readAdminAiJsonBody(
  request,
  correlationId,
  { maxBytes = BODY_LIMITS.adminJson, requiredContentType = true } = {}
) {
  const parsed = await readJsonBodyOrResponse(request, { maxBytes, requiredContentType });
  if (parsed.response) {
    return { response: withCorrelationId(parsed.response, correlationId), body: null };
  }
  return { response: null, body: parsed.body };
}

function notFoundResponse(correlationId) {
  return withCorrelationId(json(
    {
      ok: false,
      error: "Not found",
      code: "not_found",
    },
    { status: 404 }
  ), correlationId);
}

function billingAdminErrorResponse(error, correlationId) {
  if (error instanceof BillingError) {
    return withCorrelationId(json(billingErrorResponse(error), { status: error.status }), correlationId);
  }
  throw error;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeAdminLabIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    throw new InputError("Idempotency-Key header is required.", 428, "idempotency_key_required");
  }
  if (
    key.length < ADMIN_LAB_IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > ADMIN_LAB_IDEMPOTENCY_KEY_MAX_LENGTH ||
    !ADMIN_LAB_IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new InputError("Invalid Idempotency-Key header.", 400, "invalid_idempotency_key");
  }
  return key;
}

function adminImageOrganizationId(body) {
  try {
    return normalizeOrgId(body?.organization_id ?? body?.organizationId);
  } catch {
    throw new BillingError("Select an organization before running this charged image test.", {
      status: 400,
      code: "organization_required",
    });
  }
}

async function adminImageOrganizationSummary(env, organizationId) {
  const row = await env.DB.prepare(
    "SELECT id, name, slug, status, created_at, updated_at FROM organizations WHERE id = ? LIMIT 1"
  ).bind(organizationId).first();
  if (!row || row.status !== "active") {
    throw new BillingError("Organization not found.", {
      status: 404,
      code: "organization_not_found",
    });
  }
  return {
    id: row.id,
    name: row.name || row.slug || row.id,
  };
}

function adminImageAttemptResponse({
  usageKind,
  organizationId,
  organizationName = null,
  pricing,
  attempt,
  budgetPolicy = null,
}, correlationId) {
  if (usageKind === "completed" || usageKind === "completed_expired") {
    return withCorrelationId(json({
      ok: true,
      task: "image",
      code: usageKind === "completed_expired"
        ? "ai_usage_result_expired"
        : "ai_usage_result_unavailable",
      result: null,
      billing: {
        organization_id: organizationId,
        organization_name: organizationName,
        feature: "ai.image.generate",
        credits_charged: 0,
        original_credits_charged: pricing.credits,
        balance_after: attempt?.balanceAfter ?? null,
        usage_attempt_id: attempt?.id || null,
        model_id: attempt?.resultModel || null,
        idempotent_replay: true,
        replay_available: false,
        budget_policy: budgetPolicy,
      },
    }), correlationId);
  }

  if (usageKind === "in_progress") {
    return withCorrelationId(json({
      ok: false,
      error: "This idempotent admin image test is already in progress.",
      code: "ai_usage_attempt_in_progress",
      billing: {
        organization_id: organizationId,
        organization_name: organizationName,
        feature: "ai.image.generate",
        credits_reserved: pricing.credits,
        usage_attempt_id: attempt?.id || null,
      },
    }, { status: 409 }), correlationId);
  }

  return withCorrelationId(json({
    ok: false,
    error: "Admin image test billing could not be finalized. Use a new idempotency key to retry.",
    code: "ai_usage_billing_failed",
    billing: {
      organization_id: organizationId,
      organization_name: organizationName,
      feature: "ai.image.generate",
    },
  }, { status: 503 }), correlationId);
}

function adminImageBudgetProviderFamily(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (id.includes("black-forest-labs") || id.includes("flux")) return "bfl";
  if (id.includes("gpt-image") || id.includes("openai")) return "openai";
  return "ai_worker";
}

function adminImageBudgetKillSwitchFlag(modelId) {
  const providerFamily = adminImageBudgetProviderFamily(modelId);
  if (providerFamily === "bfl") return "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET";
  if (providerFamily === "openai") return "ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET";
  return "ENABLE_ADMIN_AI_CHARGED_IMAGE_BUDGET";
}

function adminLabBudgetOperation({
  operationId,
  modelId,
  modelResolverKey,
  routeId,
  routePath,
  killSwitchTarget,
}) {
  const registryEntry = getAiCostOperationRegistryEntry(operationId);
  const registryConfig = registryEntry?.operationConfig || {};
  return {
    operationId,
    featureKey: registryConfig.featureKey || operationId,
    actorType: "admin",
    actorRole: "admin",
    budgetScope: registryEntry?.budgetPolicy?.targetBudgetScope
      || ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    ownerDomain: "admin-ai",
    providerFamily: registryConfig.providerFamily || "ai_worker",
    modelId,
    modelResolverKey: registryConfig.modelResolverKey || modelResolverKey,
    providerCost: true,
    estimatedCostUnits: registryConfig.creditCost || 0,
    estimatedCredits: registryConfig.creditCost || 0,
    idempotencyPolicy: "required",
    killSwitchPolicy: {
      flagName: killSwitchTarget,
      defaultState: "disabled",
      requiredForProviderCall: true,
      disabledBehavior: "manual_only",
      operatorCanOverride: false,
      scope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      notes: "Phase 4.8.1 records the future kill-switch metadata target only; runtime env enforcement remains future work for this route.",
    },
    routeId: registryConfig.routeId || routeId,
    routePath: registryConfig.routePath || routePath,
    auditEventPrefix: registryConfig.observabilityEventPrefix || operationId,
    notes: "Phase 4.8.1 records sanitized platform_admin_lab_budget metadata and durable metadata-only idempotency for admin text/embeddings tests without enabling live billing or full result replay.",
  };
}

function compactAdminLabBudgetPolicy(plan, fingerprint, {
  idempotencyKeyHash = null,
  duplicateSuppression = "durable_idempotency_metadata_only",
} = {}) {
  return {
    budget_policy_version: plan.policyVersion,
    operation_id: plan.operationId,
    budget_scope: plan.budgetScope,
    owner_domain: plan.ownerDomain,
    provider_family: plan.providerFamily,
    model_id: plan.auditFields?.model_id || null,
    estimated_cost_units: plan.estimatedCostUnits,
    estimated_credits: plan.estimatedCredits,
    idempotency_policy: plan.idempotencyPolicy,
    idempotency_key_hash: idempotencyKeyHash,
    duplicate_suppression: duplicateSuppression,
    durable_idempotency: duplicateSuppression !== "idempotency_key_required_no_durable_replay",
    replay_policy: "metadata_only_no_result_replay",
    runtime_enforcement_status: "budget_metadata_only",
    plan_status: plan.status,
    required_next_action: plan.requiredNextAction,
    kill_switch_flag_name: plan.killSwitchPolicy?.flagName || null,
    kill_switch_default_state: plan.killSwitchPolicy?.defaultState || null,
    kill_switch_required_for_provider_call: plan.killSwitchPolicy?.requiredForProviderCall ?? null,
    fingerprint,
    audit_fields: plan.auditFields,
  };
}

function withAdminLabAttemptBudgetMetadata(budgetPolicy, attempt = null, state = null) {
  return {
    ...(budgetPolicy || {}),
    duplicate_suppression: "durable_idempotency_metadata_only",
    durable_idempotency: true,
    replay_policy: "metadata_only_no_result_replay",
    idempotency_attempt_id: attempt?.id || null,
    idempotency_attempt_status: state || attempt?.status || null,
    idempotency_attempt_result_status: attempt?.resultStatus || null,
  };
}

async function buildAdminLabBudgetPolicyContext({
  user,
  operationId,
  modelId,
  modelResolverKey,
  routeId,
  routePath,
  payload,
  hashFields,
  idempotencyKey,
  killSwitchTarget,
  correlationId,
}) {
  const operation = adminLabBudgetOperation({
    operationId,
    modelId,
    modelResolverKey,
    routeId,
    routePath,
    killSwitchTarget,
  });
  const plan = classifyAdminPlatformBudgetPlan({
    operation,
    actorUserId: user?.id || null,
    actorRole: "admin",
    modelId,
    reason: `${operationId}_phase_4_8_1_durable_metadata_only`,
    correlationId,
  });
  if (!plan.ok) {
    throw new InputError("Admin AI budget policy is unavailable.", 503, "admin_ai_budget_policy_unavailable");
  }
  const fingerprint = await buildAdminPlatformBudgetFingerprint({
    operation,
    actorId: user?.id || null,
    budgetScopeId: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    modelId,
    routeId,
    routePath,
    body: payload,
    hashFields,
  });
  return {
    plan,
    fingerprint,
    summary: compactAdminLabBudgetPolicy(plan, fingerprint, {
      idempotencyKeyHash: await sha256Hex(idempotencyKey),
    }),
  };
}

function compactAdminCallerPolicy(callerPolicy) {
  if (!callerPolicy || typeof callerPolicy !== "object") return null;
  return {
    policy_version: callerPolicy.policy_version || null,
    operation_id: callerPolicy.operation_id || null,
    budget_scope: callerPolicy.budget_scope || null,
    enforcement_status: callerPolicy.enforcement_status || null,
    caller_class: callerPolicy.caller_class || null,
    owner_domain: callerPolicy.owner_domain || null,
    provider_family: callerPolicy.provider_family || null,
    model_id: callerPolicy.model_id || null,
    model_resolver_key: callerPolicy.model_resolver_key || null,
    idempotency_policy: callerPolicy.idempotency_policy || null,
    source_route: callerPolicy.source_route || null,
    source_component: callerPolicy.source_component || null,
    budget_fingerprint: callerPolicy.budget_fingerprint || null,
    request_fingerprint: callerPolicy.request_fingerprint || null,
    kill_switch_target: callerPolicy.kill_switch_target || null,
    correlation_id: callerPolicy.correlation_id || null,
    reason: callerPolicy.reason || null,
  };
}

function adminTextRequestMetadata(payload) {
  return {
    prompt_length: payload?.prompt ? String(payload.prompt).length : 0,
    system_length: payload?.system ? String(payload.system).length : 0,
    max_tokens: payload?.maxTokens ?? null,
    temperature: payload?.temperature ?? null,
  };
}

function adminEmbeddingsRequestMetadata(payload) {
  const input = Array.isArray(payload?.input) ? payload.input : [payload?.input].filter((entry) => entry != null);
  return {
    input_count: input.length,
    input_total_length: input.reduce((sum, entry) => sum + String(entry || "").length, 0),
  };
}

function adminTextResultMetadata(providerBody) {
  const text = providerBody?.result?.text == null ? "" : String(providerBody.result.text);
  return {
    result_kind: "text",
    text_length: text.length,
    usage: providerBody?.result?.usage && typeof providerBody.result.usage === "object"
      ? {
          prompt_tokens: Number(providerBody.result.usage.prompt_tokens || 0),
          completion_tokens: Number(providerBody.result.usage.completion_tokens || 0),
          total_tokens: Number(providerBody.result.usage.total_tokens || 0),
        }
      : null,
    max_tokens: providerBody?.result?.maxTokens ?? null,
    temperature: providerBody?.result?.temperature ?? null,
  };
}

function adminEmbeddingsResultMetadata(providerBody) {
  const result = providerBody?.result || {};
  return {
    result_kind: "embeddings",
    count: Number(result.count || 0),
    dimensions: result.dimensions == null ? null : Number(result.dimensions),
    shape: Array.isArray(result.shape)
      ? result.shape.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
      : null,
    pooling: typeof result.pooling === "string" ? result.pooling.slice(0, 80) : null,
    vectors_stored: false,
  };
}

function adminLabAttemptSafeMetadata({
  requestMetadata,
  resultMetadata = null,
  budgetPolicy,
  callerPolicy,
  state,
} = {}) {
  return {
    request: requestMetadata || {},
    result: resultMetadata || null,
    budget_policy: budgetPolicy || null,
    caller_policy: compactAdminCallerPolicy(callerPolicy),
    replay: {
      policy: "metadata_only_no_result_replay",
      full_result_stored: false,
      raw_input_stored: false,
      replay_available: false,
    },
    state: state || null,
  };
}

function adminLabAttemptResponse({
  task,
  modelId,
  kind,
  attempt,
  budgetPolicy,
  callerPolicy,
}, correlationId) {
  const attemptBudget = withAdminLabAttemptBudgetMetadata(budgetPolicy, attempt, attempt?.status || kind);
  if (kind === "completed") {
    return withCorrelationId(json({
      ok: true,
      task,
      code: "admin_ai_idempotency_metadata_replay",
      result: null,
      model_id: modelId || attempt?.modelKey || null,
      idempotency: {
        attempt_id: attempt?.id || null,
        status: attempt?.status || "succeeded",
        provider_status: attempt?.providerStatus || null,
        result_status: attempt?.resultStatus || null,
        idempotent_replay: true,
        replay_available: false,
        replay_policy: "metadata_only_no_result_replay",
        completed_at: attempt?.completedAt || null,
      },
      budget_policy: attemptBudget,
      caller_policy: compactAdminCallerPolicy(callerPolicy),
    }), correlationId);
  }

  if (kind === "in_progress") {
    return withCorrelationId(json({
      ok: false,
      error: "This idempotent admin AI request is already in progress.",
      code: "admin_ai_idempotency_in_progress",
      idempotency: {
        attempt_id: attempt?.id || null,
        status: attempt?.status || "provider_running",
        provider_status: attempt?.providerStatus || null,
        replay_policy: "metadata_only_no_result_replay",
      },
      budget_policy: attemptBudget,
      caller_policy: compactAdminCallerPolicy(callerPolicy),
    }, { status: 409 }), correlationId);
  }

  return withCorrelationId(json({
    ok: false,
    error: "This idempotency key is tied to a completed or failed admin AI request. Use a new key to retry.",
    code: kind === "expired" ? "admin_ai_idempotency_expired" : "admin_ai_idempotency_terminal",
    idempotency: {
      attempt_id: attempt?.id || null,
      status: attempt?.status || kind,
      provider_status: attempt?.providerStatus || null,
      result_status: attempt?.resultStatus || null,
      replay_policy: "metadata_only_no_result_replay",
    },
    budget_policy: attemptBudget,
    caller_policy: compactAdminCallerPolicy(callerPolicy),
  }, { status: 409 }), correlationId);
}

async function parseJsonResponseBody(response) {
  if (!(response instanceof Response)) return null;
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function appendAdminLabBudgetMetadata(response, {
  budgetPolicy,
  callerPolicy,
} = {}, correlationId) {
  if (!(response instanceof Response)) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!body?.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return withCorrelationId(new Response(JSON.stringify({
    ...body,
    budget_policy: budgetPolicy || null,
    caller_policy: compactAdminCallerPolicy(callerPolicy),
  }), {
    status: response.status,
    headers,
  }), correlationId);
}

function adminImageBudgetOperation({ modelId, pricing }) {
  const registryEntry = getAiCostOperationRegistryEntry(CHARGED_ADMIN_IMAGE_OPERATION_ID);
  const registryConfig = registryEntry?.operationConfig || {};
  return {
    operationId: CHARGED_ADMIN_IMAGE_OPERATION_ID,
    featureKey: registryConfig.featureKey || "admin.ai.test_image",
    actorType: "admin",
    actorRole: "platform_admin",
    budgetScope: registryEntry?.budgetPolicy?.targetBudgetScope
      || ADMIN_PLATFORM_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
    ownerDomain: "admin-ai",
    providerFamily: adminImageBudgetProviderFamily(modelId),
    modelId,
    modelResolverKey: registryConfig.modelResolverKey || "admin.image.priced_model_catalog",
    providerCost: true,
    estimatedCostUnits: pricing?.credits || 0,
    estimatedCredits: pricing?.credits || 0,
    idempotencyPolicy: registryConfig.idempotencyPolicy || "required",
    killSwitchPolicy: {
      flagName: adminImageBudgetKillSwitchFlag(modelId),
      defaultState: "disabled",
      requiredForProviderCall: true,
      disabledBehavior: "fail_closed",
      operatorCanOverride: false,
      scope: ADMIN_PLATFORM_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
      notes: "Future enforcement target only in Phase 4.3; existing org-credit/idempotency gates remain the runtime controls.",
    },
    routeId: registryConfig.routeId || "admin.ai.test-image",
    routePath: registryConfig.routePath || "/api/admin/ai/test-image",
    auditEventPrefix: registryConfig.observabilityEventPrefix || "admin.image.test.charged",
    notes: "Charged Admin image tests use selected organization credits; Phase 4.3 records budget policy plan/audit metadata.",
  };
}

function compactAdminImageBudgetPolicy(plan, fingerprint) {
  return {
    budget_policy_version: plan.policyVersion,
    operation_id: plan.operationId,
    budget_scope: plan.budgetScope,
    owner_domain: plan.ownerDomain,
    provider_family: plan.providerFamily,
    model_id: plan.auditFields?.model_id || null,
    estimated_cost_units: plan.estimatedCostUnits,
    estimated_credits: plan.estimatedCredits,
    idempotency_policy: plan.idempotencyPolicy,
    plan_status: plan.status,
    required_next_action: plan.requiredNextAction,
    kill_switch_flag_name: plan.killSwitchPolicy?.flagName || null,
    kill_switch_default_state: plan.killSwitchPolicy?.defaultState || null,
    kill_switch_required_for_provider_call: plan.killSwitchPolicy?.requiredForProviderCall ?? null,
    fingerprint,
    audit_fields: plan.auditFields,
  };
}

async function buildAdminImageBudgetPolicyContext({
  user,
  organizationId,
  modelId,
  payload,
  pricing,
  correlationId,
}) {
  const operation = adminImageBudgetOperation({ modelId, pricing });
  const plan = classifyAdminPlatformBudgetPlan({
    operation,
    actorUserId: user?.id || null,
    actorRole: "platform_admin",
    modelId,
    reason: "charged_admin_image_test",
    correlationId,
  });
  if (!plan.ok) {
    throw new BillingError("Admin image test budget policy is unavailable.", {
      status: 503,
      code: "admin_image_budget_policy_unavailable",
    });
  }
  const fingerprint = await buildAdminPlatformBudgetFingerprint({
    operation,
    actorId: user?.id || null,
    budgetScopeId: organizationId,
    modelId,
    routeId: "admin.ai.test-image",
    routePath: "/api/admin/ai/test-image",
    body: payload,
    hashFields: ["prompt", "structuredPrompt"],
    excludeFields: ["organization_id", "organizationId"],
  });
  return {
    plan,
    fingerprint,
    summary: compactAdminImageBudgetPolicy(plan, fingerprint),
  };
}

function adminImageBillingErrorResponse(error, correlationId) {
  if (error instanceof BillingError) {
    return withCorrelationId(json(billingErrorResponse(error), { status: error.status }), correlationId);
  }
  throw error;
}

async function appendAdminImageBilling(response, billing, correlationId) {
  if (!(response instanceof Response)) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!body?.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return withCorrelationId(new Response(JSON.stringify({
    ...body,
    billing,
  }), {
    status: response.status,
    headers,
  }), correlationId);
}

async function adminImageRequestFingerprint({ organizationId, userId, payload, modelId, pricing }) {
  return sha256Hex(stableJson({
    route: "/api/admin/ai/test-image",
    operation: "admin_ai_image_test",
    organizationId,
    userId,
    modelId,
    prompt: payload.prompt || null,
    structuredPrompt: payload.structuredPrompt || null,
    width: payload.width || null,
    height: payload.height || null,
    steps: payload.steps || null,
    seed: payload.seed || null,
    guidance: payload.guidance || null,
    referenceImageCount: Array.isArray(payload.referenceImages) ? payload.referenceImages.length : 0,
    quality: payload.quality || null,
    size: payload.size || null,
    outputFormat: payload.outputFormat || null,
    background: payload.background || null,
    credits: pricing.credits,
  }));
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function decodeUsageAttemptCursorOrResponse(env, cursorParam, expectedFilterHash, correlationId) {
  if (!cursorParam) return { cursor: null };
  try {
    const decoded = await decodePaginationCursor(env, cursorParam, ADMIN_AI_USAGE_ATTEMPT_CURSOR_TYPE);
    const cursor = {
      updatedAt: readCursorString(decoded, "u"),
      id: readCursorString(decoded, "i"),
      q: readCursorString(decoded, "q", { allowEmpty: true, maxLength: 80 }),
      exp: readCursorInteger(decoded, "exp", { min: 1 }),
    };
    if (cursor.q !== expectedFilterHash || cursor.exp <= Date.now()) {
      return { response: withCorrelationId(paginationErrorResponse("Invalid cursor."), correlationId) };
    }
    return { cursor };
  } catch {
    return { response: withCorrelationId(paginationErrorResponse("Invalid cursor."), correlationId) };
  }
}

async function encodeUsageAttemptCursor(env, filterHash, row) {
  return encodePaginationCursor(env, ADMIN_AI_USAGE_ATTEMPT_CURSOR_TYPE, {
    u: row.updated_at,
    i: row.id,
    q: filterHash,
    exp: adminAiUsageAttemptCursorExpiry(),
  });
}

function videoJobResponse(job, correlationId, { status = 200, existing = false } = {}) {
  return withCorrelationId(json({
    ok: true,
    existing,
    job: serializeAiVideoJob(job),
  }, { status }), correlationId);
}

function isSyncVideoDebugAllowed(env) {
  return String(env?.ALLOW_SYNC_VIDEO_DEBUG || "").trim().toLowerCase() === "true";
}

function syncVideoDebugDisabledResponse(correlationId) {
  return withCorrelationId(json(
    {
      ok: false,
      error: "Not found",
      code: "not_found",
    },
    { status: 404 }
  ), correlationId);
}

async function attachAdminImageSaveReference(response, env, adminUser, correlationId, requestInfo = null) {
  if (!(response instanceof Response)) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body?.ok || typeof body?.result?.imageBase64 !== "string" || !body.result.imageBase64) {
    return response;
  }

  try {
    const { saveReference } = await createAiGeneratedSaveReferenceFromBase64(env, {
      userId: adminUser.id,
      imageBase64: body.result.imageBase64,
      mimeType: body.result.mimeType || "image/png",
    });
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.delete("content-length");
    return withCorrelationId(new Response(JSON.stringify({
      ...body,
      result: {
        ...body.result,
        saveReference,
      },
    }), {
      status: response.status,
      headers,
    }), correlationId);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-image",
      event: "admin_ai_generated_temp_store_failed",
      level: "warn",
      correlationId,
      admin_user_id: adminUser.id,
      model: body?.model?.id || null,
      ...getRequestLogFields(requestInfo),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return response;
  }
}

export async function handleAdminAI(ctx) {
  const { request, env, url, pathname, method, isSecure } = ctx;
  const correlationId = ctx.correlationId || null;
  const requestInfo = { request, pathname, method };

  if (!pathname.startsWith("/api/admin/ai/")) {
    return null;
  }

  const result = await requireAdmin(request, env, { isSecure, correlationId });
  if (result instanceof Response) {
    return withAdminAiCode(result);
  }

  if (pathname === "/api/admin/ai/budget-evidence" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-budget-evidence-ip", 30, 600_000, correlationId);
    if (limited) return limited;
    return withCorrelationId(json(buildAdminPlatformBudgetEvidenceReport()), correlationId);
  }

  if (pathname === "/api/admin/ai/models" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-models-ip", 60, 600_000, correlationId);
    if (limited) return limited;
    return proxyToAiLab(env, "/internal/ai/models", { method: "GET" }, result.user, correlationId, requestInfo);
  }

  if (pathname === "/api/admin/ai/usage-attempts" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-usage-attempts-ip", 60, 600_000, correlationId);
    if (limited) return limited;

    let filters;
    try {
      filters = normalizeAdminAiUsageAttemptFilters({
        status: url.searchParams.get("status"),
        organization_id: url.searchParams.get("organization_id"),
        user_id: url.searchParams.get("user_id"),
        feature: url.searchParams.get("feature"),
      });
      const filterHash = await buildAdminAiUsageAttemptFilterHash(filters);
      const decoded = await decodeUsageAttemptCursorOrResponse(
        env,
        url.searchParams.get("cursor"),
        filterHash,
        correlationId
      );
      if (decoded.response) return decoded.response;

      const page = await listAdminAiUsageAttempts(env, {
        ...filters,
        cursor: decoded.cursor,
        limit: resolvePaginationLimit(url.searchParams.get("limit"), {
          defaultValue: DEFAULT_ADMIN_AI_USAGE_ATTEMPT_LIMIT,
          maxValue: MAX_ADMIN_AI_USAGE_ATTEMPT_LIMIT,
        }),
      });
      const nextCursor = page.hasMore && page.last
        ? await encodeUsageAttemptCursor(env, filterHash, page.last)
        : null;
      return withCorrelationId(json({
        ok: true,
        attempts: page.attempts,
        nextCursor,
        appliedLimit: page.appliedLimit,
      }), correlationId);
    } catch (error) {
      return billingAdminErrorResponse(error, correlationId);
    }
  }

  // route-policy: admin.ai.usage-attempts.cleanup-expired
  if (pathname === "/api/admin/ai/usage-attempts/cleanup-expired" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-usage-attempts-write-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    try {
      normalizeBillingIdempotencyKey(request.headers.get("Idempotency-Key"));
      const parsed = await readAdminAiJsonBody(request, correlationId, {
        maxBytes: BODY_LIMITS.smallJson,
      });
      if (parsed.response) return parsed.response;
      const cleanup = await cleanupExpiredAiUsageAttempts({
        env,
        limit: parsed.body?.limit,
        dryRun: parsed.body?.dry_run !== false,
      });
      logDiagnostic({
        service: "bitbi-auth",
        component: "admin-ai-usage-attempts",
        event: "ai_usage_attempt_cleanup_completed",
        level: cleanup.failedCount > 0 || cleanup.skippedCount > 0 ? "warn" : "info",
        correlationId,
        admin_user_id: result.user.id,
        dry_run: cleanup.dryRun,
        scanned_count: cleanup.scannedCount,
        expired_count: cleanup.expiredCount,
        reservations_released_count: cleanup.reservationsReleasedCount,
        replay_metadata_expired_count: cleanup.replayMetadataExpiredCount,
        replay_objects_eligible_count: cleanup.replayObjectsEligibleCount,
        replay_objects_deleted_count: cleanup.replayObjectsDeletedCount,
        replay_object_metadata_cleared_count: cleanup.replayObjectMetadataClearedCount,
        replay_objects_skipped_active_count: cleanup.replayObjectsSkippedActiveCount,
        replay_objects_skipped_unsafe_key_count: cleanup.replayObjectsSkippedUnsafeKeyCount,
        replay_objects_skipped_missing_object_count: cleanup.replayObjectsSkippedMissingObjectCount,
        replay_object_failed_count: cleanup.replayObjectFailedCount,
        skipped_count: cleanup.skippedCount,
        failed_count: cleanup.failedCount,
      });
      return withCorrelationId(json({ ok: true, cleanup }), correlationId);
    } catch (error) {
      return billingAdminErrorResponse(error, correlationId);
    }
  }

  const usageAttemptMatch = pathname.match(/^\/api\/admin\/ai\/usage-attempts\/([^/]+)$/);
  if (usageAttemptMatch && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-usage-attempts-ip", 60, 600_000, correlationId);
    if (limited) return limited;

    const attemptId = decodePathSegment(usageAttemptMatch[1]);
    if (!attemptId || attemptId.includes("/")) {
      return notFoundResponse(correlationId);
    }

    try {
      const attempt = await getAdminAiUsageAttempt(env, attemptId);
      if (!attempt) return notFoundResponse(correlationId);
      return withCorrelationId(json({ ok: true, attempt }), correlationId);
    } catch (error) {
      return billingAdminErrorResponse(error, correlationId);
    }
  }

  // route-policy: admin.ai.test-text
  if (pathname === "/api/admin/ai/test-text" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-text-ip", 30, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const idempotencyKey = normalizeAdminLabIdempotencyKey(request.headers.get("Idempotency-Key"));
      const validated = validateTextPayload(body);
      const selection = resolveAdminAiModelSelection("text", validated);
      const modelId = selection.model.id;
      const budgetPolicy = await buildAdminLabBudgetPolicyContext({
        user: result.user,
        operationId: ADMIN_TEXT_OPERATION_ID,
        modelId,
        modelResolverKey: "admin.text.model_registry",
        routeId: "admin.ai.test-text",
        routePath: "/api/admin/ai/test-text",
        payload: validated,
        hashFields: ["prompt", "system"],
        idempotencyKey,
        killSwitchTarget: ADMIN_TEXT_BUDGET_KILL_SWITCH,
        correlationId,
      });
      const callerPolicy = buildAdminAiCallerPolicy({
        operationId: ADMIN_TEXT_OPERATION_ID,
        enforcementStatus: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_METADATA_ONLY,
        callerClass: AI_CALLER_POLICY_CALLER_CLASSES.ADMIN,
        modelId,
        modelResolverKey: "admin.text.model_registry",
        idempotencyPolicy: "required",
        sourceRoute: "/api/admin/ai/test-text",
        budgetFingerprint: budgetPolicy.summary.fingerprint,
        requestFingerprint: budgetPolicy.summary.fingerprint,
        killSwitchTarget: ADMIN_TEXT_BUDGET_KILL_SWITCH,
        correlationId,
        reason: "phase_4_8_1_admin_text_durable_idempotency_metadata_only",
        notes: "Idempotency-Key is required and backed by durable metadata-only duplicate suppression.",
      });
      const initialBudgetPolicy = withAdminLabAttemptBudgetMetadata(budgetPolicy.summary, null, "pending");
      const attemptState = await beginAdminAiIdempotencyAttempt({
        env,
        operationKey: ADMIN_TEXT_OPERATION_ID,
        route: "/api/admin/ai/test-text",
        adminUserId: result.user.id,
        idempotencyKey,
        requestFingerprint: budgetPolicy.summary.fingerprint,
        providerFamily: budgetPolicy.summary.provider_family,
        modelKey: modelId,
        budgetScope: budgetPolicy.summary.budget_scope,
        budgetPolicy: initialBudgetPolicy,
        callerPolicy: compactAdminCallerPolicy(callerPolicy),
        metadata: adminLabAttemptSafeMetadata({
          requestMetadata: adminTextRequestMetadata(validated),
          budgetPolicy: initialBudgetPolicy,
          callerPolicy,
          state: "pending",
        }),
      });
      if (attemptState.kind !== "created") {
        return adminLabAttemptResponse({
          task: "text",
          modelId,
          kind: attemptState.kind,
          attempt: attemptState.attempt,
          budgetPolicy: initialBudgetPolicy,
          callerPolicy,
        }, correlationId);
      }
      await markAdminAiIdempotencyProviderRunning(env, attemptState.attempt.id);
      const response = await proxyToAiLab(
        env,
        "/internal/ai/test-text",
        {
          method: "POST",
          body: validated,
          callerPolicy,
        },
        result.user,
        correlationId,
        requestInfo
      );
      const providerBody = await parseJsonResponseBody(response);
      if (!response.ok || !providerBody?.ok) {
        await markAdminAiIdempotencyProviderFailed(env, attemptState.attempt.id, {
          code: providerBody?.code || "provider_failed",
          message: "Admin text provider call failed.",
        });
        return response;
      }
      const completedAttempt = await markAdminAiIdempotencySucceeded(env, attemptState.attempt.id, {
        resultMetadata: adminTextResultMetadata(providerBody),
        metadata: adminLabAttemptSafeMetadata({
          requestMetadata: adminTextRequestMetadata(validated),
          resultMetadata: adminTextResultMetadata(providerBody),
          budgetPolicy: withAdminLabAttemptBudgetMetadata(initialBudgetPolicy, attemptState.attempt, "succeeded"),
          callerPolicy,
          state: "succeeded",
        }),
      });
      return appendAdminLabBudgetMetadata(response, {
        budgetPolicy: withAdminLabAttemptBudgetMetadata(initialBudgetPolicy, completedAttempt, "succeeded"),
        callerPolicy,
      }, correlationId);
    } catch (error) {
      if (error instanceof InputError) {
        if (error.code === REMOTE_MEDIA_URL_POLICY_CODE) {
          logDiagnostic({
            service: "bitbi-auth",
            component: "admin-ai-video",
            event: "admin_ai_video_rejected_remote_url",
            level: "warn",
            correlationId,
            admin_user_id: result.user.id,
            ...getRemoteMediaPolicyLogFields(error),
          });
        }
        return inputErrorResponse(error, correlationId);
      }
      if (error instanceof AdminAiIdempotencyError) {
        return inputErrorResponse(error, correlationId);
      }
      throw error;
    }
  }

  // route-policy: admin.ai.test-image
  if (pathname === "/api/admin/ai/test-image" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-image-ip", 10, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const payload = validateImagePayload(body);
      await validateFlux2DevReferenceImageDimensions(env, payload);
      const selection = resolveAdminAiModelSelection("image", payload);
      const modelId = selection.model.id;
      const pricing = isChargeableAdminImageTestModel(modelId)
        ? calculateAdminImageTestCreditCost(modelId, payload)
        : null;
      if (!pricing) {
        const response = await proxyToAiLab(
          env,
          "/internal/ai/test-image",
          {
            method: "POST",
            body: payload,
            callerPolicy: buildAdminAiCallerPolicy({
              operationId: "admin.image.test.unmetered",
              modelId,
              modelResolverKey: "admin.image.model_registry",
              sourceRoute: "/api/admin/ai/test-image",
              killSwitchTarget: "ENABLE_ADMIN_AI_BUDGETED_IMAGE_TESTS",
              correlationId,
            }),
          },
          result.user,
          correlationId,
          requestInfo
        );
        return attachAdminImageSaveReference(response, env, result.user, correlationId, requestInfo);
      }

      const organizationId = adminImageOrganizationId(body);
      const organization = await adminImageOrganizationSummary(env, organizationId);
      const clientIdempotencyKey = normalizeBillingIdempotencyKey(request.headers.get("Idempotency-Key"));
      const budgetPolicy = await buildAdminImageBudgetPolicyContext({
        user: result.user,
        organizationId,
        modelId,
        payload,
        pricing,
        correlationId,
      });
      const scopedIdempotencyKey = `admin-ai-image:${await sha256Hex(stableJson({
        organizationId,
        userId: result.user.id,
        clientIdempotencyKey,
      }))}`;
      await assertOrganizationFeatureEnabled(env, {
        organizationId,
        featureKey: "ai.image.generate",
      });
      const requestFingerprint = await adminImageRequestFingerprint({
        organizationId,
        userId: result.user.id,
        payload,
        modelId,
        pricing,
      });
      const attemptState = await beginAiUsageAttempt({
        env,
        organizationId,
        userId: result.user.id,
        featureKey: "ai.image.generate",
        operationKey: "admin_ai_image_test",
        route: "/api/admin/ai/test-image",
        idempotencyKey: scopedIdempotencyKey,
        requestFingerprint,
        creditCost: pricing.credits,
        quantity: 1,
      });

      if (attemptState.kind !== "reserved") {
        return adminImageAttemptResponse({
          usageKind: attemptState.kind,
          organizationId,
          organizationName: organization.name,
          pricing,
          attempt: attemptState.attempt,
          budgetPolicy: budgetPolicy.summary,
        }, correlationId);
      }

      await markAiUsageAttemptProviderRunning(env, attemptState.attempt.id);
      const response = await proxyToAiLab(
        env,
        "/internal/ai/test-image",
        {
          method: "POST",
          body: payload,
          callerPolicy: buildAdminAiCallerPolicy({
            operationId: CHARGED_ADMIN_IMAGE_OPERATION_ID,
            budgetScope: AI_CALLER_POLICY_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
            enforcementStatus: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_POLICY_ENFORCED,
            callerClass: AI_CALLER_POLICY_CALLER_CLASSES.PLATFORM_ADMIN,
            modelId,
            modelResolverKey: "admin.image.priced_model_catalog",
            idempotencyPolicy: "required",
            sourceRoute: "/api/admin/ai/test-image",
            budgetFingerprint: budgetPolicy.summary?.fingerprint || null,
            killSwitchTarget: budgetPolicy.summary?.kill_switch_flag_name || "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET",
            correlationId,
            reason: "charged_admin_image_budget_policy_enforced",
          }),
        },
        result.user,
        correlationId,
        requestInfo
      );

      let providerBody = null;
      try {
        providerBody = await response.clone().json();
      } catch {
        providerBody = null;
      }
      if (!response.ok || !providerBody?.ok) {
        try {
          await markAiUsageAttemptProviderFailed(env, attemptState.attempt.id, {
            code: "provider_failed",
            message: "Admin image test provider failed.",
          });
        } catch {}
        return response;
      }

      await markAiUsageAttemptFinalizing(env, attemptState.attempt.id);
      let debit;
      try {
        debit = await consumeOrganizationCredits({
          env,
          organizationId,
          userId: result.user.id,
          featureKey: "ai.image.generate",
          quantity: 1,
          credits: pricing.credits,
          idempotencyKey: scopedIdempotencyKey,
          requestFingerprint,
          source: "admin_ai_image_test",
          metadata: {
            source: "admin_ai_image_test",
            route: "/api/admin/ai/test-image",
            operation: "admin_ai_image_test",
            model: modelId,
            credit_cost: pricing.credits,
            prompt_length: payload.prompt ? String(payload.prompt).length : 0,
            width: pricing.normalized?.width || payload.width || null,
            height: pricing.normalized?.height || payload.height || null,
            steps: pricing.normalized?.steps || payload.steps || null,
            quality: pricing.normalized?.quality || payload.quality || null,
            size: pricing.normalized?.size || payload.size || null,
            output_format: pricing.normalized?.outputFormat || payload.outputFormat || null,
            background: pricing.normalized?.background || payload.background || null,
            reference_image_count: pricing.normalized?.referenceImageCount
              ?? (Array.isArray(payload.referenceImages) ? payload.referenceImages.length : null),
            pricing_version: pricing.formula?.pricingVersion || null,
            budget_policy: budgetPolicy.summary,
          },
        });
      } catch (error) {
        const responseError = error instanceof BillingError
          ? error
          : new BillingError("Admin image test billing could not be finalized.", {
              status: 503,
              code: "billing_finalization_failed",
            });
        try {
          await markAiUsageAttemptBillingFailed(env, attemptState.attempt.id, {
            code: responseError.code,
            message: "Admin image test billing finalization failed.",
          });
        } catch {}
        return adminImageBillingErrorResponse(responseError, correlationId);
      }

      await markAiUsageAttemptSucceeded(env, attemptState.attempt.id, {
        model: modelId,
        promptLength: payload.prompt ? String(payload.prompt).length : 0,
        steps: pricing.normalized?.steps ?? payload.steps ?? null,
        seed: payload.seed ?? null,
        balanceAfter: debit.creditBalance,
        resultStatus: "unavailable",
        metadata: {
          pricing: {
            model: modelId,
            credits: pricing.credits,
            providerCostUsd: pricing.providerCostUsd,
            normalized: pricing.normalized,
            formula: pricing.formula,
          },
          budget_policy: budgetPolicy.summary,
          replay: {
            available: false,
            reason: "admin_image_test_result_not_replayed",
          },
        },
      });

      const billedResponse = await appendAdminImageBilling(response, {
        organization_id: organizationId,
        organization_name: organization.name,
        feature: "ai.image.generate",
        operation: "admin_ai_image_test",
        model_id: modelId,
        credits_charged: pricing.credits,
        balance_before: debit.creditBalance + pricing.credits,
        balance_after: debit.creditBalance,
        ledger_entry_id: debit.usageEvent?.creditLedgerId || null,
        usage_event_id: debit.usageEvent?.id || null,
        usage_attempt_id: attemptState.attempt.id,
        idempotent_replay: false,
        budget_policy: budgetPolicy.summary,
      }, correlationId);
      return attachAdminImageSaveReference(billedResponse, env, result.user, correlationId, requestInfo);
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      if (error instanceof BillingError) return billingAdminErrorResponse(error, correlationId);
      throw error;
    }
  }

  // route-policy: admin.ai.test-embeddings
  if (pathname === "/api/admin/ai/test-embeddings" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-embeddings-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const idempotencyKey = normalizeAdminLabIdempotencyKey(request.headers.get("Idempotency-Key"));
      const validated = validateEmbeddingsPayload(body);
      const selection = resolveAdminAiModelSelection("embeddings", validated);
      const modelId = selection.model.id;
      const budgetPolicy = await buildAdminLabBudgetPolicyContext({
        user: result.user,
        operationId: ADMIN_EMBEDDINGS_OPERATION_ID,
        modelId,
        modelResolverKey: "admin.embeddings.model_registry",
        routeId: "admin.ai.test-embeddings",
        routePath: "/api/admin/ai/test-embeddings",
        payload: validated,
        hashFields: ["input"],
        idempotencyKey,
        killSwitchTarget: ADMIN_EMBEDDINGS_BUDGET_KILL_SWITCH,
        correlationId,
      });
      const callerPolicy = buildAdminAiCallerPolicy({
        operationId: ADMIN_EMBEDDINGS_OPERATION_ID,
        enforcementStatus: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_METADATA_ONLY,
        callerClass: AI_CALLER_POLICY_CALLER_CLASSES.ADMIN,
        modelId,
        modelResolverKey: "admin.embeddings.model_registry",
        idempotencyPolicy: "required",
        sourceRoute: "/api/admin/ai/test-embeddings",
        budgetFingerprint: budgetPolicy.summary.fingerprint,
        requestFingerprint: budgetPolicy.summary.fingerprint,
        killSwitchTarget: ADMIN_EMBEDDINGS_BUDGET_KILL_SWITCH,
        correlationId,
        reason: "phase_4_8_1_admin_embeddings_durable_idempotency_metadata_only",
        notes: "Idempotency-Key is required and backed by durable metadata-only duplicate suppression.",
      });
      const initialBudgetPolicy = withAdminLabAttemptBudgetMetadata(budgetPolicy.summary, null, "pending");
      const attemptState = await beginAdminAiIdempotencyAttempt({
        env,
        operationKey: ADMIN_EMBEDDINGS_OPERATION_ID,
        route: "/api/admin/ai/test-embeddings",
        adminUserId: result.user.id,
        idempotencyKey,
        requestFingerprint: budgetPolicy.summary.fingerprint,
        providerFamily: budgetPolicy.summary.provider_family,
        modelKey: modelId,
        budgetScope: budgetPolicy.summary.budget_scope,
        budgetPolicy: initialBudgetPolicy,
        callerPolicy: compactAdminCallerPolicy(callerPolicy),
        metadata: adminLabAttemptSafeMetadata({
          requestMetadata: adminEmbeddingsRequestMetadata(validated),
          budgetPolicy: initialBudgetPolicy,
          callerPolicy,
          state: "pending",
        }),
      });
      if (attemptState.kind !== "created") {
        return adminLabAttemptResponse({
          task: "embeddings",
          modelId,
          kind: attemptState.kind,
          attempt: attemptState.attempt,
          budgetPolicy: initialBudgetPolicy,
          callerPolicy,
        }, correlationId);
      }
      await markAdminAiIdempotencyProviderRunning(env, attemptState.attempt.id);
      const response = await proxyToAiLab(
        env,
        "/internal/ai/test-embeddings",
        {
          method: "POST",
          body: validated,
          callerPolicy,
        },
        result.user,
        correlationId,
        requestInfo
      );
      const providerBody = await parseJsonResponseBody(response);
      if (!response.ok || !providerBody?.ok) {
        await markAdminAiIdempotencyProviderFailed(env, attemptState.attempt.id, {
          code: providerBody?.code || "provider_failed",
          message: "Admin embeddings provider call failed.",
        });
        return response;
      }
      const resultMetadata = adminEmbeddingsResultMetadata(providerBody);
      const completedAttempt = await markAdminAiIdempotencySucceeded(env, attemptState.attempt.id, {
        resultMetadata,
        metadata: adminLabAttemptSafeMetadata({
          requestMetadata: adminEmbeddingsRequestMetadata(validated),
          resultMetadata,
          budgetPolicy: withAdminLabAttemptBudgetMetadata(initialBudgetPolicy, attemptState.attempt, "succeeded"),
          callerPolicy,
          state: "succeeded",
        }),
      });
      return appendAdminLabBudgetMetadata(response, {
        budgetPolicy: withAdminLabAttemptBudgetMetadata(initialBudgetPolicy, completedAttempt, "succeeded"),
        callerPolicy,
      }, correlationId);
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      if (error instanceof AdminAiIdempotencyError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  // route-policy: admin.ai.test-music
  if (pathname === "/api/admin/ai/test-music" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-music-ip", 8, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const validated = validateMusicPayload(body);
      return proxyToAiLab(
        env,
        "/internal/ai/test-music",
        {
          method: "POST",
          body: validated,
          callerPolicy: buildAdminAiCallerPolicy({
            operationId: "admin.music.test",
            modelId: validated.model || null,
            modelResolverKey: "admin.music.model_registry",
            sourceRoute: "/api/admin/ai/test-music",
            killSwitchTarget: "ENABLE_ADMIN_AI_BUDGETED_MUSIC_TESTS",
            correlationId,
          }),
        },
        result.user,
        correlationId,
        requestInfo
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  // route-policy: admin.ai.test-video-debug
  if (pathname === "/api/admin/ai/test-video" && method === "POST") {
    if (!isSyncVideoDebugAllowed(env)) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "admin-ai-video",
        event: "admin_ai_sync_video_debug_blocked",
        level: "warn",
        correlationId,
        admin_user_id: result.user.id,
        ...getRequestLogFields(requestInfo),
      });
      return syncVideoDebugDisabledResponse(correlationId);
    }

    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-ip", 8, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const minimalMode = body.minimal_mode === true;
      const { minimal_mode: _strip, ...validationBody } = body;
      const validated = validateVideoPayload(validationBody);
      if (minimalMode) validated.minimal_mode = true;
      logDiagnostic({
        service: "bitbi-auth",
        component: "admin-ai-video",
        event: "admin_ai_sync_video_debug_used",
        level: "warn",
        correlationId,
        admin_user_id: result.user.id,
        model: validated.model || null,
        preset: validated.preset || null,
        ...getRequestLogFields(requestInfo),
      });
      return proxyToAiLab(
        env,
        "/internal/ai/test-video",
        {
          method: "POST",
          body: validated,
          callerPolicy: buildAdminAiCallerPolicy({
            operationId: "admin.video.sync_debug",
            modelId: validated.model || null,
            modelResolverKey: "admin.video.model_registry",
            sourceRoute: "/api/admin/ai/test-video",
            killSwitchTarget: "ENABLE_ADMIN_AI_BUDGETED_VIDEO_DEBUG",
            correlationId,
          }),
        },
        result.user,
        correlationId,
        requestInfo
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/video-jobs/poison" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-ops-ip", 30, 600_000, correlationId);
    if (limited) return limited;

    try {
      const resultPage = await listAdminAiVideoPoisonMessages(env, url.searchParams);
      return withCorrelationId(json({
        ok: true,
        poisonMessages: resultPage.messages,
        nextCursor: resultPage.nextCursor,
      }), correlationId);
    } catch (error) {
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-ops",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  const videoJobPoisonMatch = pathname.match(/^\/api\/admin\/ai\/video-jobs\/poison\/([^/]+)$/);
  if (videoJobPoisonMatch && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-ops-ip", 30, 600_000, correlationId);
    if (limited) return limited;

    const poisonId = decodePathSegment(videoJobPoisonMatch[1]);
    if (!poisonId || poisonId.includes("/")) {
      return notFoundResponse(correlationId);
    }

    try {
      const poisonMessage = await getAdminAiVideoPoisonMessage(env, poisonId);
      if (!poisonMessage) return notFoundResponse(correlationId);
      return withCorrelationId(json({ ok: true, poisonMessage }), correlationId);
    } catch (error) {
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-ops",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/video-jobs/failed" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-ops-ip", 30, 600_000, correlationId);
    if (limited) return limited;

    try {
      const resultPage = await listAdminAiVideoFailedJobs(env, url.searchParams);
      return withCorrelationId(json({
        ok: true,
        failedJobs: resultPage.jobs,
        nextCursor: resultPage.nextCursor,
      }), correlationId);
    } catch (error) {
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-ops",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  const videoJobFailedMatch = pathname.match(/^\/api\/admin\/ai\/video-jobs\/failed\/([^/]+)$/);
  if (videoJobFailedMatch && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-ops-ip", 30, 600_000, correlationId);
    if (limited) return limited;

    const jobId = decodePathSegment(videoJobFailedMatch[1]);
    if (!jobId || jobId.includes("/")) {
      return notFoundResponse(correlationId);
    }

    try {
      const failedJob = await getAdminAiVideoFailedJob(env, jobId);
      if (!failedJob) return notFoundResponse(correlationId);
      return withCorrelationId(json({ ok: true, failedJob }), correlationId);
    } catch (error) {
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-ops",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  // route-policy: admin.ai.video-jobs.create
  if (pathname === "/api/admin/ai/video-jobs" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-job-create-ip", 8, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId, {
      maxBytes: BODY_LIMITS.adminVideoJobJson,
    });
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const minimalMode = body.minimal_mode === true;
      const { minimal_mode: _strip, ...validationBody } = body;
      const validated = validateVideoPayload(validationBody);
      if (minimalMode) validated.minimal_mode = true;
      const idempotencyKey = normalizeAiVideoIdempotencyKey(request.headers.get("Idempotency-Key"));
      const { job, existing } = await createAdminAiVideoJob({
        env,
        adminUser: result.user,
        payload: validated,
        idempotencyKey,
        correlationId,
      });
      return videoJobResponse(job, correlationId, { status: existing ? 200 : 202, existing });
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-jobs",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  const videoJobStatusMatch = pathname.match(/^\/api\/admin\/ai\/video-jobs\/([^/]+)$/);
  if (videoJobStatusMatch && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-job-status-ip", 60, 600_000, correlationId);
    if (limited) return limited;

    const jobId = decodePathSegment(videoJobStatusMatch[1]);
    if (!jobId || jobId.includes("/")) {
      return notFoundResponse(correlationId);
    }

    const job = await getAdminAiVideoJob(env, result.user, jobId);
    if (!job) {
      return notFoundResponse(correlationId);
    }
    return videoJobResponse(job, correlationId);
  }

  const videoJobOutputMatch = pathname.match(/^\/api\/admin\/ai\/video-jobs\/([^/]+)\/(output|poster)$/);
  if (videoJobOutputMatch && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-job-output-ip", 60, 600_000, correlationId);
    if (limited) return limited;

    const jobId = decodePathSegment(videoJobOutputMatch[1]);
    if (!jobId || jobId.includes("/")) {
      return notFoundResponse(correlationId);
    }

    try {
      const { object, contentType } = await getAdminAiVideoJobOutput(
        env,
        result.user,
        jobId,
        videoJobOutputMatch[2]
      );
      if (!object) return notFoundResponse(correlationId);
      const headers = new Headers();
      headers.set("content-type", contentType || "application/octet-stream");
      headers.set("cache-control", "private, no-store");
      return withCorrelationId(new Response(object.body, { status: 200, headers }), correlationId);
    } catch (error) {
      if (error instanceof WorkerConfigError) {
        logWorkerConfigFailure({
          env,
          error,
          correlationId,
          requestInfo,
          component: "admin-ai-video-job-output",
        });
        return workerConfigUnavailableResponse(correlationId);
      }
      throw error;
    }
  }

  // route-policy: admin.ai.compare
  if (pathname === "/api/admin/ai/compare" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-compare-ip", 15, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const validated = validateComparePayload(body);
      return proxyToAiLab(
        env,
        "/internal/ai/compare",
        {
          method: "POST",
          body: validated,
          callerPolicy: buildAdminAiCallerPolicy({
            operationId: "admin.compare",
            modelResolverKey: "admin.compare.model_registry",
            sourceRoute: "/api/admin/ai/compare",
            killSwitchTarget: "ENABLE_ADMIN_AI_BUDGETED_COMPARE",
            correlationId,
          }),
        },
        result.user,
        correlationId,
        requestInfo
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  // route-policy: admin.ai.live-agent
  if (pathname === "/api/admin/ai/live-agent" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-liveagent-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    try {
      const validated = validateLiveAgentPayload(body);
      return proxyLiveAgentToAiLab(
        env,
        validated,
        result.user,
        correlationId,
        requestInfo,
        buildAdminAiCallerPolicy({
          operationId: "admin.live_agent",
          modelId: validated.model || null,
          modelResolverKey: "admin.live_agent.model",
          sourceRoute: "/api/admin/ai/live-agent",
          killSwitchTarget: "ENABLE_ADMIN_AI_BUDGETED_LIVE_AGENT",
          correlationId,
        })
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error, correlationId);
      throw error;
    }
  }

  // route-policy: admin.ai.derivatives.backfill
  if (pathname === "/api/admin/ai/image-derivatives/backfill" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-derivative-backfill-ip", 20, 600_000, correlationId);
    if (limited) return limited;

    const contentType = request.headers.get("content-type") || "";
    const parsed = contentType.includes("application/json")
      ? await readAdminAiJsonBody(request, correlationId)
      : { response: null, body: {} };
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (contentType.includes("application/json") && !body) return badJsonResponse(correlationId);

    return handleAdminAiDerivativeBackfillRequest({
      env,
      body,
      adminUser: result.user,
      correlationId,
    });
  }

  // route-policy: admin.ai.save-text-asset
  if (pathname === "/api/admin/ai/save-text-asset" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-save-text-ip", 25, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    return handleAdminAiSaveTextAssetRequest({
      env,
      adminUserId: result.user.id,
      body,
      correlationId,
    });
  }

  // route-policy: admin.ai.proxy-video
  if (pathname === "/api/admin/ai/proxy-video" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-video-proxy-ip", 16, 600_000, correlationId);
    if (limited) return limited;

    const parsed = await readAdminAiJsonBody(request, correlationId);
    if (parsed.response) return parsed.response;
    const body = parsed.body;
    if (!body) return badJsonResponse(correlationId);

    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    const error = attachRemoteMediaPolicyContext(
      new InputError(
        buildRemoteMediaUrlRejectedMessage(
          "url",
          "The admin remote video proxy is disabled. Stream or download the provider URL directly in the browser instead."
        ),
        410,
        REMOTE_MEDIA_URL_POLICY_CODE
      ),
      rawUrl,
      {
        field: "url",
        reason: "admin_proxy_video_disabled",
      }
    );
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-proxy-video",
      event: "admin_ai_proxy_video_rejected",
      level: "warn",
      correlationId,
      admin_user_id: result.user.id,
      ...getRemoteMediaPolicyLogFields(error),
    });
    return inputErrorResponse(error, correlationId);
  }

  if (pathname.startsWith("/api/admin/ai/")) {
    return notFoundResponse(correlationId);
  }

  return null;
}
