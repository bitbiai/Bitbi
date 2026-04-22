import { json } from "../lib/response.js";
import { normalizeEmail, isValidEmail, readJsonBody } from "../lib/request.js";
import { nowIso, sha256Hex } from "../lib/tokens.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from "../lib/rate-limit.js";
import { createAndSendVerificationToken } from "../lib/email.js";
import { requireUser } from "../lib/session.js";
import { logUserActivity } from "../lib/activity.js";

async function evaluateSensitivePublicRateLimit(
  env,
  scope,
  key,
  maxRequests,
  windowMs,
  { correlationId = null, component = "auth-verification", requestInfo = null } = {}
) {
  return evaluateSharedRateLimit(env, scope, key, maxRequests, windowMs, {
    backend: "durable_object",
    failClosedInProduction: true,
    logBlockedEvent: true,
    correlationId,
    component,
    requestInfo,
  });
}

export async function handleVerifyEmail(ctx) {
  const { request, url, env, correlationId } = ctx;
  const ip = getClientIp(request);
  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-verify-ip",
    ip,
    10,
    900_000,
    { correlationId, component: "auth-verify-email", requestInfo: ctx }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  const rawToken = url.searchParams.get("token");

  if (!rawToken) {
    return json(
      { ok: false, error: "Token is missing." },
      { status: 400 }
    );
  }

  const tokenHash = await sha256Hex(rawToken);
  const now = nowIso();

  const tokenRow = await env.DB.prepare(
    `SELECT id, user_id FROM email_verification_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, now)
    .first();

  if (!tokenRow) {
    return json(
      {
        ok: false,
        error: "This verification link is invalid or expired.",
      },
      { status: 400 }
    );
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, verification_method = 'email_verified' WHERE id = ?"
    ).bind(now, tokenRow.user_id),
    env.DB.prepare(
      "UPDATE email_verification_tokens SET used_at = ? WHERE id = ?"
    ).bind(now, tokenRow.id),
    // Invalidate all other unused verification tokens for this user
    env.DB.prepare(
      "UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND id != ? AND used_at IS NULL"
    ).bind(now, tokenRow.user_id, tokenRow.id),
  ]);

  // Log email verification (durable background write)
  ctx.execCtx.waitUntil(
    logUserActivity(env, tokenRow.user_id, "verify_email", null, getClientIp(request))
      .catch(e => console.error("activity log failed:", e))
  );

  return json({
    ok: true,
    message: "Email address verified successfully. You can now log in.",
  });
}

export async function handleResendVerification(ctx) {
  const { request, env, correlationId } = ctx;
  const ip = getClientIp(request);
  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-resend-ip",
    ip,
    3,
    3600_000,
    { correlationId, component: "auth-resend-verification", requestInfo: ctx }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  const body = await readJsonBody(request);

  // Always return generic success to prevent user enumeration
  const genericOk = json({
    ok: true,
    message: "If an account with this email exists and is not yet verified, a new verification email has been sent.",
  });

  if (!body) return genericOk;

  const email = normalizeEmail(body.email);
  if (!email || !isValidEmail(email)) return genericOk;

  const user = await env.DB.prepare(
    "SELECT id, email, status, email_verified_at FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first();

  if (!user || user.status !== "active" || user.email_verified_at) return genericOk;

  await createAndSendVerificationToken(env, user.id, user.email);

  return genericOk;
}

export async function handleRequestReverification(ctx) {
  const { request, env, correlationId } = ctx;
  const ip = getClientIp(request);
  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-reverify-ip",
    ip,
    3,
    3600_000,
    { correlationId, component: "auth-request-reverification", requestInfo: ctx }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const user = await env.DB.prepare(
    "SELECT id, email, verification_method FROM users WHERE id = ? LIMIT 1"
  )
    .bind(session.user.id)
    .first();

  if (!user || user.verification_method !== "legacy_auto") {
    return json({ ok: true, message: "Your email is already verified." });
  }

  await createAndSendVerificationToken(env, user.id, user.email);

  return json({
    ok: true,
    message: "Verification email sent. Please check your inbox.",
  });
}
