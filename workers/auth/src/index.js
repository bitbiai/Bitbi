function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function addMinutesIso(minutes) {
  const d = new Date();
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = rawValue.join("=");
  }

  return cookies;
}

function randomTokenHex(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildSessionCookie(token, isSecure) {
  const parts = [
    `bitbi_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=2592000",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildExpiredSessionCookie(isSecure) {
  const parts = [
    "bitbi_session=",
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const hashBytes = new Uint8Array(derivedBits);

  return `pbkdf2_sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hashBytes)}`;
}

async function verifyPassword(password, storedHash) {
  try {
    const [algo, iterationsStr, saltB64, expectedHashB64] = String(storedHash).split("$");

    if (algo !== "pbkdf2_sha256") return false;

    const iterations = Number(iterationsStr);
    if (!iterations || !saltB64 || !expectedHashB64) return false;

    const encoder = new TextEncoder();
    const salt = base64ToBytes(saltB64);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );

    const actualHashB64 = bytesToBase64(new Uint8Array(derivedBits));
    return actualHashB64 === expectedHashB64;
  } catch {
    return false;
  }
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendVerificationEmail(env, toEmail, verifyLink) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: "BITBI — Verify your email address",
      text: [
        "Hello,",
        "",
        "Thank you for registering at BITBI!",
        "",
        "Please verify your email address by clicking the following link:",
        verifyLink,
        "",
        "This link is valid for 60 minutes and can only be used once.",
        "",
        "If you did not register at BITBI, you can ignore this email.",
        "",
        "— BITBI",
      ].join("\n"),
      html: [
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#d4d4d4;background:#0a0a0a;padding:32px;border-radius:12px">',
        '<h2 style="color:#00F0FF;margin-top:0">Verify your email</h2>',
        "<p>Hello,</p>",
        "<p>Thank you for registering at BITBI!</p>",
        "<p>Please verify your email address:</p>",
        `<p><a href="${verifyLink}" style="display:inline-block;padding:12px 24px;background:#00F0FF;color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:600">Verify Email</a></p>`,
        '<p style="font-size:13px;color:#888">Or copy this link:</p>',
        `<p style="font-size:13px;word-break:break-all;color:#00F0FF">${verifyLink}</p>`,
        '<p style="font-size:13px;color:#888">This link is valid for 60 minutes and can only be used once.</p>',
        '<p style="font-size:13px;color:#888">If you did not register at BITBI, you can ignore this email.</p>',
        '<p style="margin-top:24px;color:#555">— BITBI</p>',
        "</div>",
      ].join(""),
    }),
  });

  return res.ok;
}

async function createAndSendVerificationToken(env, userId, email) {
  const rawToken = randomTokenHex(32);
  const tokenHash = await sha256Hex(rawToken);
  const tokenId = crypto.randomUUID();
  const now = nowIso();
  const expiresAt = addMinutesIso(60);

  await env.DB.prepare(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(tokenId, userId, tokenHash, expiresAt, now)
    .run();

  const verifyLink = `${env.APP_BASE_URL}/verify-email.html?token=${rawToken}`;
  try {
    await sendVerificationEmail(env, email, verifyLink);
  } catch (e) {
    console.error("Verification email failed:", e);
  }
}

async function sendResetEmail(env, toEmail, resetLink) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: "BITBI — Reset your password",
      text: [
        "Hello,",
        "",
        "You requested a password reset for your BITBI account.",
        "",
        "Click the following link to set a new password:",
        resetLink,
        "",
        "This link is valid for 60 minutes and can only be used once.",
        "",
        "If you did not request this, you can ignore this email.",
        "",
        "— BITBI",
      ].join("\n"),
      html: [
        "<div style=\"font-family:sans-serif;max-width:480px;margin:0 auto;color:#d4d4d4;background:#0a0a0a;padding:32px;border-radius:12px\">",
        "<h2 style=\"color:#FFB300;margin-top:0\">Reset Password</h2>",
        "<p>Hello,</p>",
        "<p>You requested a password reset for your BITBI account.</p>",
        `<p><a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#00F0FF;color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:600">Set New Password</a></p>`,
        "<p style=\"font-size:13px;color:#888\">Or copy this link:</p>",
        `<p style="font-size:13px;word-break:break-all;color:#00F0FF">${resetLink}</p>`,
        "<p style=\"font-size:13px;color:#888\">This link is valid for 60 minutes and can only be used once.</p>",
        "<p style=\"font-size:13px;color:#888\">If you did not request this, you can ignore this email.</p>",
        "<p style=\"margin-top:24px;color:#555\">— BITBI</p>",
        "</div>",
      ].join(""),
    }),
  });

  return res.ok;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = cookies.bitbi_session;

  if (!sessionToken) {
    return null;
  }

  const tokenHash = await sha256Hex(`${sessionToken}:${env.SESSION_SECRET}`);
  const currentTime = nowIso();

  const sessionRow = await env.DB.prepare(
    `
    SELECT
      sessions.id AS session_id,
      sessions.user_id AS user_id,
      sessions.expires_at AS expires_at,
      users.email AS email,
      users.created_at AS created_at,
      users.status AS status,
      users.role AS role
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
    LIMIT 1
    `
  )
    .bind(tokenHash, currentTime)
    .first();

  if (!sessionRow) {
    return null;
  }

  await env.DB.prepare(
    `UPDATE sessions SET last_seen_at = ? WHERE id = ?`
  )
    .bind(currentTime, sessionRow.session_id)
    .run();

  return {
    sessionId: sessionRow.session_id,
    user: {
      id: sessionRow.user_id,
      email: sessionRow.email,
      createdAt: sessionRow.created_at,
      status: sessionRow.status,
      role: sessionRow.role,
    },
  };
}

async function requireUser(request, env) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }

  if (session.user.status !== "active") {
    return json(
      { ok: false, error: "This account is not active." },
      { status: 403 }
    );
  }

  return session;
}

async function requireAdmin(request, env) {
  const result = await requireUser(request, env);

  if (result instanceof Response) {
    return result;
  }

  if (result.user.role !== "admin") {
    return json(
      { ok: false, error: "Admin privileges required." },
      { status: 403 }
    );
  }

  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const isSecure = url.protocol === "https:";

    if (pathname === "/api/health" && method === "GET") {
      return json({
        ok: true,
        service: "bitbi-auth",
        message: "Auth worker is live",
      });
    }

    if (pathname === "/api/me" && method === "GET") {
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

    if (pathname === "/api/register" && method === "POST") {
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

      if (password.length < 10) {
        return json(
          {
            ok: false,
            error: "Password must be at least 10 characters long.",
          },
          { status: 400 }
        );
      }

      const existingUser = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ? LIMIT 1"
      )
        .bind(email)
        .first();

      if (existingUser) {
        return json(
          {
            ok: false,
            error: "This email is already registered.",
          },
          { status: 409 }
        );
      }

      const userId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
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

    if (pathname === "/api/login" && method === "POST") {
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

      const user = await env.DB.prepare(
        `
        SELECT id, email, password_hash, created_at, status, email_verified_at
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

      if (user.status !== "active") {
        return json(
          {
            ok: false,
            error: "This account is not active.",
          },
          { status: 403 }
        );
      }

      const passwordOk = await verifyPassword(password, user.password_hash);

      if (!passwordOk) {
        return json(
          {
            ok: false,
            error: "Invalid email or password.",
          },
          { status: 401 }
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
        },
      });

      response.headers.set("Set-Cookie", buildSessionCookie(sessionToken, isSecure));
      return response;
    }

    if (pathname === "/api/logout" && method === "POST") {
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

    // ── Admin Endpoints ──────────────────────────────────────

    if (pathname === "/api/admin/me" && method === "GET") {
      const result = await requireAdmin(request, env);

      if (result instanceof Response) {
        return result;
      }

      return json({
        ok: true,
        user: result.user,
      });
    }

    if (pathname === "/api/admin/users" && method === "GET") {
      const result = await requireAdmin(request, env);

      if (result instanceof Response) {
        return result;
      }

      const search = url.searchParams.get("search");

      let rows;
      if (search) {
        rows = await env.DB.prepare(
          `
          SELECT id, email, role, status, created_at, updated_at, email_verified_at
          FROM users
          WHERE email LIKE ?
          ORDER BY created_at DESC
          `
        )
          .bind(`%${search}%`)
          .all();
      } else {
        rows = await env.DB.prepare(
          `
          SELECT id, email, role, status, created_at, updated_at, email_verified_at
          FROM users
          ORDER BY created_at DESC
          `
        )
          .all();
      }

      return json({
        ok: true,
        users: rows.results,
      });
    }

    // PATCH /api/admin/users/:id/role
    if (
      pathname.startsWith("/api/admin/users/") &&
      pathname.endsWith("/role") &&
      method === "PATCH"
    ) {
      const result = await requireAdmin(request, env);

      if (result instanceof Response) {
        return result;
      }

      const parts = pathname.split("/");
      // ["", "api", "admin", "users", ":id", "role"]
      const targetUserId = parts[4];

      if (!targetUserId || parts.length !== 6) {
        return json(
          { ok: false, error: "Invalid path." },
          { status: 400 }
        );
      }

      const body = await readJsonBody(request);

      if (!body) {
        return json(
          { ok: false, error: "Invalid JSON body." },
          { status: 400 }
        );
      }

      const newRole = body.role;

      if (newRole !== "user" && newRole !== "admin") {
        return json(
          { ok: false, error: "Invalid role. Allowed: \"user\" or \"admin\"." },
          { status: 400 }
        );
      }

      if (targetUserId === result.user.id && newRole !== "admin") {
        return json(
          { ok: false, error: "You cannot remove your own admin role." },
          { status: 400 }
        );
      }

      const targetUser = await env.DB.prepare(
        "SELECT id FROM users WHERE id = ? LIMIT 1"
      )
        .bind(targetUserId)
        .first();

      if (!targetUser) {
        return json(
          { ok: false, error: "User not found." },
          { status: 404 }
        );
      }

      const now = nowIso();

      await env.DB.prepare(
        "UPDATE users SET role = ?, updated_at = ? WHERE id = ?"
      )
        .bind(newRole, now, targetUserId)
        .run();

      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          crypto.randomUUID(),
          result.user.id,
          "change_role",
          targetUserId,
          JSON.stringify({ role: newRole }),
          now
        )
        .run();

      const updatedUser = await env.DB.prepare(
        "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
      )
        .bind(targetUserId)
        .first();

      return json({
        ok: true,
        user: updatedUser,
      });
    }

    // PATCH /api/admin/users/:id/status
    if (
      pathname.startsWith("/api/admin/users/") &&
      pathname.endsWith("/status") &&
      method === "PATCH"
    ) {
      const result = await requireAdmin(request, env);

      if (result instanceof Response) {
        return result;
      }

      const parts = pathname.split("/");
      // ["", "api", "admin", "users", ":id", "status"]
      const targetUserId = parts[4];

      if (!targetUserId || parts.length !== 6) {
        return json(
          { ok: false, error: "Invalid path." },
          { status: 400 }
        );
      }

      const body = await readJsonBody(request);

      if (!body) {
        return json(
          { ok: false, error: "Invalid JSON body." },
          { status: 400 }
        );
      }

      const newStatus = body.status;

      if (newStatus !== "active" && newStatus !== "disabled") {
        return json(
          { ok: false, error: "Invalid status. Allowed: \"active\" or \"disabled\"." },
          { status: 400 }
        );
      }

      if (targetUserId === result.user.id && newStatus === "disabled") {
        return json(
          { ok: false, error: "You cannot disable your own account." },
          { status: 400 }
        );
      }

      const targetUser = await env.DB.prepare(
        "SELECT id FROM users WHERE id = ? LIMIT 1"
      )
        .bind(targetUserId)
        .first();

      if (!targetUser) {
        return json(
          { ok: false, error: "User not found." },
          { status: 404 }
        );
      }

      const now = nowIso();

      await env.DB.prepare(
        "UPDATE users SET status = ?, updated_at = ? WHERE id = ?"
      )
        .bind(newStatus, now, targetUserId)
        .run();

      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          crypto.randomUUID(),
          result.user.id,
          "change_status",
          targetUserId,
          JSON.stringify({ status: newStatus }),
          now
        )
        .run();

      const updatedUser = await env.DB.prepare(
        "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
      )
        .bind(targetUserId)
        .first();

      return json({
        ok: true,
        user: updatedUser,
      });
    }

    // POST /api/admin/users/:id/revoke-sessions
    if (
      pathname.startsWith("/api/admin/users/") &&
      pathname.endsWith("/revoke-sessions") &&
      method === "POST"
    ) {
      const result = await requireAdmin(request, env);

      if (result instanceof Response) {
        return result;
      }

      const parts = pathname.split("/");
      // ["", "api", "admin", "users", ":id", "revoke-sessions"]
      const targetUserId = parts[4];

      if (!targetUserId || parts.length !== 6) {
        return json(
          { ok: false, error: "Invalid path." },
          { status: 400 }
        );
      }

      if (targetUserId === result.user.id) {
        return json(
          { ok: false, error: "You cannot revoke your own sessions here." },
          { status: 400 }
        );
      }

      const targetUser = await env.DB.prepare(
        "SELECT id FROM users WHERE id = ? LIMIT 1"
      )
        .bind(targetUserId)
        .first();

      if (!targetUser) {
        return json(
          { ok: false, error: "User not found." },
          { status: 404 }
        );
      }

      const deleteResult = await env.DB.prepare(
        "DELETE FROM sessions WHERE user_id = ?"
      )
        .bind(targetUserId)
        .run();

      const now = nowIso();

      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          crypto.randomUUID(),
          result.user.id,
          "revoke_sessions",
          targetUserId,
          JSON.stringify({ revokedSessions: deleteResult.meta.changes }),
          now
        )
        .run();

      return json({
        ok: true,
        revokedSessions: deleteResult.meta.changes,
        targetUserId,
      });
    }

    // DELETE /api/admin/users/:id
    if (
      pathname.startsWith("/api/admin/users/") &&
      method === "DELETE"
    ) {
      const result = await requireAdmin(request, env);

      if (result instanceof Response) {
        return result;
      }

      const parts = pathname.split("/");
      // ["", "api", "admin", "users", ":id"]
      const targetUserId = parts[4];

      if (!targetUserId || parts.length !== 5) {
        return json(
          { ok: false, error: "Invalid path." },
          { status: 400 }
        );
      }

      if (targetUserId === result.user.id) {
        return json(
          { ok: false, error: "You cannot delete your own account." },
          { status: 400 }
        );
      }

      const targetUser = await env.DB.prepare(
        "SELECT id FROM users WHERE id = ? LIMIT 1"
      )
        .bind(targetUserId)
        .first();

      if (!targetUser) {
        return json(
          { ok: false, error: "User not found." },
          { status: 404 }
        );
      }

      const now = nowIso();

      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId),
        env.DB.prepare(
          `INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          result.user.id,
          "delete_user",
          targetUserId,
          JSON.stringify({ deletedUserId: targetUserId }),
          now
        ),
      ]);

      return json({
        ok: true,
        deletedUserId: targetUserId,
      });
    }

    // ── Password Reset ──────────────────────────────────────

    if (pathname === "/api/forgot-password" && method === "POST") {
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
      const resetLink = `${env.APP_BASE_URL}/reset-password.html?token=${rawToken}`;
      try {
        await sendResetEmail(env, user.email, resetLink);
      } catch (e) {
        console.error("Reset email failed:", e);
      }

      return genericOk;
    }

    if (pathname === "/api/reset-password/validate" && method === "GET") {
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

    if (pathname === "/api/reset-password" && method === "POST") {
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

      if (password.length < 10) {
        return json(
          {
            ok: false,
            error: "Password must be at least 10 characters long.",
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
      const newHash = await hashPassword(password);

      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(
          newHash,
          tokenRow.user_id
        ),
        env.DB.prepare(
          "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?"
        ).bind(now, tokenRow.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(
          tokenRow.user_id
        ),
      ]);

      return json({
        ok: true,
        message: "Password changed successfully. You can now log in.",
      });
    }

    // ── Email Verification ─────────────────────────────────

    if (pathname === "/api/verify-email" && method === "GET") {
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
          "UPDATE users SET email_verified_at = ? WHERE id = ?"
        ).bind(now, tokenRow.user_id),
        env.DB.prepare(
          "UPDATE email_verification_tokens SET used_at = ? WHERE id = ?"
        ).bind(now, tokenRow.id),
        // Invalidate all other unused verification tokens for this user
        env.DB.prepare(
          "UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND id != ? AND used_at IS NULL"
        ).bind(now, tokenRow.user_id, tokenRow.id),
      ]);

      return json({
        ok: true,
        message: "Email address verified successfully. You can now log in.",
      });
    }

    if (pathname === "/api/resend-verification" && method === "POST") {
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

    return json(
      {
        ok: false,
        error: "Not found",
      },
      { status: 404 }
    );
  },
};
