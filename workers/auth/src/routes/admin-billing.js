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
  billingStorageUnavailableResponse,
  getAdminOrganizationBilling,
  getAdminUserBilling,
  grantMemberCredits,
  grantOrganizationCredits,
  isBillingStorageUnavailableError,
  listAdminPlans,
  normalizeBillingIdempotencyKey,
} from "../lib/billing.js";
import {
  BillingEventError,
  billingEventErrorResponse,
  getBillingProviderEvent,
  getBillingReconciliationReport,
  getBillingReviewEvent,
  listBillingProviderEvents,
  listBillingReviewEvents,
  resolveBillingReviewEvent,
} from "../lib/billing-events.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

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

function billingErrorJson(error, ctx = null) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  if (error instanceof BillingEventError) {
    return json(billingEventErrorResponse(error), { status: error.status });
  }
  if (isBillingStorageUnavailableError(error)) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-billing",
      event: "admin_billing_storage_unavailable",
      level: "error",
      correlationId: ctx?.correlationId || null,
      code: "billing_storage_unavailable",
      ...getErrorFields(error),
    });
    return json(billingStorageUnavailableResponse(), { status: 503 });
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

async function auditBillingEvent(ctx, adminUser, action, meta = {}, targetUserId = null) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId,
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
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;
  const isBillingRoute = pathname === "/api/admin/billing/plans"
    || pathname === "/api/admin/billing/events"
    || pathname === "/api/admin/billing/reconciliation"
    || pathname === "/api/admin/billing/reviews"
    || /^\/api\/admin\/billing\/events\/[^/]+$/.test(pathname)
    || /^\/api\/admin\/billing\/reviews\/[^/]+$/.test(pathname)
    || /^\/api\/admin\/billing\/reviews\/[^/]+\/resolution$/.test(pathname)
    || /^\/api\/admin\/orgs\/[^/]+\/billing$/.test(pathname)
    || /^\/api\/admin\/orgs\/[^/]+\/credits\/grant$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/billing$/.test(pathname)
    || /^\/api\/admin\/users\/[^/]+\/credits\/grant$/.test(pathname);
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

  if (pathname === "/api/admin/billing/events" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const events = await listBillingProviderEvents(env, {
        provider: url.searchParams.get("provider"),
        status: url.searchParams.get("status"),
        eventType: url.searchParams.get("event_type") || url.searchParams.get("eventType"),
        organizationId: url.searchParams.get("organization_id") || url.searchParams.get("organizationId"),
        limit: url.searchParams.get("limit"),
      });
      return json({ ok: true, events, livePaymentProviderEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  if (pathname === "/api/admin/billing/reconciliation" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const report = await getBillingReconciliationReport(env);
      return json(report);
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  if (pathname === "/api/admin/billing/reviews" && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const result = await listBillingReviewEvents(env, {
        reviewState: url.searchParams.get("review_state") || url.searchParams.get("reviewState"),
        provider: url.searchParams.get("provider"),
        providerMode: url.searchParams.get("provider_mode") || url.searchParams.get("providerMode"),
        eventType: url.searchParams.get("event_type") || url.searchParams.get("eventType"),
        limit: url.searchParams.get("limit"),
      });
      return json({
        ok: true,
        reviews: result.reviews,
        nextCursor: result.nextCursor,
        livePaymentProviderEnabled: false,
      });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const eventMatch = pathname.match(/^\/api\/admin\/billing\/events\/([^/]+)$/);
  if (eventMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const event = await getBillingProviderEvent(env, { id: eventMatch[1] });
      return json({ ok: true, event, livePaymentProviderEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const reviewMatch = pathname.match(/^\/api\/admin\/billing\/reviews\/([^/]+)$/);
  if (reviewMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const review = await getBillingReviewEvent(env, { id: reviewMatch[1] });
      return json({
        ok: true,
        review,
        livePaymentProviderEnabled: false,
      });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const reviewResolutionMatch = pathname.match(/^\/api\/admin\/billing\/reviews\/([^/]+)\/resolution$/);
  // route-policy: admin.billing.reviews.resolve
  if (reviewResolutionMatch && method === "POST") {
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
      const result = await resolveBillingReviewEvent(env, {
        id: reviewResolutionMatch[1],
        resolutionStatus: parsed.body?.resolution_status || parsed.body?.resolutionStatus,
        resolutionNote: parsed.body?.resolution_note || parsed.body?.resolutionNote,
        resolvedByUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, `billing_review_${result.review.resolutionStatus}`, {
          billing_event_id: result.review.billingEventId,
          provider: result.review.provider,
          provider_mode: result.review.providerMode,
          event_type: result.review.eventType,
          provider_event_id: result.review.providerEventId,
          review_state: result.review.reviewState,
          previous_review_state: result.review.actionSummary?.previousReviewState || null,
        });
      }
      return json({ ok: true, ...result, sideEffectsEnabled: false });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
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
      return billingErrorJson(error, ctx);
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
      return billingErrorJson(error, ctx);
    }
  }

  const userBillingMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/billing$/);
  if (userBillingMatch && method === "GET") {
    const limited = await enforceAdminBillingRateLimit(ctx);
    if (limited) return limited;
    try {
      const billing = await getAdminUserBilling(env, {
        userId: decodeURIComponent(userBillingMatch[1]),
      });
      return json({ ok: true, billing });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  const userGrantMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/credits\/grant$/);
  // route-policy: admin.users.credits.grant
  if (userGrantMatch && method === "POST") {
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

    const targetUserId = decodeURIComponent(userGrantMatch[1]);
    try {
      const result = await grantMemberCredits({
        env,
        userId: targetUserId,
        amount: parsed.body?.amount,
        reason: parsed.body?.reason,
        createdByUserId: session.user.id,
        idempotencyKey: idempotency.key,
      });
      if (!result.reused) {
        await auditBillingEvent(ctx, session.user, "user_credit_granted", {
          user_id: targetUserId,
          amount: result.ledgerEntry.amount,
          balance_after: result.ledgerEntry.balanceAfter,
        }, targetUserId);
      }
      return json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
    } catch (error) {
      return billingErrorJson(error, ctx);
    }
  }

  return null;
}
