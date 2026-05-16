import baselineConfig from "../../../../config/ai-cost-policy-baseline.json" with { type: "json" };
import { ROUTE_POLICIES } from "../app/route-policy.js";
import {
  AI_COST_BUDGET_SCOPES,
  AI_COST_OPERATION_REGISTRY,
} from "./ai-cost-operations.js";
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
  };
}

function implementedAdminImageEvidence(entry, routeIndex) {
  const base = basicOperationEvidence(entry, routeIndex);
  return {
    ...base,
    type: "implemented_admin_budget_operation",
    runtimeStatus: "implemented_hardened",
    idempotencyTarget: "required selected-organization scoped idempotency key",
    killSwitchTarget: "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET",
    modelClass: "priced Black Forest Labs admin image tests",
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
      "Runtime kill-switch target is metadata only in Phase 4.4.",
      "Generated image result is not replayed for completed same-key admin image tests.",
      "Unpriced Admin image models remain a separate platform_admin_lab_budget baseline gap.",
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
      "Runtime env kill-switch enforcement remains future work.",
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
        ? "Runtime env kill-switch enforcement is metadata only in Phase 4.9."
        : isCompare
          ? "Runtime env kill-switch enforcement is metadata only in Phase 4.10."
          : isLiveAgent
            ? "Runtime env kill-switch enforcement is metadata only in Phase 4.12."
          : "Runtime env kill-switch enforcement is metadata only in Phase 4.8.1.",
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
      "Runtime env kill-switch enforcement is metadata only in Phase 4.6.",
      "Live daily/monthly platform budget caps remain future work.",
      operation === "platform.news_pulse.visual.ingest"
        ? "Signed OpenClaw ingest remains separate from public read routes."
        : "Scheduled visual backfill remains bounded by batch size and row attempts.",
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
      "Sync video debug, unmetered image, and broader internal routes remain baseline-allowed until targeted caller migrations.",
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

  const evidenceItems = [
    ...implementedOperations,
    adminAiUsageAttemptOperationalEvidence(options.adminAiUsageAttemptSummary, routeIndex),
    ...baselinedGaps.map((gap) => ({
      type: "baselined_runtime_gap",
      ...gap,
    })),
  ];

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
      adminTextEmbeddingsAttemptsOperable: true,
      adminLabAttemptsOperable: true,
      baselineGaps: baselinedGaps.length,
      blockedCriticalGaps: blockedCriticalGaps.length,
      routePolicyRegistered: Boolean(routeIndex.byPath.get(ADMIN_PLATFORM_BUDGET_EVIDENCE_ENDPOINT)),
    },
    adminAiUsageAttempts: adminAiUsageAttemptOperationalEvidence(options.adminAiUsageAttemptSummary, routeIndex),
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
      "Phase 4.12 covers Admin Live-Agent only with required idempotency, metadata-only stream-session attempts, caller-policy propagation, and safe stream completion/failure tracking; runtime env kill-switch enforcement and live platform budget caps remain future work.",
      "Sync video debug, unmetered image, platform/background AI outside News Pulse visuals, and baseline-allowed internal AI Worker routes beyond caller-tied domains remain baselined gaps.",
      "Production readiness and live billing readiness remain blocked.",
    ],
    limits,
  };

  return sanitizeValue(report, { limits });
}

export function renderAdminPlatformBudgetEvidenceMarkdown(report) {
  const scopeLines = (report.budgetScopes || []).map((scope) =>
    `- ${scope.scope}: operations=${scope.operationCount}; implemented=${scope.implementedCount}; baselineGaps=${scope.baselineGapCount}; runtime=${scope.runtimeEnforcementStatus}; killSwitchTargetDefined=${scope.killSwitchTargetDefined ? "yes" : "no"}`
  );
  const implementedLines = (report.implementedOperations || []).map((operation) =>
    `- ${operation.operationId}: ${operation.runtimeStatus || operation.runtimeEnforcementStatus}; scope=${operation.budgetScope || "n/a"}; route=${operation.routePath || "n/a"}`
  );
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
    `- Baseline gaps: ${report.summary?.baselineGaps ?? 0}`,
    `- Blocked critical gaps: ${report.summary?.blockedCriticalGaps ?? 0}`,
    "",
    "## Budget Scopes",
    scopeLines.length ? scopeLines.join("\n") : "- None",
    "",
    "## Implemented Operations",
    implementedLines.length ? implementedLines.join("\n") : "- None",
    "",
    "## Baselined Gaps",
    gapLines.length ? gapLines.join("\n") : "- None",
    "",
    "## Notes",
    (report.notes || []).map((note) => `- ${note}`).join("\n") || "- None",
  ].join("\n");
}
