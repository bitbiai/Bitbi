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
  billingEventErrorResponse,
  ingestVerifiedBillingProviderEvent,
  parseBillingWebhookPayload,
  verifySyntheticBillingWebhookRequest,
} from "../lib/billing-events.js";

async function enforceBillingWebhookRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    "billing-webhook-test-ip",
    getClientIp(ctx.request),
    120,
    15 * 60_000,
    sensitiveRateLimitOptions({
      component: "billing-webhook-test",
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
  throw error;
}

export async function handleBillingWebhooks(ctx) {
  const { request, env, pathname, method } = ctx;
  const match = pathname.match(/^\/api\/billing\/webhooks\/([^/]+)$/);
  if (!match) return null;
  if (method !== "POST") return null;

  const provider = match[1];
  const limited = await enforceBillingWebhookRateLimit(ctx);
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
