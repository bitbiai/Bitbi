import baselineConfig from "../../../../config/ai-cost-policy-baseline.json" with { type: "json" };
import { ROUTE_POLICIES } from "../app/route-policy.js";
import {
  AI_COST_BUDGET_SCOPES,
  AI_COST_OPERATION_REGISTRY,
} from "./ai-cost-operations.js";
import {
  ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS,
  listAdminImageTestBranchClassifications,
} from "./admin-ai-image-credit-pricing.js";
import {
  getBudgetSwitchState,
  listAdminPlatformBudgetSwitchDefinitions,
} from "./admin-platform-budget-switches.js";
import { AI_CALLER_POLICY_BODY_KEY } from "../../../shared/ai-caller-policy.mjs";

export const ADMIN_PLATFORM_BUDGET_EVIDENCE_VERSION = "admin-platform-budget-evidence-v1";
export const ADMIN_PLATFORM_BUDGET_EVIDENCE_SOURCE = "local_registry_baseline_route_policy_read_only";
export const ADMIN_PLATFORM_BUDGET_EVIDENCE_ENDPOINT = "/api/admin/ai/budget-evidence";

export const ADMIN_PLATFORM_BUDGET_EVIDENCE_SCOPES = Object.freeze([
  AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
  AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
  AI_COST_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET,
  AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
  AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
  AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
  AI_COST_BUDGET_SCOPES.EXTERNAL_PROVIDER_ONLY,
]);

const MEMBER_GATEWAY_OPERATION_IDS = Object.freeze([
  "member.image.generate",
  "member.music.generate",
  "member.video.generate",
]);
const HARDENED_ADMIN_OPERATION_ID = "admin.image.test.charged";
const UNMETERED_ADMIN_IMAGE_OPERATION_ID = "admin.image.test.unmetered";
const ADMIN_TEXT_EMBEDDINGS_OPERATION_IDS = Object.freeze([
  "admin.text.test",
  "admin.embeddings.test",
]);
const ADMIN_LAB_DURABLE_OPERATION_IDS = Object.freeze([
  ...ADMIN_TEXT_EMBEDDINGS_OPERATION_IDS,
  "admin.music.test",
  "admin.compare",
  "admin.live_agent",
]);
const SYNC_VIDEO_DEBUG_OPERATION_ID = "admin.video.sync_debug";
const ADMIN_VIDEO_JOB_OPERATION_ID = "admin.video.job.create";
const NEWS_PULSE_VISUAL_OPERATION_IDS = Object.freeze([
  "platform.news_pulse.visual.ingest",
  "platform.news_pulse.visual.scheduled",
]);
const INTERNAL_CALLER_POLICY_GUARD_OPERATION_IDS = Object.freeze([
  "admin.video.task.create",
  "admin.video.task.poll",
  "internal.video_task.create",
  "internal.video_task.poll",
]);
const RUNTIME_BUDGET_SWITCH_TARGETS = Object.freeze(
  listAdminPlatformBudgetSwitchDefinitions().map((definition) => Object.freeze({
    flagName: definition.flagName,
    switchKey: definition.switchKey,
    routePath: definition.relatedRoutes
      .map((route) => String(route || "").replace(/^(GET|POST|PATCH|DELETE|PUT)\s+/i, ""))
      .join(" and "),
    operationIds: definition.operationIds,
    domain: definition.label,
    budgetScope: definition.budgetScope,
    liveCapStatus: definition.liveCapStatus,
    liveCapFuturePhase: definition.liveCapFuturePhase,
  }))
);

const LIVE_PLATFORM_BUDGET_CAP_SCOPE_DESIGN = Object.freeze({
  [AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET]: Object.freeze({
    capRequired: true,
    owner: "platform admin lab",
    capGranularityTarget: ["daily", "monthly", "operation", "admin_user", "provider_model"],
    countability: "countable_now",
    currentDataSources: ["admin_ai_usage_attempts", "ai_video_jobs", "platform_budget_limits", "platform_budget_usage_events"],
    existingDataSufficient: true,
    migrationLikelyRequired: false,
    defaultCapPosture: "fail_closed_when_missing_limit",
    futurePhase: "Phase 4.17 implemented foundation",
  }),
  [AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET]: Object.freeze({
    capRequired: true,
    owner: "OpenClaw / News Pulse platform budget",
    capGranularityTarget: ["daily", "monthly", "source_domain", "provider_model"],
    countability: "partially_countable",
    currentDataSources: ["news_pulse_items"],
    existingDataSufficient: false,
    migrationLikelyRequired: true,
    defaultCapPosture: "not_implemented_warn_only_target",
    futurePhase: "Phase 4.18",
  }),
  [AI_COST_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET]: Object.freeze({
    capRequired: true,
    owner: "platform background jobs",
    capGranularityTarget: ["daily", "monthly", "operation", "source_domain"],
    countability: "requires_schema",
    currentDataSources: [],
    existingDataSufficient: false,
    migrationLikelyRequired: true,
    defaultCapPosture: "not_implemented",
    futurePhase: "future platform/background cap migration",
  }),
  [AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT]: Object.freeze({
    capRequired: "secondary",
    owner: "selected organization credit account plus platform operator review",
    capGranularityTarget: ["daily", "monthly", "organization", "admin_user", "provider_model"],
    countability: "countable_now",
    currentDataSources: ["usage_events", "ai_usage_attempts"],
    existingDataSufficient: true,
    migrationLikelyRequired: false,
    defaultCapPosture: "operator_review",
    futurePhase: "Phase 4.17 evidence alignment",
  }),
  [AI_COST_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN]: Object.freeze({
    capRequired: true,
    owner: "platform admin lab explicit exception owner",
    capGranularityTarget: ["daily", "monthly", "operation", "admin_user", "provider_model"],
    countability: "metadata_only",
    currentDataSources: ["budget_policy_metadata", "caller_policy_metadata"],
    existingDataSufficient: false,
    migrationLikelyRequired: true,
    defaultCapPosture: "keep_switch_disabled_until_operator_review",
    futurePhase: "Phase 4.17 explicit-unmetered cap decision",
  }),
  [AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED]: Object.freeze({
    capRequired: "inherited_from_caller",
    owner: "calling route budget scope",
    capGranularityTarget: ["caller_budget_scope", "operation", "provider_model"],
    countability: "requires_schema",
    currentDataSources: ["caller_policy_metadata"],
    existingDataSufficient: false,
    migrationLikelyRequired: true,
    defaultCapPosture: "caller_enforced_only",
    futurePhase: "future internal caller hardening after cap ledger",
  }),
});

const DEFAULT_LIMITS = Object.freeze({
  maxBudgetScopeOperationIds: 40,
  maxImplementedOperations: 20,
  maxBaselinedGaps: 80,
  maxEvidenceItems: 120,
  maxStringLength: 500,
});

const SEVERITY_RANK = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});

const SENSITIVE_KEY_PATTERN =
  /(?:^|[_-])(?:authorization|cookie|token|secret|signature|password|api[_-]?key|stripe|session|cf[_-]?token|r2[_-]?key|private[_-]?key)(?:$|[_-])/i;
const PROMPT_KEY_PATTERN =
  /(?:raw[_-]?prompt|prompt|lyrics|messages?|provider[_-]?request|raw[_-]?body|input[_-]?text|system[_-]?prompt)/i;
const SECRET_VALUE_PATTERN =
  /(?:raw\s+prompt|provider\s+request\s+body|session\s+cookie|secret\s+token|private\s+key|sk_(?:live|test)_|whsec_|Bearer\s+[A-Za-z0-9._:-]+|__Host-bitbi_session|bitbi_session=|X-Amz-Signature=|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----)/i;

function normalizeLimits(input = {}) {
  const merged = { ...DEFAULT_LIMITS, ...(input || {}) };
  const out = {};
  for (const [key, value] of Object.entries(DEFAULT_LIMITS)) {
    const number = Number(merged[key]);
    out[key] = Number.isInteger(number) && number > 0 ? Math.min(number, 1_000) : value;
  }
  return Object.freeze(out);
}

function truncateString(value, maxLength) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 14))}...[truncated]`;
}

function sanitizeValue(value, { key = "", limits }) {
  if (value == null) return value;
  if (SENSITIVE_KEY_PATTERN.test(key) || PROMPT_KEY_PATTERN.test(key)) {
    if (typeof value === "number" || typeof value === "boolean") return value;
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) return "[redacted]";
    return truncateString(value, limits.maxStringLength);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, { key, limits }));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, { key: entryKey, limits }),
      ])
    );
  }
  return null;
}

function sortedUnique(values = []) {
  return [...new Set((values || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .sort();
}

function asList(value) {
  if (Array.isArray(value)) return sortedUnique(value);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function limitList(values, maxItems, warnings, label) {
  const list = Array.isArray(values) ? values : [];
  if (list.length <= maxItems) return list;
  warnings.push(`${label} truncated to ${maxItems} of ${list.length} items.`);
  return list.slice(0, maxItems);
}

function routePolicyIndex(routePolicies = []) {
  const byId = new Map();
  const byPath = new Map();
  for (const route of routePolicies || []) {
    if (route?.id) byId.set(route.id, route);
    if (route?.path) byPath.set(route.path, route);
  }
  return { byId, byPath };
}

function operationId(entry) {
  return String(entry?.operationConfig?.operationId || "").trim();
}

function operationBudgetPolicy(entry) {
  return entry?.budgetPolicy || null;
}

function operationBudgetScopes(entry) {
  const policy = operationBudgetPolicy(entry);
  return sortedUnique([
    policy?.targetBudgetScope,
    policy?.currentBudgetScope,
  ].filter((scope) => ADMIN_PLATFORM_BUDGET_EVIDENCE_SCOPES.includes(scope)));
}

function operationLiveBudgetCapEvidence(entry) {
  const policy = operationBudgetPolicy(entry);
  if (!policy) return null;
  return {
    status: policy.liveBudgetCapStatus || "not_implemented",
    readiness: policy.liveBudgetCapReadiness || "requires_schema",
    scope: policy.liveBudgetCapScope || policy.targetBudgetScope || null,
    futurePhase: policy.liveBudgetCapFuturePhase || "Phase 4.17 live platform budget cap foundation",
    dataSources: asList(policy.liveBudgetCapEvidence?.dataSources),
    durableCompletionTimestamp: policy.liveBudgetCapEvidence?.durableCompletionTimestamp === true,
    estimatedCostUnitsAvailable: policy.liveBudgetCapEvidence?.estimatedCostUnitsAvailable === true,
    requiresCentralUsageLedger: policy.liveBudgetCapEvidence?.requiresCentralUsageLedger !== false,
  };
}

function operationRuntimeStatus(entry) {
  const policy = operationBudgetPolicy(entry);
  if (
    operationId(entry) === HARDENED_ADMIN_OPERATION_ID &&
    entry?.currentStatus === "implemented" &&
    policy?.targetEnforcementStatus === "implemented"
  ) {
    return "implemented";
  }
  if (policy?.targetEnforcementStatus === "delegated") return "caller_enforced_baseline_gap";
  if (entry?.currentStatus === "missing" || policy?.targetEnforcementStatus === "missing") return "missing";
  if (entry?.currentStatus === "partial" || policy?.targetEnforcementStatus === "partial") return "partial";
  if (entry?.currentStatus === "not_applicable") return "not_applicable";
  return String(entry?.currentStatus || policy?.targetEnforcementStatus || "unknown");
}

function rollupRuntimeStatus(statuses = []) {
  const set = new Set(statuses.filter(Boolean));
  if (set.size === 0) return "not_applicable";
  if (set.size === 1 && set.has("implemented")) return "implemented";
  if (set.has("missing")) return "missing";
  if (set.has("partial")) return "partial";
  if (set.has("caller_enforced_baseline_gap")) return "caller_enforced_baseline_gap";
  if (set.has("implemented")) return "partial";
  return [...set].sort().join(",");
}

function severityRollup(items = []) {
  const severities = sortedUnique(items.map((item) => item?.severity || item?.gapSeverity));
  if (severities.length === 0) return "none";
  return severities.sort((left, right) =>
    (SEVERITY_RANK[left] ?? 99) - (SEVERITY_RANK[right] ?? 99)
  )[0];
}

function routePolicyEvidenceForOperation(entry, index) {
  const routePolicy = entry?.routePolicy || null;
  const policy = routePolicy?.id
    ? index.byId.get(routePolicy.id)
    : index.byPath.get(entry?.operationConfig?.routePath);
  return {
    routePolicyId: routePolicy?.id || policy?.id || null,
    routePath: routePolicy?.path || entry?.operationConfig?.routePath || null,
    registered: Boolean(policy),
    expectedIdempotency: routePolicy?.expectedIdempotency || null,
    mfa: policy?.mfa || null,
    rateLimitFailClosed: policy?.rateLimit?.failClosed === true,
  };
}

function basicOperationEvidence(entry, routeIndex) {
  const config = entry?.operationConfig || {};
  const policy = operationBudgetPolicy(entry);
  const liveBudgetCap = operationLiveBudgetCapEvidence(entry);
  return {
    operationId: config.operationId,
    routeId: config.routeId || null,
    routePath: config.routePath || null,
    actorType: config.actorType || null,
    providerFamily: config.providerFamily || null,
    modelResolverKey: config.modelResolverKey || null,
    providerCost: config.providerCost !== false,
    budgetScope: policy?.targetBudgetScope || null,
    currentBudgetScope: policy?.currentBudgetScope || null,
    currentStatus: entry?.currentStatus || null,
    runtimeEnforcementStatus: operationRuntimeStatus(entry),
    idempotencyPolicy: config.idempotencyPolicy || null,
    reservationPolicy: config.reservationPolicy || null,
    replayPolicy: config.replayPolicy || null,
    currentEnforcement: {
      idempotency: entry?.currentEnforcement?.idempotency || null,
      reservation: entry?.currentEnforcement?.reservation || null,
      replay: entry?.currentEnforcement?.replay || null,
      creditCheck: entry?.currentEnforcement?.creditCheck || null,
      providerSuppression: entry?.currentEnforcement?.providerSuppression || null,
    },
    routePolicy: routePolicyEvidenceForOperation(entry, routeIndex),
    liveBudgetCap,
  };
}

function implementedAdminImageEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  return {
    ...base,
    type: "implemented_admin_budget_operation",
    runtimeStatus: "implemented_hardened",
    idempotencyTarget: "required selected-organization scoped idempotency key",
    killSwitchTarget: "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET / ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET",
    modelClass: "priced Admin image tests (BFL FLUX and GPT Image 2)",
    metadataFieldsExpected: [
      "budget_policy_version",
      "operation_id",
      "budget_scope",
      "owner_domain",
      "provider_family",
      "model_id",
      "estimated_cost_units",
      "estimated_credits",
      "idempotency_policy",
      "plan_status",
      "required_next_action",
      "kill_switch_flag_name",
      "kill_switch_default_state",
      "kill_switch_required_for_provider_call",
      "fingerprint",
      "audit_fields",
    ],
    remainingLimitations: [
      "Phase 4.15 enforces the charged Admin Image runtime budget switch before provider calls and credit debits; live platform budget caps remain future work.",
      "Generated image result is not replayed for completed same-key admin image tests.",
      "FLUX.2 Dev remains a separate explicit_unmetered_admin exception rather than a charged provider-cost path.",
    ],
  };
}

function adminImageBranchClassificationEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  const branches = listAdminImageTestBranchClassifications();
  const charged = branches.filter((branch) =>
    branch.budgetClassification === ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.CHARGED_ADMIN_ORG_CREDIT
  );
  const explicitUnmetered = branches.filter((branch) =>
    branch.budgetClassification === ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.EXPLICIT_UNMETERED_ADMIN
  );
  return {
    ...base,
    type: "admin_image_branch_classification",
    runtimeStatus: "explicit_unmetered_admin_metadata",
    chargedAdminOrgCredit: charged.map((branch) => ({
      modelId: branch.modelId,
      providerFamily: branch.providerFamily,
      budgetScope: branch.budgetScope,
      killSwitchTarget: branch.killSwitchTarget,
      idempotencyPolicy: branch.idempotencyPolicy,
      callerPolicyStatus: branch.callerPolicyStatus,
    })),
    explicitUnmeteredAdmin: explicitUnmetered.map((branch) => ({
      modelId: branch.modelId,
      providerFamily: branch.providerFamily,
      budgetScope: branch.budgetScope,
      killSwitchTarget: branch.killSwitchTarget,
      idempotencyPolicy: branch.idempotencyPolicy,
      callerPolicyStatus: branch.callerPolicyStatus,
      justification: branch.unmeteredJustification,
      providerCostBearing: branch.providerCostBearing,
    })),
    blockedUnsupported: [{
      modelId: "unknown_or_unclassified_admin_image_model",
      budgetClassification: ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.BLOCKED_UNSUPPORTED,
      behavior: "blocked before AI_LAB/provider execution by model allowlist plus Phase 4.14 branch-classification guard",
      providerCalls: false,
      creditDebit: false,
    }],
    counts: {
      chargedAdminOrgCredit: charged.length,
      explicitUnmeteredAdmin: explicitUnmetered.length,
      blockedUnsupportedGuard: 1,
    },
    remainingLimitations: [
      "Explicit unmetered FLUX.2 Dev remains an admin lab exception with metadata only, no durable idempotency, no credit debit, and no live platform budget cap.",
      "Phase 4.15 enforces ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS before provider execution.",
    ],
  };
}

function implementedAdminVideoJobEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  return {
    ...base,
    type: "implemented_admin_budget_operation",
    runtimeStatus: "implemented_job_budget_metadata",
    idempotencyTarget: "required admin job Idempotency-Key with same-request replay and different-request conflict",
    killSwitchTarget: "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET",
    modelClass: "admin async video jobs",
    metadataFieldsExpected: [
      "budget_policy_version",
      "operation_id",
      "budget_scope",
      "owner_domain",
      "provider_family",
      "model_id",
      "model_resolver_key",
      "estimated_cost_units",
      "estimated_credits",
      "idempotency_policy",
      "plan_status",
      "required_next_action",
      "kill_switch_flag_name",
      "kill_switch_default_state",
      "kill_switch_required_for_provider_call",
      "runtime_budget_limit_enforced",
      "credit_debit",
      "reservation",
      "provider_task_create",
      "fingerprint",
      "audit_fields",
    ],
    remainingLimitations: [
      "Phase 4.15 enforces ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET before job creation/queueing.",
      "No live platform budget cap or credit debit is performed.",
      "Internal AI Worker routes are not globally migrated; admin video task create/poll are caller-enforced through the auth job budget state.",
    ],
  };
}

function implementedAdminLabDurableEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  const operation = operationId(entry);
  const isEmbeddings = operation === "admin.embeddings.test";
  const isMusic = operation === "admin.music.test";
  const isCompare = operation === "admin.compare";
  const isLiveAgent = operation === "admin.live_agent";
  return {
    ...base,
    type: "partial_admin_budget_operation",
    runtimeStatus: isLiveAgent
      ? "budget_metadata_with_stream_session_idempotency"
      : "budget_metadata_with_durable_idempotency",
    idempotencyTarget: "required Idempotency-Key; admin_ai_usage_attempts stores only a safe key hash and request fingerprint",
    killSwitchTarget: isCompare
      ? "ENABLE_ADMIN_AI_COMPARE_BUDGET"
      : isMusic
      ? "ENABLE_ADMIN_AI_MUSIC_BUDGET"
      : isLiveAgent
      ? "ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET"
      : isEmbeddings
        ? "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET"
        : "ENABLE_ADMIN_AI_TEXT_BUDGET",
    modelClass: isCompare
      ? "admin compare multi-model text fanout"
      : isMusic
        ? "admin music tests"
        : isLiveAgent
          ? "admin streaming live-agent"
        : isEmbeddings
          ? "admin embeddings tests"
          : "admin text tests",
    callerPolicyTransport: "reserved_signed_json_body_key",
    reservedBodyKey: AI_CALLER_POLICY_BODY_KEY,
    metadataFieldsExpected: [
      "budget_policy_version",
      "operation_id",
      "budget_scope",
      "owner_domain",
      "provider_family",
      "model_id",
      "model_resolver_key",
      "estimated_cost_units",
      "estimated_credits",
      "idempotency_policy",
      "idempotency_key_hash",
      "idempotency_attempt_id",
      "idempotency_attempt_status",
      "duplicate_suppression",
      "durable_idempotency",
      "replay_policy",
      "runtime_enforcement_status",
      "plan_status",
      "kill_switch_flag_name",
      isLiveAgent ? "stream_session_caps" : null,
      isLiveAgent ? "stream_finalization" : null,
      "fingerprint",
      "audit_fields",
      "caller_policy",
    ].filter(Boolean),
    remainingLimitations: [
      isMusic
        ? "Phase 4.15 enforces ENABLE_ADMIN_AI_MUSIC_BUDGET before durable attempts or provider calls."
        : isCompare
          ? "Phase 4.15 enforces ENABLE_ADMIN_AI_COMPARE_BUDGET before durable attempts or provider calls."
          : isLiveAgent
            ? "Phase 4.15 enforces ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET before durable attempts or provider streams."
          : `Phase 4.15 enforces ${isEmbeddings ? "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET" : "ENABLE_ADMIN_AI_TEXT_BUDGET"} before durable attempts or provider calls.`,
      isLiveAgent
        ? "Full stream replay is intentionally unavailable; duplicate completed requests return metadata-only replay without streamed output, raw messages, provider request bodies, or provider response bodies."
        : "Full result replay is intentionally unavailable; duplicate completed requests return metadata-only replay without generated text, embedding vectors, audio, lyrics, compare results, or provider response bodies.",
      "Phase 4.8.2 adds API-first admin-only inspection plus bounded non-destructive cleanup for stuck admin lab usage attempts.",
      isLiveAgent
        ? "The AI Worker internal live-agent route now requires signed caller-policy metadata for this covered caller; unrelated internal routes remain baseline-compatible until targeted migrations."
        : "The AI Worker internal text/embeddings/music/compare routes still allow baseline-missing caller policy for other known callers to preserve org/member and baseline compatibility.",
      isLiveAgent
        ? "Explicit provider output-token and stream-duration caps remain future work because the current streaming Workers AI route exposes no safe route-local token usage or timeout finalization contract."
        : null,
      "No live platform budget cap, Stripe call, or credit debit is performed.",
    ].filter(Boolean),
  };
}

function implementedNewsPulseVisualEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  const operation = operationId(entry);
  return {
    ...base,
    type: "implemented_platform_budget_operation",
    runtimeStatus: "implemented_visual_budget_metadata",
    budgetScope: AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
    idempotencyTarget: "deterministic OpenClaw item id/content hash with visual status and attempt guards",
    killSwitchTarget: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
    modelClass: "Workers AI Flux News Pulse generated thumbnail",
    metadataFieldsExpected: [
      "visual_budget_policy_json",
      "visual_budget_policy_status",
      "visual_budget_policy_fingerprint",
      "visual_budget_policy_version",
      "budget_policy_version",
      "operation_id",
      "budget_scope",
      "owner_domain",
      "provider_family",
      "model_id",
      "idempotency_policy",
      "plan_status",
      "kill_switch_flag_name",
      "fingerprint",
      "runtime",
    ],
    duplicateProviderSuppression: [
      "ready visual rows are skipped",
      "pending visual rows are skipped",
      "failed rows are retried only below the bounded attempt limit",
      "same deterministic item/content hash preserves ready visuals on duplicate ingest",
    ],
    remainingLimitations: [
      "Phase 4.15 enforces ENABLE_NEWS_PULSE_VISUAL_BUDGET before News Pulse visual provider calls.",
      "Live daily/monthly platform budget caps remain future work.",
      operation === "platform.news_pulse.visual.ingest"
        ? "Signed OpenClaw ingest remains separate from public read routes."
        : "Scheduled visual backfill remains bounded by batch size and row attempts.",
    ],
  };
}

function retiredSyncVideoDebugEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  return {
    ...base,
    type: "retired_debug_provider_path",
    runtimeStatus: "retired_disabled_by_default",
    budgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    idempotencyTarget: "not required while disabled; future emergency retention would require Idempotency-Key plus durable budget controls",
    killSwitchTarget: "ALLOW_SYNC_VIDEO_DEBUG",
    modelClass: "synchronous admin video debug",
    supportedReplacement: "/api/admin/ai/video-jobs",
    normalProviderCostPath: false,
    disabledBehavior: [
      "returns before request body parsing",
      "does not call AI_LAB or the AI Worker",
      "does not enqueue provider work",
      "does not call providers",
      "does not mutate credits or billing",
    ],
    emergencyCompatibility: [
      "ALLOW_SYNC_VIDEO_DEBUG=true is still retained only for controlled legacy/debug compatibility",
      "the emergency path is not treated as supported budgeted admin video generation",
      "admin async video jobs are the supported Phase 4.5 budgeted path",
    ],
    remainingLimitations: [
      "Emergency compatibility execution remains a direct provider-cost path if explicitly enabled and should stay disabled outside controlled debugging.",
      "If retained long-term, a future phase must add required idempotency, durable metadata, explicit budget policy, and kill-switch enforcement before normal use.",
    ],
  };
}

function implementedInternalCallerPolicyGuardEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  const operation = operationId(entry);
  const isPoll = operation.endsWith(".poll");
  return {
    ...base,
    type: "implemented_internal_ai_caller_policy_guard",
    runtimeStatus: "implemented_caller_policy_guard",
    budgetScope: AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
    callerPolicyTransport: "reserved_signed_json_body_key",
    reservedBodyKey: AI_CALLER_POLICY_BODY_KEY,
    requiredForInternalRoutes: [
      "/internal/ai/video-task/create",
      "/internal/ai/video-task/poll",
      "/internal/ai/live-agent",
    ],
    coveredCallerPaths: [
      "admin async video job queue task create/poll",
      "admin text test",
      "admin embeddings test",
      "admin music test",
      "admin compare",
      "admin live-agent",
    ],
    baselineAllowedInternalRoutes: [
      "/internal/ai/test-text",
      "/internal/ai/test-image",
      "/internal/ai/test-embeddings",
      "/internal/ai/test-music",
      "/internal/ai/test-video",
      "/internal/ai/compare",
    ],
    metadataFieldsExpected: [
      "policy_version",
      "operation_id",
      "budget_scope",
      "enforcement_status",
      "caller_class",
      "owner_domain",
      "provider_family",
      "model_id",
      "model_resolver_key",
      "idempotency_policy",
      "source_route",
      "source_component",
      "budget_fingerprint",
      "kill_switch_target",
      "correlation_id",
      "reason",
    ],
    remainingLimitations: [
      "Phase 4.7 validates caller-policy metadata shape and requires it for async video task create/poll; Phase 4.8.1 supplies admin text/embeddings caller metadata plus durable caller-side idempotency, Phase 4.9 extends that pattern to admin music, Phase 4.10 extends it to admin compare, and Phase 4.12 requires it for Admin Live-Agent.",
      "Phase 4.13 retires the Auth Worker sync video debug caller as disabled-by-default; Phase 4.14 classifies Admin Image branches as charged, explicit-unmetered, or blocked. Broader internal routes remain baseline-allowed until targeted caller migrations.",
      isPoll
        ? "Provider polling remains bounded by the caller/job state and does not create a new provider task."
        : "Duplicate provider task creation is still suppressed by the auth job budget state and queue lease.",
    ],
  };
}

function memberGatewayEvidence(entry, routeIndex) {
  return {
    ...basicOperationEvidence(entry, routeIndex),
    type: "member_gateway_migrated",
    budgetScope: AI_COST_BUDGET_SCOPES.MEMBER_CREDIT_ACCOUNT,
    runtimeStatus: "gateway_migrated",
    coverage: "member_credit_gateway",
  };
}

function findOperationsForGap(gap, entriesById) {
  return asList(gap?.registryOperationIds)
    .map((id) => entriesById.get(id))
    .filter(Boolean);
}

function gapRuntimeStatus(gap, entriesById) {
  const operations = findOperationsForGap(gap, entriesById);
  if (operations.length === 0) return "missing";
  return rollupRuntimeStatus(operations.map((entry) => operationRuntimeStatus(entry)));
}

function baselineGapEvidence(gap, entriesById) {
  return {
    id: gap.id,
    category: gap.category || null,
    route: gap.route || null,
    routePolicyIds: asList(gap.routePolicyIds),
    operationIds: asList(gap.registryOperationIds),
    budgetScope: gap.targetBudgetScope || null,
    ownerDomain: gap.ownerDomain || null,
    severity: gap.severity || null,
    temporaryAllowanceReason: gap.temporaryAllowanceReason || null,
    futurePhase: gap.targetFuturePhase || null,
    killSwitchTarget: gap.killSwitchTarget || null,
    killSwitchExemptionReason: gap.killSwitchExemptionReason || null,
    runtimeEnforcementStatus: gapRuntimeStatus(gap, entriesById),
    designPrepStatus: gap.designPrepStatus || null,
    recommendedNextAction: gap.futureEnforcementPath || `Implement ${gap.targetFuturePhase || "the target phase"} before runtime enforcement.`,
    allowedUnmigratedForNow: gap.allowedUnmigratedForNow === true,
  };
}

function gapMatchesScope(gap, scope, entriesById) {
  if (gap?.targetBudgetScope === scope) return true;
  return findOperationsForGap(gap, entriesById).some((entry) => operationBudgetScopes(entry).includes(scope));
}

function collectKillSwitchTargets({ operations, gaps }) {
  return sortedUnique([
    ...operations.map((entry) => operationBudgetPolicy(entry)?.targetEnforcement?.killSwitch),
    ...gaps.map((gap) => gap.killSwitchTarget || gap.killSwitchExemptionReason),
  ]);
}

function scopeEvidence(scope, { entries, knownGaps, entriesById, limits, warnings }) {
  const operations = entries
    .filter((entry) => operationBudgetScopes(entry).includes(scope))
    .sort((left, right) => operationId(left).localeCompare(operationId(right)));
  const gaps = knownGaps
    .filter((gap) => gapMatchesScope(gap, scope, entriesById))
    .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  const runtimeStatus = rollupRuntimeStatus([
    ...operations.map((entry) => operationRuntimeStatus(entry)),
    ...gaps.map((gap) => gapRuntimeStatus(gap, entriesById)),
  ]);
  const targetFuturePhases = sortedUnique([
    ...operations.map((entry) => operationBudgetPolicy(entry)?.targetFuturePhase),
    ...gaps.map((gap) => gap.targetFuturePhase),
  ]);
  const killSwitchTargets = collectKillSwitchTargets({ operations, gaps });
  const implementedCount = operations.filter((entry) =>
    operationRuntimeStatus(entry) === "implemented"
  ).length;
  const capDesign = LIVE_PLATFORM_BUDGET_CAP_SCOPE_DESIGN[scope] || {
    countability: "not_applicable",
    currentDataSources: [],
    futurePhase: "not_applicable",
  };
  const capEvidence = operations
    .map(operationLiveBudgetCapEvidence)
    .filter(Boolean);
  const capEnforced = capEvidence.some((item) => item.status === "cap_enforced");
  return {
    scope,
    operationCount: operations.length,
    implementedCount,
    baselineGapCount: gaps.length,
    targetFuturePhases,
    severityRollup: severityRollup([
      ...operations.map((entry) => ({ gapSeverity: entry.gapSeverity })),
      ...gaps,
    ]),
    runtimeEnforcementExists: runtimeStatus === "implemented",
    runtimeEnforcementStatus: runtimeStatus,
    killSwitchTargetDefined: killSwitchTargets.length > 0,
    killSwitchTargets,
    liveBudgetCapStatus: capEnforced ? "cap_enforced" : "not_implemented",
    liveBudgetCapEnforced: capEnforced,
    liveBudgetCapCountability: capDesign.countability,
    liveBudgetCapFuturePhase: capDesign.futurePhase,
    liveBudgetCapDataSources: sortedUnique([
      ...(capDesign.currentDataSources || []),
      ...capEvidence.flatMap((item) => item.dataSources || []),
    ]),
    liveBudgetCapOperationReadiness: sortedUnique(capEvidence.map((item) => item.readiness)),
    operationIds: limitList(operations.map(operationId), limits.maxBudgetScopeOperationIds, warnings, `${scope} operationIds`),
    baselineGapIds: gaps.map((gap) => gap.id),
  };
}

function adminAiUsageAttemptOperationalEvidence(summary = null, routeIndex) {
  const normalized = summary && typeof summary === "object" ? summary : null;
  return {
    type: "admin_ai_usage_attempt_operational_safety",
    table: "admin_ai_usage_attempts",
    phase: "Phase 4.8.2",
    available: normalized?.available === true,
    unavailableCode: normalized?.available === false ? normalized.code || "admin_ai_usage_attempt_summary_unavailable" : null,
    totalCount: normalized?.available === true ? Number(normalized.totalCount || 0) : null,
    recentCount: normalized?.available === true ? Number(normalized.recentCount || 0) : null,
    recentWindowHours: normalized?.available === true ? Number(normalized.recentWindowHours || 24) : null,
    activeCount: normalized?.available === true ? Number(normalized.activeCount || 0) : null,
    staleActiveCount: normalized?.available === true ? Number(normalized.staleActiveCount || 0) : null,
    expiredCount: normalized?.available === true ? Number(normalized.expiredCount || 0) : null,
    failedTerminalCount: normalized?.available === true ? Number(normalized.failedTerminalCount || 0) : null,
    succeededCount: normalized?.available === true ? Number(normalized.succeededCount || 0) : null,
    latestUpdatedAt: normalized?.available === true ? normalized.latestUpdatedAt || null : null,
    cleanup: {
      endpoint: "/api/admin/ai/admin-usage-attempts/cleanup-expired",
      registered: Boolean(routeIndex.byPath.get("/api/admin/ai/admin-usage-attempts/cleanup-expired")),
      bounded: true,
      defaultDryRun: true,
      destructiveDelete: false,
      mutatesCredits: false,
      mutatesBilling: false,
      providerCalls: false,
    },
    inspection: {
      listEndpoint: "/api/admin/ai/admin-usage-attempts",
      detailEndpoint: "/api/admin/ai/admin-usage-attempts/:id",
      listRegistered: Boolean(routeIndex.byPath.get("/api/admin/ai/admin-usage-attempts")),
      detailRegistered: Boolean(routeIndex.byPath.get("/api/admin/ai/admin-usage-attempts/:id")),
      adminOnly: true,
      sanitized: true,
    },
  };
}

function runtimeBudgetSwitchEvidence(env = null, runtimeBudgetSwitchState = null) {
  const hasEnv = env && typeof env === "object";
  const appStates = new Map((runtimeBudgetSwitchState?.switches || [])
    .map((entry) => [entry.switchKey || entry.flagName, entry]));
  const targets = RUNTIME_BUDGET_SWITCH_TARGETS.map((target) => {
    const appState = appStates.get(target.switchKey) || null;
    const state = hasEnv ? getBudgetSwitchState(env, target.flagName) : {
      flagName: target.flagName,
      configured: null,
      enabled: null,
      status: "unknown",
    };
    return {
      ...target,
      defaultState: "disabled",
      requiredForProviderCall: true,
      configured: state.configured,
      enabled: state.enabled,
      masterFlagStatus: appState?.masterFlagStatus || state.status || "unknown",
      appSwitchStatus: appState?.appSwitchStatus || (runtimeBudgetSwitchState ? "missing" : "unknown"),
      appSwitchEnabled: appState ? appState.appSwitchEnabled === true : null,
      appSwitchAvailable: appState ? appState.appSwitchAvailable === true : (runtimeBudgetSwitchState ? false : null),
      effectiveEnabled: appState ? appState.effectiveEnabled === true : null,
      disabledReason: appState?.disabledReason || null,
      liveCapStatus: target.liveCapStatus,
      exposesSecretValue: false,
    };
  });
  const effectiveEnabledCount = targets.filter((target) => target.effectiveEnabled === true).length;
  const appEnabledCount = targets.filter((target) => target.appSwitchEnabled === true).length;
  return {
    type: "runtime_budget_kill_switch_enforcement",
    phase: "Phase 4.15.1",
    defaultDisabled: true,
    effectiveRule: "cloudflare_master_enabled_and_admin_d1_switch_enabled",
    acceptedTrueValues: ["1", "true", "yes", "on"],
    acceptedFalseValues: ["absent", "empty", "0", "false", "no", "off", "unrecognized"],
    providerCostWorkBlockedWhenDisabled: true,
    liveBudgetCapsEnforced: false,
    envStateAvailable: hasEnv,
    d1SwitchStateAvailable: runtimeBudgetSwitchState?.summary?.d1SwitchStoreAvailable === true,
    targetCount: targets.length,
    enabledCount: hasEnv ? targets.filter((target) => target.enabled === true).length : null,
    disabledCount: hasEnv ? targets.filter((target) => target.enabled !== true).length : null,
    appEnabledCount: runtimeBudgetSwitchState ? appEnabledCount : null,
    effectiveEnabledCount: runtimeBudgetSwitchState ? effectiveEnabledCount : null,
    disabledByMasterCount: runtimeBudgetSwitchState?.summary?.disabledByMasterCount ?? null,
    disabledByAppCount: runtimeBudgetSwitchState?.summary?.disabledByAppCount ?? null,
    unknownOrUnavailableCount: runtimeBudgetSwitchState?.summary?.unknownOrUnavailableCount ?? null,
    targets,
  };
}

function livePlatformBudgetCapEvidence(registryEntries, runtimeSwitches, platformBudgetCapUsageSummary = null) {
  const providerCostBudgetedEntries = registryEntries.filter((entry) =>
    entry?.operationConfig?.providerCost !== false &&
    entry?.budgetPolicy &&
    !String(entry?.operationConfig?.operationId || "").startsWith("member.")
  );
  const switchEnforcedOperationIds = sortedUnique((runtimeSwitches?.targets || [])
    .flatMap((target) => target.operationIds || []));
  const capEnforcedOperationIds = sortedUnique(providerCostBudgetedEntries
    .filter((entry) => entry.budgetPolicy?.liveBudgetCapStatus === "cap_enforced")
    .map(operationId));
  const capEvidenceByOperation = providerCostBudgetedEntries.map((entry) => ({
    operationId: operationId(entry),
    routePath: entry.operationConfig?.routePath || null,
    actorType: entry.operationConfig?.actorType || null,
    budgetScope: entry.budgetPolicy?.targetBudgetScope || null,
    liveBudgetCapStatus: entry.budgetPolicy?.liveBudgetCapStatus || "not_implemented",
    liveBudgetCapReadiness: entry.budgetPolicy?.liveBudgetCapReadiness || "requires_schema",
    liveBudgetCapFuturePhase: entry.budgetPolicy?.liveBudgetCapFuturePhase || null,
    dataSources: asList(entry.budgetPolicy?.liveBudgetCapEvidence?.dataSources),
    durableCompletionTimestamp: entry.budgetPolicy?.liveBudgetCapEvidence?.durableCompletionTimestamp === true,
    estimatedCostUnitsAvailable: entry.budgetPolicy?.liveBudgetCapEvidence?.estimatedCostUnitsAvailable === true,
    switchEnforced: switchEnforcedOperationIds.includes(operationId(entry)),
  })).sort((left, right) => left.operationId.localeCompare(right.operationId));
  const countabilityByBudgetScope = Object.entries(LIVE_PLATFORM_BUDGET_CAP_SCOPE_DESIGN)
    .map(([scope, design]) => {
      const operations = capEvidenceByOperation.filter((entry) => entry.budgetScope === scope);
      return {
        scope,
        status: scope === AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET
          && operations.some((entry) => entry.liveBudgetCapStatus === "cap_enforced")
          ? "cap_enforced"
          : "not_implemented",
        countability: design.countability,
        capRequired: design.capRequired,
        owner: design.owner,
        capGranularityTarget: design.capGranularityTarget,
        currentDataSources: sortedUnique([
          ...(design.currentDataSources || []),
          ...operations.flatMap((entry) => entry.dataSources || []),
        ]),
        existingDataSufficient: design.existingDataSufficient,
        migrationLikelyRequired: design.migrationLikelyRequired,
        defaultCapPosture: design.defaultCapPosture,
        futurePhase: design.futurePhase,
        operationIds: operations.map((entry) => entry.operationId),
      };
    });

  return {
    type: "live_platform_budget_cap_design_evidence",
    phase: "Phase 4.17",
    liveBudgetCapsStatus: capEnforcedOperationIds.length > 0
      ? "platform_admin_lab_budget_foundation"
      : "not_implemented",
    liveBudgetCapsEnforced: capEnforcedOperationIds.length > 0,
    runtimeRouteBehaviorChanged: capEnforcedOperationIds.length > 0,
    recommendedFirstCapScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    recommendedFirstCapPhase: "Phase 4.17",
    memberRoutesSeparate: true,
    switchEnforcedButNotCapEnforced: switchEnforcedOperationIds.some((id) => !capEnforcedOperationIds.includes(id)),
    capEnforcedOperationIds,
    switchEnforcedNotCapEnforcedOperationIds: switchEnforcedOperationIds.filter((id) => !capEnforcedOperationIds.includes(id)),
    platformAdminLabUsageSummary: platformBudgetCapUsageSummary || null,
    countabilityByBudgetScope,
    operations: capEvidenceByOperation,
    pathsWithEstimatedCostUnits: capEvidenceByOperation
      .filter((entry) => entry.estimatedCostUnitsAvailable)
      .map((entry) => entry.operationId),
    pathsWithDurableCompletionTimestamps: capEvidenceByOperation
      .filter((entry) => entry.durableCompletionTimestamp)
      .map((entry) => entry.operationId),
    requiresSchemaOperationIds: capEvidenceByOperation
      .filter((entry) =>
        entry.liveBudgetCapReadiness === "requires_schema" ||
        entry.dataSources.length === 0 ||
        LIVE_PLATFORM_BUDGET_CAP_SCOPE_DESIGN[entry.budgetScope]?.migrationLikelyRequired === true
      )
      .map((entry) => entry.operationId),
    metadataOnlyOperationIds: capEvidenceByOperation
      .filter((entry) => entry.liveBudgetCapReadiness === "metadata_only")
      .map((entry) => entry.operationId),
    notes: [
      "Phase 4.17 implements the first narrow daily/monthly cap foundation for platform_admin_lab_budget only.",
      "Runtime route execution still requires Phase 4.15 Cloudflare master flags and Phase 4.15.1 D1 app switches before cap checks.",
      "Other scopes remain future work; this is not customer billing, Stripe billing, or production readiness.",
    ],
  };
}

function platformBudgetReconciliationEvidence(reconciliation = null) {
  const normalized = reconciliation && typeof reconciliation === "object" ? reconciliation : null;
  const summary = normalized?.summary || {};
  return {
    type: "platform_budget_usage_reconciliation",
    phase: "Phase 4.18/4.19",
    endpoint: "/api/admin/ai/platform-budget-reconciliation",
    budgetScope: normalized?.budgetScope || AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    available: normalized?.ok !== false && normalized != null,
    source: normalized?.source || "local_d1_read_only",
    verdict: normalized?.verdict || (normalized ? "unavailable" : "not_run"),
    readOnly: true,
    repairExecutorExists: true,
    repairApplied: false,
    runtimeRouteBehaviorChanged: false,
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    issueCount: Number(summary.issueCount || 0),
    repairCandidateCount: Number(summary.repairCandidateCount || 0),
    criticalIssueCount: Number(summary.criticalIssueCount || 0),
    warningIssueCount: Number(summary.warningIssueCount || 0),
    notCheckableCount: Number(summary.notCheckableCount || 0),
    checks: {
      missingUsageEvents: Number(summary.missingUsageEventCount || 0),
      duplicateUsageEvents: Number(summary.duplicateUsageEventCount || 0),
      orphanUsageEvents: Number(summary.orphanUsageEventCount || 0),
      failedSourcesCounted: Number(summary.failedSourceUsageCount || 0),
      windowMismatches: Number(summary.windowMismatchCount || 0),
      invalidUsageUnits: Number(summary.invalidUsageUnitCount || 0),
      capStatusIssues: Number(summary.capStatusIssueCount || 0),
    },
    notes: [
      "Phase 4.18 reconciliation remains read-only repair evidence.",
      "Phase 4.19 adds an explicit admin-approved executor for create_missing_usage_event candidates only.",
      "Review-only candidates do not mutate usage/source rows; no credits, queues, provider state, Stripe state, or billing rows are mutated.",
    ],
  };
}

function platformBudgetRepairActionsEvidence(actions = null) {
  const rows = Array.isArray(actions) ? actions : [];
  const available = Array.isArray(actions);
  const byStatus = {};
  let lastRepairTimestamp = null;
  for (const row of rows) {
    const status = row?.actionStatus || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
    const timestamp = row?.updatedAt || row?.createdAt || null;
    if (timestamp && (!lastRepairTimestamp || String(timestamp) > String(lastRepairTimestamp))) {
      lastRepairTimestamp = timestamp;
    }
  }
  return {
    type: "platform_budget_usage_repair_executor",
    phase: "Phase 4.19",
    endpoint: "/api/admin/ai/platform-budget-reconciliation/repair",
    listEndpoint: "/api/admin/ai/platform-budget-repair-actions",
    budgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    available,
    automaticRepair: false,
    scheduledRepair: false,
    executableActions: ["create_missing_usage_event"],
    reviewOnlyActions: [
      "mark_duplicate_usage_event_review",
      "review_orphan_usage_event",
      "review_failed_source_usage",
      "fix_window_metadata",
      "add_missing_cost_metadata",
    ],
    recentActionCount: rows.length,
    actionsByStatus: byStatus,
    lastRepairTimestamp,
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    notes: [
      "Repairs require an explicit admin POST with Idempotency-Key, confirmation, and reason.",
      "Executable repair creates only missing platform_budget_usage_events from still-successful local D1 source evidence.",
      "No provider calls, Stripe calls, credit mutations, source attempt/job mutations, or customer billing mutations are performed.",
    ],
  };
}

function platformBudgetRepairReportEvidence(report = null) {
  const normalized = report && typeof report === "object" ? report : null;
  const summary = normalized?.summary || {};
  return {
    type: "platform_budget_usage_repair_operator_report",
    phase: "Phase 4.20",
    endpoint: "/api/admin/ai/platform-budget-repair-report",
    exportEndpoint: "/api/admin/ai/platform-budget-repair-report/export",
    budgetScope: AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    available: normalized?.available !== false && normalized != null,
    source: normalized?.source || "local_d1_read_only",
    exportFormats: ["json", "markdown"],
    automaticRepair: false,
    scheduledRepair: false,
    reportAppliesRepair: false,
    runtimeRouteBehaviorChanged: false,
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    totalRepairActions: Number(summary.totalRepairActions || 0),
    executableRepairsApplied: Number(summary.executableRepairsApplied || 0),
    reviewOnlyActionsRecorded: Number(summary.reviewOnlyActionsRecorded || 0),
    failedRepairAttempts: Number(summary.failedRepairAttempts || 0),
    createdUsageEventCount: Number(summary.createdUsageEventCount || 0),
    lastRepairTimestamp: summary.lastRepairTimestamp || null,
    notes: [
      "Phase 4.20 report/export is read-only and bounded.",
      "Reports do not apply repairs, delete rows, mutate usage evidence, mutate source attempts/jobs, call providers, call Stripe, or mutate credits.",
      "JSON export is supported; Markdown export is available for operator evidence packets.",
    ],
  };
}

export function buildAdminPlatformBudgetEvidenceReport(options = {}) {
  const limits = normalizeLimits(options.limits);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const registryEntries = options.registryEntries || AI_COST_OPERATION_REGISTRY;
  const baseline = options.baseline || baselineConfig;
  const knownGaps = Array.isArray(baseline?.knownGaps) ? baseline.knownGaps : [];
  const routeIndex = routePolicyIndex(options.routePolicies || ROUTE_POLICIES);
  const entriesById = new Map(registryEntries.map((entry) => [operationId(entry), entry]));
  const warnings = [];

  const memberGatewayOperations = MEMBER_GATEWAY_OPERATION_IDS
    .map((id) => entriesById.get(id))
    .filter((entry) =>
      entry?.currentStatus === "implemented" &&
      entry?.currentEnforcement?.idempotency === "implemented" &&
      entry?.currentEnforcement?.reservation === "implemented" &&
      entry?.currentEnforcement?.replay === "implemented" &&
      entry?.currentEnforcement?.creditCheck === "implemented" &&
      entry?.currentEnforcement?.providerSuppression === "implemented"
    );

  const implementedAdminBudgetOperations = registryEntries.filter((entry) =>
    operationRuntimeStatus(entry) === "implemented" &&
    ["admin", "platform", "internal"].includes(entry?.operationConfig?.actorType) &&
    !String(entry?.operationConfig?.operationId || "").startsWith("member.")
  );
  const partialAdminTextEmbeddingsOperations = ADMIN_TEXT_EMBEDDINGS_OPERATION_IDS
    .map((id) => entriesById.get(id))
    .filter((entry) => entry && operationRuntimeStatus(entry) === "partial");
  const partialAdminLabDurableOperations = ADMIN_LAB_DURABLE_OPERATION_IDS
    .map((id) => entriesById.get(id))
    .filter((entry) => entry && operationRuntimeStatus(entry) === "partial");
  const partialAdminMusicOperations = partialAdminLabDurableOperations
    .filter((entry) => operationId(entry) === "admin.music.test");
  const partialAdminCompareOperations = partialAdminLabDurableOperations
    .filter((entry) => operationId(entry) === "admin.compare");
  const partialAdminLiveAgentOperations = partialAdminLabDurableOperations
    .filter((entry) => operationId(entry) === "admin.live_agent");
  const retiredDebugOperations = [entriesById.get(SYNC_VIDEO_DEBUG_OPERATION_ID)]
    .filter(Boolean);
  const reportedAdminBudgetOperations = [
    ...implementedAdminBudgetOperations,
    ...partialAdminLabDurableOperations,
  ];

  const baselinedGaps = knownGaps.map((gap) => baselineGapEvidence(gap, entriesById));
  const blockedCriticalGaps = baselinedGaps.filter((gap) => gap.severity === "P0" || gap.severity === "P1");

  const implementedOperations = [
    ...memberGatewayOperations.map((entry) => memberGatewayEvidence(entry, routeIndex)),
    ...reportedAdminBudgetOperations.map((entry) => {
      if (operationId(entry) === HARDENED_ADMIN_OPERATION_ID) {
        return implementedAdminImageEvidence(entry, routeIndex);
      }
      if (operationId(entry) === UNMETERED_ADMIN_IMAGE_OPERATION_ID) {
        return adminImageBranchClassificationEvidence(entry, routeIndex);
      }
      if (ADMIN_LAB_DURABLE_OPERATION_IDS.includes(operationId(entry))) {
        return implementedAdminLabDurableEvidence(entry, routeIndex);
      }
      if (operationId(entry) === ADMIN_VIDEO_JOB_OPERATION_ID) {
        return implementedAdminVideoJobEvidence(entry, routeIndex);
      }
      if (NEWS_PULSE_VISUAL_OPERATION_IDS.includes(operationId(entry))) {
        return implementedNewsPulseVisualEvidence(entry, routeIndex);
      }
      if (INTERNAL_CALLER_POLICY_GUARD_OPERATION_IDS.includes(operationId(entry))) {
        return implementedInternalCallerPolicyGuardEvidence(entry, routeIndex);
      }
      return basicOperationEvidence(entry, routeIndex);
    }),
  ].sort((left, right) => left.operationId.localeCompare(right.operationId));

  const runtimeSwitches = runtimeBudgetSwitchEvidence(options.env, options.runtimeBudgetSwitchState);
  const liveBudgetCaps = livePlatformBudgetCapEvidence(
    registryEntries,
    runtimeSwitches,
    options.platformBudgetCapUsageSummary || null
  );
  const platformBudgetReconciliation = platformBudgetReconciliationEvidence(options.platformBudgetReconciliation || null);
  const platformBudgetRepairs = platformBudgetRepairActionsEvidence(options.platformBudgetRepairActions || null);
  const platformBudgetRepairReport = platformBudgetRepairReportEvidence(options.platformBudgetRepairReport || null);
  const evidenceItems = [
    ...implementedOperations,
    ...retiredDebugOperations.map((entry) => retiredSyncVideoDebugEvidence(entry, routeIndex)),
    adminAiUsageAttemptOperationalEvidence(options.adminAiUsageAttemptSummary, routeIndex),
    runtimeSwitches,
    liveBudgetCaps,
    platformBudgetReconciliation,
    platformBudgetRepairs,
    platformBudgetRepairReport,
    ...baselinedGaps.map((gap) => ({
      type: "baselined_runtime_gap",
      ...gap,
    })),
  ];
  const adminImageBranches = adminImageBranchClassificationEvidence(
    entriesById.get(UNMETERED_ADMIN_IMAGE_OPERATION_ID) || entriesById.get(HARDENED_ADMIN_OPERATION_ID),
    routeIndex
  );

  const report = {
    ok: true,
    version: ADMIN_PLATFORM_BUDGET_EVIDENCE_VERSION,
    generatedAt,
    source: ADMIN_PLATFORM_BUDGET_EVIDENCE_SOURCE,
    verdict: baselinedGaps.length > 0 ? "blocked" : "pass",
    runtimeMutation: false,
    providerCalls: false,
    billingMutation: false,
    summary: {
      memberGatewayMigrated: memberGatewayOperations.length,
      adminPlatformImplemented: implementedAdminBudgetOperations.length,
      adminTextEmbeddingsDurableIdempotency: partialAdminTextEmbeddingsOperations.length,
      adminMusicDurableIdempotency: partialAdminMusicOperations.length,
      adminCompareDurableIdempotency: partialAdminCompareOperations.length,
      adminLiveAgentDurableIdempotency: partialAdminLiveAgentOperations.length,
      adminLabDurableIdempotency: partialAdminLabDurableOperations.length,
      retiredDebugPaths: retiredDebugOperations.length,
      adminTextEmbeddingsAttemptsOperable: true,
      adminLabAttemptsOperable: true,
      adminImageChargedBranches: adminImageBranches.counts.chargedAdminOrgCredit,
      adminImageExplicitUnmeteredBranches: adminImageBranches.counts.explicitUnmeteredAdmin,
      adminImageBlockedUnsupportedGuards: adminImageBranches.counts.blockedUnsupportedGuard,
      runtimeBudgetSwitchTargets: runtimeSwitches.targetCount,
      runtimeBudgetSwitchesEnabled: runtimeSwitches.enabledCount,
      runtimeBudgetSwitchesDisabled: runtimeSwitches.disabledCount,
      runtimeBudgetSwitchesAppEnabled: runtimeSwitches.appEnabledCount,
      runtimeBudgetSwitchesEffectiveEnabled: runtimeSwitches.effectiveEnabledCount,
      runtimeBudgetSwitchesDisabledByMaster: runtimeSwitches.disabledByMasterCount,
      runtimeBudgetSwitchesDisabledByApp: runtimeSwitches.disabledByAppCount,
      runtimeBudgetSwitchesUnknownOrUnavailable: runtimeSwitches.unknownOrUnavailableCount,
      liveBudgetCapsStatus: liveBudgetCaps.liveBudgetCapsStatus,
      liveBudgetCapsEnforced: liveBudgetCaps.liveBudgetCapsEnforced,
      recommendedFirstCapScope: liveBudgetCaps.recommendedFirstCapScope,
      platformBudgetReconciliationAvailable: platformBudgetReconciliation.available,
      platformBudgetReconciliationVerdict: platformBudgetReconciliation.verdict,
      platformBudgetReconciliationRepairCandidates: platformBudgetReconciliation.repairCandidateCount,
      platformBudgetReconciliationCriticalIssues: platformBudgetReconciliation.criticalIssueCount,
      platformBudgetReconciliationNotCheckable: platformBudgetReconciliation.notCheckableCount,
      platformBudgetRepairExecutorAvailable: platformBudgetRepairs.available,
      platformBudgetRepairRecentActions: platformBudgetRepairs.recentActionCount,
      platformBudgetRepairLastActionAt: platformBudgetRepairs.lastRepairTimestamp,
      platformBudgetRepairReportAvailable: platformBudgetRepairReport.available,
      platformBudgetRepairReportExportFormats: platformBudgetRepairReport.exportFormats.length,
      platformBudgetRepairReportTotalActions: platformBudgetRepairReport.totalRepairActions,
      switchEnforcedNotCapEnforcedOperations: liveBudgetCaps.switchEnforcedNotCapEnforcedOperationIds.length,
      baselineGaps: baselinedGaps.length,
      blockedCriticalGaps: blockedCriticalGaps.length,
      routePolicyRegistered: Boolean(routeIndex.byPath.get(ADMIN_PLATFORM_BUDGET_EVIDENCE_ENDPOINT)),
    },
    adminImageBranches,
    adminAiUsageAttempts: adminAiUsageAttemptOperationalEvidence(options.adminAiUsageAttemptSummary, routeIndex),
    runtimeBudgetSwitches: runtimeSwitches,
    livePlatformBudgetCaps: liveBudgetCaps,
    platformBudgetReconciliation,
    platformBudgetRepairs,
    platformBudgetRepairReport,
    retiredDebugPaths: limitList(
      retiredDebugOperations.map((entry) => retiredSyncVideoDebugEvidence(entry, routeIndex)),
      limits.maxImplementedOperations,
      warnings,
      "retiredDebugPaths"
    ),
    budgetScopes: ADMIN_PLATFORM_BUDGET_EVIDENCE_SCOPES.map((scope) =>
      scopeEvidence(scope, {
        entries: registryEntries,
        knownGaps,
        entriesById,
        limits,
        warnings,
      })
    ),
    implementedOperations: limitList(
      implementedOperations,
      limits.maxImplementedOperations,
      warnings,
      "implementedOperations"
    ),
    baselinedGaps: limitList(
      baselinedGaps,
      limits.maxBaselinedGaps,
      warnings,
      "baselinedGaps"
    ),
    evidenceItems: limitList(
      evidenceItems,
      limits.maxEvidenceItems,
      warnings,
      "evidenceItems"
    ),
    warnings,
    notes: [
      "Phase 4.4 is read-only evidence reporting only; Phase 4.5 adds admin async video job budget metadata/enforcement, Phase 4.6 adds OpenClaw/News Pulse visual budget metadata/control evidence, and Phase 4.7 adds an internal AI Worker caller-policy guard for covered caller paths.",
      "This report remains read-only and performs no provider call, Stripe call, billing mutation, credit mutation, D1 write, R2 write, Cloudflare mutation, or GitHub settings mutation.",
      "Member image, music, and video remain the migrated member AI Cost Gateway routes.",
      "The charged Admin BFL image-test branch uses admin_org_credit_account metadata; admin async video jobs use platform_admin_lab_budget metadata plus caller-policy metadata for task create/poll; News Pulse visuals use openclaw_news_pulse_budget metadata; admin text/embeddings/music/compare/live-agent now use platform_admin_lab_budget metadata, durable metadata-only idempotency rows, signed caller-policy metadata, and Phase 4.8.2 bounded cleanup/API inspection.",
      "Phase 4.15 enforces runtime budget kill-switches for already budget-classified admin/platform provider-cost routes. Missing or false switch values block provider-cost work before provider, queue, credit, or durable-attempt execution where applicable.",
      "Phase 4.16 adds live platform budget cap design/evidence only. Phase 4.17 implements the first platform_admin_lab_budget cap foundation; production/live billing readiness remains blocked.",
      "Phase 4.19 adds an explicit admin-approved repair executor for selected platform_admin_lab_budget reconciliation candidates. It has no automatic scheduler and does not call providers, Stripe, Cloudflare, or mutate credits/source rows/customer billing.",
      "Phase 4.20 adds read-only platform budget repair evidence reporting/export. Reports and exports are bounded, sanitized, and cannot apply repairs or mutate usage/source/credit/billing state.",
      "Phase 4.13 retires sync video debug as disabled-by-default/emergency-only; async admin video jobs are the supported budgeted admin video path.",
      "Phase 4.14 classifies Admin Image branches: charged priced models stay on the admin_org_credit_account path, FLUX.2 Dev is an explicit_unmetered_admin lab exception with safe metadata, and unclassified Admin Image models are blocked before provider calls.",
      "Platform/background AI outside News Pulse visuals and baseline-allowed internal AI Worker routes beyond caller-tied domains remain baselined gaps.",
      "Production readiness and live billing readiness remain blocked.",
    ],
    limits,
  };

  return sanitizeValue(report, { limits });
}

export function renderAdminPlatformBudgetEvidenceMarkdown(report) {
  const scopeLines = (report.budgetScopes || []).map((scope) =>
    `- ${scope.scope}: operations=${scope.operationCount}; implemented=${scope.implementedCount}; baselineGaps=${scope.baselineGapCount}; runtime=${scope.runtimeEnforcementStatus}; killSwitchTargetDefined=${scope.killSwitchTargetDefined ? "yes" : "no"}; liveCaps=${scope.liveBudgetCapStatus || "not_implemented"}; countability=${scope.liveBudgetCapCountability || "n/a"}`
  );
  const implementedLines = (report.implementedOperations || []).map((operation) =>
    `- ${operation.operationId}: ${operation.runtimeStatus || operation.runtimeEnforcementStatus}; scope=${operation.budgetScope || "n/a"}; route=${operation.routePath || "n/a"}`
  );
  const retiredDebugLines = (report.retiredDebugPaths || []).map((operation) =>
    `- ${operation.operationId}: ${operation.runtimeStatus || operation.runtimeEnforcementStatus}; replacement=${operation.supportedReplacement || "n/a"}; flag=${operation.killSwitchTarget || "n/a"}`
  );
  const imageBranchLines = [
    `- Charged admin-org-credit branches: ${report.adminImageBranches?.counts?.chargedAdminOrgCredit ?? 0}`,
    `- Explicit unmetered admin branches: ${report.adminImageBranches?.counts?.explicitUnmeteredAdmin ?? 0}`,
    `- Blocked unsupported guard: ${report.adminImageBranches?.counts?.blockedUnsupportedGuard ?? 0}`,
  ];
  const switchLines = (report.runtimeBudgetSwitches?.targets || []).map((target) =>
    `- ${target.flagName}: ${target.enabled === true ? "enabled" : target.enabled === false ? "disabled" : "not evaluated"}; domain=${target.domain}`
  );
  const capScopeLines = (report.livePlatformBudgetCaps?.countabilityByBudgetScope || []).map((scope) =>
    `- ${scope.scope}: status=${scope.status}; countability=${scope.countability}; future=${scope.futurePhase}; sources=${(scope.currentDataSources || []).join(", ") || "none"}`
  );
  const reconciliation = report.platformBudgetReconciliation || {};
  const repairs = report.platformBudgetRepairs || {};
  const repairReport = report.platformBudgetRepairReport || {};
  const gapLines = (report.baselinedGaps || []).map((gap) =>
    `- ${gap.id}: ${gap.category}; ${gap.severity}; scope=${gap.budgetScope}; runtime=${gap.runtimeEnforcementStatus}; target=${gap.futurePhase}`
  );

  return [
    "# Admin/Platform AI Budget Evidence",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    `Runtime mutation: ${report.runtimeMutation ? "yes" : "no"}`,
    "",
    "## Summary",
    `- Member gateway migrated: ${report.summary?.memberGatewayMigrated ?? 0}`,
    `- Admin/platform implemented: ${report.summary?.adminPlatformImplemented ?? 0}`,
    `- Live platform budget caps: ${report.summary?.liveBudgetCapsStatus || "not_implemented"}`,
    `- Recommended first cap scope: ${report.summary?.recommendedFirstCapScope || "n/a"}`,
    `- Baseline gaps: ${report.summary?.baselineGaps ?? 0}`,
    `- Blocked critical gaps: ${report.summary?.blockedCriticalGaps ?? 0}`,
    "",
    "## Budget Scopes",
    scopeLines.length ? scopeLines.join("\n") : "- None",
    "",
    "## Implemented Operations",
    implementedLines.length ? implementedLines.join("\n") : "- None",
    "",
    "## Retired Debug Paths",
    retiredDebugLines.length ? retiredDebugLines.join("\n") : "- None",
    "",
    "## Admin Image Branches",
    imageBranchLines.join("\n"),
    "",
    "## Runtime Budget Switches",
    switchLines.length ? switchLines.join("\n") : "- None",
    "",
    "## Live Platform Budget Caps",
    capScopeLines.length ? capScopeLines.join("\n") : "- None",
    "",
    "## Platform Budget Reconciliation",
    `- Status: ${reconciliation.verdict || "not_run"}`,
    `- Repair candidates: ${reconciliation.repairCandidateCount ?? 0}`,
    `- Critical issues: ${reconciliation.criticalIssueCount ?? 0}`,
    `- Read-only: ${reconciliation.readOnly === true ? "yes" : "no"}`,
    `- Repair executor: ${repairs.available === true ? "available" : "not available"}`,
    `- Recent repair actions: ${repairs.recentActionCount ?? 0}`,
    `- Repair report/export: ${repairReport.available === true ? "available" : "not available"}; formats=${(repairReport.exportFormats || []).join(", ") || "none"}`,
    `- Automatic repair: ${repairs.automaticRepair === true ? "yes" : "no"}`,
    "",
    "## Baselined Gaps",
    gapLines.length ? gapLines.join("\n") : "- None",
    "",
    "## Notes",
    (report.notes || []).map((note) => `- ${note}`).join("\n") || "- None",
  ].join("\n");
}
