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
      { ok: false, error: "Nicht authentifiziert." },
      { status: 401 }
    );
  }

  if (session.user.status !== "active") {
    return json(
      { ok: false, error: "Dieses Konto ist nicht aktiv." },
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
      { ok: false, error: "Keine Administratorberechtigung." },
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
            error: "Ungültiger JSON-Body.",
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
            error: "E-Mail und Passwort sind erforderlich.",
          },
          { status: 400 }
        );
      }

      if (!isValidEmail(email)) {
        return json(
          {
            ok: false,
            error: "Bitte eine gültige E-Mail-Adresse angeben.",
          },
          { status: 400 }
        );
      }

      if (password.length < 10) {
        return json(
          {
            ok: false,
            error: "Das Passwort muss mindestens 10 Zeichen lang sein.",
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
            error: "Diese E-Mail ist bereits registriert.",
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

      return json(
        {
          ok: true,
          message: "Registrierung erfolgreich.",
          user: {
            id: userId,
            email,
            createdAt,
            status: "active",
          },
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
            error: "Ungültiger JSON-Body.",
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
            error: "E-Mail und Passwort sind erforderlich.",
          },
          { status: 400 }
        );
      }

      const user = await env.DB.prepare(
        `
        SELECT id, email, password_hash, created_at, status
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
            error: "Ungültige E-Mail oder Passwort.",
          },
          { status: 401 }
        );
      }

      if (user.status !== "active") {
        return json(
          {
            ok: false,
            error: "Dieses Konto ist nicht aktiv.",
          },
          { status: 403 }
        );
      }

      const passwordOk = await verifyPassword(password, user.password_hash);

      if (!passwordOk) {
        return json(
          {
            ok: false,
            error: "Ungültige E-Mail oder Passwort.",
          },
          { status: 401 }
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
        message: "Login erfolgreich.",
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
        message: "Logout erfolgreich.",
      });

      response.headers.set("Set-Cookie", buildExpiredSessionCookie(isSecure));
      return response;
    }

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
          SELECT id, email, role, status, created_at, updated_at
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
          SELECT id, email, role, status, created_at, updated_at
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
          { ok: false, error: "Ungültiger Pfad." },
          { status: 400 }
        );
      }

      const body = await readJsonBody(request);

      if (!body) {
        return json(
          { ok: false, error: "Ungültiger JSON-Body." },
          { status: 400 }
        );
      }

      const newRole = body.role;

      if (newRole !== "user" && newRole !== "admin") {
        return json(
          { ok: false, error: "Ungültige Rolle. Erlaubt: \"user\" oder \"admin\"." },
          { status: 400 }
        );
      }

      if (targetUserId === result.user.id && newRole !== "admin") {
        return json(
          { ok: false, error: "Du kannst deine eigene Admin-Rolle nicht entfernen." },
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
          { ok: false, error: "Benutzer nicht gefunden." },
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
          { ok: false, error: "Ungültiger Pfad." },
          { status: 400 }
        );
      }

      const body = await readJsonBody(request);

      if (!body) {
        return json(
          { ok: false, error: "Ungültiger JSON-Body." },
          { status: 400 }
        );
      }

      const newStatus = body.status;

      if (newStatus !== "active" && newStatus !== "disabled") {
        return json(
          { ok: false, error: "Ungültiger Status. Erlaubt: \"active\" oder \"disabled\"." },
          { status: 400 }
        );
      }

      if (targetUserId === result.user.id && newStatus === "disabled") {
        return json(
          { ok: false, error: "Du kannst dein eigenes Konto nicht deaktivieren." },
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
          { ok: false, error: "Benutzer nicht gefunden." },
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

    return json(
      {
        ok: false,
        error: "Not found",
      },
      { status: 404 }
    );
  },
};