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
import { FABLE_CHAT_MODEL_ID } from "./fable-chat.js";
import {
  FABLE_CHAT_WEB_SEARCH_HARD_MAX_USES,
  FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
  FABLE_CHAT_WEB_FETCH_MAX_USES,
  getFableChatWebSearchMaxUses,
} from "../../../shared/fable-chat-contract.mjs";
import { nowIso, randomTokenHex } from "./tokens.js";

export const FABLE_CHAT_OPERATION_ID = "admin.fable_chat.send";
export const FABLE_CHAT_SOURCE_ROUTE = "/api/admin/fable-chat/conversations/:id/messages";
export const FABLE_CHAT_STREAM_SOURCE_ROUTE = "/api/admin/fable-chat/conversations/:id/messages/stream";
export const FABLE_CHAT_INTERNAL_PATH = "/internal/ai/fable-chat";
export const FABLE_CHAT_INTERNAL_STREAM_PATH = "/internal/ai/fable-chat/stream";
export const FABLE_CHAT_BUDGET_SWITCH = "ENABLE_ADMIN_AI_TEXT_BUDGET";
const FABLE_CHAT_INPUT_UNIT_TOKENS = 32_768;
export const FABLE_CHAT_WEB_SEARCH_SURCHARGE_UNITS = 2;
const FABLE_CHAT_EFFORT_UNITS = Object.freeze({
  medium: 1,
  high: 2,
  xhigh: 4,
  max: 5,
});

export function deriveFableChatBudgetUnits({
  effort,
  estimatedInputTokens,
  webSearchEnabled = false,
  webFetchEnabled = false,
  toolChoice = "auto",
}) {
  const effortUnits = FABLE_CHAT_EFFORT_UNITS[effort];
  if (!effortUnits) {
    const error = new Error("Fable chat effort is invalid for budget admission.");
    error.code = "fable_chat_budget_policy_unavailable";
    error.status = 503;
    throw error;
  }
  const baseInputTokens = Math.max(0, Math.floor(Number(estimatedInputTokens) || 0));
  const providerToolsEnabled = toolChoice !== "none";
  const webFetchReservedTokens = webFetchEnabled === true && providerToolsEnabled
    ? FABLE_CHAT_WEB_FETCH_MAX_USES * FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS
    : 0;
  const inputTokens = baseInputTokens + webFetchReservedTokens;
  const inputUnits = Math.max(1, Math.ceil(inputTokens / FABLE_CHAT_INPUT_UNIT_TOKENS));
  const webSearchMaxUses = getFableChatWebSearchMaxUses(effort);
  const webSearchUnits = webSearchEnabled === true && providerToolsEnabled
    ? FABLE_CHAT_WEB_SEARCH_SURCHARGE_UNITS * webSearchMaxUses
    : 0;
  return {
    units: effortUnits + inputUnits + webSearchUnits,
    effortUnits,
    inputUnits,
    webSearchUnits,
    webSearchMaxUses,
    webFetchReservedTokens,
    estimatedInputBucketTokens: inputUnits * FABLE_CHAT_INPUT_UNIT_TOKENS,
  };
}

function fableChatBudgetOperation() {
  const registry = getAiCostOperationRegistryEntry(FABLE_CHAT_OPERATION_ID);
  const config = registry?.operationConfig || {};
  return {
    operationId: FABLE_CHAT_OPERATION_ID,
    featureKey: config.featureKey || "admin.ai.fable_chat",
    actorType: "admin",
    actorRole: "admin",
    budgetScope: registry?.budgetPolicy?.targetBudgetScope
      || ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    ownerDomain: "admin-fable-chat",
    providerFamily: config.providerFamily || "ai_worker",
    modelId: FABLE_CHAT_MODEL_ID,
    modelResolverKey: config.modelResolverKey || "admin.fable_chat.fixed_model",
    providerCost: true,
    estimatedCostUnits: Math.max(1, Number(config.creditCost || 1)),
    estimatedCredits: 0,
    idempotencyPolicy: "required",
    killSwitchPolicy: {
      flagName: FABLE_CHAT_BUDGET_SWITCH,
      defaultState: "disabled",
      requiredForProviderCall: true,
      disabledBehavior: "manual_only",
      operatorCanOverride: false,
      scope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      notes: "The private Fable chat reuses the Admin Text master and runtime budget switch.",
    },
    routeId: config.routeId || "admin.fable-chat.messages.send",
    routePath: config.routePath || FABLE_CHAT_SOURCE_ROUTE,
    auditEventPrefix: config.observabilityEventPrefix || FABLE_CHAT_OPERATION_ID,
    notes: "Server-authoritative Fable chat with durable result replay and platform budget caps.",
  };
}

export async function prepareFableChatBudget({
  env,
  adminUser,
  conversationId,
  message,
  retryMessageId = null,
  requestFingerprint,
  settings,
  context,
  correlationId = null,
}) {
  const operation = fableChatBudgetOperation();
  const plan = classifyAdminPlatformBudgetPlan({
    operation,
    actorUserId: adminUser.id,
    actorRole: "admin",
    modelId: FABLE_CHAT_MODEL_ID,
    reason: "admin_fable_chat_durable_result_replay",
    correlationId,
  });
  if (!plan.ok) {
    const error = new Error("Fable chat budget policy is unavailable.");
    error.code = "fable_chat_budget_policy_unavailable";
    error.status = 503;
    throw error;
  }
  await assertBudgetSwitchEffectiveEnabled(env, plan);
  const budgetWeight = deriveFableChatBudgetUnits({
    effort: settings?.effort,
    estimatedInputTokens: context?.estimatedInputTokens,
    webSearchEnabled: settings?.webSearchEnabled,
    webFetchEnabled: settings?.webFetchEnabled,
    toolChoice: settings?.toolChoice,
  });
  const budgetFingerprint = await buildAdminPlatformBudgetFingerprint({
    operation,
    actorId: adminUser.id,
    budgetScopeId: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    modelId: FABLE_CHAT_MODEL_ID,
    routeId: operation.routeId,
    routePath: operation.routePath,
    body: {
      conversation_id: conversationId,
      message,
      retry_message_id: retryMessageId,
      effort: settings?.effort,
      effective_max_output_tokens: settings?.effectiveMaxOutputTokens,
      system_preset_id: settings?.systemPresetId,
      system_preset_version: settings?.systemPresetVersion,
      thinking_display: settings?.thinkingDisplay,
      prompt_cache_policy: settings?.promptCachePolicy,
      prompt_cache_version: settings?.promptCacheVersion,
      context_format_version: context?.contextFormatVersion,
      estimated_input_bucket_tokens: budgetWeight.estimatedInputBucketTokens,
      web_search_enabled: settings?.webSearchEnabled === true,
      web_search_tool_version: settings?.webSearchToolVersion,
      web_search_max_uses: settings?.webSearchMaxUses,
      web_search_contract_version: settings?.webSearchContractVersion,
      web_search_caller_mode: settings?.webSearchCallerMode,
      web_search_allowed_callers: settings?.webSearchAllowedCallers,
      web_search_response_inclusion_preference: settings?.webSearchResponseInclusion,
      web_search_effective_response_inclusion:
        settings?.webSearchEffectiveResponseInclusion,
      web_search_domain_filter_mode: settings?.webSearchDomainFilterMode,
      web_search_allowed_domains: settings?.webSearchAllowedDomains,
      web_search_blocked_domains: settings?.webSearchBlockedDomains,
      web_search_location_enabled: settings?.webSearchLocationEnabled === true,
      web_search_location: settings?.webSearchLocation,
      tool_choice: settings?.toolChoice,
      web_fetch_enabled: settings?.webFetchEnabled === true,
      web_fetch_tool_version: settings?.webFetchToolVersion,
      web_fetch_max_uses: settings?.webFetchMaxUses,
      web_fetch_max_content_tokens: settings?.webFetchMaxContentTokens,
      web_fetch_allowed_callers: settings?.webFetchAllowedCallers,
      web_fetch_use_cache: settings?.webFetchUseCache,
      web_fetch_contract_version: settings?.webFetchContractVersion,
      memory_mode: settings?.memoryMode,
      memory_contract_version: context?.memory?.contractVersion,
      memory_checkpoint_id: context?.memory?.checkpointId,
      memory_checkpoint_version: context?.memory?.checkpointVersion,
    },
    hashFields: ["message"],
  });
  const capCheck = await checkPlatformBudgetCap(env, {
    budgetScope: plan.budgetScope,
    operationKey: FABLE_CHAT_OPERATION_ID,
    units: budgetWeight.units,
    sourceRoute: FABLE_CHAT_SOURCE_ROUTE,
    actorUserId: adminUser.id,
    actorRole: "admin",
  });
  const callerPolicy = {
    policy_version: AI_CALLER_POLICY_VERSION,
    operation_id: FABLE_CHAT_OPERATION_ID,
    budget_scope: AI_CALLER_POLICY_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    enforcement_status: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_METADATA_ONLY,
    caller_class: AI_CALLER_POLICY_CALLER_CLASSES.ADMIN,
    owner_domain: "admin-fable-chat",
    provider_family: operation.providerFamily,
    model_id: FABLE_CHAT_MODEL_ID,
    model_resolver_key: operation.modelResolverKey,
    idempotency_policy: "required",
    source_route: FABLE_CHAT_SOURCE_ROUTE,
    source_component: "auth-worker-admin-fable-chat",
    budget_fingerprint: budgetFingerprint,
    request_fingerprint: requestFingerprint,
    kill_switch_target: FABLE_CHAT_BUDGET_SWITCH,
    correlation_id: correlationId,
    reason: "admin_fable_chat_durable_result_replay",
    notes: "Auth Worker owns chat persistence, duplicate suppression, and weighted platform budget usage.",
  };
  return {
    callerPolicy,
    budgetFingerprint,
    budgetScope: plan.budgetScope,
    units: capCheck.requestedUnits,
    metadata: {
      phase: "van-ark-fable-chat-v4",
      source: "provider_attempt_admission",
      model_id: FABLE_CHAT_MODEL_ID,
      provider_family: "ai_worker",
      accounting_basis: "weighted_admitted_before_provider",
      effort: settings.effort,
      effective_max_output_tokens: Number(settings.effectiveMaxOutputTokens),
      estimated_input_bucket_tokens: budgetWeight.estimatedInputBucketTokens,
      effort_units: budgetWeight.effortUnits,
      input_units: budgetWeight.inputUnits,
      web_search_enabled: settings.webSearchEnabled === true,
      web_search_max_uses: budgetWeight.webSearchMaxUses,
      web_search_units: budgetWeight.webSearchUnits,
      web_search_tool_version: settings.webSearchToolVersion,
      web_search_contract_version: settings.webSearchContractVersion,
      web_search_caller_mode: settings.webSearchCallerMode,
      web_search_allowed_callers: settings.webSearchAllowedCallers,
      web_search_response_inclusion_preference: settings.webSearchResponseInclusion,
      web_search_effective_response_inclusion: settings.webSearchEffectiveResponseInclusion,
      web_search_domain_filter_mode: settings.webSearchDomainFilterMode,
      web_search_allowed_domains: settings.webSearchAllowedDomains,
      web_search_blocked_domains: settings.webSearchBlockedDomains,
      web_search_location_enabled: settings.webSearchLocationEnabled === true,
      web_search_location: settings.webSearchLocation,
      tool_choice: settings.toolChoice,
      web_fetch_enabled: settings.webFetchEnabled === true,
      web_fetch_max_uses: FABLE_CHAT_WEB_FETCH_MAX_USES,
      web_fetch_reserved_input_tokens: budgetWeight.webFetchReservedTokens,
      memory_mode: settings.memoryMode,
      memory_checkpoint_version: Math.max(0, Number(context?.memory?.checkpointVersion || 0)),
      final_state: "admitted",
    },
  };
}

export async function admitFableChatBudgetUsage({
  env,
  adminUserId,
  turnId,
  idempotencyKeyHash,
  requestFingerprint,
  units = 1,
  metadata = null,
}) {
  const requestedUnits = Math.max(1, Math.ceil(Number(units) || 1));
  const createdAt = nowIso();
  const windows = getPlatformBudgetWindows(createdAt);
  const eventId = `pbu_${randomTokenHex(16)}`;
  const metadataJson = JSON.stringify(metadata || {
    phase: "van-ark-fable-chat-v4",
    source: "provider_attempt_admission",
    model_id: FABLE_CHAT_MODEL_ID,
    provider_family: "ai_worker",
    accounting_basis: "weighted_admitted_before_provider",
    final_state: "admitted",
  });
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
    FABLE_CHAT_OPERATION_ID,
    FABLE_CHAT_SOURCE_ROUTE,
    adminUserId,
    requestedUnits,
    windows.day,
    windows.month,
    idempotencyKeyHash,
    requestFingerprint,
    turnId,
    metadataJson,
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
    turnId,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    FABLE_CHAT_OPERATION_ID
  ).first();
  if (existing) {
    return { admitted: true, replayed: true, eventId: existing.id, units: requestedUnits };
  }

  await checkPlatformBudgetCap(env, {
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    operationKey: FABLE_CHAT_OPERATION_ID,
    units: requestedUnits,
    sourceRoute: FABLE_CHAT_SOURCE_ROUTE,
    actorUserId: adminUserId,
    actorRole: "admin",
    now: createdAt,
  });
  throw new PlatformBudgetCapError("Platform budget admission could not be recorded.", {
    status: 503,
    code: "platform_budget_cap_store_unavailable",
    fields: {
      budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
      operationKey: FABLE_CHAT_OPERATION_ID,
      requestedUnits,
    },
  });
}

export async function recordFableChatBudgetOutcome(env, turnId, {
  finalState,
  stopReason = null,
  durationMs = null,
  outputTruncated = false,
  usage = null,
  webSearchRequestCount = 0,
  webFetchRequestCount = 0,
} = {}) {
  const safeState = ["succeeded", "failed", "unknown"].includes(finalState)
    ? finalState
    : "unknown";
  const safeStopReason = typeof stopReason === "string" && /^[a-z_]{1,40}$/.test(stopReason)
    ? stopReason
    : null;
  const safeDurationMs = durationMs != null && Number.isFinite(Number(durationMs))
    ? Math.max(0, Math.floor(Number(durationMs)))
    : null;
  const safeUsage = {};
  for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value) && value >= 0) safeUsage[key] = Math.floor(value);
  }
  const thinkingTokens = Number(usage?.output_tokens_details?.thinking_tokens);
  if (Number.isFinite(thinkingTokens) && thinkingTokens >= 0) {
    safeUsage.thinking_tokens = Math.floor(thinkingTokens);
  }
  const patch = {
    final_state: safeState,
    provider_stop_reason: safeStopReason,
    duration_ms: safeDurationMs,
    output_truncated: outputTruncated === true,
    ...safeUsage,
    web_search_request_count: Math.min(
      FABLE_CHAT_WEB_SEARCH_HARD_MAX_USES,
      Math.max(0, Math.floor(Number(webSearchRequestCount) || 0))
    ),
    web_fetch_request_count: Math.min(
      FABLE_CHAT_WEB_FETCH_MAX_USES,
      Math.max(0, Math.floor(Number(webFetchRequestCount) || 0))
    ),
  };
  await env.DB.prepare(
    `UPDATE platform_budget_usage_events
        SET metadata_json = json_patch(metadata_json, ?)
      WHERE source_attempt_id = ? AND budget_scope = ? AND operation_key = ?`
  ).bind(
    JSON.stringify(patch),
    turnId,
    ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    FABLE_CHAT_OPERATION_ID
  ).run();
}
