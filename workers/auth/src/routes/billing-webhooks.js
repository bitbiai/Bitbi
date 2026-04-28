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

function billingEventErrorJson(error) {
  if (error instanceof BillingEventError) {
    return json(billingEventErrorResponse(error), { status: error.status });
  }
  if (error instanceof StripeBillingError) {
    return json(stripeBillingErrorResponse(error), { status: error.status });
  }
  throw error;
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
      return json(
        {
          ok: true,
          duplicate: result.duplicate,
          actionPlanned: result.actionPlanned,
          event: result.event,
          checkout: result.checkout,
          creditGrant: result.creditGrant,
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
    return billingEventErrorJson(error);
  }
}
