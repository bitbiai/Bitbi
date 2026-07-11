import {
  AI_CALLER_POLICY_BUDGET_SCOPES,
  AI_CALLER_POLICY_CALLER_CLASSES,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES,
  AI_CALLER_POLICY_VERSION,
} from "../../../shared/ai-caller-policy.mjs";
import {
  ADMIN_PLATFORM_BUDGET_SCOPES,
  buildAdminPlatformBudgetFingerprint,
  classifyAdminPlatformBudgetPlan,
} from "./admin-platform-budget-policy.js";
import { assertBudgetSwitchEffectiveEnabled } from "./admin-platform-budget-switches.js";
import { getAiCostOperationRegistryEntry } from "./ai-cost-operations.js";
import {
  checkPlatformBudgetCap,
  getPlatformBudgetWindows,
  PlatformBudgetCapError,
} from "./platform-budget-caps.js";
import {
  FABLE_CHAT_MEMORY_CONTRACT_VERSION,
  FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS,
  FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
  FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS,
  FABLE_CHAT_MEMORY_MODEL_ID,
  FABLE_CHAT_MEMORY_PROMPT_VERSION,
  FABLE_CHAT_MEMORY_SAFETY_MARGINS,
  calculateFableChatMemoryCostUsd,
  getFableChatMemoryAcceptanceCeiling,
  getFableChatMemoryPlanningCeiling,
  getFableChatMemoryProviderMaxTokens,
  normalizeFableChatMemoryMode,
} from "../../../shared/fable-chat-memory-contract.mjs";
import { nowIso, randomTokenHex } from "./tokens.js";

export const FABLE_CHAT_MEMORY_OPERATION_ID = "admin.fable_chat.compact_memory";
export const FABLE_CHAT_MEMORY_INTERNAL_PATH = "/internal/ai/fable-chat/memory";
export const FABLE_CHAT_MEMORY_SOURCE_ROUTE = "/api/admin/fable-chat/conversations/:id/messages";
export const FABLE_CHAT_MEMORY_BUDGET_SWITCH = "ENABLE_ADMIN_AI_TEXT_BUDGET";
export const FABLE_CHAT_MEMORY_BUDGET_USD_PER_UNIT = 0.001;

export function deriveFableChatMemoryBudgetUnits({ profile, estimatedInputTokens }) {
  const normalizedProfile = normalizeFableChatMemoryMode(profile);
  const inputTokens = Math.max(0, Math.floor(Number(estimatedInputTokens) || 0));
  const outputTokens = getFableChatMemoryProviderMaxTokens(normalizedProfile);
  const estimated = calculateFableChatMemoryCostUsd({ input_tokens: inputTokens, output_tokens: outputTokens });
  return {
    units: Math.max(1, Math.ceil(estimated.totalCostUsd / FABLE_CHAT_MEMORY_BUDGET_USD_PER_UNIT)),
    estimatedInputTokens: inputTokens,
    estimatedInputBucketTokens: Math.max(1_000, Math.ceil(inputTokens / 1_000) * 1_000),
    reservedOutputTokens: outputTokens,
    estimatedCostUsd: estimated.totalCostUsd,
  };
}

function memoryBudgetOperation() {
  const registry = getAiCostOperationRegistryEntry(FABLE_CHAT_MEMORY_OPERATION_ID);
  const config = registry?.operationConfig || {};
  return {
    operationId: FABLE_CHAT_MEMORY_OPERATION_ID,
    featureKey: config.featureKey || "admin.ai.fable_chat_memory",
    actorType: "admin",
    actorRole: "admin",
    budgetScope: registry?.budgetPolicy?.targetBudgetScope
      || ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    ownerDomain: "admin-fable-chat-memory",
    providerFamily: config.providerFamily || "workers_ai",
    modelId: FABLE_CHAT_MEMORY_MODEL_ID,
    modelResolverKey: config.modelResolverKey || "admin.fable_chat.memory.fixed_qwen",
    providerCost: true,
    estimatedCostUnits: Math.max(1, Number(config.creditCost || 1)),
    idempotencyPolicy: "required",
    killSwitchPolicy: {
      flagName: FABLE_CHAT_MEMORY_BUDGET_SWITCH,
      defaultState: "disabled",
      requiredForProviderCall: true,
      disabledBehavior: "manual_only",
      operatorCanOverride: false,
      scope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      notes: "Hidden memory compaction reuses the Admin Text runtime budget switch.",
    },
    routeId: config.routeId || "internal.ai.fable-chat.memory",
    routePath: config.routePath || FABLE_CHAT_MEMORY_INTERNAL_PATH,
  };
}

export async function prepareFableChatMemoryBudget({
  env,
  adminUser,
  conversationId,
  checkpointId,
  checkpointVersion,
  profile,
  inputFingerprint,
  estimatedInputTokens,
  summaryPlan = null,
  correlationId = null,
}) {
  const operation = memoryBudgetOperation();
  const plan = classifyAdminPlatformBudgetPlan({
    operation,
    actorUserId: adminUser.id,
    actorRole: "admin",
    modelId: FABLE_CHAT_MEMORY_MODEL_ID,
    reason: "admin_fable_chat_hidden_memory_compaction",
    correlationId,
  });
  if (!plan.ok) {
    const error = new Error("Fable memory budget policy is unavailable.");
    error.code = "fable_chat_memory_budget_policy_unavailable";
    error.status = 503;
    throw error;
  }
  await assertBudgetSwitchEffectiveEnabled(env, plan);
  const weight = deriveFableChatMemoryBudgetUnits({ profile, estimatedInputTokens });
  const summaryLimits = {
    planning_ceiling: getFableChatMemoryPlanningCeiling(profile),
    base_soft_target: FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS[profile],
    acceptance_ceiling: getFableChatMemoryAcceptanceCeiling(profile),
    safety_margin: FABLE_CHAT_MEMORY_SAFETY_MARGINS[profile],
    minimum_viable_target: FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS[profile],
    fixed_schema_overhead: Math.max(0, Number(summaryPlan?.fixedSchemaOverhead) || 0),
    source_overhead_estimate: Math.max(0, Number(summaryPlan?.sourceOverheadEstimate) || 0),
    effective_soft_target: Math.max(0, Number(summaryPlan?.effectiveSoftTarget) || 0),
    source_catalog_count: Math.max(0, Number(summaryPlan?.sourceCatalog?.length) || 0),
  };
  const budgetFingerprint = await buildAdminPlatformBudgetFingerprint({
    operation,
    actorId: adminUser.id,
    budgetScopeId: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    modelId: FABLE_CHAT_MEMORY_MODEL_ID,
    routeId: operation.routeId,
    routePath: operation.routePath,
    body: {
      conversation_id: conversationId,
      checkpoint_id: checkpointId,
      checkpoint_version: checkpointVersion,
      profile,
      input_fingerprint: inputFingerprint,
      memory_contract_version: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
      prompt_version: FABLE_CHAT_MEMORY_PROMPT_VERSION,
      diagnostic_version: FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
      ...summaryLimits,
      estimated_input_bucket_tokens: weight.estimatedInputBucketTokens,
      reserved_output_tokens: weight.reservedOutputTokens,
    },
    hashFields: [],
  });
  const capCheck = await checkPlatformBudgetCap(env, {
    budgetScope: plan.budgetScope,
    operationKey: FABLE_CHAT_MEMORY_OPERATION_ID,
    units: weight.units,
    sourceRoute: FABLE_CHAT_MEMORY_SOURCE_ROUTE,
    actorUserId: adminUser.id,
    actorRole: "admin",
  });
  return {
    callerPolicy: {
      policy_version: AI_CALLER_POLICY_VERSION,
      operation_id: FABLE_CHAT_MEMORY_OPERATION_ID,
      budget_scope: AI_CALLER_POLICY_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      enforcement_status: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_METADATA_ONLY,
      caller_class: AI_CALLER_POLICY_CALLER_CLASSES.ADMIN,
      owner_domain: "admin-fable-chat-memory",
      provider_family: operation.providerFamily,
      model_id: FABLE_CHAT_MEMORY_MODEL_ID,
      model_resolver_key: operation.modelResolverKey,
      idempotency_policy: "required",
      source_route: FABLE_CHAT_MEMORY_SOURCE_ROUTE,
      source_component: "auth-worker-admin-fable-chat-memory",
      budget_fingerprint: budgetFingerprint,
      request_fingerprint: inputFingerprint,
      kill_switch_target: FABLE_CHAT_MEMORY_BUDGET_SWITCH,
      correlation_id: correlationId,
      reason: "admin_fable_chat_hidden_memory_compaction",
      notes: "Auth owns hidden checkpoint concurrency, validation, and atomic budget admission.",
    },
    units: capCheck.requestedUnits,
    metadata: {
      phase: "van-ark-fable-memory-v1",
      source: "provider_attempt_admission",
      model_id: FABLE_CHAT_MEMORY_MODEL_ID,
      provider_family: "workers_ai",
      accounting_basis: "qwen_price_weighted_admitted_before_provider",
      profile,
      memory_contract_version: FABLE_CHAT_MEMORY_CONTRACT_VERSION,
      prompt_version: FABLE_CHAT_MEMORY_PROMPT_VERSION,
      diagnostic_version: FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
      ...summaryLimits,
      estimated_input_bucket_tokens: weight.estimatedInputBucketTokens,
      reserved_output_tokens: weight.reservedOutputTokens,
      estimated_provider_cost_usd: weight.estimatedCostUsd,
      final_state: "admitted",
    },
  };
}

export async function admitFableChatMemoryBudgetUsage({
  env,
  adminUserId,
  checkpointId,
  inputFingerprint,
  units,
  metadata,
}) {
  const requestedUnits = Math.max(1, Math.ceil(Number(units) || 1));
  const createdAt = nowIso();
  const windows = getPlatformBudgetWindows(createdAt);
  const eventId = `pbu_${randomTokenHex(16)}`;
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO platform_budget_usage_events (
       id, budget_scope, operation_key, source_route, actor_user_id, actor_role, units,
       window_day, window_month, idempotency_key_hash, request_fingerprint,
       source_attempt_id, source_job_id, status, metadata_json, created_at
     )
     SELECT ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, NULL, 'recorded', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM platform_budget_limits daily_limit
         WHERE daily_limit.budget_scope = ? AND daily_limit.window_type = 'daily'
           AND daily_limit.status = 'active'
           AND (
             SELECT COALESCE(SUM(usage.units), 0)
               FROM platform_budget_usage_events usage
              WHERE usage.budget_scope = ? AND usage.window_day = ?
                AND usage.status = 'recorded'
           ) + ? <= daily_limit.limit_units
      )
        AND EXISTS (
          SELECT 1 FROM platform_budget_limits monthly_limit
           WHERE monthly_limit.budget_scope = ? AND monthly_limit.window_type = 'monthly'
             AND monthly_limit.status = 'active'
             AND (
               SELECT COALESCE(SUM(usage.units), 0)
                 FROM platform_budget_usage_events usage
                WHERE usage.budget_scope = ? AND usage.window_month = ?
                  AND usage.status = 'recorded'
             ) + ? <= monthly_limit.limit_units
        )`
  ).bind(
    eventId,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    FABLE_CHAT_MEMORY_OPERATION_ID,
    FABLE_CHAT_MEMORY_SOURCE_ROUTE,
    adminUserId,
    requestedUnits,
    windows.day,
    windows.month,
    inputFingerprint,
    inputFingerprint,
    checkpointId,
    JSON.stringify(metadata),
    createdAt,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    windows.day,
    requestedUnits,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    windows.month,
    requestedUnits
  ).run();
  if (Number(result?.meta?.changes || 0) > 0) {
    return { admitted: true, replayed: false, eventId, units: requestedUnits };
  }
  const existing = await env.DB.prepare(
    `SELECT id FROM platform_budget_usage_events
      WHERE source_attempt_id = ? AND budget_scope = ? AND operation_key = ?
      LIMIT 1`
  ).bind(
    checkpointId,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    FABLE_CHAT_MEMORY_OPERATION_ID
  ).first();
  if (existing) {
    return { admitted: true, replayed: true, eventId: existing.id, units: requestedUnits };
  }
  await checkPlatformBudgetCap(env, {
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    operationKey: FABLE_CHAT_MEMORY_OPERATION_ID,
    units: requestedUnits,
    sourceRoute: FABLE_CHAT_MEMORY_SOURCE_ROUTE,
    actorUserId: adminUserId,
    actorRole: "admin",
    now: createdAt,
  });
  throw new PlatformBudgetCapError("Memory compaction budget admission could not be recorded.", {
    status: 503,
    code: "platform_budget_cap_store_unavailable",
    fields: {
      budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      operationKey: FABLE_CHAT_MEMORY_OPERATION_ID,
      requestedUnits,
    },
  });
}

export async function recordFableChatMemoryBudgetOutcome(env, checkpointId, {
  finalState,
  durationMs = null,
  usage = null,
  providerCostUsd = null,
} = {}) {
  const state = ["succeeded", "failed", "unknown"].includes(finalState)
    ? finalState
    : "unknown";
  const safeUsage = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value) && value >= 0) safeUsage[key] = Math.floor(value);
  }
  const cost = Number(providerCostUsd);
  const patch = {
    final_state: state,
    duration_ms: Number.isFinite(Number(durationMs))
      ? Math.max(0, Math.floor(Number(durationMs)))
      : null,
    ...(Number.isFinite(cost) && cost >= 0 ? { provider_cost_usd: cost } : {}),
    ...safeUsage,
  };
  await env.DB.prepare(
    `UPDATE platform_budget_usage_events
        SET metadata_json = json_patch(metadata_json, ?)
      WHERE source_attempt_id = ? AND budget_scope = ? AND operation_key = ?`
  ).bind(
    JSON.stringify(patch),
    checkpointId,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    FABLE_CHAT_MEMORY_OPERATION_ID
  ).run();
}
