import { json } from "../lib/response.js";
import { normalizeEmail, isValidEmail, readJsonBody } from "../lib/request.js";
import { nowIso, addMinutesIso, randomTokenHex, sha256Hex } from "../lib/tokens.js";
import { hashPassword } from "../lib/passwords.js";
import { isRateLimited, getClientIp, rateLimitResponse } from "../lib/rate-limit.js";
import { sendResetEmail } from "../lib/email.js";
import { logUserActivity } from "../lib/activity.js";

export async function handleForgotPassword(ctx) {
  const { request, env } = ctx;
  const ip = getClientIp(request);
  if (isRateLimited(`forgot:${ip}`, 5, 3600_000)) return rateLimitResponse();

  const body = await readJsonBody(request);

  // Always return generic success to prevent user enumeration
  const genericOk = json({
    ok: true,
    message:
      "If an account with this email exists, a reset link has been sent.",
  });

  if (!body) return genericOk;

  const email = normalizeEmail(body.email);
  if (!email || !isValidEmail(email)) return genericOk;

  // Per-email rate limit (returns generic to avoid revealing email existence)
  if (isRateLimited(`forgot-email:${email}`, 3, 3600_000)) return genericOk;

  const user = await env.DB.prepare(
    "SELECT id, email, status FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first();

  if (!user || user.status !== "active") return genericOk;

  // Generate token, store only the hash
  const rawToken = randomTokenHex(32);
  const tokenHash = await sha256Hex(rawToken);
  const tokenId = crypto.randomUUID();
  const now = nowIso();
  const expiresAt = addMinutesIso(60);

  await env.DB.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(tokenId, user.id, tokenHash, expiresAt, now)
    .run();

  // Send email (fire-and-forget — don't leak failures)
  const resetLink = `${env.APP_BASE_URL}/account/reset-password.html?token=${rawToken}`;
  try {
    await sendResetEmail(env, user.email, resetLink);
  } catch (e) {
    console.error("Reset email failed:", e);
  }

  return genericOk;
}

export async function handleValidateReset(ctx) {
  const { request, url, env } = ctx;
  const ip = getClientIp(request);
  if (isRateLimited(`reset-validate:${ip}`, 10, 900_000)) return rateLimitResponse();

  const rawToken = url.searchParams.get("token");

  if (!rawToken) {
    return json({ ok: true, valid: false });
  }

  const tokenHash = await sha256Hex(rawToken);
  const now = nowIso();

  const row = await env.DB.prepare(
    `SELECT id FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, now)
    .first();

  return json({ ok: true, valid: !!row });
}

export async function handleResetPassword(ctx) {
  const { request, env } = ctx;
  const ip = getClientIp(request);
  if (isRateLimited(`reset:${ip}`, 5, 3600_000)) return rateLimitResponse();

  const body = await readJsonBody(request);

  if (!body) {
    return json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const rawToken = String(body.token || "");
  const password = String(body.password || "");

  if (!rawToken) {
    return json(
      { ok: false, error: "Token is missing." },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return json(
      {
        ok: false,
        error: "Password must be at least 8 characters long.",
      },
      { status: 400 }
    );
  }

  if (password.length > 128) {
    return json(
      {
        ok: false,
        error: "Password must not exceed 128 characters.",
      },
      { status: 400 }
    );
  }

  const tokenHash = await sha256Hex(rawToken);
  const now = nowIso();

  const tokenRow = await env.DB.prepare(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, now)
    .first();

  if (!tokenRow) {
    return json(
      {
        ok: false,
        error:
          "This link is invalid or expired. Please request a new one.",
      },
      { status: 400 }
    );
  }

  // Hash new password and update user
  const newHash = await hashPassword(password, env);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(
      newHash,
      tokenRow.user_id
    ),
    env.DB.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?"
    ).bind(now, tokenRow.id),
    // Invalidate all other unused reset tokens for this user
    env.DB.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND id != ? AND used_at IS NULL"
    ).bind(now, tokenRow.user_id, tokenRow.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(
      tokenRow.user_id
    ),
  ]);

  // Log password reset (durable background write)
  ctx.execCtx.waitUntil(
    logUserActivity(env, tokenRow.user_id, "reset_password", null, ip)
      .catch(e => console.error("activity log failed:", e))
  );

  return json({
    ok: true,
    message: "Password changed successfully. You can now log in.",
  });
}
