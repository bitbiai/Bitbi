import {
  evaluateSharedRateLimit,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "./rate-limit.js";

export async function enforceSensitiveUserRateLimit(ctx, {
  scope,
  userId,
  maxRequests,
  windowMs,
  component,
}) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    scope,
    userId,
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
