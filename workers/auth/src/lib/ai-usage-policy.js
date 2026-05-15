import {
  BillingError,
  MEMBER_DAILY_CREDIT_ALLOWANCE,
  assertMemberHasCredits,
  assertOrganizationFeatureEnabled,
  billingErrorResponse,
  buildMemberUsageRequestHash,
  consumeMemberCredits,
  consumeOrganizationCredits,
  fetchMemberUsageByIdempotency,
  getMemberCreditBalance,
  normalizeBillingIdempotencyKey,
  topUpMemberDailyCredits,
} from "./billing.js";
import {
  beginAiUsageAttempt,
  billingMetadataFromAttempt,
  markAiUsageAttemptBillingFailed,
  markAiUsageAttemptFinalizing,
  markAiUsageAttemptProviderFailed,
  markAiUsageAttemptProviderRunning,
  markAiUsageAttemptSucceeded,
} from "./ai-usage-attempts.js";
import {
  beginMemberAiUsageAttempt,
  billingMetadataFromMemberAttempt,
  markMemberAiUsageAttemptBillingFailed,
  markMemberAiUsageAttemptFinalizing,
  markMemberAiUsageAttemptProviderFailed,
  markMemberAiUsageAttemptProviderRunning,
  markMemberAiUsageAttemptSucceeded,
} from "./member-ai-usage-attempts.js";
import {
  AI_COST_GATEWAY_PHASES,
  AiCostGatewayError,
  createAiCostGatewayPlan,
} from "./ai-cost-gateway.js";
import { getAiCostOperationConfig } from "./ai-cost-operations.js";
import { OrgRbacError, normalizeOrgId, orgRbacErrorResponse, requireOrgRole } from "./orgs.js";
import { sha256Hex } from "./tokens.js";
import { MINIMAX_MUSIC_2_6_BASE_CREDITS } from "../../../../js/shared/music-2-6-pricing.mjs";

export const AI_USAGE_OPERATIONS = Object.freeze({
  MEMBER_IMAGE_GENERATE: Object.freeze({
    id: "member.image.generate",
    featureKey: "ai.image.generate",
    credits: 1,
    quantity: 1,
    minRole: "member",
  }),
  MEMBER_TEXT_GENERATE: Object.freeze({
    id: "member.text.generate",
    featureKey: "ai.text.generate",
    credits: 1,
    quantity: 1,
    minRole: "member",
  }),
  MEMBER_VIDEO_GENERATE: Object.freeze({
    id: "member.video.generate",
    featureKey: "ai.video.generate",
    credits: 5,
    quantity: 1,
    minRole: "member",
  }),
  MEMBER_MUSIC_GENERATE: Object.freeze({
    id: "member.music.generate",
    featureKey: "ai.music.generate",
    credits: MINIMAX_MUSIC_2_6_BASE_CREDITS,
    quantity: 1,
    minRole: "member",
    source: "member_music_generation",
  }),
});

const ORG_CONTEXT_FIELDS = new Set(["organization_id", "organizationId"]);

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

function fingerprintBody(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => fingerprintBody(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (ORG_CONTEXT_FIELDS.has(key)) continue;
      out[key] = fingerprintBody(value[key]);
    }
    return out;
  }
  return value;
}

function resolveOperation(operation) {
  if (typeof operation === "string" && AI_USAGE_OPERATIONS[operation]) {
    return AI_USAGE_OPERATIONS[operation];
  }
  if (operation && typeof operation === "object" && operation.featureKey) {
    return operation;
  }
  throw new BillingError("Unsupported AI usage operation.", {
    status: 400,
    code: "unsupported_ai_usage_operation",
  });
}

function hasOrganizationContext(body) {
  return Boolean(body && typeof body === "object" && (
    Object.prototype.hasOwnProperty.call(body, "organization_id") ||
    Object.prototype.hasOwnProperty.call(body, "organizationId")
  ));
}

function rawOrganizationId(body) {
  if (Object.prototype.hasOwnProperty.call(body, "organization_id")) return body.organization_id;
  return body.organizationId;
}

async function buildRequestFingerprint({ route, operation, organizationId, body }) {
  return sha256Hex(stableJson({
    version: 1,
    route,
    operation: operation.id,
    featureKey: operation.featureKey,
    organizationId,
    body: fingerprintBody(body),
  }));
}

async function buildMemberRequestFingerprint({ route, operation, userId, body }) {
  return sha256Hex(stableJson({
    version: 1,
    route,
    operation: operation.id,
    featureKey: operation.featureKey,
    userId: userId || null,
    body: fingerprintBody(body),
  }));
}

async function buildScopedIdempotencyKey({ clientKey, route, operation, organizationId, userId }) {
  const digest = await sha256Hex(stableJson({
    version: 1,
    kind: "ai-usage",
    clientKey,
    route,
    operation: operation.id,
    organizationId,
    userId: userId || null,
  }));
  return `ai:${digest}`;
}

export function aiUsagePolicyErrorResponse(error) {
  if (error instanceof BillingError) {
    return {
      status: error.status || 400,
      body: billingErrorResponse(error),
    };
  }
  if (error instanceof OrgRbacError) {
    const body = orgRbacErrorResponse(error);
    return {
      status: body.status || error.status || 400,
      body,
    };
  }
  return {
    status: 503,
    body: {
      ok: false,
      error: "AI usage policy could not be verified.",
      code: "ai_usage_policy_unavailable",
    },
  };
}

function aiCostGatewayErrorToBillingError(error) {
  if (error instanceof BillingError) return error;
  if (error instanceof AiCostGatewayError) {
    return new BillingError(error.message, {
      status: error.status || 400,
      code: error.code || "ai_cost_gateway_error",
    });
  }
  return error;
}

async function prepareMemberGatewayPolicy({
  env,
  request,
  user,
  body,
  resolvedOperation,
  route,
}) {
  const operationConfig = getAiCostOperationConfig(resolvedOperation.id);
  if (!operationConfig) {
    throw new BillingError("AI cost operation is not registered.", {
      status: 503,
      code: "ai_cost_operation_unavailable",
    });
  }

  let gatewayPlan;
  try {
    gatewayPlan = await createAiCostGatewayPlan({
      operationConfig: {
        ...operationConfig,
        creditCost: resolvedOperation.credits,
        quantity: resolvedOperation.quantity || operationConfig.quantity || 1,
      },
      routePath: route,
      routeId: operationConfig.routeId,
      actorId: user?.id || null,
      billingScopeId: user?.id || null,
      modelId: resolvedOperation.modelId || body?.model || operationConfig.modelId || operationConfig.modelResolverKey || null,
      providerFamily: operationConfig.providerFamily,
      clientIdempotencyKey: request.headers.get("Idempotency-Key"),
      body,
      includePromptHash: true,
      hashFields: ["prompt", "lyrics", "negativePrompt", "negative_prompt", "referenceImages"],
      excludeOrganizationContextAliases: true,
      excludeFields: ["csrf", "csrfToken", "authToken", "authorization", "cookie"],
    });
  } catch (error) {
    throw aiCostGatewayErrorToBillingError(error);
  }

  if (gatewayPlan.state === AI_COST_GATEWAY_PHASES.REQUIRES_IDEMPOTENCY) {
    throw new BillingError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  if (!gatewayPlan.scopedIdempotencyKey) {
    throw new BillingError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }

  const attemptState = await beginMemberAiUsageAttempt({
    env,
    userId: user?.id || null,
    featureKey: resolvedOperation.featureKey,
    operationKey: resolvedOperation.id,
    route,
    idempotencyKey: gatewayPlan.scopedIdempotencyKey,
    requestFingerprint: gatewayPlan.fingerprint,
    creditCost: resolvedOperation.credits,
    quantity: resolvedOperation.quantity || 1,
    metadata: {
      gateway_version: gatewayPlan.gatewayVersion,
      operation_id: gatewayPlan.operationId,
      route,
      replay_policy: gatewayPlan.replayPolicy,
      ...(resolvedOperation.id === AI_USAGE_OPERATIONS.MEMBER_MUSIC_GENERATE.id ? {
        bundled_sub_operations: [
          "member.music.lyrics.generate",
          "member.music.audio.generate",
          "member.music.cover.generate",
        ],
        cover_generation_policy: "included_in_parent_music_bundle",
      } : {}),
    },
    beforeReserve: () => topUpMemberDailyCredits({
      env,
      userId: user?.id || null,
    }),
  });

  return {
    mode: "member",
    gatewayMode: "ai-cost-pilot",
    organizationId: null,
    featureKey: resolvedOperation.featureKey,
    credits: resolvedOperation.credits,
    attemptKind: attemptState.kind,
    attempt: attemptState.attempt,
    idempotencyKey: gatewayPlan.scopedIdempotencyKey,
    requestFingerprint: gatewayPlan.fingerprint,
    dailyCreditAllowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
    gatewayPlan,
    async prepareForProvider() {
      return {
        topUp: attemptState.preparation || null,
        balanceBefore: null,
        idempotentReplay: false,
      };
    },
    async markProviderRunning() {
      return markMemberAiUsageAttemptProviderRunning(env, attemptState.attempt.id);
    },
    async markProviderFailed({ code = "provider_failed", message = null } = {}) {
      return markMemberAiUsageAttemptProviderFailed(env, attemptState.attempt.id, { code, message });
    },
    async markFinalizing() {
      return markMemberAiUsageAttemptFinalizing(env, attemptState.attempt.id);
    },
    async markBillingFailed({ code = "billing_failed", message = null } = {}) {
      return markMemberAiUsageAttemptBillingFailed(env, attemptState.attempt.id, { code, message });
    },
    async markSucceeded(result = {}) {
      return markMemberAiUsageAttemptSucceeded(env, attemptState.attempt.id, result);
    },
    billingMetadata({ replay = false, balanceAfter = null } = {}) {
      return billingMetadataFromMemberAttempt(
        {
          ...attemptState.attempt,
          balanceAfter: balanceAfter == null ? attemptState.attempt.balanceAfter : balanceAfter,
        },
        { replay }
      );
    },
    async chargeAfterSuccess(metadata = {}) {
      const result = await consumeMemberCredits({
        env,
        userId: user?.id || null,
        featureKey: resolvedOperation.featureKey,
        quantity: resolvedOperation.quantity || 1,
        credits: resolvedOperation.credits,
        idempotencyKey: gatewayPlan.scopedIdempotencyKey,
        requestFingerprint: gatewayPlan.fingerprint,
        metadata: {
          route,
          operation: resolvedOperation.id,
          gateway_version: gatewayPlan.gatewayVersion,
          ...metadata,
        },
        source: resolvedOperation.source || "member_image_generation",
      });
      return {
        user_id: user?.id || null,
        feature: resolvedOperation.featureKey,
        credits_charged: resolvedOperation.credits,
        balance_after: result.creditBalance,
        daily_credit_allowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
      };
    },
  };
}

export async function prepareAiUsagePolicy({
  env,
  request,
  user,
  body,
  operation,
  route,
}) {
  const resolvedOperation = resolveOperation(operation);
  if (!hasOrganizationContext(body)) {
    if (user?.role === "admin") {
      return {
        mode: "admin-legacy",
        organizationId: null,
        featureKey: resolvedOperation.featureKey,
        credits: 0,
        async prepareForProvider() {
          return null;
        },
        async chargeAfterSuccess() {
          return null;
        },
      };
    }

    if (
      resolvedOperation.id === AI_USAGE_OPERATIONS.MEMBER_IMAGE_GENERATE.id ||
      resolvedOperation.id === AI_USAGE_OPERATIONS.MEMBER_MUSIC_GENERATE.id
    ) {
      return prepareMemberGatewayPolicy({
        env,
        request,
        user,
        body,
        resolvedOperation,
        route,
      });
    }

    const requestFingerprint = await buildMemberRequestFingerprint({
      route,
      operation: resolvedOperation,
      userId: user?.id || null,
      body,
    });
    const rawClientIdempotencyKey = request.headers.get("Idempotency-Key");
    const clientIdempotencyKey = rawClientIdempotencyKey
      ? normalizeBillingIdempotencyKey(rawClientIdempotencyKey)
      : null;
    const idempotencyKey = clientIdempotencyKey
      ? await buildScopedIdempotencyKey({
        clientKey: clientIdempotencyKey,
        route,
        operation: resolvedOperation,
        organizationId: null,
        userId: user?.id || null,
      })
      : null;
    return {
      mode: "member",
      organizationId: null,
      featureKey: resolvedOperation.featureKey,
      credits: resolvedOperation.credits,
      idempotencyKey,
      dailyCreditAllowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
      async prepareForProvider() {
        if (idempotencyKey) {
          const existingUsage = await fetchMemberUsageByIdempotency(env, {
            userId: user?.id || null,
            idempotencyKey,
          });
          if (existingUsage) {
            const expectedRequestHash = await buildMemberUsageRequestHash({
              userId: user?.id || null,
              featureKey: resolvedOperation.featureKey,
              quantity: resolvedOperation.quantity || 1,
              credits: resolvedOperation.credits,
              requestFingerprint,
            });
            if (existingUsage.request_hash !== expectedRequestHash) {
              throw new BillingError("Idempotency-Key conflicts with a different usage request.", {
                status: 409,
                code: "idempotency_conflict",
              });
            }
            return {
              topUp: null,
              balanceBefore: await getMemberCreditBalance(env, user?.id || null),
              idempotentReplay: true,
            };
          }
        }
        const topUp = await topUpMemberDailyCredits({
          env,
          userId: user?.id || null,
        });
        const availability = await assertMemberHasCredits(env, {
          userId: user?.id || null,
          credits: resolvedOperation.credits,
        });
        return {
          topUp,
          balanceBefore: availability.balance,
        };
      },
      async chargeAfterSuccess(metadata = {}) {
        const result = await consumeMemberCredits({
          env,
          userId: user?.id || null,
          featureKey: resolvedOperation.featureKey,
          quantity: resolvedOperation.quantity || 1,
          credits: resolvedOperation.credits,
          idempotencyKey,
          requestFingerprint,
          metadata: {
            route,
            operation: resolvedOperation.id,
            ...metadata,
          },
          source: resolvedOperation.source || "member_image_generation",
        });
        return {
          user_id: user?.id || null,
          feature: resolvedOperation.featureKey,
          credits_charged: resolvedOperation.credits,
          balance_after: result.creditBalance,
          daily_credit_allowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
        };
      },
    };
  }

  const organizationId = normalizeOrgId(rawOrganizationId(body));
  const clientIdempotencyKey = normalizeBillingIdempotencyKey(request.headers.get("Idempotency-Key"));
  await requireOrgRole(env, {
    organizationId,
    userId: user?.id,
    minRole: resolvedOperation.minRole || "member",
  });
  await assertOrganizationFeatureEnabled(env, {
    organizationId,
    featureKey: resolvedOperation.featureKey,
  });

  const requestFingerprint = await buildRequestFingerprint({
    route,
    operation: resolvedOperation,
    organizationId,
    body,
  });
  const idempotencyKey = await buildScopedIdempotencyKey({
    clientKey: clientIdempotencyKey,
    route,
    operation: resolvedOperation,
    organizationId,
    userId: user?.id || null,
  });
  const attemptState = await beginAiUsageAttempt({
    env,
    organizationId,
    userId: user?.id || null,
    featureKey: resolvedOperation.featureKey,
    operationKey: resolvedOperation.id,
    route,
    idempotencyKey,
    requestFingerprint,
    creditCost: resolvedOperation.credits,
    quantity: resolvedOperation.quantity || 1,
  });

  return {
    mode: "organization",
    organizationId,
    featureKey: resolvedOperation.featureKey,
    credits: resolvedOperation.credits,
    attemptKind: attemptState.kind,
    attempt: attemptState.attempt,
    idempotencyKey,
    async markProviderRunning() {
      return markAiUsageAttemptProviderRunning(env, attemptState.attempt.id);
    },
    async markProviderFailed({ code = "provider_failed", message = null } = {}) {
      return markAiUsageAttemptProviderFailed(env, attemptState.attempt.id, { code, message });
    },
    async markFinalizing() {
      return markAiUsageAttemptFinalizing(env, attemptState.attempt.id);
    },
    async markBillingFailed({ code = "billing_failed", message = null } = {}) {
      return markAiUsageAttemptBillingFailed(env, attemptState.attempt.id, { code, message });
    },
    async markSucceeded(result = {}) {
      return markAiUsageAttemptSucceeded(env, attemptState.attempt.id, result);
    },
    billingMetadata({ replay = false, balanceAfter = null } = {}) {
      return billingMetadataFromAttempt(
        {
          ...attemptState.attempt,
          balanceAfter: balanceAfter == null ? attemptState.attempt.balanceAfter : balanceAfter,
        },
        { replay }
      );
    },
    async chargeAfterSuccess(metadata = {}) {
      const result = await consumeOrganizationCredits({
        env,
        organizationId,
        userId: user?.id || null,
        featureKey: resolvedOperation.featureKey,
        quantity: resolvedOperation.quantity || 1,
        credits: resolvedOperation.credits,
        idempotencyKey,
        requestFingerprint,
        metadata: {
          route,
          operation: resolvedOperation.id,
          ...metadata,
        },
      });
      return {
        organization_id: organizationId,
        feature: resolvedOperation.featureKey,
        credits_charged: resolvedOperation.credits,
        balance_after: result.creditBalance,
      };
    },
  };
}
