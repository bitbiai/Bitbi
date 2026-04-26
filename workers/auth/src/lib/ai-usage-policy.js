import { BillingError, billingErrorResponse, normalizeBillingIdempotencyKey, assertOrganizationFeatureEnabled, assertOrganizationHasCredits, assertUsageIdempotencyAvailable, consumeOrganizationCredits } from "./billing.js";
import { OrgRbacError, normalizeOrgId, orgRbacErrorResponse, requireOrgRole } from "./orgs.js";
import { sha256Hex } from "./tokens.js";

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
    return {
      mode: "legacy-user",
      organizationId: null,
      featureKey: resolvedOperation.featureKey,
      credits: 0,
      async chargeAfterSuccess() {
        return null;
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
  const existingUsage = await assertUsageIdempotencyAvailable({
    env,
    organizationId,
    userId: user?.id || null,
    featureKey: resolvedOperation.featureKey,
    quantity: resolvedOperation.quantity || 1,
    credits: resolvedOperation.credits,
    idempotencyKey,
    requestFingerprint,
  });
  if (!existingUsage) {
    await assertOrganizationHasCredits(env, {
      organizationId,
      credits: resolvedOperation.credits,
    });
  }

  return {
    mode: "organization",
    organizationId,
    featureKey: resolvedOperation.featureKey,
    credits: resolvedOperation.credits,
    idempotencyKey,
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
