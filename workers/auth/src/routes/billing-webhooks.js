import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  isRequestBodyError,
  readTextBodyLimited,
  requestBodyErrorResponse,
} from "../lib/request.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  BillingEventError,
  BILLING_WEBHOOK_STRIPE_PROVIDER,
  BILLING_WEBHOOK_TEST_PROVIDER,
  billingEventErrorResponse,
  ingestVerifiedBillingProviderEvent,
  parseBillingWebhookPayload,
  verifySyntheticBillingWebhookRequest,
} from "../lib/billing-events.js";
import {
  StripeBillingError,
  handleVerifiedStripeLiveWebhookEvent,
  handleVerifiedStripeWebhookEvent,
  parseVerifiedStripeWebhookPayload,
  stripeBillingErrorResponse,
  verifyStripeLiveWebhookRequest,
  verifyStripeWebhookRequest,
} from "../lib/stripe-billing.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import { processTransactionalMessages } from "../lib/transactional-messages.js";

async function enforceBillingWebhookRateLimit(ctx, provider) {
  const normalizedProvider = provider === "stripe-live"
    ? "stripe-live"
    : provider === BILLING_WEBHOOK_STRIPE_PROVIDER
    ? BILLING_WEBHOOK_STRIPE_PROVIDER
    : BILLING_WEBHOOK_TEST_PROVIDER;
  const result = await evaluateSharedRateLimit(
    ctx.env,
    `billing-webhook-${normalizedProvider}-ip`,
    getClientIp(ctx.request),
    120,
    15 * 60_000,
    sensitiveRateLimitOptions({
      component: `billing-webhook-${normalizedProvider}`,
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

function billingEventErrorJson(error, ctx = null) {
  if (error instanceof BillingEventError) {
    return json(billingEventErrorResponse(error), { status: error.status });
  }
  if (error instanceof StripeBillingError) {
    return json(stripeBillingErrorResponse(error), { status: error.status });
  }
  logDiagnostic({
    service: "bitbi-auth",
    component: "billing-webhooks",
    event: "billing_webhook_unexpected_error",
    level: "error",
    correlationId: ctx?.correlationId || null,
    code: "billing_webhook_unexpected_error",
    ...getErrorFields(error),
  });
  return json({
    ok: false,
    error: "Billing webhook processing failed.",
    code: "billing_webhook_unexpected_error",
  }, { status: 500 });
}

export async function handleBillingWebhooks(ctx) {
  const { request, env, pathname, method } = ctx;
  const liveStripeMatch = pathname === "/api/billing/webhooks/stripe/live";
  const match = liveStripeMatch ? ["", "stripe-live"] : pathname.match(/^\/api\/billing\/webhooks\/([^/]+)$/);
  if (!match) return null;
  if (method !== "POST") return null;

  const provider = match[1];
  const limited = await enforceBillingWebhookRateLimit(ctx, provider);
  if (limited) return limited;

  let rawBody;
  try {
    rawBody = await readTextBodyLimited(request, {
      maxBytes: BODY_LIMITS.billingWebhookRaw,
      requiredContentType: true,
      allowedTypes: ["application/json"],
    });
  } catch (error) {
    if (isRequestBodyError(error)) return requestBodyErrorResponse(error);
    throw error;
  }

  try {
    if (liveStripeMatch) {
      const verification = await verifyStripeLiveWebhookRequest({
        env,
        rawBody,
        request,
      });
      const payload = parseVerifiedStripeWebhookPayload(rawBody);
      const result = await handleVerifiedStripeLiveWebhookEvent({
        env,
        rawBody,
        payload,
        verificationStatus: verification.verificationStatus,
      });
      // Credit-pack confirmation is already queued. Wake the existing outbox
      // now; the five-minute cron remains the recovery path. The outbox lease
      // and provider idempotency key keep a concurrent cron from sending twice.
      if (result.creditGrant && ctx.execCtx?.waitUntil) {
        ctx.execCtx.waitUntil(processTransactionalMessages(env, { limit: 2 }).catch(() => logDiagnostic({
          service: "bitbi-auth",
          component: "consumer-mail",
          event: "consumer_mail_wake_failed",
          level: "error",
          code: "consumer_mail_wake_failed",
          correlationId: ctx.correlationId,
        })));
      }
      return json(
        {
          ok: true,
          duplicate: result.duplicate,
          actionPlanned: result.actionPlanned,
          event: result.event,
          checkout: result.checkout,
          creditGrant: result.creditGrant,
          subscription: result.subscription || null,
          liveBillingEnabled: true,
        },
        { status: result.duplicate ? 200 : 202 }
      );
    }

    if (provider === BILLING_WEBHOOK_STRIPE_PROVIDER) {
      const verification = await verifyStripeWebhookRequest({
        env,
        rawBody,
        request,
      });
      const payload = parseVerifiedStripeWebhookPayload(rawBody);
      const result = await handleVerifiedStripeWebhookEvent({
        env,
        rawBody,
        payload,
        verificationStatus: verification.verificationStatus,
      });
      return json(
        {
          ok: true,
          duplicate: result.duplicate,
          actionPlanned: result.actionPlanned,
          event: result.event,
          checkout: result.checkout,
          creditGrant: result.creditGrant,
          liveBillingEnabled: false,
        },
        { status: result.duplicate ? 200 : 202 }
      );
    }

    const verification = await verifySyntheticBillingWebhookRequest({
      env,
      provider,
      rawBody,
      request,
    });
    const payload = parseBillingWebhookPayload(rawBody);
    const result = await ingestVerifiedBillingProviderEvent({
      env,
      provider: verification.provider,
      rawBody,
      payload,
      verificationStatus: verification.verificationStatus,
    });
    return json(
      {
        ok: true,
        duplicate: result.duplicate,
        actionPlanned: result.actionPlanned,
        event: result.event,
        liveBillingEnabled: false,
      },
      { status: result.duplicate ? 200 : 202 }
    );
  } catch (error) {
    return billingEventErrorJson(error, ctx);
  }
}
