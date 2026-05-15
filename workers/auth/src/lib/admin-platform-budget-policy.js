import { sha256Hex } from "./tokens.js";

export const ADMIN_PLATFORM_BUDGET_POLICY_VERSION = "admin-platform-budget-policy-v1";

export const ADMIN_PLATFORM_BUDGET_SCOPES = Object.freeze({
  MEMBER_CREDIT_ACCOUNT: "member_credit_account",
  ORGANIZATION_CREDIT_ACCOUNT: "organization_credit_account",
  ADMIN_ORG_CREDIT_ACCOUNT: "admin_org_credit_account",
  PLATFORM_ADMIN_LAB_BUDGET: "platform_admin_lab_budget",
  PLATFORM_BACKGROUND_BUDGET: "platform_background_budget",
  OPENCLAW_NEWS_PULSE_BUDGET: "openclaw_news_pulse_budget",
  INTERNAL_AI_WORKER_CALLER_ENFORCED: "internal_ai_worker_caller_enforced",
  EXPLICIT_UNMETERED_ADMIN: "explicit_unmetered_admin",
  EXTERNAL_PROVIDER_ONLY: "external_provider_only",
});

export const ADMIN_PLATFORM_BUDGET_ACTIONS = Object.freeze({
  VALIDATE_CONFIG: "validate_config",
  REQUIRE_KILL_SWITCH: "require_kill_switch",
  CHECK_PLATFORM_BUDGET: "check_platform_budget",
  CHECK_ADMIN_ORG_CREDITS: "check_admin_org_credits",
  REQUIRE_CALLER_POLICY: "require_caller_policy",
  RECORD_EXPLICIT_UNMETERED_AUDIT: "record_explicit_unmetered_audit",
  BLOCK_PROVIDER_CALL: "block_provider_call",
});

export const ADMIN_PLATFORM_BUDGET_PLAN_STATUSES = Object.freeze({
  READY_FOR_BUDGET_CHECK: "ready_for_budget_check",
  REQUIRES_KILL_SWITCH: "requires_kill_switch",
  BLOCKED_BY_POLICY: "blocked_by_policy",
  CALLER_ENFORCED: "caller_enforced",
  EXPLICIT_UNMETERED: "explicit_unmetered",
  PLATFORM_BUDGET_REVIEW: "platform_budget_review",
  ADMIN_ORG_CREDIT_REQUIRED: "admin_org_credit_required",
  INVALID_CONFIG: "invalid_config",
});

export class AdminPlatformBudgetPolicyError extends Error {
  constructor(message, { code = "admin_platform_budget_policy_error", status = 400 } = {}) {
    super(message);
    this.name = "AdminPlatformBudgetPolicyError";
    this.code = code;
    this.status = status;
  }
}

const ACTOR_TYPES = new Set([
  "member",
  "organization",
  "admin",
  "platform",
  "internal",
  "background",
]);
const BUDGET_SCOPE_VALUES = new Set(Object.values(ADMIN_PLATFORM_BUDGET_SCOPES));
const PROVIDER_COST_BUDGET_SCOPES = new Set(Object.values(ADMIN_PLATFORM_BUDGET_SCOPES));
const IDEMPOTENCY_POLICIES = new Set([
  "required",
  "optional",
  "forbidden",
  "inherited",
  "caller_enforced",
  "not_applicable",
]);
const DISABLED_BEHAVIORS = new Set([
  "fail_closed",
  "skip_provider_call",
  "return_503",
  "return_403",
  "manual_only",
  "caller_policy_required",
]);
const OPERATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const FLAG_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,95}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,160}$/;
const HIGH_RISK_BUDGET_SCOPES = new Set([
  ADMIN_PLATFORM_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
  ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
  ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET,
  ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
  ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
]);
const KILL_SWITCH_EXEMPT_SCOPES = new Set([
  ADMIN_PLATFORM_BUDGET_SCOPES.EXTERNAL_PROVIDER_ONLY,
  ADMIN_PLATFORM_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
]);
const SENSITIVE_FIELD_PATTERN =
  /(?:^|[_-])(?:authorization|cookie|token|secret|signature|password|api[_-]?key|stripe|session|cf[_-]?token|r2[_-]?key|private[_-]?key)(?:$|[_-])/i;
const PROMPT_FIELD_PATTERN = /(?:prompt|lyrics|messages?|provider[_-]?request|raw[_-]?body|input[_-]?text|system[_-]?prompt)/i;
const DEFAULT_MAX_STRING_LENGTH = 2048;

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminPlatformBudgetPolicyError(`${fieldName} must be an object.`, {
      code: "invalid_budget_policy_config",
    });
  }
}

function normalizeString(value, {
  fieldName,
  required = true,
  maxLength = 160,
  pattern = null,
} = {}) {
  if (value == null || value === "") {
    if (!required) return null;
    throw new AdminPlatformBudgetPolicyError(`${fieldName} is required.`, {
      code: "invalid_budget_policy_config",
    });
  }
  const text = String(value).trim();
  if (!text || text.length > maxLength || (pattern && !pattern.test(text))) {
    throw new AdminPlatformBudgetPolicyError(`${fieldName} is invalid.`, {
      code: "invalid_budget_policy_config",
    });
  }
  return text;
}

function normalizeEnum(value, { fieldName, allowed, defaultValue = null }) {
  const text = value == null || value === "" ? defaultValue : String(value).trim();
  if (!text || !allowed.has(text)) {
    throw new AdminPlatformBudgetPolicyError(`${fieldName} is invalid.`, {
      code: "invalid_budget_policy_config",
    });
  }
  return text;
}

function normalizeNonNegativeInteger(value, {
  fieldName,
  defaultValue = 0,
  max = 1_000_000_000,
} = {}) {
  const number = value == null || value === "" ? defaultValue : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new AdminPlatformBudgetPolicyError(`${fieldName} must be a non-negative integer.`, {
      code: "invalid_budget_policy_config",
    });
  }
  return number;
}

function normalizeBoolean(value, { fieldName, defaultValue = false } = {}) {
  if (value == null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AdminPlatformBudgetPolicyError(`${fieldName} must be boolean.`, {
    code: "invalid_budget_policy_config",
  });
}

function normalizeNotes(value, { maxLength = 500, required = false, fieldName = "notes" } = {}) {
  if (value == null || value === "") {
    if (!required) return null;
    throw new AdminPlatformBudgetPolicyError(`${fieldName} is required.`, {
      code: "invalid_budget_policy_config",
    });
  }
  const text = String(value).trim();
  if (!text) {
    if (!required) return null;
    throw new AdminPlatformBudgetPolicyError(`${fieldName} is required.`, {
      code: "invalid_budget_policy_config",
    });
  }
  return text.slice(0, maxLength);
}

function normalizeDefaultState(value) {
  if (value === false || value === "off" || value === "disabled") return "disabled";
  if (value === true || value === "on" || value === "enabled") return "enabled";
  throw new AdminPlatformBudgetPolicyError("killSwitch.defaultState is invalid.", {
    code: "invalid_kill_switch_config",
  });
}

export function validateAdminPlatformKillSwitchConfig(input = {}, options = {}) {
  assertPlainObject(input, "killSwitch");
  const scope = normalizeEnum(input.scope || options.scope, {
    fieldName: "killSwitch.scope",
    allowed: BUDGET_SCOPE_VALUES,
  });
  const flagName = normalizeString(input.flagName, {
    fieldName: "killSwitch.flagName",
    pattern: FLAG_NAME_PATTERN,
    maxLength: 96,
  });
  const defaultState = normalizeDefaultState(input.defaultState ?? "disabled");
  const requiredForProviderCall = normalizeBoolean(input.requiredForProviderCall, {
    fieldName: "killSwitch.requiredForProviderCall",
    defaultValue: true,
  });
  const operatorCanOverride = normalizeBoolean(input.operatorCanOverride, {
    fieldName: "killSwitch.operatorCanOverride",
    defaultValue: false,
  });
  const disabledBehavior = normalizeEnum(input.disabledBehavior || "fail_closed", {
    fieldName: "killSwitch.disabledBehavior",
    allowed: DISABLED_BEHAVIORS,
  });
  const unsafeDefaultEnabledReason = normalizeNotes(input.unsafeDefaultEnabledReason, {
    maxLength: 300,
  });

  if (HIGH_RISK_BUDGET_SCOPES.has(scope) && defaultState === "enabled" && !unsafeDefaultEnabledReason) {
    throw new AdminPlatformBudgetPolicyError(
      "High-risk budget scopes require safe/off kill switch defaults unless a reason is documented.",
      { code: "unsafe_kill_switch_default" }
    );
  }
  if (SENSITIVE_FIELD_PATTERN.test(flagName)) {
    throw new AdminPlatformBudgetPolicyError("killSwitch.flagName must not reference secrets.", {
      code: "unsafe_kill_switch_config",
    });
  }

  return Object.freeze({
    flagName,
    defaultState,
    requiredForProviderCall,
    disabledBehavior,
    operatorCanOverride,
    scope,
    notes: normalizeNotes(input.notes, { maxLength: 300 }),
    unsafeDefaultEnabledReason,
  });
}

function normalizeKillSwitch(config, { allowMissingKillSwitch = false } = {}) {
  const killSwitch = config.killSwitchPolicy || config.killSwitch || null;
  if (killSwitch) {
    return validateAdminPlatformKillSwitchConfig(killSwitch, {
      scope: config.budgetScope,
    });
  }
  const exemptionReason = normalizeNotes(
    config.killSwitchExemptionReason || config.killSwitchExemption,
    { maxLength: 500 }
  );
  if (KILL_SWITCH_EXEMPT_SCOPES.has(config.budgetScope) && exemptionReason) {
    return null;
  }
  if (allowMissingKillSwitch) return null;
  throw new AdminPlatformBudgetPolicyError(
    "Provider-cost admin/platform operations require a kill-switch policy or explicit exemption.",
    { code: "kill_switch_policy_required" }
  );
}

export function normalizeAdminPlatformBudgetOperation(input = {}, options = {}) {
  assertPlainObject(input, "operation");
  const operationId = normalizeString(input.operationId || input.id, {
    fieldName: "operationId",
    pattern: OPERATION_ID_PATTERN,
    maxLength: 120,
  });
  const actorType = normalizeEnum(input.actorType, {
    fieldName: "actorType",
    allowed: ACTOR_TYPES,
  });
  const budgetScope = normalizeEnum(input.budgetScope, {
    fieldName: "budgetScope",
    allowed: BUDGET_SCOPE_VALUES,
  });
  const providerFamily = normalizeString(input.providerFamily || "none", {
    fieldName: "providerFamily",
    pattern: OPERATION_ID_PATTERN,
    required: false,
    maxLength: 80,
  }) || "none";
  const providerCost = input.providerCost == null
    ? providerFamily !== "none"
    : normalizeBoolean(input.providerCost, { fieldName: "providerCost" });
  const ownerDomain = normalizeString(input.ownerDomain || input.domain, {
    fieldName: "ownerDomain",
    pattern: FEATURE_KEY_PATTERN,
    maxLength: 120,
    required: providerCost || ["admin", "platform", "internal", "background"].includes(actorType),
  });
  const idempotencyPolicy = normalizeEnum(input.idempotencyPolicy || input.idempotencyTarget, {
    fieldName: "idempotencyPolicy",
    allowed: IDEMPOTENCY_POLICIES,
    defaultValue: providerCost ? null : "not_applicable",
  });
  const killSwitchExemptionReason = normalizeNotes(
    input.killSwitchExemptionReason || input.killSwitchExemption,
    { maxLength: 500 }
  );
  const normalizedForKillSwitch = {
    budgetScope,
    killSwitchPolicy: input.killSwitchPolicy,
    killSwitch: input.killSwitch,
    killSwitchExemptionReason,
  };

  if (providerCost && !PROVIDER_COST_BUDGET_SCOPES.has(budgetScope)) {
    throw new AdminPlatformBudgetPolicyError("Provider-cost operations require an explicit budget scope.", {
      code: "budget_scope_required",
    });
  }
  if (providerCost && !idempotencyPolicy) {
    throw new AdminPlatformBudgetPolicyError("Provider-cost operations require an idempotency policy target.", {
      code: "idempotency_target_required",
    });
  }
  if (
    budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN
    && !normalizeNotes(input.unmeteredJustification, { maxLength: 500 })
  ) {
    throw new AdminPlatformBudgetPolicyError("Explicit unmetered admin operations require a justification.", {
      code: "unmetered_justification_required",
    });
  }
  if (
    providerCost
    && budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.EXTERNAL_PROVIDER_ONLY
    && !killSwitchExemptionReason
  ) {
    throw new AdminPlatformBudgetPolicyError("External-provider-only operations require a kill-switch exemption reason.", {
      code: "kill_switch_exemption_required",
    });
  }
  if (
    providerCost
    && budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED
    && !killSwitchExemptionReason
  ) {
    throw new AdminPlatformBudgetPolicyError("Caller-enforced internal operations require an explicit exemption reason.", {
      code: "caller_enforced_exemption_required",
    });
  }

  const killSwitchPolicy = providerCost
    ? normalizeKillSwitch(normalizedForKillSwitch, options)
    : null;

  return Object.freeze({
    policyVersion: ADMIN_PLATFORM_BUDGET_POLICY_VERSION,
    operationId,
    featureKey: input.featureKey == null || input.featureKey === ""
      ? null
      : normalizeString(input.featureKey, {
        fieldName: "featureKey",
        pattern: FEATURE_KEY_PATTERN,
        maxLength: 120,
      }),
    actorType,
    actorRole: normalizeString(input.actorRole || input.actorClass, {
      fieldName: "actorRole",
      required: false,
      pattern: SAFE_ID_PATTERN,
      maxLength: 80,
    }),
    budgetScope,
    ownerDomain,
    providerFamily,
    modelId: normalizeString(input.modelId, {
      fieldName: "modelId",
      required: false,
      maxLength: 160,
    }),
    modelResolverKey: normalizeString(input.modelResolverKey, {
      fieldName: "modelResolverKey",
      required: false,
      pattern: OPERATION_ID_PATTERN,
      maxLength: 120,
    }),
    providerCost,
    estimatedCostUnits: normalizeNonNegativeInteger(
      input.estimatedCostUnits ?? input.costUnits ?? input.estimatedUnits,
      { fieldName: "estimatedCostUnits" }
    ),
    estimatedCredits: normalizeNonNegativeInteger(
      input.estimatedCredits ?? input.credits,
      { fieldName: "estimatedCredits" }
    ),
    idempotencyPolicy,
    killSwitchPolicy,
    killSwitchExemptionReason,
    unmeteredJustification: normalizeNotes(input.unmeteredJustification, { maxLength: 500 }),
    budgetLimitPolicy: input.budgetLimitPolicy && typeof input.budgetLimitPolicy === "object"
      ? Object.freeze({ ...input.budgetLimitPolicy })
      : null,
    routeId: normalizeString(input.routeId, {
      fieldName: "routeId",
      required: false,
      pattern: OPERATION_ID_PATTERN,
      maxLength: 120,
    }),
    routePath: input.routePath == null || input.routePath === "" ? null : String(input.routePath).slice(0, 256),
    auditEventPrefix: normalizeString(input.auditEventPrefix || input.observabilityEventPrefix || operationId, {
      fieldName: "auditEventPrefix",
      pattern: OPERATION_ID_PATTERN,
      maxLength: 120,
    }),
    notes: normalizeNotes(input.notes, { maxLength: 500 }),
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

function normalizeSet(values) {
  return new Set((values || []).map((entry) => String(entry || "").trim()).filter(Boolean));
}

function fieldMatches(set, key, path) {
  return set.has(key) || set.has(path);
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
      if (fieldMatches(options.excludeFields, key, childPath)) continue;
      if (SENSITIVE_FIELD_PATTERN.test(key) || SENSITIVE_FIELD_PATTERN.test(childPath)) continue;
      out[key] = await sanitizeFingerprintValue(value[key], options, childPath);
    }
    return out;
  }
  if (typeof value === "string") {
    const key = path.split(".").pop() || path;
    const shouldHash = fieldMatches(options.hashFields, key, path) || PROMPT_FIELD_PATTERN.test(key);
    if (shouldHash || value.length > options.maxStringLength) {
      return {
        sha256: await sha256Hex(value),
        length: value.length,
        hashed: true,
      };
    }
  }
  return value;
}

export async function buildAdminPlatformBudgetFingerprint(input = {}) {
  const operation = normalizeAdminPlatformBudgetOperation(
    input.operation || input.operationConfig || input,
    { allowMissingKillSwitch: true }
  );
  const maxStringLength = normalizeNonNegativeInteger(input.maxStringLength, {
    fieldName: "maxStringLength",
    defaultValue: DEFAULT_MAX_STRING_LENGTH,
    max: 128 * 1024,
  });
  const payload = {
    policyVersion: ADMIN_PLATFORM_BUDGET_POLICY_VERSION,
    operationId: operation.operationId,
    actorType: operation.actorType,
    actorId: input.actorId || null,
    budgetScope: operation.budgetScope,
    budgetScopeId: input.budgetScopeId || null,
    ownerDomain: operation.ownerDomain,
    providerFamily: operation.providerFamily,
    modelId: input.modelId || operation.modelId,
    modelResolverKey: input.modelResolverKey || operation.modelResolverKey,
    routeId: input.routeId || operation.routeId,
    routePath: input.routePath || operation.routePath,
    body: await sanitizeFingerprintValue(input.body || {}, {
      excludeFields: normalizeSet(input.excludeFields),
      hashFields: normalizeSet(input.hashFields),
      maxStringLength,
    }),
  };
  return sha256Hex(stableJson(payload));
}

function safeAuditString(value, maxLength = 160) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text || SENSITIVE_FIELD_PATTERN.test(text)) return null;
  return text.slice(0, maxLength);
}

export function buildAdminPlatformBudgetAuditFields(input = {}) {
  const operation = input.normalizedOperation
    || normalizeAdminPlatformBudgetOperation(input.operation || input.operationConfig || input, {
      allowMissingKillSwitch: true,
    });
  const planStatus = safeAuditString(input.planStatus || input.status, 80);
  return Object.freeze({
    budget_policy_version: ADMIN_PLATFORM_BUDGET_POLICY_VERSION,
    operation_id: operation.operationId,
    actor_user_id: safeAuditString(input.actorUserId || input.actorId, 120),
    actor_class: operation.actorType,
    actor_role: safeAuditString(input.actorRole || operation.actorRole, 80),
    budget_scope: operation.budgetScope,
    owner_domain: operation.ownerDomain,
    provider_family: operation.providerFamily,
    model_id: safeAuditString(input.modelId || operation.modelId, 160),
    model_resolver_key: safeAuditString(input.modelResolverKey || operation.modelResolverKey, 120),
    estimated_cost_units: operation.estimatedCostUnits,
    estimated_credits: operation.estimatedCredits,
    idempotency_policy: operation.idempotencyPolicy,
    kill_switch_flag_name: operation.killSwitchPolicy?.flagName || null,
    plan_status: planStatus,
    reason: safeAuditString(input.reason, 200),
    correlation_id: safeAuditString(input.correlationId, 120),
  });
}

function actionForStatus(status) {
  switch (status) {
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.REQUIRES_KILL_SWITCH:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.REQUIRE_KILL_SWITCH;
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.CALLER_ENFORCED:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.REQUIRE_CALLER_POLICY;
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.EXPLICIT_UNMETERED:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.RECORD_EXPLICIT_UNMETERED_AUDIT;
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.ADMIN_ORG_CREDIT_REQUIRED:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.CHECK_ADMIN_ORG_CREDITS;
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.PLATFORM_BUDGET_REVIEW:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.CHECK_PLATFORM_BUDGET;
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.BLOCKED_BY_POLICY:
    case ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.INVALID_CONFIG:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.BLOCK_PROVIDER_CALL;
    default:
      return ADMIN_PLATFORM_BUDGET_ACTIONS.CHECK_PLATFORM_BUDGET;
  }
}

function classifyNormalizedOperation(operation, { policyBlocked = false } = {}) {
  if (policyBlocked) return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.BLOCKED_BY_POLICY;
  if (operation.providerCost && !operation.killSwitchPolicy && !operation.killSwitchExemptionReason) {
    return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.REQUIRES_KILL_SWITCH;
  }
  if (operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED) {
    return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.CALLER_ENFORCED;
  }
  if (operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.EXTERNAL_PROVIDER_ONLY) {
    return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.CALLER_ENFORCED;
  }
  if (operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN) {
    return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.EXPLICIT_UNMETERED;
  }
  if (operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT) {
    return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.ADMIN_ORG_CREDIT_REQUIRED;
  }
  if (
    operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET
    || operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET
    || operation.budgetScope === ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET
  ) {
    return operation.budgetLimitPolicy
      ? ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.READY_FOR_BUDGET_CHECK
      : ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.PLATFORM_BUDGET_REVIEW;
  }
  return ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.READY_FOR_BUDGET_CHECK;
}

export function classifyAdminPlatformBudgetPlan(input = {}) {
  let operation;
  try {
    operation = normalizeAdminPlatformBudgetOperation(
      input.operation || input.operationConfig || input,
      { allowMissingKillSwitch: true }
    );
  } catch (error) {
    return Object.freeze({
      policyVersion: ADMIN_PLATFORM_BUDGET_POLICY_VERSION,
      ok: false,
      status: ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.INVALID_CONFIG,
      requiredNextAction: ADMIN_PLATFORM_BUDGET_ACTIONS.BLOCK_PROVIDER_CALL,
      error: error instanceof AdminPlatformBudgetPolicyError
        ? { code: error.code, message: error.message }
        : { code: "unexpected_budget_policy_error", message: "Admin/platform budget policy planning failed." },
      warnings: Object.freeze([
        "Invalid budget policy configs must be fixed before any runtime route migration.",
      ]),
    });
  }

  const status = classifyNormalizedOperation(operation, input);
  const auditFields = buildAdminPlatformBudgetAuditFields({
    ...input,
    normalizedOperation: operation,
    planStatus: status,
  });
  const warnings = [];
  if (status === ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.REQUIRES_KILL_SWITCH) {
    warnings.push("A future runtime migration must fail closed before provider calls until a kill switch is configured.");
  }
  if (status === ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.EXPLICIT_UNMETERED) {
    warnings.push("Explicit unmetered admin operations still require audit visibility and operator review.");
  }
  if (status === ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.CALLER_ENFORCED) {
    warnings.push("Internal/provider-only routes must remain service-only and caller-enforced.");
  }
  warnings.push("Phase 4.2 planning is pure and does not call providers, mutate credits, or read live environment values.");

  return Object.freeze({
    policyVersion: ADMIN_PLATFORM_BUDGET_POLICY_VERSION,
    ok: status !== ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.INVALID_CONFIG
      && status !== ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.BLOCKED_BY_POLICY,
    status,
    operationId: operation.operationId,
    budgetScope: operation.budgetScope,
    ownerDomain: operation.ownerDomain,
    actorType: operation.actorType,
    providerFamily: operation.providerFamily,
    idempotencyPolicy: operation.idempotencyPolicy,
    killSwitchPolicy: operation.killSwitchPolicy,
    estimatedCostUnits: operation.estimatedCostUnits,
    estimatedCredits: operation.estimatedCredits,
    requiredNextAction: actionForStatus(status),
    auditFields,
    warnings: Object.freeze(warnings),
  });
}
