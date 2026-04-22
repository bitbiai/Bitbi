import { json } from "./response.js";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
  getSessionTokenFromCookies,
  parseCookies,
} from "./cookies.js";
import { addDaysIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { isProductionEnvironment } from "./rate-limit.js";
import {
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

const SESSION_TOUCH_WINDOW_MS = 10 * 60_000;

function getSessionTouchThreshold(currentTime) {
  return new Date(Date.parse(currentTime) - SESSION_TOUCH_WINDOW_MS).toISOString();
}

async function touchSessionIfStale(env, sessionRow, currentTime) {
  const staleBefore = getSessionTouchThreshold(currentTime);
  if (sessionRow.last_seen_at && sessionRow.last_seen_at >= staleBefore) {
    return;
  }

  await env.DB.prepare(
    `UPDATE sessions
     SET last_seen_at = ?
     WHERE id = ?
       AND (last_seen_at IS NULL OR last_seen_at < ?)`
  )
    .bind(currentTime, sessionRow.session_id, staleBefore)
    .run();
}

export async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = getSessionTokenFromCookies(cookies);

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
      sessions.last_seen_at AS last_seen_at,
      users.email AS email,
      users.created_at AS created_at,
      users.status AS status,
      users.role AS role,
      users.verification_method AS verification_method
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
      AND users.status = 'active'
    LIMIT 1
    `
  )
    .bind(tokenHash, currentTime)
    .first();

  if (!sessionRow) {
    return null;
  }

  await touchSessionIfStale(env, sessionRow, currentTime);

  return {
    sessionId: sessionRow.session_id,
    user: {
      id: sessionRow.user_id,
      email: sessionRow.email,
      createdAt: sessionRow.created_at,
      status: sessionRow.status,
      role: sessionRow.role,
      verificationMethod: sessionRow.verification_method,
    },
  };
}

export async function createSession(env, userId) {
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
    .bind(sessionId, userId, tokenHash, createdAt, expiresAt, createdAt)
    .run();

  return {
    sessionId,
    sessionToken,
    createdAt,
    expiresAt,
  };
}

export async function requireUser(request, env) {
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

function adminSecureSessionResponse(correlationId = null) {
  return withCorrelationId(json(
    { ok: false, error: "Admin access requires a secure session." },
    { status: 403 }
  ), correlationId);
}

function hasSecureAdminSessionCookie(request) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return !!cookies?.[SECURE_SESSION_COOKIE_NAME];
}

function hasLegacyAdminSessionCookie(request) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return !!cookies?.[LEGACY_SESSION_COOKIE_NAME];
}

function logAdminSessionPolicyRejection(request, correlationId, session, reason) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-auth",
    event: "admin_session_policy_rejected",
    level: "warn",
    correlationId,
    admin_user_id: session?.user?.id || null,
    failure_reason: reason,
    status: 403,
    ...getRequestLogFields(request),
  });
}

function logAdminAuthRejection(request, correlationId, session, reason, status) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-auth",
    event: "admin_auth_rejected",
    level: status >= 500 ? "error" : "warn",
    correlationId,
    admin_user_id: session?.user?.id || null,
    user_role: session?.user?.role || null,
    failure_reason: reason,
    status,
    ...getRequestLogFields(request),
  });
}

export async function requireAdmin(request, env, options = {}) {
  const result = await requireUser(request, env);

  if (result instanceof Response) {
    if (result.status === 401) {
      logAdminAuthRejection(request, options.correlationId || null, null, "not_authenticated", 401);
    } else if (result.status === 403) {
      logAdminAuthRejection(request, options.correlationId || null, null, "user_not_active", 403);
    }
    return withCorrelationId(result, options.correlationId || null);
  }

  if (result.user.role !== "admin") {
    logAdminAuthRejection(request, options.correlationId || null, result, "not_admin", 403);
    return withCorrelationId(json(
      { ok: false, error: "Admin privileges required." },
      { status: 403 }
    ), options.correlationId || null);
  }

  if (options.enforceSecureSession !== false && isProductionEnvironment(env)) {
    if (options.isSecure !== true) {
      logAdminSessionPolicyRejection(request, options.correlationId || null, result, "insecure_transport");
      return adminSecureSessionResponse(options.correlationId || null);
    }
    if (!hasSecureAdminSessionCookie(request)) {
      const reason = hasLegacyAdminSessionCookie(request)
        ? "legacy_cookie_only"
        : "secure_cookie_missing";
      logAdminSessionPolicyRejection(request, options.correlationId || null, result, reason);
      return adminSecureSessionResponse(options.correlationId || null);
    }
  }

  return result;
}
