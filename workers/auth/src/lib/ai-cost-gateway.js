import { sha256Hex } from "./tokens.js";

export const AI_COST_GATEWAY_VERSION = "ai-cost-gateway-v1";

export const AI_COST_GATEWAY_MODES = Object.freeze({
  PLAN_ONLY: "plan_only",
  ENFORCING: "enforcing",
});

export const AI_COST_GATEWAY_SCOPES = Object.freeze({
  MEMBER_CREDIT_ACCOUNT: "member_credit_account",
  ORGANIZATION_CREDIT_ACCOUNT: "organization_credit_account",
  PLATFORM_BUDGET: "platform_budget",
  UNMETERED_ADMIN: "unmetered_admin",
  EXTERNAL: "external",
});

export const AI_COST_GATEWAY_PHASES = Object.freeze({
  REQUIRES_IDEMPOTENCY: "requires_idempotency",
  READY_TO_RESERVE: "ready_to_reserve",
  RESERVATION_NOT_SUPPORTED: "reservation_not_supported",
  PLATFORM_BUDGET_REVIEW: "platform_budget_review",
  UNMETERED_ADMIN: "unmetered_admin",
  LEGACY_PASSTHROUGH: "legacy_passthrough",
  BLOCKED_INVALID_CONFIG: "blocked_invalid_config",
});

export class AiCostGatewayError extends Error {
  constructor(message, { code = "ai_cost_gateway_error", status = 400 } = {}) {
    super(message);
    this.name = "AiCostGatewayError";
    this.code = code;
    this.status = status;
  }
}

const ACTOR_TYPES = new Set(["member", "organization", "admin", "platform"]);
const BILLING_SCOPES = new Set(Object.values(AI_COST_GATEWAY_SCOPES));
const IDEMPOTENCY_POLICIES = new Set(["required", "optional", "forbidden", "inherited"]);
const RESERVATION_POLICIES = new Set(["required", "not_supported", "platform_budget_only"]);
const REPLAY_POLICIES = new Set(["disabled", "metadata_only", "temp_object", "durable_result"]);
const FAILURE_POLICIES = new Set([
  "release_reservation",
  "no_charge",
  "manual_review",
  "terminal_billing_failure",
]);
const STORAGE_POLICIES = new Set(["none", "user_images", "private_media", "external_only"]);
const OPERATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const COST_UNITS_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/;
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const DEFAULT_MAX_STRING_LENGTH = 2048;
const ORGANIZATION_CONTEXT_ALIASES = new Set([
  "organization_id",
  "organizationId",
  "org_id",
  "orgId",
]);
const DEFAULT_VOLATILE_FIELDS = new Set([
  "nonce",
  "timestamp",
  "requestId",
  "request_id",
  "correlationId",
  "correlation_id",
]);
const SENSITIVE_FIELD_PATTERN =
  /(?:^|[_-])(?:authorization|cookie|token|secret|signature|password|api[_-]?key|stripe|session)(?:$|[_-])/i;

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiCostGatewayError(`${fieldName} must be an object.`, {
      code: "invalid_operation_config",
    });
  }
}

function normalizeIdentifier(value, { fieldName, pattern, required = true, maxLength = 128 }) {
  if (value == null || value === "") {
    if (!required) return null;
    throw new AiCostGatewayError(`${fieldName} is required.`, {
      code: "invalid_operation_config",
    });
  }
  const text = String(value).trim();
  if (!text || text.length > maxLength || !pattern.test(text)) {
    throw new AiCostGatewayError(`${fieldName} is invalid.`, {
      code: "invalid_operation_config",
    });
  }
  return text;
}

function normalizeEnum(value, { fieldName, allowed, defaultValue = null }) {
  const text = value == null || value === "" ? defaultValue : String(value).trim();
  if (!text || !allowed.has(text)) {
    throw new AiCostGatewayError(`${fieldName} is invalid.`, {
      code: "invalid_operation_config",
    });
  }
  return text;
}

function normalizeNonNegativeInteger(value, { fieldName, defaultValue = 0, max = 10_000_000 } = {}) {
  const number = value == null || value === "" ? defaultValue : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new AiCostGatewayError(`${fieldName} must be a non-negative integer.`, {
      code: "invalid_operation_config",
    });
  }
  return number;
}

function normalizePositiveInteger(value, { fieldName, defaultValue = 1, max = 100_000 } = {}) {
  const number = value == null || value === "" ? defaultValue : Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > max) {
    throw new AiCostGatewayError(`${fieldName} must be a positive integer.`, {
      code: "invalid_operation_config",
    });
  }
  return number;
}

function normalizeFailurePolicies(value) {
  const list = Array.isArray(value)
    ? value
    : value == null || value === ""
      ? ["release_reservation", "no_charge"]
      : [value];
  const normalized = list.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (normalized.length === 0 || normalized.some((entry) => !FAILURE_POLICIES.has(entry))) {
    throw new AiCostGatewayError("failurePolicy is invalid.", {
      code: "invalid_operation_config",
    });
  }
  return Object.freeze([...new Set(normalized)]);
}

function normalizeOptionalNotes(value) {
  if (value == null || value === "") return null;
  return String(value).trim().slice(0, 500);
}

function isMemberOrOrgScope(scope) {
  return scope === AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT
    || scope === AI_COST_GATEWAY_SCOPES.ORGANIZATION_CREDIT_ACCOUNT;
}

function isExplicitZeroCostScope(scope) {
  return scope === AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET
    || scope === AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN
    || scope === AI_COST_GATEWAY_SCOPES.EXTERNAL;
}

export function normalizeAiCostOperationConfig(config) {
  assertPlainObject(config, "config");
  const operationId = normalizeIdentifier(config.operationId || config.id, {
    fieldName: "operationId",
    pattern: OPERATION_ID_PATTERN,
    maxLength: 120,
  });
  const featureKey = normalizeIdentifier(config.featureKey, {
    fieldName: "featureKey",
    pattern: FEATURE_KEY_PATTERN,
    maxLength: 120,
  });
  const actorType = normalizeEnum(config.actorType, {
    fieldName: "actorType",
    allowed: ACTOR_TYPES,
  });
  const billingScope = normalizeEnum(config.billingScope, {
    fieldName: "billingScope",
    allowed: BILLING_SCOPES,
  });
  const providerFamily = normalizeIdentifier(config.providerFamily || "none", {
    fieldName: "providerFamily",
    pattern: COST_UNITS_PATTERN,
    required: false,
    maxLength: 64,
  }) || "none";
  const modelId = config.modelId == null || config.modelId === ""
    ? null
    : String(config.modelId).trim().slice(0, 160);
  const modelResolverKey = config.modelResolverKey == null || config.modelResolverKey === ""
    ? null
    : normalizeIdentifier(config.modelResolverKey, {
      fieldName: "modelResolverKey",
      pattern: OPERATION_ID_PATTERN,
      maxLength: 120,
    });
  const creditCost = normalizeNonNegativeInteger(
    config.creditCost ?? config.credits ?? config.cost?.credits,
    { fieldName: "creditCost" }
  );
  const quantity = normalizePositiveInteger(config.quantity, { fieldName: "quantity" });
  const costUnits = normalizeIdentifier(config.costUnits || "credits", {
    fieldName: "costUnits",
    pattern: COST_UNITS_PATTERN,
    maxLength: 64,
  });
  const idempotencyPolicy = normalizeEnum(config.idempotencyPolicy, {
    fieldName: "idempotencyPolicy",
    allowed: IDEMPOTENCY_POLICIES,
  });
  const reservationPolicy = normalizeEnum(config.reservationPolicy, {
    fieldName: "reservationPolicy",
    allowed: RESERVATION_POLICIES,
  });
  const replayPolicy = normalizeEnum(config.replayPolicy, {
    fieldName: "replayPolicy",
    allowed: REPLAY_POLICIES,
  });
  const failurePolicies = normalizeFailurePolicies(config.failurePolicy ?? config.failurePolicies);
  const storagePolicy = normalizeEnum(config.storagePolicy || "none", {
    fieldName: "storagePolicy",
    allowed: STORAGE_POLICIES,
  });
  const observabilityEventPrefix = normalizeIdentifier(config.observabilityEventPrefix || operationId, {
    fieldName: "observabilityEventPrefix",
    pattern: OPERATION_ID_PATTERN,
    maxLength: 120,
  });
  const routeId = config.routeId == null || config.routeId === ""
    ? null
    : normalizeIdentifier(config.routeId, {
      fieldName: "routeId",
      pattern: ROUTE_ID_PATTERN,
      maxLength: 120,
    });
  const routePath = config.routePath || config.route || null;
  if (routePath != null && (!String(routePath).startsWith("/") || String(routePath).length > 256)) {
    throw new AiCostGatewayError("routePath is invalid.", {
      code: "invalid_operation_config",
    });
  }
  const providerCost = config.providerCost == null
    ? providerFamily !== "none"
    : Boolean(config.providerCost);
  const costPolicy = config.costPolicy == null || config.costPolicy === ""
    ? null
    : String(config.costPolicy).trim().slice(0, 160);
  const explicitCostPolicy = Boolean(
    config.explicitCostPolicy === true
    || costPolicy
    || creditCost > 0
    || isExplicitZeroCostScope(billingScope)
  );

  if (providerCost && !explicitCostPolicy) {
    throw new AiCostGatewayError("Provider-cost operations require an explicit cost policy.", {
      code: "missing_cost_policy",
    });
  }
  if (providerCost && isMemberOrOrgScope(billingScope) && creditCost <= 0 && !costPolicy) {
    throw new AiCostGatewayError("Cost-bearing member/org operations require explicit credits or costPolicy.", {
      code: "missing_cost_policy",
    });
  }
  if (providerCost && isMemberOrOrgScope(billingScope) && idempotencyPolicy !== "required") {
    throw new AiCostGatewayError("Cost-bearing member/org operations require idempotencyPolicy=required.", {
      code: "idempotency_required_for_cost_bearing_operation",
      status: 428,
    });
  }
  if (providerCost && actorType === "admin" && creditCost === 0 && billingScope !== AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN) {
    throw new AiCostGatewayError("Uncharged admin provider-cost operations must use billingScope=unmetered_admin.", {
      code: "admin_unmetered_policy_required",
    });
  }

  return Object.freeze({
    gatewayVersion: AI_COST_GATEWAY_VERSION,
    operationId,
    featureKey,
    actorType,
    billingScope,
    providerFamily,
    modelId,
    modelResolverKey,
    creditCost,
    quantity,
    costUnits,
    costVersion: String(config.costVersion || "unversioned").trim().slice(0, 80),
    providerCost,
    costPolicy,
    idempotencyPolicy,
    reservationPolicy,
    replayPolicy,
    failurePolicies,
    storagePolicy,
    observabilityEventPrefix,
    routeId,
    routePath: routePath == null ? null : String(routePath),
    notes: normalizeOptionalNotes(config.notes),
  });
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function fieldMatches(set, key, path) {
  return set.has(key) || set.has(path);
}

function shouldOmitField({ key, path, excludeFields, excludeOrganizationContextAliases }) {
  if (fieldMatches(excludeFields, key, path)) return true;
  if (DEFAULT_VOLATILE_FIELDS.has(key)) return true;
  if (excludeOrganizationContextAliases && ORGANIZATION_CONTEXT_ALIASES.has(key)) return true;
  return SENSITIVE_FIELD_PATTERN.test(key) || SENSITIVE_FIELD_PATTERN.test(path);
}

async function sanitizeFingerprintValue(value, options, path = "") {
  if (Array.isArray(value)) {
    const out = [];
    for (const entry of value) {
      out.push(await sanitizeFingerprintValue(entry, options, path));
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const childPath = path ? `${path}.${key}` : key;
      if (shouldOmitField({ key, path: childPath, ...options })) continue;
      out[key] = await sanitizeFingerprintValue(value[key], options, childPath);
    }
    return out;
  }
  if (typeof value === "string") {
    const key = path.split(".").pop() || path;
    const shouldHash = fieldMatches(options.hashFields, key, path)
      || (options.includePromptHash && /prompt/i.test(key));
    if (shouldHash) {
      return {
        sha256: await sha256Hex(value),
        length: value.length,
      };
    }
    if (value.length > options.maxStringLength) {
      return {
        sha256: await sha256Hex(value),
        length: value.length,
        truncated: true,
      };
    }
  }
  return value;
}

function normalizeSet(values) {
  return new Set((values || []).map((entry) => String(entry || "").trim()).filter(Boolean));
}

export async function buildAiCostRequestFingerprint(input = {}) {
  const options = {
    excludeFields: normalizeSet(input.excludeFields),
    hashFields: normalizeSet(input.hashFields),
    maxStringLength: normalizePositiveInteger(input.maxStringLength, {
      fieldName: "maxStringLength",
      defaultValue: DEFAULT_MAX_STRING_LENGTH,
      max: 128 * 1024,
    }),
    includePromptHash: input.includePromptHash === true,
    excludeOrganizationContextAliases: input.excludeOrganizationContextAliases === true,
  };
  const payload = {
    gatewayVersion: AI_COST_GATEWAY_VERSION,
    operationId: input.operationId || input.operationConfig?.operationId || input.operationConfig?.id || null,
    route: input.route || input.routePath || input.operationConfig?.routePath || input.operationConfig?.route || null,
    routeId: input.routeId || input.operationConfig?.routeId || null,
    actorId: input.actorId || null,
    billingScopeId: input.billingScopeId || null,
    billingScope: input.billingScope || input.operationConfig?.billingScope || null,
    modelId: input.modelId || input.operationConfig?.modelId || null,
    providerFamily: input.providerFamily || input.operationConfig?.providerFamily || null,
    costVersion: input.costVersion || input.operationConfig?.costVersion || null,
    body: await sanitizeFingerprintValue(input.body || {}, options),
  };
  return sha256Hex(stableJson(payload));
}

export async function buildAiCostScopedIdempotencyKey(input = {}) {
  const policy = input.idempotencyPolicy
    || input.operationConfig?.idempotencyPolicy
    || "optional";
  const rawClientKey = input.clientIdempotencyKey == null
    ? null
    : String(input.clientIdempotencyKey).trim();
  if (!rawClientKey) {
    if (policy === "required") {
      throw new AiCostGatewayError("A valid Idempotency-Key header is required.", {
        code: "idempotency_key_required",
        status: 428,
      });
    }
    return null;
  }
  if (policy === "forbidden") {
    throw new AiCostGatewayError("Idempotency-Key is not accepted for this operation.", {
      code: "idempotency_key_forbidden",
    });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(rawClientKey)) {
    throw new AiCostGatewayError("Idempotency-Key is malformed.", {
      code: "invalid_idempotency_key",
      status: 428,
    });
  }
  const digest = await sha256Hex(stableJson({
    gatewayVersion: AI_COST_GATEWAY_VERSION,
    kind: "ai-cost-idempotency",
    clientKey: rawClientKey,
    route: input.route || input.routePath || input.operationConfig?.routePath || input.operationConfig?.route || null,
    routeId: input.routeId || input.operationConfig?.routeId || null,
    operationId: input.operationId || input.operationConfig?.operationId || input.operationConfig?.id || null,
    actorId: input.actorId || null,
    billingScopeId: input.billingScopeId || null,
    modelId: input.modelId || input.operationConfig?.modelId || null,
  }));
  return `ai-cost:${digest}`;
}

function normalizePlanConfig(input = {}) {
  return normalizeAiCostOperationConfig(input.operationConfig || input.config || input);
}

function classifyNormalizedConfig(config, input = {}) {
  if (
    config.idempotencyPolicy === "required"
    && !String(input.clientIdempotencyKey || "").trim()
  ) {
    return AI_COST_GATEWAY_PHASES.REQUIRES_IDEMPOTENCY;
  }
  if (config.billingScope === AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN) {
    return AI_COST_GATEWAY_PHASES.UNMETERED_ADMIN;
  }
  if (config.billingScope === AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET) {
    return AI_COST_GATEWAY_PHASES.PLATFORM_BUDGET_REVIEW;
  }
  if (!config.providerCost || config.billingScope === AI_COST_GATEWAY_SCOPES.EXTERNAL) {
    return AI_COST_GATEWAY_PHASES.LEGACY_PASSTHROUGH;
  }
  if (config.reservationPolicy === "required") {
    return AI_COST_GATEWAY_PHASES.READY_TO_RESERVE;
  }
  if (config.reservationPolicy === "platform_budget_only") {
    return AI_COST_GATEWAY_PHASES.PLATFORM_BUDGET_REVIEW;
  }
  return AI_COST_GATEWAY_PHASES.RESERVATION_NOT_SUPPORTED;
}

export function classifyAiCostGatewayState(input = {}) {
  try {
    const config = normalizePlanConfig(input);
    return {
      state: classifyNormalizedConfig(config, input),
      operationId: config.operationId,
      billingScope: config.billingScope,
    };
  } catch (error) {
    return {
      state: AI_COST_GATEWAY_PHASES.BLOCKED_INVALID_CONFIG,
      error: error instanceof AiCostGatewayError
        ? { code: error.code, message: error.message }
        : { code: "unexpected_ai_cost_gateway_error", message: "AI cost gateway planning failed." },
    };
  }
}

function nextActionForState(state) {
  switch (state) {
    case AI_COST_GATEWAY_PHASES.REQUIRES_IDEMPOTENCY:
      return "require_valid_idempotency_key_before_provider_call";
    case AI_COST_GATEWAY_PHASES.READY_TO_RESERVE:
      return "create_durable_reservation_before_provider_call";
    case AI_COST_GATEWAY_PHASES.RESERVATION_NOT_SUPPORTED:
      return "legacy_passthrough_until_route_migration";
    case AI_COST_GATEWAY_PHASES.PLATFORM_BUDGET_REVIEW:
      return "verify_platform_budget_or_deterministic_job_policy";
    case AI_COST_GATEWAY_PHASES.UNMETERED_ADMIN:
      return "record_admin_cost_telemetry_when_route_is_migrated";
    case AI_COST_GATEWAY_PHASES.BLOCKED_INVALID_CONFIG:
      return "fix_operation_config_before_route_migration";
    default:
      return "no_gateway_action_for_legacy_passthrough";
  }
}

export async function createAiCostGatewayPlan(input = {}) {
  let config;
  try {
    config = normalizePlanConfig(input);
  } catch (error) {
    const state = AI_COST_GATEWAY_PHASES.BLOCKED_INVALID_CONFIG;
    return {
      gatewayVersion: AI_COST_GATEWAY_VERSION,
      state,
      ok: false,
      error: error instanceof AiCostGatewayError
        ? { code: error.code, message: error.message }
        : { code: "unexpected_ai_cost_gateway_error", message: "AI cost gateway planning failed." },
      nextRequiredAction: nextActionForState(state),
      safetyNotes: [
        "Phase 3.2 planning is local and pure.",
        "No provider calls, credit reservations, credit debits, Stripe calls, or Cloudflare mutations are performed.",
      ],
    };
  }

  const state = classifyNormalizedConfig(config, input);
  const fingerprint = await buildAiCostRequestFingerprint({
    ...input,
    operationConfig: config,
    operationId: config.operationId,
    routePath: input.routePath || config.routePath,
    routeId: input.routeId || config.routeId,
    modelId: input.modelId || config.modelId,
    providerFamily: input.providerFamily || config.providerFamily,
    billingScope: config.billingScope,
    costVersion: input.costVersion || config.costVersion,
  });
  let scopedIdempotencyKey = null;
  if (String(input.clientIdempotencyKey || "").trim()) {
    scopedIdempotencyKey = await buildAiCostScopedIdempotencyKey({
      ...input,
      operationConfig: config,
      idempotencyPolicy: config.idempotencyPolicy,
      operationId: config.operationId,
      routePath: input.routePath || config.routePath,
      routeId: input.routeId || config.routeId,
      modelId: input.modelId || config.modelId,
    });
  }

  return {
    gatewayVersion: AI_COST_GATEWAY_VERSION,
    state,
    ok: state !== AI_COST_GATEWAY_PHASES.BLOCKED_INVALID_CONFIG,
    operationId: config.operationId,
    featureKey: config.featureKey,
    actorType: config.actorType,
    billingScope: config.billingScope,
    creditCost: config.creditCost,
    quantity: config.quantity,
    costUnits: config.costUnits,
    providerFamily: config.providerFamily,
    modelId: input.modelId || config.modelId,
    idempotencyPolicy: config.idempotencyPolicy,
    reservationPolicy: config.reservationPolicy,
    replayPolicy: config.replayPolicy,
    storagePolicy: config.storagePolicy,
    fingerprint,
    scopedIdempotencyKey,
    nextRequiredAction: nextActionForState(state),
    safetyNotes: [
      "Phase 3.2 does not wire this plan into live routes.",
      "No provider calls, credit reservations, credit debits, Stripe calls, or Cloudflare mutations are performed.",
      state === AI_COST_GATEWAY_PHASES.REQUIRES_IDEMPOTENCY
        ? "A future migrated route must fail before provider execution until a valid Idempotency-Key is supplied."
        : "A future migrated route must still perform route auth, entitlement, limiter, and body validation before using gateway state.",
    ],
  };
}
