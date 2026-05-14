import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import {
  BillingError,
  billingErrorResponse,
  billingStorageUnavailableResponse,
  getMemberCreditsDashboard,
  isBillingStorageUnavailableError,
} from "../lib/billing.js";
import {
  StripeBillingError,
  cancelStripeLiveMemberSubscriptionAtPeriodEnd,
  createStripeLiveMemberCreditPackCheckout,
  createStripeLiveMemberSubscriptionCheckout,
  getMemberLiveCreditsPurchaseContext,
  reactivateStripeLiveMemberSubscription,
  stripeBillingErrorResponse,
} from "../lib/stripe-billing.js";
import { BODY_LIMITS, readJsonBodyOrResponse } from "../lib/request.js";
import { enforceSensitiveUserRateLimit } from "../lib/sensitive-write-limit.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

function creditsErrorResponse(error, { correlationId = null, userId = null } = {}) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  if (error instanceof StripeBillingError) {
    return json(stripeBillingErrorResponse(error), { status: error.status });
  }
  if (isBillingStorageUnavailableError(error)) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "account-credits",
      event: "member_credits_dashboard_unavailable",
      level: "error",
      correlationId,
      user_id: userId,
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
      key: request.headers.get("Idempotency-Key"),
      response: null,
    };
  } catch {
    return {
      key: null,
      response: json({ ok: false, error: "A valid Idempotency-Key header is required.", code: "idempotency_key_required" }, { status: 428 }),
    };
  }
}

async function handleMemberLiveCreditPackCheckout(ctx, session) {
  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "account-billing-live-checkout-user",
    userId: session.user.id,
    maxRequests: 10,
    windowMs: 15 * 60_000,
    component: "account-billing-live-checkout",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;

  try {
    const result = await createStripeLiveMemberCreditPackCheckout({
      env: ctx.env,
      userId: session.user.id,
      packId: parsed.body?.pack_id || parsed.body?.packId,
      idempotencyKey: idempotency.key,
      legalAcceptance: {
        termsAccepted: parsed.body?.terms_accepted === true || parsed.body?.termsAccepted === true,
        termsVersion: parsed.body?.terms_version || parsed.body?.termsVersion,
        immediateDeliveryAccepted: parsed.body?.immediate_delivery_accepted === true || parsed.body?.immediateDeliveryAccepted === true,
        acceptedAt: parsed.body?.accepted_at || parsed.body?.acceptedAt || null,
      },
    });
    return json({
      ok: true,
      reused: result.reused,
      checkout_url: result.checkout.checkoutUrl,
      session_id: result.checkout.sessionId,
      mode: result.checkout.providerMode,
      checkout_scope: "member",
      authorization_scope: result.checkout.authorizationScope,
      credit_pack: result.creditPack,
      livePaymentProviderEnabled: true,
    }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return creditsErrorResponse(error, {
      correlationId: ctx.correlationId,
      userId: session.user.id,
    });
  }
}

async function handleMemberLiveSubscriptionCheckout(ctx, session) {
  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "account-billing-live-subscription-checkout-user",
    userId: session.user.id,
    maxRequests: 10,
    windowMs: 15 * 60_000,
    component: "account-billing-live-subscription-checkout",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;

  try {
    const result = await createStripeLiveMemberSubscriptionCheckout({
      env: ctx.env,
      userId: session.user.id,
      idempotencyKey: idempotency.key,
      legalAcceptance: {
        termsAccepted: parsed.body?.terms_accepted === true || parsed.body?.termsAccepted === true,
        termsVersion: parsed.body?.terms_version || parsed.body?.termsVersion,
        immediateDeliveryAccepted: parsed.body?.immediate_delivery_accepted === true || parsed.body?.immediateDeliveryAccepted === true,
        acceptedAt: parsed.body?.accepted_at || parsed.body?.acceptedAt || null,
      },
    });
    return json({
      ok: true,
      reused: result.reused,
      checkout_url: result.checkout.checkoutUrl,
      session_id: result.checkout.sessionId,
      mode: result.checkout.providerMode,
      checkout_scope: "member_subscription",
      authorization_scope: result.checkout.authorizationScope,
      subscription_plan: result.checkout.plan,
      livePaymentProviderEnabled: true,
    }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return creditsErrorResponse(error, {
      correlationId: ctx.correlationId,
      userId: session.user.id,
    });
  }
}

async function handleMemberSubscriptionManagement(ctx, session, action) {
  const limited = await enforceSensitiveUserRateLimit(ctx, {
    scope: "account-billing-live-subscription-manage-user",
    userId: session.user.id,
    maxRequests: 8,
    windowMs: 15 * 60_000,
    component: "account-billing-live-subscription-manage",
  });
  if (limited) return limited;

  const idempotency = idempotencyKeyOrResponse(ctx.request);
  if (idempotency.response) return idempotency.response;

  const parsed = await readJsonBodyOrResponse(ctx.request, {
    maxBytes: BODY_LIMITS.smallJson,
  });
  if (parsed.response) return parsed.response;
  if (parsed.body?.confirmed !== true && parsed.body?.confirm !== true) {
    return json({
      ok: false,
      error: "Subscription management confirmation is required.",
      code: "subscription_confirmation_required",
    }, { status: 400 });
  }

  try {
    const result = action === "reactivate"
      ? await reactivateStripeLiveMemberSubscription({
          env: ctx.env,
          userId: session.user.id,
          idempotencyKey: idempotency.key,
        })
      : await cancelStripeLiveMemberSubscriptionAtPeriodEnd({
          env: ctx.env,
          userId: session.user.id,
          idempotencyKey: idempotency.key,
        });
    return json({
      ok: true,
      action,
      reused: result.reused,
      subscription: result.subscription,
    });
  } catch (error) {
    return creditsErrorResponse(error, {
      correlationId: ctx.correlationId,
      userId: session.user.id,
    });
  }
}

export async function handleAccountCredits(ctx) {
  const { request, env, pathname, method, url, correlationId } = ctx;
  const isDashboard = pathname === "/api/account/credits-dashboard" && method === "GET";
  const isLiveCheckout = pathname === "/api/account/billing/checkout/live-credit-pack" && method === "POST";
  const isSubscriptionCheckout = pathname === "/api/account/billing/checkout/subscription" && method === "POST";
  const isSubscriptionCancel = pathname === "/api/account/billing/subscription/cancel" && method === "POST";
  const isSubscriptionReactivate = pathname === "/api/account/billing/subscription/reactivate" && method === "POST";
  if (!isDashboard && !isLiveCheckout && !isSubscriptionCheckout && !isSubscriptionCancel && !isSubscriptionReactivate) return null;

  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  if (isLiveCheckout) {
    return handleMemberLiveCreditPackCheckout(ctx, session);
  }
  if (isSubscriptionCheckout) {
    return handleMemberLiveSubscriptionCheckout(ctx, session);
  }
  if (isSubscriptionCancel) {
    return handleMemberSubscriptionManagement(ctx, session, "cancel");
  }
  if (isSubscriptionReactivate) {
    return handleMemberSubscriptionManagement(ctx, session, "reactivate");
  }

  try {
    const dashboard = await getMemberCreditsDashboard({
      env,
      userId: session.user.id,
      limit: url.searchParams.get("limit"),
      applyDailyTopUp: true,
    });
    try {
      const purchaseContext = await getMemberLiveCreditsPurchaseContext({
        env,
        userId: session.user.id,
        includeConfigNames: session.user.role === "admin",
        limit: url.searchParams.get("limit"),
      });
      dashboard.liveCheckout = purchaseContext.liveCheckout;
      dashboard.packs = purchaseContext.packs;
      dashboard.purchaseHistory = purchaseContext.purchaseHistory;
    } catch (error) {
      if (!isBillingStorageUnavailableError(error)) throw error;
      dashboard.liveCheckout = { enabled: false, configured: false, mode: "live", code: "billing_storage_unavailable" };
      dashboard.packs = [];
      dashboard.purchaseHistory = [];
    }
    return json({ ok: true, dashboard });
  } catch (error) {
    return creditsErrorResponse(error, {
      correlationId,
      userId: session.user.id,
    });
  }
}
