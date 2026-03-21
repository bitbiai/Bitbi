import { json } from "../lib/response.js";
import { normalizeEmail, isValidEmail, readJsonBody } from "../lib/request.js";
import { parseCookies, buildSessionCookie, buildExpiredSessionCookie } from "../lib/cookies.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { nowIso, addDaysIso, randomTokenHex, sha256Hex } from "../lib/tokens.js";
import { getSessionUser } from "../lib/session.js";
import { isRateLimited, getClientIp, rateLimitResponse } from "../lib/rate-limit.js";
import { createAndSendVerificationToken } from "../lib/email.js";

export async function handleMe(ctx) {
  const { request, env } = ctx;
  const session = await getSessionUser(request, env);

  if (!session) {
    return json({
      loggedIn: false,
      user: null,
    });
  }

  return json({
    loggedIn: true,
    user: session.user,
  });
}

export async function handleRegister(ctx) {
  const { request, env } = ctx;
  const ip = getClientIp(request);
  if (isRateLimited(`register:${ip}`, 5, 3600_000)) return rateLimitResponse();

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
  if (isRateLimited(`register-email:${email}`, 3, 3600_000)) {
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
  const { request, env, isSecure } = ctx;
  const ip = getClientIp(request);
  if (isRateLimited(`login:${ip}`, 10, 900_000)) return rateLimitResponse();

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
  if (isRateLimited(`login-email:${email}`, 10, 900_000)) return rateLimitResponse();

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
    return json(
      {
        ok: false,
        error: "Invalid email or password.",
      },
      { status: 401 }
    );
  }

  if (user.status !== "active") {
    return json(
      {
        ok: false,
        error: "This account is not active.",
      },
      { status: 403 }
    );
  }

  if (!user.email_verified_at) {
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

  const sessionToken = randomTokenHex(32);
  const tokenHash = await sha256Hex(`${sessionToken}:${env.SESSION_SECRET}`);
  const sessionId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = addDaysIso(30);

  await env.DB.prepare(
    `
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  )
    .bind(sessionId, user.id, tokenHash, createdAt, expiresAt, createdAt)
    .run();

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
  const sessionToken = cookies.bitbi_session;

  if (sessionToken) {
    const tokenHash = await sha256Hex(`${sessionToken}:${env.SESSION_SECRET}`);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  const response = json({
    ok: true,
    message: "Logout successful.",
  });

  response.headers.set("Set-Cookie", buildExpiredSessionCookie(isSecure));
  return response;
}
