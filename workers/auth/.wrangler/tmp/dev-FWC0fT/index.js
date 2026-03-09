var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers
    }
  });
}
__name(json, "json");
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
__name(isValidEmail, "isValidEmail");
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
__name(bytesToBase64, "bytesToBase64");
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(base64ToBytes, "base64ToBytes");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function addDaysIso(days) {
  const d = /* @__PURE__ */ new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
__name(addDaysIso, "addDaysIso");
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
__name(parseCookies, "parseCookies");
function randomTokenHex(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomTokenHex, "randomTokenHex");
function buildSessionCookie(token, isSecure) {
  const parts = [
    `bitbi_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=2592000"
  ];
  if (isSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
__name(buildSessionCookie, "buildSessionCookie");
function buildExpiredSessionCookie(isSecure) {
  const parts = [
    "bitbi_session=",
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
__name(buildExpiredSessionCookie, "buildExpiredSessionCookie");
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 1e5;
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
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  const hashBytes = new Uint8Array(derivedBits);
  return `pbkdf2_sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hashBytes)}`;
}
__name(hashPassword, "hashPassword");
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
        hash: "SHA-256"
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
__name(verifyPassword, "verifyPassword");
async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
__name(readJsonBody, "readJsonBody");
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
  ).bind(tokenHash, currentTime).first();
  if (!sessionRow) {
    return null;
  }
  await env.DB.prepare(
    `UPDATE sessions SET last_seen_at = ? WHERE id = ?`
  ).bind(currentTime, sessionRow.session_id).run();
  return {
    sessionId: sessionRow.session_id,
    user: {
      id: sessionRow.user_id,
      email: sessionRow.email,
      createdAt: sessionRow.created_at,
      status: sessionRow.status,
      role: sessionRow.role
    }
  };
}
__name(getSessionUser, "getSessionUser");
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
__name(requireUser, "requireUser");
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
__name(requireAdmin, "requireAdmin");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const isSecure = url.protocol === "https:";
    if (pathname === "/api/health" && method === "GET") {
      return json({
        ok: true,
        service: "bitbi-auth",
        message: "Auth worker is live"
      });
    }
    if (pathname === "/api/me" && method === "GET") {
      const session = await getSessionUser(request, env);
      if (!session) {
        return json({
          loggedIn: false,
          user: null
        });
      }
      return json({
        loggedIn: true,
        user: session.user
      });
    }
    if (pathname === "/api/register" && method === "POST") {
      const body = await readJsonBody(request);
      if (!body) {
        return json(
          {
            ok: false,
            error: "Ung\xFCltiger JSON-Body."
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
            error: "E-Mail und Passwort sind erforderlich."
          },
          { status: 400 }
        );
      }
      if (!isValidEmail(email)) {
        return json(
          {
            ok: false,
            error: "Bitte eine g\xFCltige E-Mail-Adresse angeben."
          },
          { status: 400 }
        );
      }
      if (password.length < 10) {
        return json(
          {
            ok: false,
            error: "Das Passwort muss mindestens 10 Zeichen lang sein."
          },
          { status: 400 }
        );
      }
      const existingUser = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ? LIMIT 1"
      ).bind(email).first();
      if (existingUser) {
        return json(
          {
            ok: false,
            error: "Diese E-Mail ist bereits registriert."
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
      ).bind(userId, email, passwordHash, createdAt).run();
      return json(
        {
          ok: true,
          message: "Registrierung erfolgreich.",
          user: {
            id: userId,
            email,
            createdAt,
            status: "active"
          }
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
            error: "Ung\xFCltiger JSON-Body."
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
            error: "E-Mail und Passwort sind erforderlich."
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
      ).bind(email).first();
      if (!user) {
        return json(
          {
            ok: false,
            error: "Ung\xFCltige E-Mail oder Passwort."
          },
          { status: 401 }
        );
      }
      if (user.status !== "active") {
        return json(
          {
            ok: false,
            error: "Dieses Konto ist nicht aktiv."
          },
          { status: 403 }
        );
      }
      const passwordOk = await verifyPassword(password, user.password_hash);
      if (!passwordOk) {
        return json(
          {
            ok: false,
            error: "Ung\xFCltige E-Mail oder Passwort."
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
      ).bind(sessionId, user.id, tokenHash, createdAt, expiresAt, createdAt).run();
      const response = json({
        ok: true,
        message: "Login erfolgreich.",
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.created_at,
          status: user.status
        }
      });
      response.headers.set("Set-Cookie", buildSessionCookie(sessionToken, isSecure));
      return response;
    }
    if (pathname === "/api/logout" && method === "POST") {
      const cookies = parseCookies(request.headers.get("Cookie"));
      const sessionToken = cookies.bitbi_session;
      if (sessionToken) {
        const tokenHash = await sha256Hex(`${sessionToken}:${env.SESSION_SECRET}`);
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
      }
      const response = json({
        ok: true,
        message: "Logout erfolgreich."
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
        user: result.user
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
        ).bind(`%${search}%`).all();
      } else {
        rows = await env.DB.prepare(
          `
          SELECT id, email, role, status, created_at, updated_at
          FROM users
          ORDER BY created_at DESC
          `
        ).all();
      }
      return json({
        ok: true,
        users: rows.results
      });
    }
    if (pathname.startsWith("/api/admin/users/") && pathname.endsWith("/role") && method === "PATCH") {
      const result = await requireAdmin(request, env);
      if (result instanceof Response) {
        return result;
      }
      const parts = pathname.split("/");
      const targetUserId = parts[4];
      if (!targetUserId || parts.length !== 6) {
        return json(
          { ok: false, error: "Ung\xFCltiger Pfad." },
          { status: 400 }
        );
      }
      const body = await readJsonBody(request);
      if (!body) {
        return json(
          { ok: false, error: "Ung\xFCltiger JSON-Body." },
          { status: 400 }
        );
      }
      const newRole = body.role;
      if (newRole !== "user" && newRole !== "admin") {
        return json(
          { ok: false, error: 'Ung\xFCltige Rolle. Erlaubt: "user" oder "admin".' },
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
      ).bind(targetUserId).first();
      if (!targetUser) {
        return json(
          { ok: false, error: "Benutzer nicht gefunden." },
          { status: 404 }
        );
      }
      const now = nowIso();
      await env.DB.prepare(
        "UPDATE users SET role = ?, updated_at = ? WHERE id = ?"
      ).bind(newRole, now, targetUserId).run();
      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).bind(
        crypto.randomUUID(),
        result.user.id,
        "change_role",
        targetUserId,
        JSON.stringify({ role: newRole }),
        now
      ).run();
      const updatedUser = await env.DB.prepare(
        "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
      ).bind(targetUserId).first();
      return json({
        ok: true,
        user: updatedUser
      });
    }
    if (pathname.startsWith("/api/admin/users/") && pathname.endsWith("/status") && method === "PATCH") {
      const result = await requireAdmin(request, env);
      if (result instanceof Response) {
        return result;
      }
      const parts = pathname.split("/");
      const targetUserId = parts[4];
      if (!targetUserId || parts.length !== 6) {
        return json(
          { ok: false, error: "Ung\xFCltiger Pfad." },
          { status: 400 }
        );
      }
      const body = await readJsonBody(request);
      if (!body) {
        return json(
          { ok: false, error: "Ung\xFCltiger JSON-Body." },
          { status: 400 }
        );
      }
      const newStatus = body.status;
      if (newStatus !== "active" && newStatus !== "disabled") {
        return json(
          { ok: false, error: 'Ung\xFCltiger Status. Erlaubt: "active" oder "disabled".' },
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
      ).bind(targetUserId).first();
      if (!targetUser) {
        return json(
          { ok: false, error: "Benutzer nicht gefunden." },
          { status: 404 }
        );
      }
      const now = nowIso();
      await env.DB.prepare(
        "UPDATE users SET status = ?, updated_at = ? WHERE id = ?"
      ).bind(newStatus, now, targetUserId).run();
      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).bind(
        crypto.randomUUID(),
        result.user.id,
        "change_status",
        targetUserId,
        JSON.stringify({ status: newStatus }),
        now
      ).run();
      const updatedUser = await env.DB.prepare(
        "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
      ).bind(targetUserId).first();
      return json({
        ok: true,
        user: updatedUser
      });
    }
    if (pathname.startsWith("/api/admin/users/") && pathname.endsWith("/revoke-sessions") && method === "POST") {
      const result = await requireAdmin(request, env);
      if (result instanceof Response) {
        return result;
      }
      const parts = pathname.split("/");
      const targetUserId = parts[4];
      if (!targetUserId || parts.length !== 6) {
        return json(
          { ok: false, error: "Ung\xFCltiger Pfad." },
          { status: 400 }
        );
      }
      if (targetUserId === result.user.id) {
        return json(
          { ok: false, error: "Du kannst deine eigenen Sitzungen hier nicht widerrufen." },
          { status: 400 }
        );
      }
      const targetUser = await env.DB.prepare(
        "SELECT id FROM users WHERE id = ? LIMIT 1"
      ).bind(targetUserId).first();
      if (!targetUser) {
        return json(
          { ok: false, error: "Benutzer nicht gefunden." },
          { status: 404 }
        );
      }
      const deleteResult = await env.DB.prepare(
        "DELETE FROM sessions WHERE user_id = ?"
      ).bind(targetUserId).run();
      const now = nowIso();
      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).bind(
        crypto.randomUUID(),
        result.user.id,
        "revoke_sessions",
        targetUserId,
        JSON.stringify({ revokedSessions: deleteResult.meta.changes }),
        now
      ).run();
      return json({
        ok: true,
        revokedSessions: deleteResult.meta.changes,
        targetUserId
      });
    }
    if (pathname.startsWith("/api/admin/users/") && method === "DELETE") {
      const result = await requireAdmin(request, env);
      if (result instanceof Response) {
        return result;
      }
      const parts = pathname.split("/");
      const targetUserId = parts[4];
      if (!targetUserId || parts.length !== 5) {
        return json(
          { ok: false, error: "Ung\xFCltiger Pfad." },
          { status: 400 }
        );
      }
      if (targetUserId === result.user.id) {
        return json(
          { ok: false, error: "Du kannst dein eigenes Konto nicht l\xF6schen." },
          { status: 400 }
        );
      }
      const targetUser = await env.DB.prepare(
        "SELECT id FROM users WHERE id = ? LIMIT 1"
      ).bind(targetUserId).first();
      if (!targetUser) {
        return json(
          { ok: false, error: "Benutzer nicht gefunden." },
          { status: 404 }
        );
      }
      await env.DB.prepare(
        "DELETE FROM sessions WHERE user_id = ?"
      ).bind(targetUserId).run();
      await env.DB.prepare(
        "DELETE FROM users WHERE id = ?"
      ).bind(targetUserId).run();
      const now = nowIso();
      await env.DB.prepare(
        `
        INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).bind(
        crypto.randomUUID(),
        result.user.id,
        "delete_user",
        targetUserId,
        JSON.stringify({ deletedUserId: targetUserId }),
        now
      ).run();
      return json({
        ok: true,
        deletedUserId: targetUserId
      });
    }
    return json(
      {
        ok: false,
        error: "Not found"
      },
      { status: 404 }
    );
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-8zrnjT/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-8zrnjT/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
