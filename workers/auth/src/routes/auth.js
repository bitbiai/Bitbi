import { json } from "../lib/response.js";
import { normalizeEmail, isValidEmail, readJsonBody } from "../lib/request.js";
import {
  parseCookies,
  buildSessionCookie,
  buildExpiredSessionCookies,
  getSessionTokenFromCookies,
} from "../lib/cookies.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { nowIso, sha256Hex } from "../lib/tokens.js";
import { createSession, getSessionUser } from "../lib/session.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from "../lib/rate-limit.js";
import { createAndSendVerificationToken } from "../lib/email.js";
import { logUserActivity } from "../lib/activity.js";
import { resolveCachedAvatarPresence } from "../lib/profile-avatar-state.js";
import { logDiagnostic } from "../../../../js/shared/worker-observability.mjs";

async function evaluateSensitivePublicRateLimit(
  env,
  scope,
  key,
  maxRequests,
  windowMs,
  { correlationId = null, component = "auth" } = {}
) {
  return evaluateSharedRateLimit(env, scope, key, maxRequests, windowMs, {
    failClosedInProduction: true,
    correlationId,
    component,
  });
}

function logAdminAuthEvent(correlationId, event, fields = {}) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-auth",
    event,
    level: event === "admin_login_succeeded" ? "info" : "warn",
    correlationId,
    ...fields,
  });
}

export async function handleMe(ctx) {
  const { request, env } = ctx;
  const session = await getSessionUser(request, env);

  if (!session) {
    return json({
      loggedIn: false,
      user: null,
    });
  }

  const profileRow = await env.DB.prepare(
    "SELECT display_name, has_avatar FROM profiles WHERE user_id = ? LIMIT 1"
  )
    .bind(session.user.id)
    .first();
  const hasAvatar = await resolveCachedAvatarPresence(env, session.user.id, profileRow?.has_avatar);

  return json({
    loggedIn: true,
    user: {
      ...session.user,
      display_name: profileRow?.display_name || "",
      has_avatar: hasAvatar,
      avatar_url: hasAvatar ? "/api/profile/avatar" : null,
    },
  });
}

export async function handleRegister(ctx) {
  const { request, env, correlationId } = ctx;
  const ip = getClientIp(request);
  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-register-ip",
    ip,
    5,
    3600_000,
    { correlationId, component: "auth-register" }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  const body = await readJsonBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "Invalid JSON body.",
      },
      { status: 400 }
    );
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!email || !password) {
    return json(
      {
        ok: false,
        error: "Email and password are required.",
      },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return json(
      {
        ok: false,
        error: "Please enter a valid email address.",
      },
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

  // Per-email rate limit (returns generic success to prevent enumeration)
  const emailLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-register-email",
    email,
    3,
    3600_000,
    { correlationId, component: "auth-register" }
  );
  if (emailLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (emailLimit.limited) {
    return json(
      {
        ok: true,
        message: "Registration successful. Please check your inbox and verify your email address.",
        needsVerification: true,
      },
      { status: 201 }
    );
  }

  const existingUser = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first();

  if (existingUser) {
    // Return same response as success to prevent email enumeration
    return json(
      {
        ok: true,
        message: "Registration successful. Please check your inbox and verify your email address.",
        needsVerification: true,
      },
      { status: 201 }
    );
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password, env);
  const createdAt = nowIso();

  await env.DB.prepare(
    `
    INSERT INTO users (id, email, password_hash, created_at, status)
    VALUES (?, ?, ?, ?, 'active')
    `
  )
    .bind(userId, email, passwordHash, createdAt)
    .run();

  // Send verification email (do not auto-login)
  await createAndSendVerificationToken(env, userId, email);

  // Log registration (durable background write)
  ctx.execCtx.waitUntil(
    logUserActivity(env, userId, "register", { email }, ip)
      .catch(e => console.error("activity log failed:", e))
  );

  return json(
    {
      ok: true,
      message: "Registration successful. Please check your inbox and verify your email address.",
      needsVerification: true,
    },
    { status: 201 }
  );
}

export async function handleLogin(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const ip = getClientIp(request);
  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-login-ip",
    ip,
    10,
    900_000,
    { correlationId, component: "auth-login" }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  const body = await readJsonBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "Invalid JSON body.",
      },
      { status: 400 }
    );
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!email || !password) {
    return json(
      {
        ok: false,
        error: "Email and password are required.",
      },
      { status: 400 }
    );
  }

  // Per-email rate limit
  const emailLimit = await evaluateSensitivePublicRateLimit(
    env,
    "auth-login-email",
    email,
    10,
    900_000,
    { correlationId, component: "auth-login" }
  );
  if (emailLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (emailLimit.limited) return rateLimitResponse();

  const user = await env.DB.prepare(
    `
    SELECT id, email, password_hash, created_at, status, role, email_verified_at
    FROM users
    WHERE email = ?
    LIMIT 1
    `
  )
    .bind(email)
    .first();

  if (!user) {
    return json(
      {
        ok: false,
        error: "Invalid email or password.",
      },
      { status: 401 }
    );
  }

  // Verify password BEFORE checking status to prevent enumeration
  // (disabled accounts return a distinguishable error — only safe after password proof)
  const { valid, needsRehash } = await verifyPassword(password, user.password_hash, env);

  if (!valid) {
    if (user.role === "admin") {
      logAdminAuthEvent(correlationId, "admin_login_failed", {
        admin_user_id: user.id,
        failure_reason: "invalid_password",
      });
    }
    return json(
      {
        ok: false,
        error: "Invalid email or password.",
      },
      { status: 401 }
    );
  }

  if (user.status !== "active") {
    if (user.role === "admin") {
      logAdminAuthEvent(correlationId, "admin_login_failed", {
        admin_user_id: user.id,
        failure_reason: "account_inactive",
      });
    }
    return json(
      {
        ok: false,
        error: "This account is not active.",
      },
      { status: 403 }
    );
  }

  if (!user.email_verified_at) {
    if (user.role === "admin") {
      logAdminAuthEvent(correlationId, "admin_login_failed", {
        admin_user_id: user.id,
        failure_reason: "email_not_verified",
      });
    }
    return json(
      {
        ok: false,
        error: "Please verify your email address first. Check your inbox (and spam folder).",
        code: "EMAIL_NOT_VERIFIED",
      },
      { status: 403 }
    );
  }

  // Transparent rehash with stronger parameters (only for verified, active users)
  if (needsRehash) {
    const newHash = await hashPassword(password, env);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(newHash, user.id)
      .run();
  }

  const { sessionToken } = await createSession(env, user.id);

  if (user.role === "admin") {
    logAdminAuthEvent(correlationId, "admin_login_succeeded", {
      admin_user_id: user.id,
      session_transport: isSecure ? "secure" : "legacy",
    });
  }

  // Log login (durable background write)
  ctx.execCtx.waitUntil(
    logUserActivity(env, user.id, "login", { email: user.email }, ip)
      .catch(e => console.error("activity log failed:", e))
  );

  const response = json({
    ok: true,
    message: "Login successful.",
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      status: user.status,
      role: user.role,
    },
  });

  response.headers.set("Set-Cookie", buildSessionCookie(sessionToken, isSecure));
  return response;
}

export async function handleLogout(ctx) {
  const { request, env, isSecure } = ctx;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = getSessionTokenFromCookies(cookies);

  let loggedOutUserId = null;
  if (sessionToken) {
    const tokenHash = await sha256Hex(`${sessionToken}:${env.SESSION_SECRET}`);
    // Fetch the session's user_id before deleting
    const sess = await env.DB.prepare(
      "SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1"
    ).bind(tokenHash).first();
    if (sess) loggedOutUserId = sess.user_id;
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  if (loggedOutUserId) {
    ctx.execCtx.waitUntil(
      logUserActivity(env, loggedOutUserId, "logout", null, getClientIp(request))
        .catch(e => console.error("activity log failed:", e))
    );
  }

  const response = json({
    ok: true,
    message: "Logout successful.",
  });

  for (const value of buildExpiredSessionCookies(isSecure)) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
}
