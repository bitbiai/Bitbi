export const AI_CALLER_POLICY_VERSION = "ai-caller-policy-v1";
export const AI_CALLER_POLICY_BODY_KEY = "__bitbi_ai_caller_policy";

export const AI_CALLER_POLICY_ENFORCEMENT_STATUSES = Object.freeze({
  GATEWAY_ENFORCED: "gateway_enforced",
  BUDGET_POLICY_ENFORCED: "budget_policy_enforced",
  BUDGET_METADATA_ONLY: "budget_metadata_only",
  CALLER_ENFORCED: "caller_enforced",
  BASELINE_ALLOWED: "baseline_allowed",
  EXPLICIT_UNMETERED: "explicit_unmetered",
});

export const AI_CALLER_POLICY_BUDGET_SCOPES = Object.freeze({
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

export const AI_CALLER_POLICY_CALLER_CLASSES = Object.freeze({
  MEMBER: "member",
  ORGANIZATION: "organization",
  PLATFORM_ADMIN: "platform_admin",
  ADMIN: "admin",
  PLATFORM_BACKGROUND: "platform_background",
  OPENCLAW_AGENT: "openclaw_agent",
  INTERNAL_SYSTEM: "internal_system",
});

export class AiCallerPolicyError extends Error {
  constructor(message, { code = "ai_caller_policy_invalid", status = 400 } = {}) {
    super(message);
    this.name = "AiCallerPolicyError";
    this.code = code;
    this.status = status;
  }
}

const ALLOWED_STATUSES = new Set(Object.values(AI_CALLER_POLICY_ENFORCEMENT_STATUSES));
const ALLOWED_BUDGET_SCOPES = new Set(Object.values(AI_CALLER_POLICY_BUDGET_SCOPES));
const ALLOWED_CALLER_CLASSES = new Set(Object.values(AI_CALLER_POLICY_CALLER_CLASSES));
const IDEMPOTENCY_POLICIES = new Set([
  "required",
  "optional",
  "forbidden",
  "inherited",
  "caller_enforced",
  "not_applicable",
]);

const OPERATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const OWNER_DOMAIN_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,180}$/;
const SAFE_ROUTE_PATTERN = /^\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,220}$/;
const FLAG_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,95}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g;
const SENSITIVE_KEY_PATTERN =
  /(?:^|[_-])(?:authorization|cookie|token|secret|signature|password|api[_-]?key|stripe|session|cf[_-]?token|r2[_-]?key|private[_-]?key)(?:$|[_-])/i;
const PROMPT_KEY_PATTERN =
  /(?:raw[_-]?prompt|prompt|lyrics|messages?|provider[_-]?request|raw[_-]?body|input[_-]?text|system[_-]?prompt|negative[_-]?prompt)/i;
const SECRET_VALUE_PATTERN =
  /(?:sk_(?:live|test)_|whsec_|Bearer\s+[A-Za-z0-9._:-]+|bitbi_session=|__Host-bitbi_session|X-Amz-Signature=|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----)/i;

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiCallerPolicyError(`${fieldName} must be an object.`);
  }
}

function cleanString(value) {
  return String(value ?? "").replace(CONTROL_CHAR_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function unsafeValue(value) {
  return typeof value === "string" && SECRET_VALUE_PATTERN.test(value);
}

function assertNoUnsafeFields(value, path = "callerPolicy", depth = 0) {
  if (value == null) return;
  if (depth > 6) {
    throw new AiCallerPolicyError(`${path} is too deeply nested.`);
  }
  if (unsafeValue(value)) {
    throw new AiCallerPolicyError(`${path} contains unsafe values.`);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertNoUnsafeFields(value[index], `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || PROMPT_KEY_PATTERN.test(key)) {
      throw new AiCallerPolicyError(`${path}.${key} is not allowed.`);
    }
    assertNoUnsafeFields(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeString(value, {
  fieldName,
  required = true,
  maxLength = 180,
  pattern = null,
} = {}) {
  if (value == null || value === "") {
    if (!required) return null;
    throw new AiCallerPolicyError(`${fieldName} is required.`);
  }
  const text = cleanString(value);
  if (!text || text.length > maxLength || (pattern && !pattern.test(text)) || unsafeValue(text)) {
    throw new AiCallerPolicyError(`${fieldName} is invalid.`);
  }
  return text;
}

function normalizeEnum(value, { fieldName, allowed, required = true } = {}) {
  if (value == null || value === "") {
    if (!required) return null;
    throw new AiCallerPolicyError(`${fieldName} is required.`);
  }
  const text = cleanString(value);
  if (!allowed.has(text)) {
    throw new AiCallerPolicyError(`${fieldName} is invalid.`);
  }
  return text;
}

function optionalNote(value, { fieldName, maxLength = 300 } = {}) {
  if (value == null || value === "") return null;
  const text = cleanString(value);
  if (!text) return null;
  if (unsafeValue(text)) {
    throw new AiCallerPolicyError(`${fieldName} is unsafe.`);
  }
  return text.slice(0, maxLength);
}

function alias(input, snakeKey, camelKey) {
  if (Object.prototype.hasOwnProperty.call(input, snakeKey)) return input[snakeKey];
  return input[camelKey];
}

export function sanitizeAiCallerPolicy(input = {}) {
  assertPlainObject(input, "callerPolicy");
  assertNoUnsafeFields(input);

  const version = normalizeString(alias(input, "policy_version", "policyVersion") || input.version, {
    fieldName: "policy_version",
    maxLength: 64,
  });
  if (version !== AI_CALLER_POLICY_VERSION) {
    throw new AiCallerPolicyError("policy_version is unsupported.");
  }

  return Object.freeze({
    policy_version: version,
    operation_id: normalizeString(alias(input, "operation_id", "operationId"), {
      fieldName: "operation_id",
      maxLength: 120,
      pattern: OPERATION_ID_PATTERN,
    }),
    budget_scope: normalizeEnum(alias(input, "budget_scope", "budgetScope"), {
      fieldName: "budget_scope",
      allowed: ALLOWED_BUDGET_SCOPES,
    }),
    enforcement_status: normalizeEnum(alias(input, "enforcement_status", "enforcementStatus"), {
      fieldName: "enforcement_status",
      allowed: ALLOWED_STATUSES,
    }),
    caller_class: normalizeEnum(alias(input, "caller_class", "callerClass"), {
      fieldName: "caller_class",
      allowed: ALLOWED_CALLER_CLASSES,
    }),
    owner_domain: normalizeString(alias(input, "owner_domain", "ownerDomain"), {
      fieldName: "owner_domain",
      maxLength: 120,
      pattern: OWNER_DOMAIN_PATTERN,
    }),
    provider_family: normalizeString(alias(input, "provider_family", "providerFamily"), {
      fieldName: "provider_family",
      required: false,
      maxLength: 120,
      pattern: SAFE_ID_PATTERN,
    }),
    model_id: normalizeString(alias(input, "model_id", "modelId"), {
      fieldName: "model_id",
      required: false,
      maxLength: 180,
      pattern: SAFE_ID_PATTERN,
    }),
    model_resolver_key: normalizeString(alias(input, "model_resolver_key", "modelResolverKey"), {
      fieldName: "model_resolver_key",
      required: false,
      maxLength: 140,
      pattern: OPERATION_ID_PATTERN,
    }),
    idempotency_policy: normalizeEnum(alias(input, "idempotency_policy", "idempotencyPolicy"), {
      fieldName: "idempotency_policy",
      allowed: IDEMPOTENCY_POLICIES,
      required: false,
    }),
    source_route: normalizeString(alias(input, "source_route", "sourceRoute"), {
      fieldName: "source_route",
      required: false,
      maxLength: 220,
      pattern: SAFE_ROUTE_PATTERN,
    }),
    source_component: normalizeString(alias(input, "source_component", "sourceComponent"), {
      fieldName: "source_component",
      required: false,
      maxLength: 140,
      pattern: SAFE_ID_PATTERN,
    }),
    budget_fingerprint: normalizeString(alias(input, "budget_fingerprint", "budgetFingerprint"), {
      fieldName: "budget_fingerprint",
      required: false,
      maxLength: 180,
      pattern: FINGERPRINT_PATTERN,
    }),
    request_fingerprint: normalizeString(alias(input, "request_fingerprint", "requestFingerprint"), {
      fieldName: "request_fingerprint",
      required: false,
      maxLength: 180,
      pattern: FINGERPRINT_PATTERN,
    }),
    kill_switch_target: normalizeString(alias(input, "kill_switch_target", "killSwitchTarget"), {
      fieldName: "kill_switch_target",
      required: false,
      maxLength: 96,
      pattern: FLAG_NAME_PATTERN,
    }),
    correlation_id: normalizeString(alias(input, "correlation_id", "correlationId"), {
      fieldName: "correlation_id",
      required: false,
      maxLength: 160,
      pattern: SAFE_ID_PATTERN,
    }),
    reason: optionalNote(alias(input, "reason", "reason"), { fieldName: "reason", maxLength: 300 }),
    notes: optionalNote(alias(input, "notes", "notes"), { fieldName: "notes", maxLength: 300 }),
  });
}

export function validateAiCallerPolicy(input, {
  required = false,
  allowedOperationIds = null,
  allowedStatuses = null,
} = {}) {
  if (input == null) {
    if (!required) return null;
    throw new AiCallerPolicyError("caller policy is required.", {
      code: "ai_caller_policy_required",
      status: 428,
    });
  }
  const policy = sanitizeAiCallerPolicy(input);
  const operationSet = Array.isArray(allowedOperationIds) && allowedOperationIds.length
    ? new Set(allowedOperationIds)
    : null;
  if (operationSet && !operationSet.has(policy.operation_id)) {
    throw new AiCallerPolicyError("operation_id is not allowed for this route.");
  }
  const statusSet = Array.isArray(allowedStatuses) && allowedStatuses.length
    ? new Set(allowedStatuses)
    : null;
  if (statusSet && !statusSet.has(policy.enforcement_status)) {
    throw new AiCallerPolicyError("enforcement_status is not allowed for this route.");
  }
  return policy;
}

export function buildAiCallerPolicyAuditSummary(input) {
  const policy = sanitizeAiCallerPolicy(input);
  return Object.freeze({
    policy_version: policy.policy_version,
    operation_id: policy.operation_id,
    budget_scope: policy.budget_scope,
    enforcement_status: policy.enforcement_status,
    caller_class: policy.caller_class,
    owner_domain: policy.owner_domain,
    provider_family: policy.provider_family,
    model_id: policy.model_id,
    model_resolver_key: policy.model_resolver_key,
    idempotency_policy: policy.idempotency_policy,
    source_route: policy.source_route,
    source_component: policy.source_component,
    budget_fingerprint: policy.budget_fingerprint,
    request_fingerprint: policy.request_fingerprint,
    kill_switch_target: policy.kill_switch_target,
    correlation_id: policy.correlation_id,
    reason: policy.reason,
    notes: policy.notes,
  });
}

export function stripAiCallerPolicyFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { body, callerPolicy: null };
  }
  if (!Object.prototype.hasOwnProperty.call(body, AI_CALLER_POLICY_BODY_KEY)) {
    return { body, callerPolicy: null };
  }
  const { [AI_CALLER_POLICY_BODY_KEY]: callerPolicy, ...stripped } = body;
  return { body: stripped, callerPolicy };
}

export function withAiCallerPolicy(body, callerPolicy) {
  if (!callerPolicy) return body;
  assertPlainObject(body, "body");
  return {
    ...body,
    [AI_CALLER_POLICY_BODY_KEY]: sanitizeAiCallerPolicy(callerPolicy),
  };
}
