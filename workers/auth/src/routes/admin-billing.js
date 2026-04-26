import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { requireAdmin } from "../lib/session.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  BillingError,
  billingErrorResponse,
  getAdminOrganizationBilling,
  grantOrganizationCredits,
  listAdminPlans,
  normalizeBillingIdempotencyKey,
} from "../lib/billing.js";

async function enforceAdminBillingRateLimit(ctx, {
  scope = "admin-billing-read-ip",
  maxRequests = 120,
  windowMs = 15 * 60_000,
  component = "admin-billing",
} = {}) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    scope,
    getClientIp(ctx.request),
    maxRequests,
    windowMs,
    sensitiveRateLimitOptions({
      component,
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

function billingErrorJson(error) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  throw error;
}

function idempotencyKeyOrResponse(request) {
  try {
    return {
      key: normalizeBillingIdempotencyKey(request.headers.get("Idempotency-Key")),
      response: null,
    };
  } catch (error) {
    if (error instanceof BillingError) {
      return {
        key: null,
        response: json(billingErrorResponse(error), { status: error.status }),
      };
    }
    throw error;
  }
}

async function auditBillingEvent(ctx, adminUser, action, meta = {}) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId: null,
      meta: {
        ...meta,
        actor_email: adminUser.email,
      },
    },
    {
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

export async function handleAdminBilling(ctx) {
  const { request, env, pathname, method, isSecure, correlationId } = ctx;
  const isBillingRoute = pathname === "/api/admin/billing/plans"
    || /^\/api\/admin\/orgs\/[^/]+\/billing$/.test(pathname)
    || /^\/api\/admin\/orgs\/[^/]+\/credits\/grant$/.test(pathname);
  if (!isBillingRoute) return null;

  const session = await requireAdmin(request, env, {
    isSecure,
    correlationId,
  });
  if (session instanceof Response) return session;

  if (pathname === "/api/admin/billing/plans" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    const plans = await listAdminPlans(env);
    return json({ ok: true, plans, livePaymentProviderEnabled: false });
  }

  const billingMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/billing$/);
  if (billingMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const billing = await getAdminOrganizationBilling(env, {
        organizationId: billingMatch[1],
      });
      return json({ ok: true, billing });
    } catch (error) {
      return billingErrorJson(error);
    }
  }

  const grantMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/credits\/grant$/);
  // route-policy: admin.orgs.credits.grant
  if (grantMatch && method === "POST") {
    const limited = await enforceAdminBillingRateLimit(ctx, {
      scope: "admin-billing-write-ip",
      maxRequests: 30,
      windowMs: 15 * 60_000,
      component: "admin-billing-write",
    });
    if (limited) return limited;

    const idempotency = idempotencyKeyOrResponse(request);
    if (idempotency.response) return idempotency.response;

    const parsed = await readJsonBodyOrResponse(request, {
      maxBytes: BODY_LIMITS.smallJson,
    });
    if (parsed.response) return parsed.response;

    try {
      const result = await grantOrganizationCredits({
        env,
        organizationId: grantMatch[1],
        amount: parsed.body?.amount,
        reason: parsed.body?.reason,
        createdByUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, "organization_credit_granted", {
          organization_id: grantMatch[1],
          amount: result.ledgerEntry.amount,
          balance_after: result.ledgerEntry.balanceAfter,
        });
      }
      return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error);
    }
  }

  return null;
}
