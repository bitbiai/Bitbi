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
import { nowIso, randomTokenHex } from "./tokens.js";

export const FABLE_CHAT_OPERATION_ID = "admin.fable_chat.send";
export const FABLE_CHAT_SOURCE_ROUTE = "/api/admin/fable-chat/conversations/:id/messages";
export const FABLE_CHAT_INTERNAL_PATH = "/internal/ai/fable-chat";
export const FABLE_CHAT_BUDGET_SWITCH = "ENABLE_ADMIN_AI_TEXT_BUDGET";

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
    },
    hashFields: ["message"],
  });
  const capCheck = await checkPlatformBudgetCap(env, {
    budgetScope: plan.budgetScope,
    operationKey: FABLE_CHAT_OPERATION_ID,
    units: plan.estimatedCostUnits || 1,
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
    notes: "Auth Worker owns chat persistence, duplicate suppression, and platform budget usage.",
  };
  return {
    callerPolicy,
    budgetFingerprint,
    budgetScope: plan.budgetScope,
    units: capCheck.requestedUnits,
  };
}

export async function admitFableChatBudgetUsage({
  env,
  adminUserId,
  turnId,
  idempotencyKeyHash,
  requestFingerprint,
  units = 1,
}) {
  const requestedUnits = Math.max(1, Math.ceil(Number(units) || 1));
  const createdAt = nowIso();
  const windows = getPlatformBudgetWindows(createdAt);
  const eventId = `pbu_${randomTokenHex(16)}`;
  const metadataJson = JSON.stringify({
    phase: "van-ark-fable-chat-v1",
    source: "provider_attempt_admission",
    model_id: FABLE_CHAT_MODEL_ID,
    provider_family: "ai_worker",
    accounting_basis: "admitted_before_provider",
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
